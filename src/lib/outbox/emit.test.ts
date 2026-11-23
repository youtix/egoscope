import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, games, incidents, outboxFacts } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  insertEventType,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { emit } from './emit';
import { OUTBOX_FACT_KINDS } from './facts';

import type { OutboxFact } from './facts';
import type { Database } from '@/lib/db';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
// The evening detection pass of Monday 23 November 2026, 23:00 Paris time.
const NOW = toEpochMs(Date.UTC(2026, 10, 23, 22));
const PASS_ID = '0b9f3c1e-5a7d-4e62-8c14-7f2d9a6b3e05';
const LATER = toEpochMs(NOW + 3_600_000);

// The request, the game and the event that the facts name, the first of their tables
// (insertSubjects).
const REQUEST_ID = 1;
const GAME_ID = 1;
const EVENT_ID = 1;
const TO_DO: OutboxFact = { kind: 'backtest_request_to_do', backtestRequestId: REQUEST_ID };
const DEADLINE_MOVED = {
  kind: 'backtest_request_deadline_changed',
  backtestRequestId: REQUEST_ID,
  deadlineGameId: GAME_ID,
  playerEventId: EVENT_ID,
} as const;
// The wake plan a pass left: only the purge is due, an hour later.
const PLAN = { computedAt: NOW, entries: [{ task: 'purge', dueAt: LATER }], probes: [] } as const;

/**
 * Writes the rows that the facts name, each the first of its table: two research types,
 * a followed player, his request to do of the media storm, an event of his, and a season
 * of games.
 */
async function insertSubjects(db: Database): Promise<void> {
  await insertEventType(db);
  await insertEventType(db, { id: 'bereavement', name: 'Death of a loved one' });
  const player = await insertPlayer(db);
  await insertRequest(db, { playerId: player.id });
  await insertDetectedEvent(db, { playerId: player.id });
  await insertLeagueSeason(db, '2024-25');
}

/**
 * The outbox and the wake plan as a build of `lot` loads them, over a database with the
 * rows that the facts name and a plan that a pass left.
 */
async function build(lot: '1' | '2') {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_LOT', lot);
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_outbox');
  const wakePlan = await import('@/lib/wake-plan');
  const outbox = await import('.');
  const database = await createTestDatabase();
  onTestFinished(database.close);
  await insertSubjects(database.db);
  await wakePlan.writePlan(PLAN);
  return {
    emitTwice: async (fact: OutboxFact) => {
      await database.db.transaction(async (tx) => outbox.emit(tx, fact));
      const afterFirst = await wakePlan.readPlan(NOW);
      await wakePlan.writePlan(PLAN);
      await database.db.transaction(async (tx) => outbox.emit(tx, fact));
      const afterSecond = await wakePlan.readPlan(NOW);
      return [afterFirst, afterSecond].map((reading) =>
        reading.ok ? reading.plan.entries : reading.error,
      );
    },
  };
}

describe('emit', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertSubjects(db);
    await db.insert(incidents).values({ kind: 'backup_failed', causeKey: 'upload_failed' });
    onTestFinished(installFakeClock(fixedClock(NOW)));
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Emits each of `facts` in a transaction of its own. */
  async function emitEach(facts: readonly OutboxFact[], passId?: string): Promise<void> {
    for (const fact of facts) {
      await db.transaction(async (tx) => emit(tx, fact, passId));
    }
  }

  const stored = async () =>
    db
      .select({ kind: outboxFacts.kind, passId: outboxFacts.passId, at: outboxFacts.createdAt })
      .from(outboxFacts)
      .orderBy(asc(outboxFacts.id));

  it('[TEL-02] names every kind of the module map, the export reminder being an incident', () => {
    expect(new Set(OUTBOX_FACT_KINDS)).toStrictEqual(
      new Set([
        'backtest_request_to_do',
        'backtest_request_deadline_changed',
        'alert_sheet_produced',
        'alert_sheet_updated',
        'tracked_result_ready',
        'type_proposal_new',
        'incident_opened',
        'incident_closed',
      ]),
    );
    expect(OUTBOX_FACT_KINDS).toHaveLength(8);
  });

  it('[TRV-29] [TEL-17] records a fact once, so that a rerun of its step adds nothing', async () => {
    await emitEach([TO_DO, TO_DO], PASS_ID);

    await expect(stored()).resolves.toStrictEqual([
      { kind: 'backtest_request_to_do', passId: PASS_ID, at: new Date(NOW) },
    ]);
  });

  it('[TEL-17] tells facts apart by their kind, their subject and the version of a deadline change', async () => {
    await db.insert(games).values({
      statsSource: 'sportsdataverse_espn',
      sourceGameRef: '401700002',
      season: '2024-25',
      phase: 'regular_season',
      status: 'scheduled',
      scheduledStartAt: new Date(LATER),
      gameDayOn: '2025-01-16',
      homeTeamId: 2,
      awayTeamId: 1,
      lastFetchedAt: new Date(NOW),
      scheduleChangedAt: new Date(NOW),
    });
    const facts: readonly OutboxFact[] = [
      TO_DO,
      DEADLINE_MOVED,
      { ...DEADLINE_MOVED, deadlineGameId: 2 },
      { kind: 'type_proposal_new', eventTypeId: 'media-storm' },
      { kind: 'type_proposal_new', eventTypeId: 'bereavement' },
      { kind: 'incident_opened', incidentId: 1 },
      { kind: 'incident_closed', incidentId: 1 },
      { kind: 'alert_sheet_produced', lot2SubjectId: 4 },
      { kind: 'alert_sheet_updated', lot2SubjectId: 4 },
      { kind: 'tracked_result_ready', lot2SubjectId: 4 },
    ];

    await emitEach(facts);
    await emitEach(facts);

    await expect(db.$count(outboxFacts)).resolves.toBe(facts.length);
  });

  it('[TEL-02] records the fact in the transaction of its change, which a rollback takes away', async () => {
    const rolledBack = db.transaction(async (tx) => {
      await emit(tx, TO_DO);
      throw new Error('The change failed.');
    });

    await expect(rolledBack).rejects.toThrow('The change failed.');
    await expect(stored()).resolves.toStrictEqual([]);
  });
});

describe('the wake-up of the notification dispatch', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    onTestFinished(installFakeClock(fixedClock(NOW)));
  });

  it('[TEL-02] pulls the wake plan to now for a new fact while Lot 2 is active, and not for the same fact again', async () => {
    const { emitTwice } = await build('2');

    await expect(emitTwice(TO_DO)).resolves.toStrictEqual([
      [
        { task: 'purge', dueAt: LATER },
        { task: 'notification-dispatch', dueAt: NOW },
      ],
      [{ task: 'purge', dueAt: LATER }],
    ]);
  });

  it('[TEL-02] wakes nothing while Lot 1 is active, where nothing consumes the facts', async () => {
    const { emitTwice } = await build('1');

    await expect(emitTwice(TO_DO)).resolves.toStrictEqual([
      [{ task: 'purge', dueAt: LATER }],
      [{ task: 'purge', dueAt: LATER }],
    ]);
  });
});

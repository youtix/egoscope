import { asc, eq, TransactionRollbackError } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { boxScores, createTestDatabase, games, recalculationJobs } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertEventType,
  insertLeagueSeason,
  insertPlayer,
  insertValidCase,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { RecalculationCause, RecalculationScope } from './recalculate';
import type { Database } from '@/lib/db';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const NOW = toEpochMs(Date.UTC(2026, 10, 21, 9));
const LATER = toEpochMs(NOW + 3_600_000);
const FIRST = leaguePlayerId('p01');
const SECOND = leaguePlayerId('p02');
const BEREAVEMENT = 'bereavement';
// The wake plan a pass left: only the purge is due, an hour later.
const PLAN = { computedAt: NOW, entries: [{ task: 'purge', dueAt: LATER }], probes: [] } as const;
const ROW_COLUMNS = {
  scope: recalculationJobs.scope,
  playerIds: recalculationJobs.playerIds,
  eventTypeIds: recalculationJobs.eventTypeIds,
  gameIds: recalculationJobs.gameIds,
  cause: recalculationJobs.cause,
  status: recalculationJobs.status,
};

/** The recalculation module and the wake plan, over a fresh fake of the runtime cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_recalculation');
  return {
    recalculation: await import('./recalculate'),
    wakePlan: await import('@/lib/wake-plan'),
  };
}

describe('the recalculation jobs', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let request: (scope: RecalculationScope, cause: RecalculationCause) => Promise<void>;
  let isInProgress: (playerId: string, eventTypeId: string) => Promise<boolean>;
  let wakePlan: Awaited<ReturnType<typeof load>>['wakePlan'];
  let requestIn: Awaited<ReturnType<typeof load>>['recalculation']['requestRecalculation'];

  beforeEach(async () => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    onTestFinished(installFakeClock(fixedClock(NOW)));
    const loaded = await load();
    wakePlan = loaded.wakePlan;
    requestIn = loaded.recalculation.requestRecalculation;
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(database.close);
    await wakePlan.writePlan(PLAN);
    request = async (scope, cause) => db.transaction(async (tx) => requestIn(tx, scope, cause));
    isInProgress = async (playerId, eventTypeId) =>
      loaded.recalculation.isRecalculating(db, playerId, eventTypeId);
  });

  const jobs = async () =>
    db.select(ROW_COLUMNS).from(recalculationJobs).orderBy(asc(recalculationJobs.id));

  it('[SEN-34] records a pending import job with its players and types', async () => {
    await request(
      { kind: 'import', playerIds: [FIRST], eventTypeIds: [MEDIA_STORM, BEREAVEMENT] },
      'new_cases',
    );

    await expect(jobs()).resolves.toStrictEqual([
      {
        scope: 'import',
        playerIds: [FIRST],
        eventTypeIds: [MEDIA_STORM, BEREAVEMENT],
        gameIds: null,
        cause: 'new_cases',
        status: 'pending',
      },
    ]);
  });

  it('[SEN-34] records a statistics-update job with its players and its games, and no type', async () => {
    await request(
      { kind: 'statistics_update', playerIds: [FIRST, SECOND], gameIds: [7, 9] },
      'stats_correction',
    );

    await expect(jobs()).resolves.toStrictEqual([
      {
        scope: 'statistics_update',
        playerIds: [FIRST, SECOND],
        eventTypeIds: null,
        gameIds: [7, 9],
        cause: 'stats_correction',
        status: 'pending',
      },
    ]);
  });

  it('[SEN-34] records an event-or-case-change job, of every type of the player when it names none', async () => {
    await request({ kind: 'event_or_case_change', playerIds: [SECOND] }, 'manual_decision');

    await expect(jobs()).resolves.toStrictEqual([
      {
        scope: 'event_or_case_change',
        playerIds: [SECOND],
        eventTypeIds: null,
        gameIds: null,
        cause: 'manual_decision',
        status: 'pending',
      },
    ]);
  });

  it('[SEN-34] records a full job with no player, no type and no game', async () => {
    await request({ kind: 'full' }, 'parameter_change');

    await expect(jobs()).resolves.toStrictEqual([
      {
        scope: 'full',
        playerIds: null,
        eventTypeIds: null,
        gameIds: null,
        cause: 'parameter_change',
        status: 'pending',
      },
    ]);
  });

  it('[CL-SEN-17] never merges jobs with different causes, and keeps them in the order recorded', async () => {
    const scope = { kind: 'statistics_update', playerIds: [FIRST], gameIds: [7] } as const;

    await request(scope, 'stats_correction');
    await request(scope, 'new_cases');
    await request(scope, 'baseline_updated');
    await request({ kind: 'full' }, 'recalculation');

    const recorded = await jobs();
    expect(recorded.map((job) => job.cause)).toStrictEqual([
      'stats_correction',
      'new_cases',
      'baseline_updated',
      'recalculation',
    ]);
  });

  it('[CL-SEN-16] leaves no job when the caller rolls its transaction back, and one when it commits', async () => {
    const rolledBack = db.transaction(async (tx) => {
      await requestIn(tx, { kind: 'full' }, 'parameter_change');
      await requestIn(tx, { kind: 'import', playerIds: [FIRST] }, 'new_cases');
      tx.rollback();
    });
    await expect(rolledBack).rejects.toThrow(TransactionRollbackError);
    await expect(jobs()).resolves.toStrictEqual([]);

    await request({ kind: 'import', playerIds: [FIRST] }, 'new_cases');
    await expect(jobs()).resolves.toHaveLength(1);
  });

  it('[CL-SEN-16] records nothing for a scope that names no player', async () => {
    await request({ kind: 'import', playerIds: [] }, 'new_cases');
    await request({ kind: 'statistics_update', playerIds: [], gameIds: [7] }, 'stats_correction');

    await expect(jobs()).resolves.toStrictEqual([]);
    const reading = await wakePlan.readPlan(NOW);
    expect(reading.ok ? reading.plan.entries : reading.error).toStrictEqual(PLAN.entries);
  });

  it('[SEN-34] wakes the recalculation task at once, keeping the entries of the other tasks', async () => {
    await request({ kind: 'import', playerIds: [FIRST] }, 'new_cases');

    const reading = await wakePlan.readPlan(NOW);
    expect(reading.ok ? reading.plan.entries : reading.error).toStrictEqual([
      { task: 'purge', dueAt: LATER },
      { task: 'recalculation', dueAt: NOW },
    ]);
  });

  describe('isRecalculating', () => {
    it('[SEN-36] is false while no job is recorded, and again once the job has ended', async () => {
      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(false);

      await request({ kind: 'import', playerIds: [FIRST] }, 'new_cases');
      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(true);

      await db.delete(recalculationJobs).where(eq(recalculationJobs.cause, 'new_cases'));
      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(false);
    });

    it('[CL-SEN-16] is true for every pair while a full job is pending', async () => {
      await request({ kind: 'full' }, 'parameter_change');

      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(true);
      await expect(isInProgress(SECOND, BEREAVEMENT)).resolves.toBe(true);
    });

    it('[SEN-36] is true for every type of the players of a job that names no type, and for no other player', async () => {
      await request({ kind: 'event_or_case_change', playerIds: [FIRST] }, 'manual_decision');

      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(true);
      await expect(isInProgress(FIRST, BEREAVEMENT)).resolves.toBe(true);
      await expect(isInProgress(SECOND, MEDIA_STORM)).resolves.toBe(false);
    });

    it("[SEN-36] is true for the trend of a job's named type, whoever the player, and for no other type", async () => {
      await request(
        { kind: 'import', playerIds: [FIRST], eventTypeIds: [MEDIA_STORM] },
        'new_cases',
      );

      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(true);
      await expect(isInProgress(SECOND, MEDIA_STORM)).resolves.toBe(true);
      await expect(isInProgress(FIRST, BEREAVEMENT)).resolves.toBe(false);
      await expect(isInProgress(SECOND, BEREAVEMENT)).resolves.toBe(false);
    });

    it("[SEN-34] [CL-SEN-16] is true for the general trend of each type of the players' cases, for a job that names no type, whoever the player", async () => {
      await insertEventType(db);
      await insertLeagueSeason(db, '2024-25');
      await insertPlayer(db, { source: 'p01' });
      await insertBoxScores(db, { playerId: FIRST, source: 'p01', season: '2024-25' });
      const [first] = await db
        .select({ id: games.id })
        .from(boxScores)
        .innerJoin(games, eq(games.id, boxScores.gameId))
        .where(eq(boxScores.playerId, FIRST))
        .orderBy(asc(games.scheduledStartAt))
        .limit(1);
      const gameId = first?.id ?? 0;
      await insertValidCase(db, { playerId: FIRST, measuredGameId: gameId });

      await request(
        { kind: 'statistics_update', playerIds: [FIRST], gameIds: [gameId] },
        'stats_correction',
      );

      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(true);
      await expect(isInProgress(SECOND, MEDIA_STORM)).resolves.toBe(true);
      await expect(isInProgress(SECOND, BEREAVEMENT)).resolves.toBe(false);
    });

    it('[CL-SEN-16] is true while the job covering the pair is running', async () => {
      await request({ kind: 'import', playerIds: [FIRST] }, 'new_cases');
      await db
        .update(recalculationJobs)
        .set({ status: 'running' })
        .where(eq(recalculationJobs.cause, 'new_cases'));

      await expect(isInProgress(FIRST, MEDIA_STORM)).resolves.toBe(true);
    });
  });
});

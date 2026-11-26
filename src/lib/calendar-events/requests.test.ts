import { asc, eq, TransactionRollbackError } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { calendarDerivationRequests, createTestDatabase } from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertEventType,
  insertPlayer,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { DerivationRefusal, DerivationRequest } from './requests';
import type { Database } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const NOW = toEpochMs(Date.UTC(2026, 10, 21, 9));
const LATER = toEpochMs(NOW + 3_600_000);
const EARLIER = toEpochMs(NOW - 7_200_000);
const FIRST = leaguePlayerId('p01');
const SECOND = leaguePlayerId('p02');
const FORMER_TEAM = 'former-team';
// The wake plan a pass left: only the purge is due, an hour later.
const PLAN = { computedAt: NOW, entries: [{ task: 'purge', dueAt: LATER }], probes: [] } as const;
const ROW_COLUMNS = {
  kind: calendarDerivationRequests.kind,
  playerId: calendarDerivationRequests.playerId,
  eventTypeId: calendarDerivationRequests.eventTypeId,
  cause: calendarDerivationRequests.cause,
  followsOwnerChange: calendarDerivationRequests.followsOwnerChange,
  requestedAt: calendarDerivationRequests.requestedAt,
};

/** The module and the wake plan, over a fresh fake of the runtime cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_derivation_requests');
  return {
    requests: await import('./requests'),
    wakePlan: await import('@/lib/wake-plan'),
  };
}

describe('the calendar derivation requests', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let request: (scope: DerivationRequest) => Promise<Result<undefined, DerivationRefusal>>;
  let requestIn: Awaited<ReturnType<typeof load>>['requests']['requestDerivation'];
  let dueAt: () => Promise<EpochMs | null>;
  let wakePlan: Awaited<ReturnType<typeof load>>['wakePlan'];

  beforeEach(async () => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    onTestFinished(installFakeClock(fixedClock(NOW)));
    const loaded = await load();
    wakePlan = loaded.wakePlan;
    requestIn = loaded.requests.requestDerivation;
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(database.close);
    await wakePlan.writePlan(PLAN);
    await insertPlayer(db);
    await insertPlayer(db, { source: 'p02' });
    await insertCalendarType(db);
    await insertEventType(db, {
      id: FORMER_TEAM,
      name: 'Return to a former team',
      datingRule: 'The first game against a former team.',
      knownInAdvance: true,
      calendarDerivation: 'former_team',
    });
    await insertEventType(db, { id: MEDIA_STORM });
    request = async (scope) => db.transaction(async (tx) => requestIn(tx, scope));
    dueAt = async () => loaded.requests.nextDueAt(db);
  });

  const rows = async () =>
    db
      .select(ROW_COLUMNS)
      .from(calendarDerivationRequests)
      .orderBy(asc(calendarDerivationRequests.id));

  const row = (fields: Partial<Awaited<ReturnType<typeof rows>>[number]>) => ({
    kind: 'full',
    playerId: null,
    eventTypeId: null,
    cause: 'type_validated',
    followsOwnerChange: true,
    requestedAt: new Date(NOW),
    ...fields,
  });

  it('[CL-TAX-19] records a regular request for one player and both types', async () => {
    await expect(
      request({ kind: 'regular', cause: 'statistics_update', player: FIRST }),
    ).resolves.toStrictEqual({ ok: true, value: undefined });

    await expect(rows()).resolves.toStrictEqual([
      row({
        kind: 'regular',
        playerId: FIRST,
        cause: 'statistics_update',
        followsOwnerChange: false,
      }),
    ]);
  });

  it('[CL-TAX-19] records a full request for every eligible player and one type, at the instant of the clock', async () => {
    await request({ kind: 'full', cause: 'type_validated', eventType: BIRTHDAY });

    await expect(rows()).resolves.toStrictEqual([
      row({ eventTypeId: BIRTHDAY, requestedAt: new Date(NOW) }),
    ]);
  });

  it('[CL-TAX-19] records a request for one player and one type, and one for every player and both types', async () => {
    await request({
      kind: 'regular',
      cause: 'collection_pass',
      player: FIRST,
      eventType: FORMER_TEAM,
    });
    await request({ kind: 'regular', cause: 'collection_pass' });

    await expect(rows()).resolves.toStrictEqual([
      row({
        kind: 'regular',
        playerId: FIRST,
        eventTypeId: FORMER_TEAM,
        cause: 'collection_pass',
        followsOwnerChange: false,
      }),
      row({ kind: 'regular', cause: 'collection_pass', followsOwnerChange: false }),
    ]);
  });

  it.each(['statistics_update', 'collection_pass'] as const)(
    '[CL-TAX-19] the cause %s makes a regular request, not owner-driven',
    async (cause) => {
      await request({ kind: 'regular', cause, player: FIRST });

      await expect(rows()).resolves.toStrictEqual([
        row({ kind: 'regular', cause, playerId: FIRST, followsOwnerChange: false }),
      ]);
    },
  );

  it.each([
    ['history_stored', false],
    ['team_history_changed', false],
    ['type_validated', true],
    ['type_reactivated', true],
    ['type_changed', true],
    ['birthday_changed', true],
    ['mapping_changed', true],
    ['team_change_entered', true],
  ] as const)(
    '[CL-TAX-19] the cause %s makes a full request, owner-driven: %s',
    async (cause, followsOwnerChange) => {
      await request({ kind: 'full', cause, player: FIRST });

      await expect(rows()).resolves.toStrictEqual([
        row({ kind: 'full', cause, playerId: FIRST, followsOwnerChange }),
      ]);
    },
  );

  it('[CL-TAX-19] lets a need for a scope that is pending join its request, keeping its cause and its instant', async () => {
    await request({ kind: 'full', cause: 'type_validated', player: FIRST });
    onTestFinished(installFakeClock(fixedClock(LATER)));
    await request({ kind: 'full', cause: 'type_validated', player: FIRST });
    await request({ kind: 'full', cause: 'birthday_changed', player: FIRST });

    await expect(rows()).resolves.toStrictEqual([row({ playerId: FIRST })]);
  });

  it('[CL-TAX-19] keeps one request for each scope: every player, one player, one type, and the kind of run', async () => {
    await request({ kind: 'regular', cause: 'statistics_update' });
    await request({ kind: 'regular', cause: 'collection_pass' });
    await request({ kind: 'regular', cause: 'statistics_update', player: FIRST });
    await request({ kind: 'regular', cause: 'statistics_update', player: SECOND });
    await request({ kind: 'regular', cause: 'statistics_update', eventType: BIRTHDAY });
    await request({ kind: 'full', cause: 'history_stored' });

    const found = await rows();
    expect(
      found.map(({ kind, playerId, eventTypeId, cause }) => [kind, playerId, eventTypeId, cause]),
    ).toStrictEqual([
      ['regular', null, null, 'statistics_update'],
      ['regular', FIRST, null, 'statistics_update'],
      ['regular', SECOND, null, 'statistics_update'],
      ['regular', null, BIRTHDAY, 'statistics_update'],
      ['full', null, null, 'history_stored'],
    ]);
  });

  it.each([
    ['mapping_changed', 'birthday_changed', true],
    ['mapping_changed', 'history_stored', false],
    ['history_stored', 'birthday_changed', false],
    ['team_history_changed', 'team_change_entered', false],
  ] as const)(
    '[CL-TEL-21] a pending %s request that a %s need joins is owner-driven: %s',
    async (first, joining, followsOwnerChange) => {
      await request({ kind: 'full', cause: first, player: FIRST });
      await request({ kind: 'full', cause: joining, player: FIRST });

      await expect(rows()).resolves.toStrictEqual([
        row({ cause: first, playerId: FIRST, followsOwnerChange }),
      ]);
    },
  );

  it('[CL-TEL-21] stays not owner-driven once a need that no owner action made has joined, whatever joins after', async () => {
    await request({ kind: 'full', cause: 'type_changed' });
    await request({ kind: 'full', cause: 'team_history_changed' });
    await request({ kind: 'full', cause: 'type_changed' });

    await expect(rows()).resolves.toStrictEqual([
      row({ cause: 'type_changed', followsOwnerChange: false }),
    ]);
  });

  it('[CL-TAX-19] adds a row for a need that arrives while a run holds the request, and joins that one next', async () => {
    await request({ kind: 'full', cause: 'mapping_changed', player: FIRST });
    await db
      .update(calendarDerivationRequests)
      .set({ leaseExpiresAt: new Date(LATER) })
      .where(eq(calendarDerivationRequests.playerId, FIRST));

    await request({ kind: 'full', cause: 'birthday_changed', player: FIRST });
    await request({ kind: 'full', cause: 'team_history_changed', player: FIRST });

    await expect(rows()).resolves.toStrictEqual([
      row({ playerId: FIRST, cause: 'mapping_changed' }),
      row({ playerId: FIRST, cause: 'birthday_changed', followsOwnerChange: false }),
    ]);
  });

  it('[CL-TAX-19] refuses a type that is not calendar-derived, and one that does not exist, and records nothing', async () => {
    await expect(
      request({ kind: 'full', cause: 'type_validated', eventType: MEDIA_STORM }),
    ).resolves.toStrictEqual({ ok: false, error: 'not_calendar_derived' });
    await expect(
      request({ kind: 'full', cause: 'type_validated', eventType: 'no-such-type' }),
    ).resolves.toStrictEqual({ ok: false, error: 'not_calendar_derived' });

    await expect(rows()).resolves.toStrictEqual([]);
    const reading = await wakePlan.readPlan(NOW);
    expect(reading.ok ? reading.plan.entries : reading.error).toStrictEqual(PLAN.entries);
  });

  it('[CL-TAX-19] accepts each of the two calendar-derived types', async () => {
    await expect(
      request({ kind: 'full', cause: 'type_reactivated', eventType: BIRTHDAY }),
    ).resolves.toStrictEqual({ ok: true, value: undefined });
    await expect(
      request({ kind: 'full', cause: 'type_reactivated', eventType: FORMER_TEAM }),
    ).resolves.toStrictEqual({ ok: true, value: undefined });

    await expect(rows()).resolves.toHaveLength(2);
  });

  it('[CL-TAX-19] leaves no request when the caller rolls its transaction back, and one when it commits', async () => {
    const rolledBack = db.transaction(async (tx) => {
      await requestIn(tx, { kind: 'full', cause: 'mapping_changed', player: FIRST });
      tx.rollback();
    });
    await expect(rolledBack).rejects.toThrow(TransactionRollbackError);
    await expect(rows()).resolves.toStrictEqual([]);

    await request({ kind: 'full', cause: 'mapping_changed', player: FIRST });
    await expect(rows()).resolves.toHaveLength(1);
  });

  it('[CL-TAX-19] wakes the calendar derivation task at once, keeping the entries of the other tasks', async () => {
    await request({ kind: 'regular', cause: 'statistics_update' });

    const reading = await wakePlan.readPlan(NOW);
    expect(reading.ok ? reading.plan.entries : reading.error).toStrictEqual([
      { task: 'purge', dueAt: LATER },
      { task: 'calendar-derivation', dueAt: NOW },
    ]);
  });

  describe('nextDueAt', () => {
    it('[CL-TAX-19] is null while no request is pending', async () => {
      await expect(dueAt()).resolves.toBeNull();
    });

    it('[CL-TAX-19] gives the instant of the earliest request recorded', async () => {
      await db.insert(calendarDerivationRequests).values([
        {
          kind: 'full',
          cause: 'type_validated',
          followsOwnerChange: true,
          requestedAt: new Date(LATER),
        },
        {
          kind: 'regular',
          cause: 'statistics_update',
          followsOwnerChange: false,
          requestedAt: new Date(EARLIER),
        },
        {
          kind: 'regular',
          playerId: SECOND,
          cause: 'collection_pass',
          followsOwnerChange: false,
          requestedAt: new Date(NOW),
        },
      ]);

      await expect(dueAt()).resolves.toBe(EARLIER);
    });

    it('[TRV-30] gives the instant a held request lapses, since a run that died is resumed then', async () => {
      await db.insert(calendarDerivationRequests).values([
        {
          kind: 'full',
          cause: 'type_validated',
          followsOwnerChange: true,
          requestedAt: new Date(EARLIER),
          leaseExpiresAt: new Date(LATER),
        },
      ]);
      await expect(dueAt()).resolves.toBe(LATER);

      await request({ kind: 'regular', cause: 'statistics_update' });
      await expect(dueAt()).resolves.toBe(NOW);
    });
  });
});

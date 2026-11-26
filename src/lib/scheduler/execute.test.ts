import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTestDatabase,
  databaseActivityMinutes,
  incidents,
  journalEntries,
  quotaUsage,
  schedulerLease,
  taskRuns,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { ChunkOutcome, ReadyGuard, ScheduledTask, TaskSchedule } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs, FixedClock } from '@/lib/time';

// An on-demand run asked in a test starts no pass of its own.
vi.mock(import('next/server'), () => ({ after: vi.fn() }));

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** An instant of 2026 in UTC, by its month, its day and its hour, minutes as a fraction. */
const utc = (month: number, day: number, hours: number) =>
  toEpochMs(Date.UTC(2026, month - 1, day) + hours * HOUR);
// Wednesday 25 November 2026, 10:00 UTC, 11:00 in Paris, the default zone.
const AT = utc(11, 25, 10);
const at = (minutes: number) => toEpochMs(AT + minutes * MINUTE);
const ITEMS = 10;
const OLD_PASS = '00000000-0000-4000-8000-000000000002';
const OTHER_PASS = '00000000-0000-4000-8000-000000000001';
const FREE_LEASE = [{ id: 1, passId: null, expiresAt: null }];
const SUCCEEDED: ChunkOutcome = { kind: 'done', result: 'succeeded' };

/** A call that answers `value` on a later turn, as a real one does. */
const answer =
  <T>(value: T) =>
  async (): Promise<T> => {
    await Promise.resolve();
    return value;
  };

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return {
    fake: processFakeRuntimeCache(),
    wakePlan: await import('@/lib/wake-plan'),
    ...(await import('.')),
  };
}

/**
 * A task due at AT until its last item is handled, which handles two items per chunk from its
 * cursor, each chunk lasting `chunkMs`, and notes each item it handled.
 */
function chunkedTask(clock: FixedClock, handled: number[], chunkMs: number): ScheduledTask {
  const nextDueAt = async () => {
    await Promise.resolve();
    return handled.includes(ITEMS - 1) ? null : AT;
  };
  return {
    key: 'recalculation',
    schedules: [{ kind: 'computed', nextDueAt }],
    run: async ({ cursor }) => {
      await Promise.resolve();
      const from = cursor === null ? 0 : Number(cursor);
      const to = Math.min(from + 2, ITEMS);
      handled.push(...Array.from({ length: to - from }, (_, index) => from + index));
      clock.advance(chunkMs);
      return to === ITEMS ? SUCCEEDED : { kind: 'more', cursor: String(to) };
    },
  };
}

/** A task that succeeds at once in one chunk, on the schedules given. */
const instantTask = (
  key: ScheduledTask['key'],
  schedules: readonly TaskSchedule[],
): ScheduledTask => ({ key, schedules, run: answer(SUCCEEDED) });

const daily = (time: string): TaskSchedule => ({ kind: 'daily', times: () => [time] });

// The statistics update at 15:00 in Paris, 14:00 UTC in winter, and its cut-off five hours later.
const UPDATE_DUE_AT = utc(11, 25, 14);
const cutoff = (dueAt: EpochMs) => toEpochMs(dueAt + 5 * HOUR);
const sourceRefresh = { kind: 'stats-source-refresh', dueAt: UPDATE_DUE_AT, state: {} } as const;

describe('a database pass', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(AT);
    const restoreClock = installFakeClock(clock);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  const moveTo = (instant: EpochMs) => clock.advance(instant - clock.now());
  const runsOf = async () => db.select().from(taskRuns).orderBy(asc(taskRuns.id));
  const messagesOf = async () => {
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    return entries.map(({ messageKey }) => messageKey);
  };
  const leaseOf = async () => db.select().from(schedulerLease);
  const insertSuccess = async (taskKey: ScheduledTask['key'], dueAt: EpochMs) =>
    db.insert(taskRuns).values({
      taskKey,
      trigger: 'scheduled',
      dueAt: new Date(dueAt),
      startedAt: new Date(dueAt),
      finishedAt: new Date(dueAt + MINUTE),
      result: 'succeeded',
      passId: OLD_PASS,
    });

  it('[TRV-30] [CA-TRV-09] keeps the cursor of a run that the budget stops and resumes it at the next pass, each item once', async () => {
    const { execute } = await load();
    const handled: number[] = [];
    const registry = [chunkedTask(clock, handled, 100_000)];
    const first = await execute(db, registry);
    const [paused] = await runsOf();
    expect({ isPass: first.ok, handled: [...handled], paused }).toMatchObject({
      isPass: true,
      handled: [0, 1, 2, 3, 4, 5],
      paused: { cursor: '6', result: null, trigger: 'scheduled' },
    });
    clock.advance(5 * MINUTE);
    await execute(db, registry);
    expect(handled).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const runs = await runsOf();
    expect(runs.map(({ id, result, cursor }) => ({ id, result, cursor }))).toStrictEqual([
      { id: paused?.id, result: 'succeeded', cursor: '8' },
    ]);
    expect(await messagesOf()).toStrictEqual(['task_run_succeeded']);
  });

  it('[TRV-30] [CA-TRV-09] [CL-TRV-07] takes over an expired lease, closes a run without progress for twice the function limit as interrupted and resumes it from its cursor', async () => {
    const { execute } = await load();
    await db
      .insert(schedulerLease)
      .values({ id: 1, passId: OTHER_PASS, expiresAt: new Date(at(-1)) });
    const [crashed] = await db
      .insert(taskRuns)
      .values({
        taskKey: 'recalculation',
        trigger: 'on_demand',
        dueAt: new Date(at(-30)),
        startedAt: new Date(at(-20)),
        progressAt: new Date(at(-10)),
        passId: OLD_PASS,
        cursor: '4',
      })
      .returning();
    const handled: number[] = [];
    await execute(db, [chunkedTask(clock, handled, MINUTE)]);
    expect(handled).toStrictEqual([4, 5, 6, 7, 8, 9]);
    const runs = await runsOf();
    expect(runs).toMatchObject([
      {
        trigger: 'on_demand',
        dueAt: new Date(at(-30)),
        finishedAt: new Date(AT),
        passId: OLD_PASS,
        result: 'interrupted',
      },
      {
        trigger: 'on_demand',
        dueAt: new Date(at(-30)),
        finishedAt: new Date(at(3)),
        passId: OLD_PASS,
        result: 'succeeded',
      },
    ]);
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    expect(
      entries.map(({ messageKey, level, taskRunId }) => ({ messageKey, level, taskRunId })),
    ).toStrictEqual([
      { messageKey: 'task_run_interrupted', level: 'warning', taskRunId: crashed?.id },
      { messageKey: 'task_run_succeeded', level: 'info', taskRunId: runs[1]?.id },
    ]);
    expect(await leaseOf()).toStrictEqual(FREE_LEASE);
  });

  it('[TRV-28] runs nothing while another pass holds the lease', async () => {
    const { execute } = await load();
    await db
      .insert(schedulerLease)
      .values({ id: 1, passId: OTHER_PASS, expiresAt: new Date(at(1)) });
    const outcome = await execute(db, [instantTask('purge', [daily('04:00')])]);
    expect(outcome).toStrictEqual({ ok: false, error: { kind: 'lease_held' } });
    expect(await runsOf()).toStrictEqual([]);
  });

  it('[TRV-28] [CL-TRV-07] journals once an occurrence due while the previous run still runs, and starts it once that run ends', async () => {
    const { execute } = await load();
    const [running] = await db
      .insert(taskRuns)
      .values({
        taskKey: 'purge',
        trigger: 'on_demand',
        dueAt: new Date(at(-24 * 60)),
        startedAt: new Date(at(-24 * 60)),
        progressAt: new Date(at(-1)),
        passId: OLD_PASS,
        cursor: 'a',
      })
      .returning();
    let isBusy = true;
    const purge: ScheduledTask = {
      key: 'purge',
      schedules: [daily('10:30')],
      run: async () => {
        await Promise.resolve();
        clock.advance(MINUTE);
        return isBusy ? { kind: 'more', cursor: 'b' } : SUCCEEDED;
      },
    };
    await execute(db, [purge]);
    clock.advance(5 * MINUTE);
    await execute(db, [purge]);
    const entries = await db.select().from(journalEntries);
    expect(
      entries.map(({ messageKey, taskRunId, occurredAt }) => ({
        messageKey,
        taskRunId,
        occurredAt,
      })),
    ).toStrictEqual([
      { messageKey: 'task_run_postponed', taskRunId: running?.id, occurredAt: new Date(at(-30)) },
    ]);
    isBusy = false;
    clock.advance(5 * MINUTE);
    await execute(db, [purge]);
    const runs = await runsOf();
    expect(runs.map(({ result, dueAt, trigger }) => ({ result, dueAt, trigger }))).toStrictEqual([
      { result: 'succeeded', dueAt: new Date(at(-24 * 60)), trigger: 'on_demand' },
      { result: 'succeeded', dueAt: new Date(at(-30)), trigger: 'scheduled' },
    ]);
  });

  it('[TRV-28] [CL-TRV-23] lets a due run wait in its ready guard without the lease and never stale, and starts an on-demand run asked meanwhile once it ends', async () => {
    const { execute, requestRun } = await load();
    await insertSuccess('statistics-update', toEpochMs(UPDATE_DUE_AT - 24 * HOUR));
    let isReady = false;
    const triggers: string[] = [];
    const readyGuard: ReadyGuard = {
      probe: 'stats-source-refresh',
      call: answer({ found: true }),
      check: async () => {
        await Promise.resolve();
        return isReady ? { ready: true } : { ready: false, probe: sourceRefresh };
      },
      cutoff,
    };
    const update: ScheduledTask = {
      key: 'statistics-update',
      schedules: [daily('15:00')],
      readyGuard,
      run: async ({ trigger }) => {
        await Promise.resolve();
        triggers.push(trigger);
        return SUCCEEDED;
      },
    };
    moveTo(toEpochMs(UPDATE_DUE_AT + 5 * MINUTE));
    await execute(db, [update]);
    const request = await requestRun(db, [update], 'statistics-update');
    moveTo(toEpochMs(UPDATE_DUE_AT + 40 * MINUTE));
    await execute(db, [update]);
    const waiting = await runsOf();
    expect({
      lease: await leaseOf(),
      request,
      runs: waiting.map(({ trigger, startedAt, result }) => ({ trigger, startedAt, result })),
      triggers: [...triggers],
    }).toStrictEqual({
      lease: FREE_LEASE,
      request: { ok: true, deferred: true },
      runs: [
        {
          trigger: 'scheduled',
          startedAt: new Date(UPDATE_DUE_AT - 24 * HOUR),
          result: 'succeeded',
        },
        { trigger: 'scheduled', startedAt: new Date(UPDATE_DUE_AT + 5 * MINUTE), result: null },
        { trigger: 'on_demand', startedAt: null, result: null },
      ],
      triggers: [],
    });
    isReady = true;
    moveTo(toEpochMs(UPDATE_DUE_AT + HOUR));
    await execute(db, [update]);
    expect(triggers).toStrictEqual(['scheduled', 'on_demand']);
    const runs = await runsOf();
    expect(
      runs.map(({ dueAt, progressAt, startedAt, result }) => ({
        dueAt,
        progressAt,
        startedAt,
        result,
      })),
    ).toStrictEqual([
      {
        dueAt: new Date(UPDATE_DUE_AT - 24 * HOUR),
        progressAt: null,
        startedAt: new Date(UPDATE_DUE_AT - 24 * HOUR),
        result: 'succeeded',
      },
      {
        dueAt: new Date(UPDATE_DUE_AT),
        progressAt: new Date(UPDATE_DUE_AT + HOUR),
        startedAt: new Date(UPDATE_DUE_AT + 5 * MINUTE),
        result: 'succeeded',
      },
      {
        dueAt: new Date(UPDATE_DUE_AT + 5 * MINUTE),
        progressAt: null,
        startedAt: new Date(UPDATE_DUE_AT + HOUR),
        result: 'succeeded',
      },
    ]);
    expect(await messagesOf()).toStrictEqual(['task_run_succeeded', 'task_run_succeeded']);
  });

  it('[CL-TRV-23] goes on at the cut-off when the source stays late, and records the run as source late', async () => {
    const { execute } = await load();
    await insertSuccess('statistics-update', toEpochMs(UPDATE_DUE_AT - 24 * HOUR));
    const update: ScheduledTask = {
      key: 'statistics-update',
      schedules: [daily('15:00')],
      readyGuard: {
        probe: 'stats-source-refresh',
        call: answer({ found: false, next: sourceRefresh }),
        check: answer({ ready: false, probe: sourceRefresh }),
        cutoff,
      },
      run: answer({ kind: 'done', result: 'source_late' }),
    };
    moveTo(UPDATE_DUE_AT);
    await execute(db, [update]);
    moveTo(cutoff(UPDATE_DUE_AT));
    await execute(db, [update]);
    const runs = await runsOf();
    expect(runs.map(({ result }) => result)).toStrictEqual(['succeeded', 'source_late']);
    expect(await messagesOf()).toStrictEqual(['task_run_source_late']);
  });

  it('[TRV-27] [CL-TRV-18] runs a daily time that a clock change skips or repeats exactly once, at its first instant', async () => {
    const { execute } = await load();
    const registry = [instantTask('backup', [daily('02:30')])];
    const runNight = async (from: EpochMs) => {
      for (let pass = 0; pass < 8; pass += 1) {
        moveTo(toEpochMs(from + pass * 30 * MINUTE));
        await execute(db, registry);
      }
    };
    // Spring: 02:30 does not exist in Paris on 29 March; it runs at 03:00, 01:00 UTC.
    await insertSuccess('backup', utc(3, 28, 1.5));
    await runNight(utc(3, 28, 23));
    // Autumn: 02:30 occurs twice in Paris on 25 October, at 00:30 and 01:30 UTC.
    await insertSuccess('backup', utc(10, 24, 0.5));
    await runNight(utc(10, 24, 23));
    const runs = await runsOf();
    expect(runs.map(({ dueAt }) => dueAt)).toStrictEqual([
      new Date(utc(3, 28, 1.5)),
      new Date(utc(3, 29, 1)),
      new Date(utc(10, 24, 0.5)),
      new Date(utc(10, 25, 0.5)),
    ]);
  });

  it("[TRV-26] runs a chained task in the same pass, under its parent's pass id", async () => {
    const { execute } = await load();
    const registry = [
      instantTask('statistics-fetch', [{ kind: 'computed', nextDueAt: answer(AT) }]),
      instantTask('calendar-derivation', [{ kind: 'chained', after: ['statistics-fetch'] }]),
    ];
    const pass = await execute(db, registry);
    const [parent, child] = await runsOf();
    expect({ pass, parent, child }).toMatchObject({
      pass: { ok: true, passId: parent?.passId },
      parent: { taskKey: 'statistics-fetch', result: 'succeeded' },
      child: {
        taskKey: 'calendar-derivation',
        parentRunId: parent?.id,
        passId: parent?.passId,
        result: 'succeeded',
      },
    });
  });

  it('[TRV-30] [CL-TRV-07] records a run whose handler throws as failed, and starts no chunk once the budget is spent', async () => {
    const { execute } = await load();
    const registry: ScheduledTask[] = [
      {
        key: 'link-check',
        schedules: [{ kind: 'computed', nextDueAt: answer(AT) }],
        run: async () => {
          await Promise.resolve();
          clock.advance(5 * MINUTE);
          throw new Error('A bug.');
        },
      },
      instantTask('backup', [{ kind: 'computed', nextDueAt: answer(AT) }]),
    ];
    await execute(db, registry);
    const runs = await runsOf();
    expect(
      runs.map(({ taskKey, result, trigger }) => ({ taskKey, result, trigger })),
    ).toStrictEqual([{ taskKey: 'link-check', result: 'failed', trigger: 'scheduled' }]);
    expect(await messagesOf()).toStrictEqual(['task_run_failed']);
  });

  it('[TRV-31] [CL-TRV-08] journals at the end of a pass an occurrence missed meanwhile, and leaves its catch-up run to the next pass once the budget is spent', async () => {
    const { execute } = await load();
    // The purge at 09:01 in Paris, 08:01 UTC, is missed at 10:01 UTC.
    await insertSuccess('purge', toEpochMs(at(-24 * 60) - 119 * MINUTE));
    let isDue = true;
    const slow: ScheduledTask = {
      key: 'link-check',
      schedules: [{ kind: 'computed', nextDueAt: async () => answer(isDue ? AT : null)() }],
      run: async () => {
        await Promise.resolve();
        isDue = false;
        clock.advance(5 * MINUTE);
        return SUCCEEDED;
      },
    };
    const registry = [slow, instantTask('purge', [daily('09:01')])];
    await execute(db, registry);
    const afterFirst = await runsOf();
    expect(
      afterFirst.map(({ taskKey, trigger, dueAt, result }) => ({
        taskKey,
        trigger,
        dueAt,
        result,
      })),
    ).toStrictEqual([
      {
        taskKey: 'purge',
        trigger: 'scheduled',
        dueAt: new Date(at(-24 * 60) - 119 * MINUTE),
        result: 'succeeded',
      },
      { taskKey: 'link-check', trigger: 'scheduled', dueAt: new Date(AT), result: 'succeeded' },
    ]);
    clock.advance(5 * MINUTE);
    await execute(db, registry);
    const caughtUp = await runsOf();
    expect(
      caughtUp.slice(2).map(({ dueAt, startedAt, result }) => ({ dueAt, startedAt, result })),
    ).toStrictEqual([
      { dueAt: new Date(at(-119)), startedAt: new Date(at(10)), result: 'succeeded' },
    ]);
    const incident = await db.select({ closedAt: incidents.closedAt }).from(incidents);
    expect(incident).toStrictEqual([{ closedAt: new Date(at(10)) }]);
  });

  it('[CL-TRV-25] journals the counted attempts once, hands the probe calls to quotas, records its activity and rewrites the plan', async () => {
    const { execute, wakePlan } = await load();
    await wakePlan.bumpCounter({ attempt: 'refused_trigger' }, at(-3))();
    await wakePlan.bumpCounter({ probeCall: 'statsSource' }, at(-2))();
    await execute(db, []);
    const usage = await db.select().from(quotaUsage);
    const activity = await db.select().from(databaseActivityMinutes);
    expect({
      messages: await messagesOf(),
      isUsageCounted: usage.length > 0,
      activity: activity.length,
    }).toStrictEqual({
      messages: ['trigger_refused'],
      isUsageCounted: true,
      activity: 1,
    });
    expect(await wakePlan.readPlan(clock.now())).toMatchObject({ ok: true, plan: { entries: [] } });
  });

  it('[CL-TRV-25] runs its pass while the cache fails, its counters left for a later pass', async () => {
    const { execute, fake } = await load();
    fake.setAvailable(false);
    const outcome = await execute(db, [
      instantTask('backup', [{ kind: 'computed', nextDueAt: answer(AT) }]),
    ]);
    const runs = await runsOf();
    expect({ isPass: outcome.ok, results: runs.map(({ result }) => result) }).toStrictEqual({
      isPass: true,
      results: ['succeeded'],
    });
  });

  it("[CL-TRV-07] records a run whose query fails as failed, and keeps the query's parameters, the owner's text among them, out of the log", async () => {
    const { execute } = await load();
    const lines: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const failing: ScheduledTask = {
      ...instantTask('link-check', [{ kind: 'computed', nextDueAt: answer(AT) }]),
      // An insert that the database refuses, its parameters holding the owner's text.
      run: async ({ db: pass }) => {
        const row = { taskKey: 'purge', trigger: 'scheduled', passId: 'not-a-uuid' } as const;
        await pass.insert(taskRuns).values({ ...row, dueAt: new Date(AT), cursor: 'OWNER TEXT' });
        return SUCCEEDED;
      },
    };
    try {
      await execute(db, [failing]);
    } finally {
      errors.mockRestore();
    }
    const runs = await runsOf();
    expect({
      log: lines.map((line): unknown => JSON.parse(line)),
      results: runs.map(({ result }) => result),
    }).toStrictEqual({
      log: [
        {
          level: 'error',
          message: 'A task handler threw: its run is recorded as failed.',
          context: { task: 'link-check', error: 'Error', code: '22P02' },
        },
      ],
      results: ['failed'],
    });
  });
});

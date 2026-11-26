import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, incidents, journalEntries, schedulerLease, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { ChunkOutcome, ScheduledTask, TaskRunResult, TaskSchedule } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** An instant of November 2026 in UTC, by its day, its hour and its minute. */
const nov = (day: number, hour: number, minute = 0) =>
  toEpochMs(Date.UTC(2026, 10, day, hour, minute));
const PASS = '00000000-0000-4000-8000-000000000002';

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  return import('.');
}

/** A call that answers `value` on a later turn, as a real one does. */
const answer =
  <T>(value: T) =>
  async (): Promise<T> => {
    await Promise.resolve();
    return value;
  };

const task = (key: ScheduledTask['key'], schedules: readonly TaskSchedule[]): ScheduledTask => ({
  key,
  schedules,
  run: answer({ kind: 'done', result: 'succeeded' }),
});

// The purge at 04:00 in Paris, 03:00 UTC in winter.
const purge = task('purge', [{ kind: 'daily', times: () => ['04:00'] }]);

// The statistics update at 15:00 in Paris, 14:00 UTC in winter, which waits for the source
// until its cut-off five hours later.
const statisticsUpdate: ScheduledTask = {
  ...task('statistics-update', [{ kind: 'daily', times: () => ['15:00'] }]),
  readyGuard: {
    probe: 'stats-source-refresh',
    call: answer({ found: true }),
    check: answer({ ready: true }),
    cutoff: (dueAt) => toEpochMs(dueAt + 5 * HOUR),
  },
};

describe('the run check', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  type Run = Readonly<{
    taskKey: ScheduledTask['key'];
    dueAt: EpochMs;
    startedAt?: EpochMs;
    finishedAt?: EpochMs;
    result?: TaskRunResult;
    trigger?: 'scheduled' | 'on_demand';
  }>;
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  const insertRuns = async (runs: readonly Run[]) => {
    await db.insert(taskRuns).values(
      runs.map((run) => {
        const startedAt = run.startedAt ?? run.dueAt;
        return {
          taskKey: run.taskKey,
          trigger: run.trigger ?? 'scheduled',
          dueAt: new Date(run.dueAt),
          startedAt: new Date(startedAt),
          finishedAt:
            run.result === undefined ? null : new Date(run.finishedAt ?? startedAt + MINUTE),
          result: run.result ?? null,
          passId: PASS,
        };
      }),
    );
  };
  const missesOf = async () => {
    const entries = await db
      .select({ params: journalEntries.messageParams })
      .from(journalEntries)
      .where(eq(journalEntries.messageKey, 'task_run_missed'))
      .orderBy(asc(journalEntries.id));
    return entries.map(({ params }) => params);
  };
  const incidentsOf = async () => {
    const opened = await db.select().from(incidents).orderBy(asc(incidents.id));
    return opened.map(({ kind, causeKey, closedAt }) => ({
      kind,
      causeKey,
      isClosed: closedAt !== null,
    }));
  };
  // A purge that ran on schedule on the 23rd, then only on demand on the 24th.
  const purgeRuns: readonly Run[] = [
    { taskKey: 'purge', dueAt: nov(23, 3), result: 'succeeded' },
    { taskKey: 'purge', dueAt: nov(24, 8), trigger: 'on_demand', result: 'succeeded' },
  ];

  it('[TRV-31] [CL-TRV-08] journals each missed occurrence once, opens "task not run" and makes the one catch-up run due at once, in a pass of its own that starts no run', async () => {
    const { checkMissedRuns, computeWakePlan } = await load();
    await insertRuns(purgeRuns);
    const at = nov(25, 10);
    const caughtUp = [
      await checkMissedRuns(db, [], at),
      await checkMissedRuns(db, [purge], at),
      await checkMissedRuns(db, [purge], toEpochMs(at + MINUTE)),
    ];
    expect(caughtUp).toStrictEqual([
      { ok: true, caughtUp: [] },
      { ok: true, caughtUp: ['purge'] },
      { ok: true, caughtUp: [] },
    ]);
    expect(await missesOf()).toStrictEqual([
      { task: 'purge', dueAt: nov(24, 3) },
      { task: 'purge', dueAt: nov(25, 3) },
    ]);
    expect(await incidentsOf()).toStrictEqual([
      { kind: 'task_not_run', causeKey: 'purge', isClosed: false },
    ]);
    // The check ran as a pass of its own, whose lease it released; it started no run, and
    // left the catch-up run, due at once, to the next pass.
    const runs = await db.select().from(taskRuns);
    expect({
      runs: runs.length,
      lease: await db.select().from(schedulerLease),
      plan: await computeWakePlan(db, [purge], at),
    }).toStrictEqual({
      runs: 2,
      lease: [{ id: 1, passId: null, expiresAt: null }],
      plan: { computedAt: at, entries: [{ task: 'purge', dueAt: nov(25, 3) }], probes: [] },
    });
  });

  it('[TRV-28] [TRV-31] [CL-TRV-08] journals each missed occurrence once when two checks run at once, and checks nothing while a pass holds the lease', async () => {
    const { checkMissedRuns } = await load();
    await insertRuns([{ taskKey: 'purge', dueAt: nov(23, 3), result: 'succeeded' }]);
    const at = nov(25, 10);
    const outcomes = await Promise.all([
      checkMissedRuns(db, [purge], at),
      checkMissedRuns(db, [purge], at),
    ]);
    expect(outcomes.filter((outcome) => !outcome.ok)).toStrictEqual([
      { ok: false, error: { kind: 'lease_held' } },
    ]);
    expect(await missesOf()).toStrictEqual([
      { task: 'purge', dueAt: nov(24, 3) },
      { task: 'purge', dueAt: nov(25, 3) },
    ]);
    await db
      .update(schedulerLease)
      .set({ passId: PASS, expiresAt: new Date(at + HOUR) })
      .where(eq(schedulerLease.id, 1));
    await db.delete(journalEntries).where(eq(journalEntries.messageKey, 'task_run_missed'));
    expect(await checkMissedRuns(db, [purge], toEpochMs(at + MINUTE))).toStrictEqual({
      ok: false,
      error: { kind: 'lease_held' },
    });
    expect(await missesOf()).toStrictEqual([]);
    expect(await db.select().from(taskRuns)).toHaveLength(1);
  });

  it('[TRV-31] [CL-TRV-08] closes "task not run" at the success of the catch-up run, which the next pass runs, and journals no occurrence twice', async () => {
    const { checkMissedRuns, execute } = await load();
    await insertRuns(purgeRuns);
    await checkMissedRuns(db, [purge], nov(25, 10));
    const restore = installFakeClock(fixedClock(nov(25, 10, 1)));
    try {
      await execute(db, [purge]);
    } finally {
      restore();
    }
    expect(await incidentsOf()).toStrictEqual([
      { kind: 'task_not_run', causeKey: 'purge', isClosed: true },
    ]);
    expect(await missesOf()).toHaveLength(2);
  });

  it('[TRV-31] [CL-TRV-08] checks the occurrences of chained and owner-computed tasks, and closes at once the incident of a task that a late success caught up', async () => {
    const { checkMissedRuns } = await load();
    const at = nov(25, 12);
    const registry = [
      task('news-collection', [{ kind: 'daily', times: () => ['22:00'] }]),
      task('detection', [{ kind: 'chained', after: ['news-collection'] }]),
      task('recalculation', [
        { kind: 'computed', nextDueAt: answer(nov(25, 9)) },
        { kind: 'daily', times: () => [] },
      ]),
      task('link-check', [{ kind: 'computed', nextDueAt: answer(null) }]),
    ];
    await insertRuns([
      { taskKey: 'detection', dueAt: nov(24, 6), result: 'succeeded' },
      {
        taskKey: 'news-collection',
        dueAt: nov(24, 21),
        finishedAt: nov(24, 21, 30),
        result: 'succeeded',
      },
      {
        taskKey: 'recalculation',
        dueAt: nov(24, 6),
        trigger: 'on_demand',
        result: 'succeeded',
      },
      {
        taskKey: 'recalculation',
        dueAt: nov(25, 9),
        startedAt: nov(25, 9, 30),
        finishedAt: nov(25, 11, 50),
        result: 'succeeded',
        trigger: 'on_demand',
      },
      { taskKey: 'link-check', dueAt: nov(24, 6), result: 'failed' },
    ]);
    expect(await checkMissedRuns(db, registry, at)).toStrictEqual({
      ok: true,
      caughtUp: ['detection'],
    });
    expect(await missesOf()).toStrictEqual([
      { task: 'detection', dueAt: nov(24, 21, 30) },
      { task: 'recalculation', dueAt: nov(25, 9) },
    ]);
    expect(await incidentsOf()).toStrictEqual([
      { kind: 'task_not_run', causeKey: 'detection', isClosed: false },
      { kind: 'task_not_run', causeKey: 'recalculation', isClosed: true },
    ]);
  });

  it('[TRV-28] [CL-TRV-23] takes a statistics update waiting for the source for running, missed only without a result by the cut-off plus the margin', async () => {
    const { checkMissedRuns } = await load();
    await insertRuns([{ taskKey: 'statistics-update', dueAt: nov(23, 14), result: 'succeeded' }]);
    await db.insert(taskRuns).values({
      taskKey: 'statistics-update',
      trigger: 'scheduled',
      dueAt: new Date(nov(24, 14)),
      startedAt: new Date(nov(24, 14)),
      passId: PASS,
    });
    const registry = [statisticsUpdate];
    expect(await checkMissedRuns(db, registry, nov(24, 20, 59))).toStrictEqual({
      ok: true,
      caughtUp: [],
    });
    expect(await missesOf()).toStrictEqual([]);
    expect(await checkMissedRuns(db, registry, nov(24, 21))).toStrictEqual({
      ok: true,
      caughtUp: [],
    });
    expect(await missesOf()).toStrictEqual([{ task: 'statistics-update', dueAt: nov(24, 14) }]);
    expect(await db.select().from(taskRuns)).toHaveLength(2);
  });

  it('[CL-TRV-23] never takes a late source for "task not run", and misses a day whose run has not started by the start time plus the margin', async () => {
    const { checkMissedRuns } = await load();
    await insertRuns([
      { taskKey: 'statistics-update', dueAt: nov(23, 14), result: 'succeeded' },
      {
        taskKey: 'statistics-update',
        dueAt: nov(24, 14),
        finishedAt: nov(24, 19),
        result: 'source_late',
      },
    ]);
    const registry = [statisticsUpdate];
    expect(await checkMissedRuns(db, registry, nov(25, 15, 59))).toStrictEqual({
      ok: true,
      caughtUp: [],
    });
    expect(await missesOf()).toStrictEqual([]);
    expect(await checkMissedRuns(db, registry, nov(25, 16))).toStrictEqual({
      ok: true,
      caughtUp: ['statistics-update'],
    });
    expect(await missesOf()).toStrictEqual([{ task: 'statistics-update', dueAt: nov(25, 14) }]);
  });

  it('[CL-TRV-23] takes a manual run for the day of the statistics update only when it succeeded, a failed one leaving the day missed, and a success closing "task not run" at once', async () => {
    const { checkMissedRuns } = await load();
    const manual = { taskKey: 'statistics-update', trigger: 'on_demand' } as const;
    await insertRuns([
      { taskKey: 'statistics-update', dueAt: nov(23, 14), result: 'succeeded' },
      { ...manual, dueAt: nov(24, 14, 30), result: 'failed' },
      { ...manual, dueAt: nov(25, 14, 30), result: 'succeeded' },
    ]);
    expect(await checkMissedRuns(db, [statisticsUpdate], nov(25, 16))).toStrictEqual({
      ok: true,
      caughtUp: [],
    });
    expect(await missesOf()).toStrictEqual([{ task: 'statistics-update', dueAt: nov(24, 14) }]);
    expect(await incidentsOf()).toStrictEqual([
      { kind: 'task_not_run', causeKey: 'statistics-update', isClosed: true },
    ]);
  });

  it('[TRV-31] [CL-TRV-08] [CL-TRV-23] runs each timed task once at the first pass on an empty database, and journals no occurrence before it as missed', async () => {
    const { execute } = await load();
    const late: ChunkOutcome = { kind: 'done', result: 'source_late' };
    const update: ScheduledTask = { ...statisticsUpdate, run: answer(late) };
    const registry: readonly ScheduledTask[] = [purge, update];
    const clock = fixedClock(nov(25, 10));
    const restore = installFakeClock(clock);
    try {
      await execute(db, registry);
      clock.advance(5 * MINUTE);
      await execute(db, registry);
      const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
      expect(runs.map(({ taskKey, dueAt, result }) => ({ taskKey, dueAt, result }))).toStrictEqual([
        { taskKey: 'purge', dueAt: new Date(nov(25, 3)), result: 'succeeded' },
        { taskKey: 'statistics-update', dueAt: new Date(nov(24, 14)), result: 'source_late' },
      ]);
      expect({ misses: await missesOf(), incidents: await incidentsOf() }).toStrictEqual({
        misses: [],
        incidents: [],
      });
      // The occurrences after the first runs are checked: the update of the 25th, not
      // started by 16:00 UTC, and the purge of the 26th, not run by 05:00 UTC.
      clock.advance(nov(26, 6) - clock.now());
      await execute(db, registry);
    } finally {
      restore();
    }
    expect(await missesOf()).toStrictEqual([
      { task: 'purge', dueAt: nov(26, 3) },
      { task: 'statistics-update', dueAt: nov(25, 14) },
    ]);
  });

  it('[TRV-28] [TRV-31] [CL-TRV-07] [CL-TRV-08] runs one catch-up run after an outage, which stands for the occurrence due since within the margin, and journals no postponement', async () => {
    const { execute } = await load();
    const calls: string[] = [];
    const counted = (scheduled: ScheduledTask): ScheduledTask => ({
      ...scheduled,
      run: async () => {
        calls.push(scheduled.key);
        return answer<ChunkOutcome>({ kind: 'done', result: 'succeeded' })();
      },
    });
    // The detection at 12:00 and 14:00 in Paris, 11:00 and 13:00 UTC in winter.
    const detection = task('detection', [{ kind: 'daily', times: () => ['12:00', '14:00'] }]);
    const registry = [counted(purge), counted(detection)];
    await insertRuns([
      { taskKey: 'purge', dueAt: nov(23, 3), result: 'succeeded' },
      { taskKey: 'detection', dueAt: nov(24, 13), result: 'succeeded' },
    ]);
    const clock = fixedClock(nov(25, 4));
    const restore = installFakeClock(clock);
    try {
      await execute(db, registry);
      clock.advance(nov(25, 13, 30) - clock.now());
      await execute(db, registry);
    } finally {
      restore();
    }
    expect(calls).toStrictEqual(['purge', 'detection']);
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    expect(
      runs.slice(2).map(({ taskKey, dueAt, startedAt, result }) => ({
        taskKey,
        dueAt,
        startedAt,
        result,
      })),
    ).toStrictEqual([
      {
        taskKey: 'purge',
        dueAt: new Date(nov(25, 3)),
        startedAt: new Date(nov(25, 4)),
        result: 'succeeded',
      },
      {
        taskKey: 'detection',
        dueAt: new Date(nov(25, 13)),
        startedAt: new Date(nov(25, 13, 30)),
        result: 'succeeded',
      },
    ]);
    expect(await missesOf()).toStrictEqual([
      { task: 'purge', dueAt: nov(24, 3) },
      { task: 'detection', dueAt: nov(25, 11) },
    ]);
    const postponed = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.messageKey, 'task_run_postponed'));
    expect({ postponed, incidents: await incidentsOf() }).toStrictEqual({
      postponed: [],
      incidents: [
        { kind: 'task_not_run', causeKey: 'purge', isClosed: true },
        { kind: 'task_not_run', causeKey: 'detection', isClosed: true },
      ],
    });
  });

  /**
   * The news collection at `times` in Paris, last run on 24 November at 16:00 UTC, whose
   * handler fails at its first call, run by passes on 25 November at 16:30, 17:30 and
   * 18:30 UTC: the handler's calls, by the pass at which each came, and the runs of the 25th.
   */
  const collectAfterAFailure = async (times: readonly string[]) => {
    const { execute } = await load();
    const calls: EpochMs[] = [];
    const clock = fixedClock(nov(25, 16, 30));
    const collection: ScheduledTask = {
      ...task('news-collection', [{ kind: 'daily', times: () => times }]),
      run: async () => {
        calls.push(clock.now());
        const result: TaskRunResult = calls.length === 1 ? 'failed' : 'succeeded';
        return answer<ChunkOutcome>({ kind: 'done', result })();
      },
    };
    await insertRuns([{ taskKey: 'news-collection', dueAt: nov(24, 16), result: 'succeeded' }]);
    const restore = installFakeClock(clock);
    try {
      for (const at of [nov(25, 16, 30), nov(25, 17, 30), nov(25, 18, 30)]) {
        clock.advance(at - clock.now());
        await execute(db, [collection]);
      }
    } finally {
      restore();
    }
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    return {
      calls,
      runs: runs.slice(1).map(({ dueAt, startedAt, result }) => ({ dueAt, startedAt, result })),
    };
  };

  it('[TRV-31] [CL-TRV-08] journals the earlier occurrence that a failed run stood for once its margin has passed, and catches it up at that pass', async () => {
    // 16:00 and 17:00 in Paris, 15:00 and 16:00 UTC: the run of the 16:30 pass, due at
    // 16:00, stands for 15:00 too, and fails; by 17:00 no run has succeeded for 15:00.
    const { calls, runs } = await collectAfterAFailure(['16:00', '17:00']);
    expect(calls).toStrictEqual([nov(25, 16, 30), nov(25, 17, 30)]);
    expect(runs).toStrictEqual([
      { dueAt: new Date(nov(25, 16)), startedAt: new Date(nov(25, 16, 30)), result: 'failed' },
      { dueAt: new Date(nov(25, 16)), startedAt: new Date(nov(25, 17, 30)), result: 'succeeded' },
    ]);
    expect(await missesOf()).toStrictEqual([{ task: 'news-collection', dueAt: nov(25, 15) }]);
    expect(await incidentsOf()).toStrictEqual([
      { kind: 'task_not_run', causeKey: 'news-collection', isClosed: true },
    ]);
  });

  it('[TRV-31] [CL-TRV-08] journals the occurrence that a failed catch-up run stood for once its margin has passed, and catches it up again at that pass', async () => {
    // 10:00, 16:00 and 17:00 in Paris: the 09:00 UTC occurrence is missed, and its catch-up
    // run at 16:30, due at 16:00, stands for 15:00 too, and fails.
    const { calls, runs } = await collectAfterAFailure(['10:00', '16:00', '17:00']);
    expect(calls).toStrictEqual([nov(25, 16, 30), nov(25, 17, 30)]);
    expect(runs).toStrictEqual([
      { dueAt: new Date(nov(25, 16)), startedAt: new Date(nov(25, 16, 30)), result: 'failed' },
      { dueAt: new Date(nov(25, 16)), startedAt: new Date(nov(25, 17, 30)), result: 'succeeded' },
    ]);
    expect(await missesOf()).toStrictEqual([
      { task: 'news-collection', dueAt: nov(25, 9) },
      { task: 'news-collection', dueAt: nov(25, 15) },
    ]);
    expect(await incidentsOf()).toStrictEqual([
      { kind: 'task_not_run', causeKey: 'news-collection', isClosed: true },
    ]);
  });

  it('[TRV-31] [CL-TRV-08] makes the catch-up run of a task whose timed schedule has no time due at its last missed occurrence', async () => {
    const { checkMissedRuns, execute } = await load();
    const linkCheck = task('link-check', [
      { kind: 'computed', nextDueAt: answer(nov(25, 9)) },
      { kind: 'daily', times: () => [] },
    ]);
    await insertRuns([{ taskKey: 'link-check', dueAt: nov(24, 6), result: 'succeeded' }]);
    expect(await checkMissedRuns(db, [linkCheck], nov(25, 12))).toStrictEqual({
      ok: true,
      caughtUp: ['link-check'],
    });
    const restore = installFakeClock(fixedClock(nov(25, 12, 1)));
    try {
      await execute(db, [linkCheck]);
    } finally {
      restore();
    }
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    expect(runs.at(-1)).toMatchObject({
      taskKey: 'link-check',
      trigger: 'scheduled',
      dueAt: new Date(nov(25, 9)),
      startedAt: new Date(nov(25, 12, 1)),
      result: 'succeeded',
    });
  });
});

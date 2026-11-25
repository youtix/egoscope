import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, incidents, journalEntries, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { ScheduledTask, TaskRunResult, TaskSchedule } from './types';
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

  it('[TRV-31] [CL-TRV-08] journals each missed occurrence once, opens "task not run" and starts one scheduled catch-up run in the given pass', async () => {
    const { checkMissedRuns } = await load();
    await insertRuns(purgeRuns);
    const at = nov(25, 10);
    const caughtUp = [
      await checkMissedRuns(db, [], { at }),
      await checkMissedRuns(db, [purge], { at, passId: PASS }),
      await checkMissedRuns(db, [purge], { at: toEpochMs(at + MINUTE) }),
    ];
    expect(caughtUp).toStrictEqual([[], ['purge'], []]);
    expect(await missesOf()).toStrictEqual([
      { task: 'purge', dueAt: nov(24, 3) },
      { task: 'purge', dueAt: nov(25, 3) },
    ]);
    expect(await incidentsOf()).toStrictEqual([
      { kind: 'task_not_run', causeKey: 'purge', isClosed: false },
    ]);
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    expect(runs.at(-1)).toMatchObject({
      trigger: 'scheduled',
      dueAt: new Date(nov(25, 3)),
      startedAt: new Date(at),
      result: null,
      passId: PASS,
    });
  });

  it('[TRV-31] [CL-TRV-08] closes "task not run" at the success of the catch-up run, which the next pass runs, and journals no occurrence twice', async () => {
    const { checkMissedRuns, execute } = await load();
    await insertRuns(purgeRuns);
    await checkMissedRuns(db, [purge], { at: nov(25, 10) });
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
      task('recalculation', [{ kind: 'computed', nextDueAt: answer(nov(25, 9)) }]),
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
    expect(await checkMissedRuns(db, registry, { at })).toStrictEqual(['detection']);
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
    expect(await checkMissedRuns(db, registry, { at: nov(24, 20, 59) })).toStrictEqual([]);
    expect(await missesOf()).toStrictEqual([]);
    expect(await checkMissedRuns(db, registry, { at: nov(24, 21) })).toStrictEqual([]);
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
    expect(await checkMissedRuns(db, registry, { at: nov(25, 15, 59) })).toStrictEqual([]);
    expect(await missesOf()).toStrictEqual([]);
    expect(await checkMissedRuns(db, registry, { at: nov(25, 16) })).toStrictEqual([
      'statistics-update',
    ]);
    expect(await missesOf()).toStrictEqual([{ task: 'statistics-update', dueAt: nov(25, 14) }]);
  });
});

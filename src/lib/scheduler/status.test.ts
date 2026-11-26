import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import type { ScheduledTask } from './types';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
/** An instant of November 2026 in UTC, by its day, its hour and its minute. */
const nov = (day: number, hour: number, minute = 0) =>
  toEpochMs(Date.UTC(2026, 10, day, hour, minute));
const AT = nov(25, 10);
const PASS = '00000000-0000-4000-8000-000000000002';

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

const task = (key: ScheduledTask['key'], time: string): ScheduledTask => ({
  key,
  schedules: [{ kind: 'daily', times: () => [time] }],
  run: async () => {
    await Promise.resolve();
    return { kind: 'done', result: 'succeeded' };
  },
});

describe('the status of the tasks and of the trigger', () => {
  it(
    "[TRV-26] [TRV-28] lists each task's last run with its result, none while it runs, the run asked meanwhile and the next scheduled run",
    { timeout: DATABASE_TEST_TIMEOUT_MS },
    async () => {
      const database = await createTestDatabase();
      onTestFinished(database.close);
      const { db } = database;
      const { taskOverview } = await load();
      await db.insert(taskRuns).values([
        {
          taskKey: 'purge',
          trigger: 'scheduled',
          dueAt: new Date(nov(25, 3)),
          startedAt: new Date(nov(25, 3)),
          passId: PASS,
        },
        { taskKey: 'purge', trigger: 'on_demand', dueAt: new Date(nov(25, 9)) },
        {
          taskKey: 'backup',
          trigger: 'scheduled',
          dueAt: new Date(nov(24, 22)),
          startedAt: new Date(nov(24, 22)),
          finishedAt: new Date(nov(24, 22, 5)),
          result: 'failed',
          passId: PASS,
        },
      ]);
      const registry = [
        task('purge', '04:00'),
        task('backup', '23:00'),
        task('link-check', '05:00'),
      ];
      expect(await taskOverview(db, registry, AT)).toStrictEqual([
        {
          task: 'purge',
          lastRun: {
            trigger: 'scheduled',
            startedAt: nov(25, 3),
            finishedAt: null,
            result: null,
          },
          isRunning: true,
          requestedAt: nov(25, 9),
          nextRunAt: nov(26, 3),
        },
        {
          task: 'backup',
          lastRun: {
            trigger: 'scheduled',
            startedAt: nov(24, 22),
            finishedAt: nov(24, 22, 5),
            result: 'failed',
          },
          isRunning: false,
          requestedAt: null,
          nextRunAt: nov(25, 22),
        },
        {
          task: 'link-check',
          lastRun: null,
          isRunning: false,
          requestedAt: null,
          nextRunAt: nov(25, 4),
        },
      ]);
    },
  );

  it("[TRV-32] shows the trigger degraded once the last accepted tick, whoever sent it, is older than twice the expected interval, and lists each caller's last call", async () => {
    const { fake, triggerStatuses, wakePlan } = await load();
    expect(await triggerStatuses(AT, 5)).toStrictEqual({
      trigger: 'degraded',
      lastAcceptedAt: null,
      callers: [],
      runtimeCache: 'normal',
    });
    await wakePlan.recordTick('external-trigger', nov(25, 9, 30));
    await wakePlan.recordTick('vercel-cron/1.0', nov(25, 9, 51));
    // Ten minutes after the last tick, twice the expected five, the trigger is still normal.
    expect(await triggerStatuses(nov(25, 10, 1), 5)).toStrictEqual({
      trigger: 'normal',
      lastAcceptedAt: nov(25, 9, 51),
      callers: [
        { caller: 'vercel-cron/1.0', lastCallAt: nov(25, 9, 51) },
        { caller: 'external-trigger', lastCallAt: nov(25, 9, 30) },
      ],
      runtimeCache: 'normal',
    });
    expect(await triggerStatuses(nov(25, 10, 2), 5)).toMatchObject({
      trigger: 'degraded',
    });
    fake.setAvailable(false);
    expect(await triggerStatuses(AT, 5)).toStrictEqual({
      trigger: null,
      lastAcceptedAt: null,
      callers: [],
      runtimeCache: 'degraded',
    });
  });
});

import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, journalEntries, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { ScheduledTask } from './types';
import type { Database } from '@/lib/db';

/** What `after` takes: a promise, or a callback that Next.js calls once the response is sent. */
type AfterTask = Promise<unknown> | (() => unknown);

const scheduled = vi.hoisted(() => ({ after: vi.fn<(task: AfterTask) => void>() }));
vi.mock(import('next/server'), () => scheduled);

/** Runs `task` as Next.js does once the response is sent. */
async function runAfterResponse(task: AfterTask | undefined): Promise<void> {
  await (typeof task === 'function' ? task() : task);
}

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
/** An instant of November 2026 in UTC, by its day and its hour. */
const nov = (day: number, hour: number) => toEpochMs(Date.UTC(2026, 10, day, hour));
const AT = nov(25, 10);
// The purge at 04:00 in Paris, 03:00 UTC in winter.
const PURGE_DUE_AT = nov(25, 3);
const NEXT_PURGE_AT = nov(26, 3);

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  return { wakePlan: await import('@/lib/wake-plan'), ...(await import('.')) };
}

const purge: ScheduledTask = {
  key: 'purge',
  schedules: [{ kind: 'daily', times: () => ['04:00'] }],
  run: async () => {
    await Promise.resolve();
    return { kind: 'done', result: 'succeeded' };
  },
};

describe('an on-demand run', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    scheduled.after.mockClear();
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    await db.insert(taskRuns).values({
      taskKey: 'purge',
      trigger: 'scheduled',
      dueAt: new Date(PURGE_DUE_AT),
      startedAt: new Date(PURGE_DUE_AT),
      finishedAt: new Date(PURGE_DUE_AT + MINUTE),
      result: 'succeeded',
      passId: '00000000-0000-4000-8000-000000000002',
    });
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[TRV-33] records the asked run once and pulls the wake plan to now, leaving the pass to after the response', async () => {
    const { computeWakePlan, requestRun, wakePlan } = await load();
    await wakePlan.writePlan(await computeWakePlan(db, [purge], AT));
    const planned = await wakePlan.readPlan(AT);
    const requests = [
      await requestRun(db, [purge], 'purge'),
      await requestRun(db, [purge], 'purge'),
    ];
    expect({ planned, requests }).toMatchObject({
      planned: { earliestDueAt: NEXT_PURGE_AT },
      requests: [
        { ok: true, deferred: false },
        { ok: true, deferred: false },
      ],
    });
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    expect(
      runs.map(({ trigger, dueAt, startedAt }) => ({ trigger, dueAt, startedAt })),
    ).toStrictEqual([
      { trigger: 'scheduled', dueAt: new Date(PURGE_DUE_AT), startedAt: new Date(PURGE_DUE_AT) },
      { trigger: 'on_demand', dueAt: new Date(AT), startedAt: null },
    ]);
    expect(await wakePlan.readPlan(AT)).toMatchObject({ earliestDueAt: AT });
    expect(scheduled.after).toHaveBeenCalledTimes(2);
  });

  it('[TRV-33] runs in the pass started after the response, marked on demand, without moving the next scheduled run', async () => {
    const { requestRun, taskOverview } = await load();
    await requestRun(db, [purge], 'purge');
    await runAfterResponse(scheduled.after.mock.calls[0]?.[0]);
    const journal = await db.select().from(journalEntries);
    expect(
      journal.map(({ messageKey, messageParams }) => ({ messageKey, messageParams })),
    ).toStrictEqual([
      { messageKey: 'task_run_succeeded', messageParams: { task: 'purge', trigger: 'on_demand' } },
    ]);
    const [line] = await taskOverview(db, [purge], AT);
    expect(line).toMatchObject({
      lastRun: { trigger: 'on_demand', startedAt: AT, finishedAt: AT, result: 'succeeded' },
      nextRunAt: NEXT_PURGE_AT,
    });
  });

  it('[TRV-33] refuses a task that is not active', async () => {
    const { requestRun } = await load();
    expect(await requestRun(db, [purge], 'backup')).toStrictEqual({
      ok: false,
      error: { kind: 'inactive_task' },
    });
    expect(await db.select().from(taskRuns)).toHaveLength(1);
    expect(scheduled.after).not.toHaveBeenCalled();
  });
});

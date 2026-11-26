import { asc } from 'drizzle-orm';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, journalEntries, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { PASS_BUDGET_MS } from './limits';

import type { ScheduledTask } from './types';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
/** An instant of 24 November 2026 in UTC, by its hour and its minute. */
const utc = (hour: number, minute = 0) => toEpochMs(Date.UTC(2026, 10, 24, hour, minute));

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  return import('.');
}

describe("a task's turn", { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[TRV-28] [CL-TRV-07] journals a postponed occurrence once, though the run it waits for is closed as interrupted and resumed meanwhile', async () => {
    const database = await createTestDatabase();
    onTestFinished(database.close);
    const { db } = database;
    const { execute } = await load();
    const clock = fixedClock(utc(14, 50));
    onTestFinished(installFakeClock(clock));
    const moveTo = (instant: number) => clock.advance(instant - clock.now());
    let isBusy = true;
    // The purge at 04:00 and 16:00 in Paris, 03:00 and 15:00 UTC, whose chunks spend the
    // pass's budget while it is busy.
    const purge: ScheduledTask = {
      key: 'purge',
      schedules: [{ kind: 'daily', times: () => ['04:00', '16:00'] }],
      run: async ({ cursor }) => {
        await Promise.resolve();
        clock.advance(isBusy ? PASS_BUDGET_MS + MINUTE : MINUTE);
        return isBusy
          ? { kind: 'more', cursor: `${cursor ?? ''}a` }
          : { kind: 'done', result: 'succeeded' };
      },
    };
    // The run due at 03:00 starts at 14:50 and runs at 15:00, when the next occurrence comes.
    await execute(db, [purge]);
    moveTo(utc(15));
    await execute(db, [purge]);
    // No pass for eleven minutes: the run is closed as interrupted and resumed, and the
    // resumption still runs at the next pass.
    moveTo(utc(15, 16));
    await execute(db, [purge]);
    moveTo(utc(15, 21));
    isBusy = false;
    await execute(db, [purge]);
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    expect({
      runs: runs.map(({ dueAt, result, cursor }) => ({ dueAt: dueAt.getTime(), result, cursor })),
      entries: entries.map(({ messageKey, taskRunId, occurredAt }) => ({
        messageKey,
        taskRunId,
        at: occurredAt.getTime(),
      })),
    }).toStrictEqual({
      runs: [
        { dueAt: utc(3), result: 'interrupted', cursor: 'aa' },
        { dueAt: utc(3), result: 'succeeded', cursor: 'aaa' },
        { dueAt: utc(15), result: 'succeeded', cursor: null },
      ],
      entries: [
        { messageKey: 'task_run_postponed', taskRunId: runs[0]?.id, at: utc(15) },
        { messageKey: 'task_run_interrupted', taskRunId: runs[0]?.id, at: utc(15, 16) },
        { messageKey: 'task_run_succeeded', taskRunId: runs[1]?.id, at: utc(15, 22) },
        { messageKey: 'task_run_succeeded', taskRunId: runs[2]?.id, at: utc(15, 23) },
      ],
    });
  });
});

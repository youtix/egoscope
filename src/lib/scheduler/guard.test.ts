import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, journalEntries, schedulerLease, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { ScheduledTask } from './types';
import type { Database } from '@/lib/db';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const HOUR = 3_600_000;
/** An instant of November 2026 in UTC, by its day and its minute after 14:00. */
const nov = (day: number, minute = 0) => toEpochMs(Date.UTC(2026, 10, day, 14, minute));
const PASS = '00000000-0000-4000-8000-000000000002';
// The pass, half an hour after the statistics update began to wait for the source.
const AT = nov(25, 30);

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  return { wakePlan: await import('@/lib/wake-plan'), ...(await import('.')) };
}

/** A call that answers `value` on a later turn, as a real one does. */
const answer =
  <T>(value: T) =>
  async (): Promise<T> => {
    await Promise.resolve();
    return value;
  };

const succeeded = answer({ kind: 'done', result: 'succeeded' } as const);

// The statistics update at 15:00 in Paris, 14:00 UTC in winter, whose check of the source
// throws, as a bug or a lost connection does.
const update: ScheduledTask = {
  key: 'statistics-update',
  schedules: [{ kind: 'daily', times: () => ['15:00'] }],
  run: succeeded,
  readyGuard: {
    probe: 'stats-source-refresh',
    call: answer({ found: true }),
    check: async () => {
      await Promise.resolve();
      throw new TypeError('The source answered what no check expects.');
    },
    cutoff: (dueAt) => toEpochMs(dueAt + 5 * HOUR),
  },
};

// The link check at 15:20 in Paris, 14:20 UTC, after the update in the registry.
const linkCheck: ScheduledTask = {
  key: 'link-check',
  schedules: [{ kind: 'daily', times: () => ['15:20'] }],
  run: succeeded,
};

describe('the ready guard', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let lines: unknown[];

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    lines = [];
    const errors = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(JSON.parse(String(line)));
    });
    const restore = installFakeClock(fixedClock(AT));
    const scheduled = { trigger: 'scheduled', passId: PASS } as const;
    await db.insert(taskRuns).values([
      ...[update, linkCheck].map((task, index) => {
        const dueAt = new Date(nov(24, 20 * index));
        const end = { result: 'succeeded', finishedAt: dueAt } as const;
        return { ...scheduled, ...end, taskKey: task.key, dueAt, startedAt: dueAt };
      }),
      // The update of the 25th, which waits for the source since 14:00 UTC.
      {
        ...scheduled,
        taskKey: 'statistics-update',
        dueAt: new Date(nov(25)),
        startedAt: new Date(nov(25)),
      },
    ]);
    return async () => {
      restore();
      errors.mockRestore();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[CL-TRV-07] [CL-TRV-23] records as failed the run whose ready guard throws, then runs the later tasks and writes the plan', async () => {
    const { execute, wakePlan } = await load();
    expect(await execute(db, [update, linkCheck])).toMatchObject({ ok: true });
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    const journal = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    expect({
      log: lines,
      runs: runs.slice(2).map(({ taskKey, dueAt, finishedAt, result }) => ({
        taskKey,
        dueAt,
        finishedAt,
        result,
      })),
      journal: journal.map(({ messageKey, messageParams }) => ({ messageKey, messageParams })),
      plan: await wakePlan.readPlan(AT),
      lease: await db.select().from(schedulerLease),
    }).toMatchObject({
      log: [
        {
          level: 'error',
          message: 'A ready guard threw.',
          context: { task: 'statistics-update', error: 'TypeError' },
        },
      ],
      runs: [
        {
          taskKey: 'statistics-update',
          dueAt: new Date(nov(25)),
          finishedAt: new Date(AT),
          result: 'failed',
        },
        {
          taskKey: 'link-check',
          dueAt: new Date(nov(25, 20)),
          finishedAt: new Date(AT),
          result: 'succeeded',
        },
      ],
      journal: [
        {
          messageKey: 'task_run_failed',
          messageParams: { task: 'statistics-update', trigger: 'scheduled' },
        },
        {
          messageKey: 'task_run_succeeded',
          messageParams: { task: 'link-check', trigger: 'scheduled' },
        },
      ],
      plan: {
        ok: true,
        plan: {
          computedAt: AT,
          entries: [
            { task: 'statistics-update', dueAt: nov(26) },
            { task: 'link-check', dueAt: nov(26, 20) },
          ],
          probes: [],
        },
      },
      lease: [{ id: 1, passId: null, expiresAt: null }],
    });
  });

  it('[CL-TRV-07] [CL-TRV-23] makes due at once in the plan a run whose ready guard throws, so that the next pass asks it again', async () => {
    const { computeWakePlan } = await load();
    expect({ plan: await computeWakePlan(db, [update, linkCheck], AT), log: lines }).toStrictEqual({
      plan: {
        computedAt: AT,
        entries: [
          { task: 'statistics-update', dueAt: AT },
          { task: 'link-check', dueAt: nov(25, 20) },
        ],
        probes: [],
      },
      log: [
        {
          level: 'error',
          message: 'A ready guard threw.',
          context: { task: 'statistics-update', error: 'TypeError' },
        },
      ],
    });
  });
});

import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, journalEntries, schedulerLease, taskRuns } from '@/lib/db';
import { getParams } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { catchUpOf, pendingMissOf } from './catch-up';

import type { CatchUpFacts } from './catch-up';
import type { ScheduledTask } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const HOUR = 3_600_000;
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

// The purge at 04:00 in Paris, 03:00 UTC in winter.
const purge: ScheduledTask = {
  key: 'purge',
  schedules: [{ kind: 'daily', times: () => ['04:00'] }],
  run: answer({ kind: 'done', result: 'succeeded' }),
};

// The statistics update at 15:00 in Paris, 14:00 UTC in winter, which waits for the source.
const statisticsUpdate: ScheduledTask = {
  key: 'statistics-update',
  schedules: [{ kind: 'daily', times: () => ['15:00'] }],
  run: answer({ kind: 'done', result: 'succeeded' }),
  readyGuard: {
    probe: 'stats-source-refresh',
    call: answer({ found: true }),
    check: answer({ ready: true }),
    cutoff: (dueAt) => toEpochMs(dueAt + 5 * HOUR),
  },
};

describe('the catch-up run', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[TRV-31] [CL-TRV-08] [CL-TRV-23] stays to start until a scheduled run starts once the occurrence is missed, or a run that started at or after it stands for it', async () => {
    const params = await getParams(db);
    // The purge of the 25th, missed at 05:00 UTC, the margin of two hours after it.
    const pending: CatchUpFacts = {
      lastMiss: { dueAt: nov(25, 3), journaledAt: nov(25, 10) },
      lastScheduledStartedAt: nov(25, 3),
      lastSuccessStartedAt: nov(24, 3),
      lastScheduledEndStartedAt: nov(25, 3),
    };
    const cases: readonly CatchUpFacts[] = [
      pending,
      { ...pending, lastMiss: null },
      { ...pending, lastScheduledStartedAt: toEpochMs(nov(25, 5) - 1) },
      { ...pending, lastScheduledStartedAt: nov(25, 5) },
      // Journaled under a margin of one hour, which has grown since.
      { ...pending, lastMiss: { dueAt: nov(25, 3), journaledAt: nov(25, 4) } },
      {
        ...pending,
        lastScheduledStartedAt: nov(25, 4),
        lastMiss: { dueAt: nov(25, 3), journaledAt: nov(25, 4) },
      },
      { ...pending, lastSuccessStartedAt: toEpochMs(nov(25, 3) - 1) },
      { ...pending, lastSuccessStartedAt: nov(25, 3) },
      { ...pending, lastScheduledEndStartedAt: toEpochMs(nov(25, 3) - 1) },
    ];
    const due = nov(25, 3);
    expect({
      purge: cases.map((facts) => pendingMissOf(purge, facts, params)),
      update: cases.map((facts) => pendingMissOf(statisticsUpdate, facts, params)),
    }).toStrictEqual({
      purge: [due, null, due, null, due, null, due, null, due],
      // A scheduled run of the update that started at or after it and ended stood for it.
      update: [null, null, null, null, null, null, null, null, due],
    });
  });

  it('[TRV-28] [CL-TRV-08] is due at the latest occurrence that has come, when later than the last missed one', async () => {
    const params = await getParams(db);
    const facts: CatchUpFacts = {
      lastMiss: { dueAt: nov(24, 3), journaledAt: nov(24, 10) },
      lastScheduledStartedAt: nov(23, 3),
      lastSuccessStartedAt: nov(23, 3),
      lastScheduledEndStartedAt: nov(23, 3),
    };
    const computed: ScheduledTask = {
      ...purge,
      key: 'backup',
      schedules: [{ kind: 'computed', nextDueAt: answer(null) }],
    };
    const moment = (at: EpochMs) => ({ at, params, timeZone: 'Europe/Paris' });
    const [justBefore, atIt] = [moment(nov(25, 2, 59)), moment(nov(25, 3))];
    expect([
      catchUpOf(purge, facts, justBefore),
      catchUpOf(purge, facts, atIt),
      catchUpOf(computed, facts, atIt),
      catchUpOf(purge, { ...facts, lastMiss: null }, atIt),
    ]).toStrictEqual([nov(24, 3), nov(25, 3), nov(24, 3), null]);
  });

  it('[TRV-30] [CA-TRV-09] [CL-TRV-07] [CL-TRV-08] resumes from its cursor a cut run whose occurrence the run check finds missed, as its one catch-up run', async () => {
    const { execute } = await load();
    const cursors: (string | null)[] = [];
    const resumable: ScheduledTask = {
      ...purge,
      run: async ({ cursor }) => {
        cursors.push(cursor);
        return answer({ kind: 'done', result: 'succeeded' } as const)();
      },
    };
    const scheduled = { taskKey: 'purge', trigger: 'scheduled', passId: PASS } as const;
    const success = { result: 'succeeded', finishedAt: new Date(nov(24, 3, 1)) } as const;
    await db.insert(taskRuns).values([
      { ...scheduled, ...success, dueAt: new Date(nov(24, 3)), startedAt: new Date(nov(24, 3)) },
      // The run of the 25th wrote its progress mark at 03:04 UTC with its cursor, then its
      // function stopped, leaving the lease, which expires at 03:10; no pass came by 05:00.
      {
        ...scheduled,
        dueAt: new Date(nov(25, 3)),
        startedAt: new Date(nov(25, 3)),
        progressAt: new Date(nov(25, 3, 4)),
        cursor: '3',
      },
    ]);
    await db
      .insert(schedulerLease)
      .values({ id: 1, passId: PASS, expiresAt: new Date(nov(25, 3, 10)) });
    const restore = installFakeClock(fixedClock(nov(25, 5, 5)));
    try {
      await execute(db, [resumable]);
    } finally {
      restore();
    }
    const runs = await db.select().from(taskRuns).orderBy(asc(taskRuns.id));
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    expect({
      cursors,
      runs: runs.map(({ dueAt, startedAt, progressAt, passId, cursor, result }) => ({
        dueAt,
        startedAt,
        progressAt,
        passId,
        cursor,
        result,
      })),
      journal: entries.map(({ messageKey, messageParams }) => ({ messageKey, messageParams })),
    }).toStrictEqual({
      cursors: ['3'],
      runs: [
        {
          dueAt: new Date(nov(24, 3)),
          startedAt: new Date(nov(24, 3)),
          progressAt: null,
          passId: PASS,
          cursor: null,
          result: 'succeeded',
        },
        {
          dueAt: new Date(nov(25, 3)),
          startedAt: new Date(nov(25, 3)),
          progressAt: new Date(nov(25, 3, 4)),
          passId: PASS,
          cursor: '3',
          result: 'interrupted',
        },
        {
          dueAt: new Date(nov(25, 3)),
          startedAt: new Date(nov(25, 5, 5)),
          progressAt: new Date(nov(25, 5, 5)),
          passId: PASS,
          cursor: '3',
          result: 'succeeded',
        },
      ],
      journal: [
        { messageKey: 'task_run_interrupted', messageParams: { task: 'purge' } },
        { messageKey: 'task_run_missed', messageParams: { task: 'purge', dueAt: nov(25, 3) } },
        { messageKey: 'incident_opened', messageParams: { incident: { kind: 'task_not_run' } } },
        {
          messageKey: 'task_run_succeeded',
          messageParams: { task: 'purge', trigger: 'scheduled' },
        },
        { messageKey: 'incident_closed', messageParams: { incident: { kind: 'task_not_run' } } },
      ],
    });
  });
});

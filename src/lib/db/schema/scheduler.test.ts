import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { createTestDatabase } from '../test-database';
import { schedulerLease, taskRuns } from './scheduler';

import type { Database } from '../types';

// The purge due at 04:00 Paris time on 2026-11-18, which started at once.
const DUE_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18, 3)));
const PASS_ID = '0f3c6a52-7d1e-4b89-a2c4-6e5d8f9b1a37';
const RUNNING = {
  trigger: 'scheduled',
  dueAt: DUE_AT,
  startedAt: DUE_AT,
  passId: PASS_ID,
} as const;
// A run that ended five minutes later.
const FINISHED_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18, 3, 5)));

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the scheduler tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('records a running run with the defaults of the data model', async () => {
    await db.insert(taskRuns).values({ taskKey: 'purge', ...RUNNING });

    await expect(db.select().from(taskRuns)).resolves.toStrictEqual([
      {
        id: 1,
        taskKey: 'purge',
        ...RUNNING,
        progressAt: null,
        finishedAt: null,
        result: null,
        parentRunId: null,
        competitionDayOn: null,
        probeCount: null,
        lastRefreshSeenAt: null,
        cursor: null,
        summary: {},
      },
    ]);
  });

  it('accepts each task key of the module map, and refuses the run check, which is no task', async () => {
    const keys = [
      'statistics-update',
      'statistics-fetch',
      'calendar-derivation',
      'recalculation',
      'link-check',
      'purge',
      'backup',
      'news-collection',
      'detection',
      'classification-resume',
      'game-tracking',
      'notification-dispatch',
    ] as const;
    await db.insert(taskRuns).values(keys.map((taskKey) => ({ taskKey, ...RUNNING })));

    const stored = await db.select({ key: taskRuns.taskKey }).from(taskRuns).orderBy(taskRuns.id);
    const runCheck = db.insert(taskRuns).values({ taskKey: sql`'run-check'`, ...RUNNING });

    expect(stored.map((row) => row.key)).toStrictEqual(keys);
    await expect(runCheck).rejects.toMatchObject(violationOf('task_runs_task_key_check'));
  });

  it('[CL-TRV-07] ends a run with its instant and one result of the glossary together', async () => {
    const results = ['succeeded', 'failed', 'interrupted', 'source_late'] as const;
    await db.insert(taskRuns).values(
      results.map((result) => ({
        taskKey: 'statistics-update' as const,
        ...RUNNING,
        finishedAt: FINISHED_AT,
        result,
      })),
    );

    const stored = await db.select({ result: taskRuns.result }).from(taskRuns).orderBy(taskRuns.id);
    const unknown = db
      .insert(taskRuns)
      .values({ taskKey: 'purge', ...RUNNING, finishedAt: FINISHED_AT, result: sql`'cancelled'` });
    const endless = db.insert(taskRuns).values({ taskKey: 'purge', ...RUNNING, result: 'failed' });
    const resultless = db
      .insert(taskRuns)
      .values({ taskKey: 'purge', ...RUNNING, finishedAt: FINISHED_AT });

    expect(stored.map((row) => row.result)).toStrictEqual(results);
    await expect(unknown).rejects.toMatchObject(violationOf('task_runs_result_check'));
    await expect(endless).rejects.toMatchObject(violationOf('task_runs_finished_check'));
    await expect(resultless).rejects.toMatchObject(violationOf('task_runs_finished_check'));
  });

  it('[CL-COL-20] lets only a requested on-demand run wait without a start, and gives a started run its pass', async () => {
    await db.insert(taskRuns).values({ taskKey: 'purge', trigger: 'on_demand', dueAt: DUE_AT });

    const scheduled = db
      .insert(taskRuns)
      .values({ taskKey: 'backup', trigger: 'scheduled', dueAt: DUE_AT });
    const ended = db.insert(taskRuns).values({
      taskKey: 'backup',
      trigger: 'on_demand',
      dueAt: DUE_AT,
      finishedAt: FINISHED_AT,
      result: 'failed',
    });
    const passless = db
      .insert(taskRuns)
      .values({ taskKey: 'backup', trigger: 'scheduled', dueAt: DUE_AT, startedAt: DUE_AT });
    const trigger = db
      .insert(taskRuns)
      .values({ taskKey: 'backup', ...RUNNING, trigger: sql`'manual'` });

    await expect(scheduled).rejects.toMatchObject(violationOf('task_runs_waiting_check'));
    await expect(ended).rejects.toMatchObject(violationOf('task_runs_waiting_check'));
    await expect(passless).rejects.toMatchObject(violationOf('task_runs_pass_check'));
    await expect(trigger).rejects.toMatchObject(violationOf('task_runs_trigger_check'));
  });

  it('[CL-TRV-23] keeps the competition day, the probes, the last refresh and a late source to the statistics update', async () => {
    await db.insert(taskRuns).values({
      taskKey: 'statistics-update',
      ...RUNNING,
      competitionDayOn: '2026-11-17',
      probeCount: 2,
      lastRefreshSeenAt: DUE_AT,
    });

    const day = db
      .insert(taskRuns)
      .values({ taskKey: 'purge', ...RUNNING, competitionDayOn: '2026-11-17' });
    const probes = db.insert(taskRuns).values({ taskKey: 'purge', ...RUNNING, probeCount: 2 });
    const late = db
      .insert(taskRuns)
      .values({ taskKey: 'purge', ...RUNNING, finishedAt: FINISHED_AT, result: 'source_late' });

    await expect(
      db.select({ day: taskRuns.competitionDayOn, probes: taskRuns.probeCount }).from(taskRuns),
    ).resolves.toStrictEqual([{ day: '2026-11-17', probes: 2 }]);
    await expect(day).rejects.toMatchObject(violationOf('task_runs_statistics_update_check'));
    await expect(probes).rejects.toMatchObject(violationOf('task_runs_statistics_update_check'));
    await expect(late).rejects.toMatchObject(violationOf('task_runs_source_late_check'));
  });

  it('[CL-COL-20] runs one run of a task at a time, with at most one requested run waiting', async () => {
    await db.insert(taskRuns).values([
      { taskKey: 'purge', ...RUNNING, finishedAt: FINISHED_AT, result: 'succeeded' },
      { taskKey: 'purge', ...RUNNING },
      { taskKey: 'purge', trigger: 'on_demand', dueAt: DUE_AT },
      { taskKey: 'backup', ...RUNNING },
    ]);

    const running = db.insert(taskRuns).values({ taskKey: 'purge', ...RUNNING });
    const waiting = db
      .insert(taskRuns)
      .values({ taskKey: 'purge', trigger: 'on_demand', dueAt: DUE_AT });

    await expect(running).rejects.toMatchObject(duplicateOf('task_runs_one_running_key'));
    await expect(waiting).rejects.toMatchObject(duplicateOf('task_runs_one_requested_key'));
  });

  it('keeps a chained run when the run it was chained to goes', async () => {
    await db.insert(taskRuns).values([
      { taskKey: 'statistics-update', ...RUNNING, finishedAt: FINISHED_AT, result: 'succeeded' },
      { taskKey: 'calendar-derivation', ...RUNNING, parentRunId: 1 },
    ]);

    await db.delete(taskRuns).where(eq(taskRuns.id, 1));

    await expect(
      db.select({ id: taskRuns.id, parent: taskRuns.parentRunId }).from(taskRuns),
    ).resolves.toStrictEqual([{ id: 2, parent: null }]);
  });

  it('keeps the tick lease in one row, id 1, its pass and its expiry set and cleared together', async () => {
    await db.insert(schedulerLease).values({ id: 1 });
    const second = db.insert(schedulerLease).values({ id: 2 });
    const passAlone = db
      .update(schedulerLease)
      .set({ passId: PASS_ID })
      .where(eq(schedulerLease.id, 1));
    await expect(second).rejects.toMatchObject(violationOf('scheduler_lease_id_check'));
    await expect(passAlone).rejects.toMatchObject(violationOf('scheduler_lease_holder_check'));

    await db
      .update(schedulerLease)
      .set({ passId: PASS_ID, expiresAt: FINISHED_AT })
      .where(eq(schedulerLease.id, 1));

    await expect(db.select().from(schedulerLease)).resolves.toStrictEqual([
      { id: 1, passId: PASS_ID, expiresAt: FINISHED_AT },
    ]);
  });
});

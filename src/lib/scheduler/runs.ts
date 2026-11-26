// The rows of `task_runs` (TRV-26 to TRV-33, CL-TRV-07, CL-TRV-08): what a pass reads of
// each task, and every change of a run's state, each journaled in its own transaction.
import { and, desc, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm';

import { journalEntries, taskRuns } from '@/lib/db';
import { close } from '@/lib/incidents';
import { record } from '@/lib/journal';
import { toEpochMs } from '@/lib/time';

import type { ScheduledTask, TaskRunResult, WaitingRun } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { JournalEntryInput } from '@/lib/journal';
import type { EpochMs } from '@/lib/time';
import type { TaskKey } from '@/lib/wake-plan';
import type { SQL } from 'drizzle-orm';

/** One run, as the table holds it. */
export type RunRow = typeof taskRuns.$inferSelect;

/** The last occurrence of a task journaled as missed, and when the run check journaled it. */
export type LastMiss = Readonly<{ dueAt: EpochMs; journaledAt: EpochMs }>;

/** What the scheduler knows of a task from its runs. */
export type TaskState = Readonly<{
  /** The run that started last: the running one, if any (TRV-28). */
  latest: RunRow | null;
  /** The on-demand run that waits to start (CL-COL-20). */
  requested: RunRow | null;
  /** The occurrence of the last scheduled run, from which the next one counts (TRV-33). */
  lastScheduledDueAt: EpochMs | null;
  lastSuccess: RunRow | null;
  /** The start of the last scheduled run, which a catch-up run is once its miss is due (CL-TRV-08). */
  lastScheduledStartedAt: EpochMs | null;
  /** The start of the last run that succeeded, whatever its trigger (CL-TRV-08). */
  lastSuccessStartedAt: EpochMs | null;
  /** The start of the last scheduled run that ended other than interrupted (CL-TRV-23). */
  lastScheduledEndStartedAt: EpochMs | null;
  /** The last occurrence journaled as missed (TRV-31, CL-TRV-08). */
  lastMiss: LastMiss | null;
}>;

/** How a run that a handler ended ended. */
export type HandlerResult = Exclude<TaskRunResult, 'interrupted'>;

/** A run's instant as an `EpochMs` (TRV-26). */
export const epochOf = (date: Date): EpochMs => toEpochMs(date.getTime());

/** Whether `run` runs: it started and has no result yet (CL-TRV-07). */
export const isRunning = (
  run: RunRow | null,
): run is RunRow & Readonly<{ startedAt: Date; result: null }> =>
  run !== null && run.startedAt !== null && run.result === null;

/**
 * Whether `run` waits in the ready guard of `task`: a scheduled run whose work has not
 * begun, which holds neither the lease nor a connection and is never stale (CL-TRV-23).
 */
export const isWaiting = (task: ScheduledTask, run: RunRow): boolean =>
  task.readyGuard !== undefined &&
  run.trigger === 'scheduled' &&
  run.progressAt === null &&
  run.result === null;

/** A running run as its ready guard sees it (CL-TRV-23). */
export const waitingRunOf = (run: RunRow): WaitingRun => ({
  id: run.id,
  dueAt: epochOf(run.dueAt),
  startedAt: epochOf(run.startedAt ?? run.dueAt),
});

const byTask = <T extends Readonly<{ taskKey: TaskKey }>>(rows: readonly T[]) =>
  new Map(rows.map((row) => [row.taskKey, row]));

/** The latest instant of `column` among a task's runs that `filter` keeps, or null. */
const latestWhere = (column: typeof taskRuns.dueAt | typeof taskRuns.startedAt, filter: SQL) =>
  sql<Date | null>`max(${column}) filter (where ${filter})`.mapWith(taskRuns.dueAt);

const scheduledOnly = sql`${taskRuns.trigger} = 'scheduled'`;

/** The instants that each task's runs reach: last scheduled occurrence and start, last success's start. */
async function marksOf(db: Database) {
  return db
    .select({
      taskKey: taskRuns.taskKey,
      scheduledDueAt: latestWhere(taskRuns.dueAt, scheduledOnly),
      scheduledStartedAt: latestWhere(taskRuns.startedAt, scheduledOnly),
      successStartedAt: latestWhere(taskRuns.startedAt, sql`${taskRuns.result} = 'succeeded'`),
      scheduledEndStartedAt: latestWhere(
        taskRuns.startedAt,
        sql`${scheduledOnly} and ${taskRuns.result} <> 'interrupted'`,
      ),
    })
    .from(taskRuns)
    .groupBy(taskRuns.taskKey);
}

/** Each task's last occurrence journaled as missed, and when it was (TRV-31, CL-TRV-08). */
async function missesOf(db: Database) {
  const task = sql<TaskKey>`${journalEntries.messageParams}->>'task'`;
  return db
    .select({
      taskKey: task,
      dueAt:
        sql<number>`max((${journalEntries.messageParams}->>'dueAt')::double precision)`.mapWith(
          Number,
        ),
      journaledAt: sql<Date>`max(${journalEntries.occurredAt})`.mapWith(journalEntries.occurredAt),
    })
    .from(journalEntries)
    .where(eq(journalEntries.messageKey, 'task_run_missed'))
    .groupBy(task);
}

const epochOrNull = (date: Date | null | undefined): EpochMs | null =>
  date === null || date === undefined ? null : epochOf(date);

/**
 * What the runs, and the run check's journal entries, say of every task, in six reads
 * whatever the number of tasks (TRV-26, TRV-28, CL-TRV-08).
 */
export async function loadStates(db: Database): Promise<(task: TaskKey) => TaskState> {
  const latest = await db
    .selectDistinctOn([taskRuns.taskKey])
    .from(taskRuns)
    .where(isNotNull(taskRuns.startedAt))
    .orderBy(taskRuns.taskKey, desc(taskRuns.startedAt), desc(taskRuns.id));
  const requested = await db.select().from(taskRuns).where(isNull(taskRuns.startedAt));
  const successes = await db
    .selectDistinctOn([taskRuns.taskKey])
    .from(taskRuns)
    .where(eq(taskRuns.result, 'succeeded'))
    .orderBy(taskRuns.taskKey, desc(taskRuns.finishedAt));
  const [latestOf, requestedOf, successOf] = [byTask(latest), byTask(requested), byTask(successes)];
  const [marksByTask, missByTask] = [byTask(await marksOf(db)), byTask(await missesOf(db))];
  return (task) => {
    const marks = marksByTask.get(task);
    const miss = missByTask.get(task);
    return {
      latest: latestOf.get(task) ?? null,
      requested: requestedOf.get(task) ?? null,
      lastScheduledDueAt: epochOrNull(marks?.scheduledDueAt),
      lastSuccess: successOf.get(task) ?? null,
      lastScheduledStartedAt: epochOrNull(marks?.scheduledStartedAt),
      lastSuccessStartedAt: epochOrNull(marks?.successStartedAt),
      lastScheduledEndStartedAt: epochOrNull(marks?.scheduledEndStartedAt),
      lastMiss:
        miss === undefined
          ? null
          : { dueAt: toEpochMs(miss.dueAt), journaledAt: epochOf(miss.journaledAt) },
    };
  };
}

/** A run to start now, with what it continues of an earlier one. */
export type RunStart = Readonly<{
  taskKey: TaskKey;
  trigger: RunRow['trigger'];
  dueAt: EpochMs;
  passId: string;
  parentRunId?: number | null;
  competitionDayOn?: string | null;
  cursor?: string | null;
  progressAt?: EpochMs | null;
}>;

/**
 * Starts a run at `at`, unless one of its task already runs (TRV-28): the unique index
 * of running runs refuses the second, so that no two runs of a task ever overlap.
 */
export async function startRun(
  db: Database | Transaction,
  start: RunStart,
  at: EpochMs,
): Promise<RunRow | null> {
  const progressAt = start.progressAt ?? null;
  const [started] = await db
    .insert(taskRuns)
    .values({
      taskKey: start.taskKey,
      trigger: start.trigger,
      dueAt: new Date(start.dueAt),
      startedAt: new Date(at),
      progressAt: progressAt === null ? null : new Date(progressAt),
      parentRunId: start.parentRunId ?? null,
      passId: start.passId,
      competitionDayOn: start.competitionDayOn ?? null,
      cursor: start.cursor ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return started ?? null;
}

/** A pass at an instant: the run it starts gets its id (TRV-26). */
export type PassMoment = Readonly<{ passId: string; at: EpochMs }>;

/** Starts the on-demand run that waited, in its pass, while no run of its task runs (TRV-28, TRV-33). */
export async function startRequested(
  db: Database,
  requested: RunRow,
  moment: PassMoment,
): Promise<RunRow | null> {
  const runningOfTask = and(
    eq(taskRuns.taskKey, requested.taskKey),
    isNotNull(taskRuns.startedAt),
    isNull(taskRuns.result),
  );
  const running = db.select({ id: taskRuns.id }).from(taskRuns).where(runningOfTask);
  const stillWaiting = and(eq(taskRuns.id, requested.id), isNull(taskRuns.startedAt));
  const [started] = await db
    .update(taskRuns)
    .set({ startedAt: new Date(moment.at), passId: moment.passId })
    .where(and(stillWaiting, notExists(running)))
    .returning();
  return started ?? null;
}

/** Writes the progress mark of a portion of `run` at `at` and where it resumes (TRV-30, CL-TRV-07). */
export async function markProgress(
  db: Database,
  run: Readonly<{ id: number; cursor: string | null }>,
  at: EpochMs,
): Promise<void> {
  await db
    .update(taskRuns)
    .set({ cursor: run.cursor, progressAt: new Date(at) })
    .where(eq(taskRuns.id, run.id));
}

/** The journal entry of a run that ended with `result`. */
function endEntry(run: RunRow, result: HandlerResult): JournalEntryInput {
  const params = { task: run.taskKey, trigger: run.trigger };
  switch (result) {
    case 'source_late': {
      return { messageKey: 'task_run_source_late', taskRunId: run.id };
    }
    case 'failed': {
      return { messageKey: 'task_run_failed', taskRunId: run.id, params };
    }
    case 'succeeded': {
      return { messageKey: 'task_run_succeeded', taskRunId: run.id, params };
    }
  }
}

/**
 * Ends `run` with `result` at `at` and journals it; a success closes the task's "task
 * not run" incident (TRV-26, TRV-31, CL-TRV-08).
 */
export async function finishRun(
  db: Database,
  run: RunRow,
  end: Readonly<{ result: HandlerResult; at: EpochMs }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(taskRuns)
      .set({ result: end.result, finishedAt: new Date(end.at) })
      .where(eq(taskRuns.id, run.id));
    await record(tx, endEntry(run, end.result));
    if (end.result === 'succeeded') {
      await close(tx, { kind: 'task_not_run', task: run.taskKey }, run.passId ?? undefined);
    }
  });
}

/**
 * Closes a run found stale at a wake-up as interrupted, its end being `at`, with a
 * warning in the journal, which frees its task (CL-TRV-07).
 */
export async function interrupt(db: Database, run: RunRow, at: EpochMs): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(taskRuns)
      .set({ result: 'interrupted', finishedAt: new Date(at) })
      .where(eq(taskRuns.id, run.id));
    await record(tx, {
      messageKey: 'task_run_interrupted',
      taskRunId: run.id,
      params: { task: run.taskKey },
    });
  });
}

// A task's turn in a pass (TRV-26, TRV-28, TRV-30, CL-TRV-07, CL-TRV-08): the run to work
// on, if any, and the postponement of an occurrence that comes due while a run runs.
import { and, eq, sql } from 'drizzle-orm';

import { journalEntries } from '@/lib/db';
import { record } from '@/lib/journal';
import { toEpochMs } from '@/lib/time';

import { catchUpOf } from './catch-up';
import { nextOccurrence, scheduledDue, sinceOf } from './due';
import { epochOf, isRunning, startRequested, startRun } from './runs';

import type { DueContext } from './due';
import type { RunRow, RunStart, TaskState } from './runs';
import type { ScheduledTask } from './types';
import type { Database } from '@/lib/db';
import type { ParamReader } from '@/lib/params';
import type { EpochMs } from '@/lib/time';
import type { TaskKey } from '@/lib/wake-plan';

/** A database pass: its id, its budget's end, the parameters it read, its started tasks. */
export type Pass = Readonly<{
  db: Database;
  id: string;
  endsAt: EpochMs;
  params: ParamReader;
  timeZone: string;
  /** The tasks that started a scheduled run in this pass: one each. */
  started: Set<TaskKey>;
}>;

/** A task's turn in a pass: what the pass knows of it now. */
type Turn = Readonly<{ pass: Pass; task: ScheduledTask; state: TaskState; context: DueContext }>;

/**
 * Journals that the task of `turn` came due while `running` runs, once per postponed
 * occurrence, whichever run it waits for: the resumption of a cut run journals it no more
 * than the run did. The occurrence waits for that run's end (TRV-28, CL-TRV-07).
 */
async function journalPostponement(turn: Turn, running: RunRow): Promise<void> {
  const { task, state, context } = turn;
  const runningDueAt = epochOf(running.dueAt);
  const lastScheduledDueAt = toEpochMs(Math.max(state.lastScheduledDueAt ?? 0, runningDueAt));
  const since = { lastScheduledDueAt, lastStartedAt: sinceOf(state).lastStartedAt };
  const next = await nextOccurrence(task, since, context);
  if (next === null || next.dueAt > context.at || next.dueAt <= runningDueAt) {
    return;
  }
  const { db } = context;
  const thisPostponement = and(
    eq(journalEntries.messageKey, 'task_run_postponed'),
    sql`${journalEntries.messageParams}->>'task' = ${task.key}`,
    eq(journalEntries.occurredAt, new Date(next.dueAt)),
  );
  const journaled = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(thisPostponement);
  if (journaled.length > 0) {
    return;
  }
  const entry = { taskRunId: running.id, occurredAt: next.dueAt, params: { task: task.key } };
  await db.transaction(async (tx) => record(tx, { messageKey: 'task_run_postponed', ...entry }));
}

/**
 * The resumption of an interrupted run from its cursor and its progress, in its own pass,
 * with its parent run and its competition day (TRV-30, CA-TRV-09, CL-TRV-07). A scheduled
 * one is the task's catch-up run while one is still to start, and is then due at the
 * occurrence the catch-up run is due for when later, standing for it (CL-TRV-08).
 */
function resumptionOf(turn: Turn, run: RunRow): RunStart {
  const { pass, task, state, context } = turn;
  const catchUp = run.trigger === 'scheduled' ? catchUpOf(task, state, context) : null;
  const dueAt = epochOf(run.dueAt);
  return {
    taskKey: run.taskKey,
    trigger: run.trigger,
    dueAt: catchUp === null ? dueAt : toEpochMs(Math.max(dueAt, catchUp)),
    passId: run.passId ?? pass.id,
    parentRunId: run.parentRunId,
    competitionDayOn: run.competitionDayOn,
    cursor: run.cursor,
    progressAt: run.progressAt === null ? null : context.at,
  };
}

/**
 * The one scheduled run of the turn's task per pass, for its due occurrence or its catch-up
 * run (CL-TRV-08), a chained one in its parent's pass (TRV-26).
 */
async function startScheduled(turn: Turn): Promise<RunRow | null> {
  const { pass, task, state, context } = turn;
  if (pass.started.has(task.key)) {
    return null;
  }
  const due = await scheduledDue(task, state, context);
  if (due === null || due.dueAt > context.at) {
    return null;
  }
  pass.started.add(task.key);
  const start: RunStart = {
    taskKey: task.key,
    trigger: 'scheduled',
    dueAt: due.dueAt,
    passId: due.parent?.passId ?? pass.id,
    parentRunId: due.parent?.id ?? null,
  };
  return startRun(pass.db, start, context.at);
}

/**
 * Starts the run that the turn's task is due for, if any, the one place where a run starts:
 * the resumption of an interrupted run (TRV-30), the catch-up run included, the on-demand
 * run that waited (CL-COL-20), or its scheduled run, its catch-up run included (CL-TRV-08).
 */
async function startDue(turn: Turn): Promise<RunRow | null> {
  const { pass, state, context } = turn;
  const { latest, requested } = state;
  if (latest?.result === 'interrupted') {
    return startRun(pass.db, resumptionOf(turn, latest), context.at);
  }
  if (requested !== null) {
    return startRequested(pass.db, requested, { passId: pass.id, at: context.at });
  }
  return startScheduled(turn);
}

/**
 * The run of the turn's task to work on now, if any (TRV-28): the one that runs, an
 * occurrence due meanwhile being postponed, or the one it is due for.
 */
export async function nextRun(turn: Turn): Promise<RunRow | null> {
  const { latest } = turn.state;
  if (isRunning(latest)) {
    await journalPostponement(turn, latest);
    return latest;
  }
  return startDue(turn);
}

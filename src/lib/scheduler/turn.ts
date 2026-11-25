// A task's turn in a pass (TRV-26, TRV-28, TRV-30, CL-TRV-07, CL-TRV-23): the run to work
// on, if any, and the postponement of an occurrence that comes due while a run runs.
import { and, eq } from 'drizzle-orm';

import { journalEntries } from '@/lib/db';
import { record } from '@/lib/journal';
import { toEpochMs } from '@/lib/time';

import { nextOccurrence, sinceOf } from './due';
import {
  epochOf,
  isRunning,
  isWaiting,
  markProgress,
  startRequested,
  startRun,
  waitingRunOf,
} from './runs';

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
 * Journals, once per occurrence, that the task of `turn` came due while `running` runs:
 * the occurrence waits for that run's end (TRV-28, CL-TRV-07).
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
    eq(journalEntries.taskRunId, running.id),
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

/** The resumption of an interrupted run from its cursor, in its own pass (TRV-30). */
function resumptionOf(run: RunRow, pass: Pass, at: EpochMs): RunStart {
  return {
    taskKey: run.taskKey,
    trigger: run.trigger,
    dueAt: epochOf(run.dueAt),
    passId: run.passId ?? pass.id,
    parentRunId: run.parentRunId,
    competitionDayOn: run.competitionDayOn,
    cursor: run.cursor,
    progressAt: run.progressAt === null ? null : at,
  };
}

/** The one scheduled run of the turn's task per pass, for its due occurrence, a chained one in its parent's pass (TRV-26). */
async function startScheduled(turn: Turn): Promise<RunRow | null> {
  const { pass, task, state, context } = turn;
  if (pass.started.has(task.key)) {
    return null;
  }
  const due = await nextOccurrence(task, sinceOf(state), context);
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
 * Starts the run that the turn's task is due for, if any: the resumption of an
 * interrupted run (TRV-30), the on-demand run that waited (CL-COL-20), or its scheduled run.
 */
async function startDue(turn: Turn): Promise<RunRow | null> {
  const { pass, state, context } = turn;
  const { latest, requested } = state;
  if (latest?.result === 'interrupted') {
    return startRun(pass.db, resumptionOf(latest, pass, context.at), context.at);
  }
  if (requested !== null) {
    return startRequested(pass.db, requested, { passId: pass.id, at: context.at });
  }
  return startScheduled(turn);
}

/**
 * `run` once its ready guard lets it go, at the latest at its cut-off, its progress mark
 * then showing that its work began; a run that does not wait goes on at once (CL-TRV-23).
 */
async function releasedFromGuard(turn: Turn, run: RunRow): Promise<RunRow | null> {
  const { pass, task, context } = turn;
  const guard = task.readyGuard;
  if (guard === undefined || !isWaiting(task, run)) {
    return run;
  }
  const isCutOff = context.at >= guard.cutoff(epochOf(run.dueAt), pass.params, pass.timeZone);
  const checked = isCutOff ? null : await guard.check(pass.db, waitingRunOf(run), context.at);
  if (checked !== null && !checked.ready) {
    return null;
  }
  await markProgress(pass.db, run, context.at);
  return run;
}

/**
 * The run of the turn's task to work on now, if any (TRV-28): the one that runs, an
 * occurrence due meanwhile being postponed, or the one it is due for; a run that waits in
 * its ready guard goes on only once the guard lets it go.
 */
export async function nextRun(turn: Turn): Promise<RunRow | null> {
  const { latest } = turn.state;
  if (isRunning(latest)) {
    await journalPostponement(turn, latest);
  }
  const run = isRunning(latest) ? latest : await startDue(turn);
  return run === null ? null : releasedFromGuard(turn, run);
}

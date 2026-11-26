// The run check (TRV-31, CL-TRV-08, CL-TRV-23): each missed occurrence journaled once, the
// "task not run" incident opened, and the task's one catch-up run made due at once.
import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNotNull, or, sql } from 'drizzle-orm';

import { journalEntries, taskRuns } from '@/lib/db';
import { close, open } from '@/lib/incidents';
import { record } from '@/lib/journal';
import { getParams } from '@/lib/params';
import { toEpochMs } from '@/lib/time';
import { wakeAt } from '@/lib/wake-plan';

import { marginOf, pendingMissOf } from './catch-up';
import { TIME_ZONE_KEY } from './due';
import { releaseLease, takeLease } from './lease';
import { localTimesOf, occurrencesBetween } from './occurrences';
import { epochOf } from './runs';

import type { CatchUpFacts } from './catch-up';
import type { LeaseHeld } from './lease';
import type { Registry, ScheduledTask, TaskRunResult, TaskRunTrigger } from './types';
import type { Database } from '@/lib/db';
import type { ParamReader } from '@/lib/params';
import type { EpochMs } from '@/lib/time';
import type { TaskKey } from '@/lib/wake-plan';

/** A run that started, as the check reads it: its end and result are null while it runs. */
type Span = Readonly<{
  task: TaskKey;
  trigger: TaskRunTrigger;
  start: EpochMs;
  end: EpochMs | null;
  result: TaskRunResult | null;
}>;

/** When the check runs, and the pass, holding the lease, whose id the incidents it opens take. */
type CheckMoment = Readonly<{ at: EpochMs; passId: string }>;

/** What the run check at opening did: the tasks whose catch-up run it made due, or nothing while a pass runs. */
export type MissedRunsCheck =
  Readonly<{ ok: true; caughtUp: readonly TaskKey[] }> | Readonly<{ ok: false; error: LeaseHeld }>;

type Check = Readonly<{
  db: Database;
  at: EpochMs;
  passId: string;
  params: ParamReader;
  timeZone: string;
  marginMs: number;
  floors: ReadonlyMap<TaskKey, EpochMs>;
  spans: readonly Span[];
  journaled: ReadonlySet<string>;
}>;

/**
 * Where each task's check starts: just before the occurrence of its last scheduled run
 * that succeeded, which an on-demand run never moves (TRV-33), or else of its first run,
 * and never before its first run started, so that the occurrences that came before the
 * task first ran, which its first run, due at once, stands for, are never missed
 * (CL-TRV-08); a task that never ran has none, since it is due at once. A run that
 * finished without success never moves it, so that the earlier occurrences that such a
 * run stood for are still judged, each journaled once (CL-TRV-08).
 */
async function floorsOf(db: Database): Promise<ReadonlyMap<TaskKey, EpochMs>> {
  const succeededScheduled = sql`${taskRuns.result} = 'succeeded' and ${taskRuns.trigger} = 'scheduled'`;
  const lastOccurrence = sql`coalesce(max(${taskRuns.dueAt}) filter (where ${succeededScheduled}), min(${taskRuns.dueAt}))`;
  const rows = await db
    .select({
      taskKey: taskRuns.taskKey,
      from: sql<Date>`greatest(${lastOccurrence}, min(${taskRuns.startedAt}))`.mapWith(
        taskRuns.dueAt,
      ),
    })
    .from(taskRuns)
    .where(isNotNull(taskRuns.startedAt))
    .groupBy(taskRuns.taskKey);
  return new Map(rows.map(({ taskKey, from }) => [taskKey, toEpochMs(from.getTime() - 1)]));
}

/** What the check reads of `task`: its runs since `since`, and its parents' successes since. */
function runsToRead(task: ScheduledTask, since: Date) {
  const parents = task.schedules.flatMap((schedule) =>
    schedule.kind === 'chained' ? schedule.after : [],
  );
  const parentSuccess = (parent: TaskKey) =>
    and(
      eq(taskRuns.taskKey, parent),
      eq(taskRuns.result, 'succeeded'),
      gt(taskRuns.finishedAt, since),
    );
  return [
    and(eq(taskRuns.taskKey, task.key), gt(taskRuns.startedAt, since)),
    ...parents.map((parent) => parentSuccess(parent)),
  ];
}

/** The runs that the check reads, for the tasks of `registry` that have a floor. */
async function spansOf(
  db: Database,
  registry: Registry,
  floors: ReadonlyMap<TaskKey, EpochMs>,
): Promise<readonly Span[]> {
  const conditions = registry.flatMap((task) => {
    const floor = floors.get(task.key);
    return floor === undefined ? [] : runsToRead(task, new Date(floor));
  });
  if (conditions.length === 0) {
    return [];
  }
  // Every run read started: its own runs since the floor, its parents' successes.
  const runs = await db
    .select({
      task: taskRuns.taskKey,
      trigger: taskRuns.trigger,
      startedAt: sql<Date>`${taskRuns.startedAt}`.mapWith(taskRuns.startedAt),
      finishedAt: taskRuns.finishedAt,
      result: taskRuns.result,
    })
    .from(taskRuns)
    .where(or(...conditions));
  return runs.map(({ task, trigger, startedAt, finishedAt, result }) => ({
    task,
    trigger,
    start: epochOf(startedAt),
    end: finishedAt === null ? null : epochOf(finishedAt),
    result,
  }));
}

const missKey = (task: string, dueAt: number | string) => `${task}@${String(dueAt)}`;

/** The occurrences already journaled as missed since `since`. */
async function journaledMisses(db: Database, since: EpochMs): Promise<ReadonlySet<string>> {
  const params = journalEntries.messageParams;
  const missEntries = eq(journalEntries.messageKey, 'task_run_missed');
  const recentEntries = gt(journalEntries.occurredAt, new Date(since));
  const rows = await db
    .select({ task: sql<string>`${params}->>'task'`, dueAt: sql<string>`${params}->>'dueAt'` })
    .from(journalEntries)
    .where(and(missEntries, recentEntries));
  return new Set(rows.map(({ task, dueAt }) => missKey(task, dueAt)));
}

/** Everything the check of `registry` at `moment` reads, in six reads whatever the number of tasks. */
async function checkOf(
  db: Database,
  registry: Registry,
  moment: CheckMoment,
): Promise<Check | null> {
  const floors = await floorsOf(db);
  const spans = await spansOf(db, registry, floors);
  if (spans.length === 0) {
    return null;
  }
  const params = await getParams(db);
  const oldestFloor = toEpochMs(Math.min(...floors.values()));
  return {
    db,
    at: moment.at,
    passId: moment.passId,
    params,
    timeZone: params.get(TIME_ZONE_KEY),
    marginMs: marginOf(params),
    floors,
    spans,
    journaled: await journaledMisses(db, oldestFloor),
  };
}

/** The occurrences of `task` after `floor` whose margin has passed (CL-TRV-08). */
async function occurrencesOf(task: ScheduledTask, floor: EpochMs, check: Check) {
  const until = toEpochMs(check.at - check.marginMs);
  const isChecked = (instant: EpochMs) => instant > floor && instant <= until;
  const found: EpochMs[] = [];
  for (const schedule of task.schedules) {
    if (schedule.kind === 'chained') {
      const ends = check.spans
        .filter((span) => schedule.after.includes(span.task) && span.result === 'succeeded')
        .flatMap((span) => span.end ?? []);
      found.push(...ends.filter((end) => isChecked(end)));
    } else if (schedule.kind === 'computed') {
      const dueAt = await schedule.nextDueAt(check.db, check.at);
      found.push(...(dueAt !== null && isChecked(dueAt) ? [dueAt] : []));
    } else {
      const local = localTimesOf(schedule, check.params);
      found.push(...occurrencesBetween({ after: floor, until }, local, check.timeZone));
    }
  }
  return found;
}

/** Whether `span` ended by `deadline`. */
const isEndedBy = (span: Span, deadline: number) => span.end !== null && span.end <= deadline;

/**
 * Whether `span` counts as the day's run of a task with a ready guard: a scheduled run, or a
 * manual one that succeeded, which satisfies the day's occurrence (CL-TRV-23); a manual run
 * that failed, was cut or still runs does not.
 */
const isDaysRun = (span: Span) => span.trigger === 'scheduled' || span.result === 'succeeded';

/**
 * Whether `occurrence` of `task` is missed: no run started at or after it succeeded by
 * the occurrence plus the margin (TRV-31, CL-TRV-08); for a task with a ready guard, the
 * statistics update, the day's run has not started by the occurrence plus the margin, or
 * none of those has a result by the cut-off plus the margin, so that a run waiting for the
 * source is running and a late source is never missed (CL-TRV-23).
 */
function isMissed(task: ScheduledTask, occurrence: EpochMs, check: Check): boolean {
  const startDeadline = occurrence + check.marginMs;
  const started = check.spans.filter((span) => span.task === task.key && span.start >= occurrence);
  const { readyGuard } = task;
  if (readyGuard === undefined) {
    return started.every((span) => span.result !== 'succeeded' || !isEndedBy(span, startDeadline));
  }
  const inTime = started.filter((span) => span.start <= startDeadline && isDaysRun(span));
  const resultDeadline =
    readyGuard.cutoff(occurrence, check.params, check.timeZone) + check.marginMs;
  const hasResult = inTime.some((span) => isEndedBy(span, resultDeadline));
  return inTime.length === 0 || (!hasResult && check.at >= resultDeadline);
}

/** The occurrences of `task` missed since its floor and not journaled yet (TRV-31). */
async function newMisses(task: ScheduledTask, check: Check): Promise<readonly EpochMs[]> {
  const floor = check.floors.get(task.key);
  if (floor === undefined) {
    return [];
  }
  const occurrences = await occurrencesOf(task, floor, check);
  return occurrences.filter(
    (occurrence) =>
      isMissed(task, occurrence, check) && !check.journaled.has(missKey(task.key, occurrence)),
  );
}

/** What the runs of `spans` say about the last missed occurrence `lastMiss` (CL-TRV-08). */
function factsOf(spans: readonly Span[], lastMiss: CatchUpFacts['lastMiss']): CatchUpFacts {
  const lastStartOf = (isCounted: (span: Span) => boolean) => {
    const starts = spans.filter((span) => isCounted(span)).map((span) => span.start);
    return starts.length === 0 ? null : toEpochMs(Math.max(...starts));
  };
  const isScheduled = (span: Span) => span.trigger === 'scheduled';
  return {
    lastMiss,
    lastScheduledStartedAt: lastStartOf(isScheduled),
    lastSuccessStartedAt: lastStartOf((span) => span.result === 'succeeded'),
    lastScheduledEndStartedAt: lastStartOf(
      (span) => isScheduled(span) && span.result !== null && span.result !== 'interrupted',
    ),
  };
}

/**
 * Journals the new missed occurrences of `task` at the check's instant and opens its "task
 * not run" incident, closed at once when a success started at or after the last of them
 * stands for them (CL-TRV-08). The check starts no run: the task's one catch-up run, recorded
 * as scheduled, starts at its next turn, where every run starts, as the resumption of its
 * interrupted run when it has one (TRV-30, CL-TRV-07), and after the run of the task that
 * runs, if any (TRV-28). Returns the task when that catch-up run is due now, the wake plan
 * then pulled to now.
 */
async function catchUp(
  task: ScheduledTask,
  missed: readonly EpochMs[],
  check: Check,
): Promise<TaskKey | null> {
  const last = toEpochMs(Math.max(...missed));
  const spans = check.spans.filter((span) => span.task === task.key);
  const isCaughtUp = spans.some((span) => span.result === 'succeeded' && span.start >= last);
  const cause = { kind: 'task_not_run', task: task.key } as const;
  await check.db.transaction(async (tx) => {
    for (const dueAt of missed) {
      const params = { task: task.key, dueAt };
      await record(tx, { messageKey: 'task_run_missed', occurredAt: check.at, params });
    }
    await open(tx, cause, check.passId);
    if (isCaughtUp) {
      await close(tx, cause, check.passId);
    }
  });
  const facts = factsOf(spans, { dueAt: last, journaledAt: check.at });
  const isRunning = spans.some((span) => span.end === null);
  if (isRunning || pendingMissOf(task, facts, check.params) === null) {
    return null;
  }
  await wakeAt(check.at, task.key);
  return task.key;
}

/**
 * The run check at `moment` (TRV-31, CL-TRV-08), at the start and the end of each pass and
 * at each opening of the app, run by the pass `moment.passId` that holds the lease, so that
 * two checks never journal the same occurrence: each occurrence missed since the task's
 * last scheduled run that succeeded is journaled once, opens the task's "task not run" incident,
 * closed by its next success, and makes the task due at once for one catch-up run, recorded
 * as scheduled, which starts at the task's next turn, in that pass if its budget allows and
 * otherwise at the next one. A statistics update that waits for the source is running, and a
 * late source is never missed (CL-TRV-23). Returns the tasks whose catch-up run is due now.
 */
export async function runCheck(
  db: Database,
  registry: Registry,
  moment: CheckMoment,
): Promise<readonly TaskKey[]> {
  const check = await checkOf(db, registry, moment);
  if (check === null) {
    return [];
  }
  const caughtUp: TaskKey[] = [];
  for (const task of registry) {
    const missed = await newMisses(task, check);
    const started = missed.length === 0 ? null : await catchUp(task, missed, check);
    caughtUp.push(...(started === null ? [] : [started]));
  }
  return caughtUp;
}

/**
 * The run check at an opening of the app (TRV-31, CL-TRV-08): as a pass of its own, under
 * the `scheduler_lease` row that every pass takes, so that it never runs beside a pass or
 * another opening's check and journals each missed occurrence once (TRV-28). While a pass
 * holds the lease it checks nothing, since that pass checks at its end; otherwise it runs
 * the check at `at` and returns the tasks whose catch-up run, recorded as scheduled, it made
 * due at once in the wake plan, which the next pass starts.
 */
export async function checkMissedRuns(
  db: Database,
  registry: Registry,
  at: EpochMs,
): Promise<MissedRunsCheck> {
  const passId = randomUUID();
  const lease = await takeLease(db, passId, at);
  if (!lease.ok) {
    return lease;
  }
  try {
    return { ok: true, caughtUp: await runCheck(db, registry, { at, passId }) };
  } finally {
    await releaseLease(db, passId);
  }
}

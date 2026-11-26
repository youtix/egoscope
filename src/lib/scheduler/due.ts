// When each task comes due (module map §1.9, §4): the next occurrence of its schedules,
// counted from its runs.
import { toEpochMs } from '@/lib/time';

import { catchUpOf } from './catch-up';
import { firstOccurrenceAfter, latestOccurrenceAtOrBefore, localTimesOf } from './occurrences';
import { epochOf } from './runs';

import type { TimedSchedule } from './occurrences';
import type { RunRow, TaskState } from './runs';
import type { ScheduledTask, TaskSchedule } from './types';
import type { Database } from '@/lib/db';
import type { ParamReader } from '@/lib/params';
import type { EpochMs } from '@/lib/time';
import type { TaskKey } from '@/lib/wake-plan';

/** What the due instants are computed from. */
export type DueContext = Readonly<{
  db: Database;
  at: EpochMs;
  params: ParamReader;
  timeZone: string;
  stateOf: (task: TaskKey) => TaskState;
}>;

/** An occurrence: when it is due, and for a chained one, the parent run it follows. */
type Due = Readonly<{ dueAt: EpochMs; parent: RunRow | null }>;

/** From where a task's next occurrence counts: its last scheduled occurrence and its last start. */
type Since = Readonly<{ lastScheduledDueAt: EpochMs | null; lastStartedAt: EpochMs | null }>;

/** The parameter that holds the owner's zone, in which the timed tasks run (TRV-27). */
export const TIME_ZONE_KEY = 'display.timeZone';

const due = (dueAt: EpochMs | null, parent: RunRow | null = null): Due | null =>
  dueAt === null ? null : { dueAt, parent };

/**
 * The next occurrence of a timed schedule: the first after the last scheduled one, or,
 * once it has come, the latest that has come, which stands for every one before it
 * (CL-TRV-08); a task that never ran is due at its latest occurrence.
 */
function timedDue(schedule: TimedSchedule, since: Since, context: DueContext): Due | null {
  const local = localTimesOf(schedule, context.params);
  const { at, timeZone } = context;
  const next =
    since.lastScheduledDueAt === null
      ? null
      : firstOccurrenceAfter(since.lastScheduledDueAt, local, timeZone);
  return due(next !== null && next > at ? next : latestOccurrenceAtOrBefore(at, local, timeZone));
}

/** The last success of a parent of `after` that ended since the task last started (TRV-26). */
function chainedDue(after: readonly TaskKey[], since: Since, context: DueContext): Due | null {
  let found: Due | null = null;
  for (const key of after) {
    const parent = context.stateOf(key).lastSuccess;
    const endedAt = parent?.finishedAt ?? null;
    const isNew =
      endedAt !== null && (since.lastStartedAt === null || endedAt.getTime() > since.lastStartedAt);
    if (isNew && (found === null || endedAt.getTime() > found.dueAt)) {
      found = due(epochOf(endedAt), parent);
    }
  }
  return found;
}

/** The occurrence of one schedule of a task. */
async function dueOf(
  schedule: TaskSchedule,
  since: Since,
  context: DueContext,
): Promise<Due | null> {
  switch (schedule.kind) {
    case 'chained': {
      return chainedDue(schedule.after, since, context);
    }
    case 'computed': {
      return due(await schedule.nextDueAt(context.db, context.at));
    }
    case 'daily':
    case 'weekly': {
      return timedDue(schedule, since, context);
    }
  }
}

/**
 * The next occurrence of `task`'s schedules counted from `since`, whatever runs now: the
 * earliest of them, following a parent run when a chained one is among them, so that the
 * chained run shares its parent's pass (TRV-26).
 */
export async function nextOccurrence(
  task: ScheduledTask,
  since: Since,
  context: DueContext,
): Promise<Due | null> {
  const dues = await Promise.all(
    task.schedules.map(async (schedule) => dueOf(schedule, since, context)),
  );
  const found = dues.filter((one): one is Due => one !== null);
  if (found.length === 0) {
    return null;
  }
  const dueAt = toEpochMs(Math.min(...found.map((one) => one.dueAt)));
  return { dueAt, parent: found.find((one) => one.parent !== null)?.parent ?? null };
}

/** Where a task's next occurrence counts from, given its runs: on-demand runs aside (TRV-33). */
export function sinceOf(state: TaskState): Since {
  const startedAt = state.latest?.startedAt ?? null;
  return {
    lastScheduledDueAt: state.lastScheduledDueAt,
    lastStartedAt: startedAt === null ? null : epochOf(startedAt),
  };
}

/**
 * The occurrence that the next scheduled run of `task` is due for, given its runs: its one
 * catch-up run while one is still to start, due at once (TRV-31, CL-TRV-08), otherwise its
 * next occurrence; on-demand runs never move it (TRV-33).
 */
export async function scheduledDue(
  task: ScheduledTask,
  state: TaskState,
  context: DueContext,
): Promise<Due | null> {
  const catchUp = catchUpOf(task, state, context);
  return catchUp === null ? nextOccurrence(task, sinceOf(state), context) : due(catchUp);
}

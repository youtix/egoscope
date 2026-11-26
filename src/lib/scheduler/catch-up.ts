// The one catch-up run of a task whose occurrences the run check journaled as missed (TRV-31,
// CL-TRV-08): whether it is still to start, and the occurrence it is due for. The run check
// only journals; the code that starts every run starts it, the resumption of an interrupted
// run included, from what is decided here.
import { toEpochMs } from '@/lib/time';

import { HOUR_MS } from './limits';
import { latestOccurrenceAtOrBefore, localTimesOf } from './occurrences';

import type { LastMiss } from './runs';
import type { ScheduledTask } from './types';
import type { ParamReader } from '@/lib/params';
import type { EpochMs } from '@/lib/time';

/** What a task's runs say about its last missed occurrence (CL-TRV-08, CL-TRV-23). */
export type CatchUpFacts = Readonly<{
  lastMiss: LastMiss | null;
  lastScheduledStartedAt: EpochMs | null;
  lastSuccessStartedAt: EpochMs | null;
  lastScheduledEndStartedAt: EpochMs | null;
}>;

/** The instant, the parameters and the owner's zone, at which a catch-up run is judged. */
type CatchUpMoment = Readonly<{ at: EpochMs; params: ParamReader; timeZone: string }>;

/** The margin after which an occurrence without a success is missed (TRV-31, H-TRV-07). */
export const marginOf = (params: ParamReader): number =>
  params.get('scheduler.missedRunMarginHours') * HOUR_MS;

const isAtOrAfter = (instant: EpochMs | null, from: number) => instant !== null && instant >= from;

/**
 * The last missed occurrence of `task` that its one catch-up run is still to stand for, or
 * null (TRV-31, CL-TRV-08): one is journaled, no scheduled run of the task has started since
 * it became missed, at its occurrence plus the margin, and no run that started at or after it
 * succeeded, which stands for it (CL-TRV-08); for a task with a ready guard, the statistics
 * update, a scheduled run that started at or after it and ended with a result stands for it
 * too, since a late source is never missed (CL-TRV-23).
 */
export function pendingMissOf(
  task: ScheduledTask,
  facts: CatchUpFacts,
  params: ParamReader,
): EpochMs | null {
  const miss = facts.lastMiss;
  if (miss === null) {
    return null;
  }
  // The journal entry caps the instant, should the margin have grown since.
  const missedAt = Math.min(miss.dueAt + marginOf(params), miss.journaledAt);
  const isStarted = isAtOrAfter(facts.lastScheduledStartedAt, missedAt);
  const isStoodFor =
    isAtOrAfter(facts.lastSuccessStartedAt, miss.dueAt) ||
    (task.readyGuard !== undefined && isAtOrAfter(facts.lastScheduledEndStartedAt, miss.dueAt));
  return isStarted || isStoodFor ? null : miss.dueAt;
}

/**
 * The occurrence that the catch-up run of `task` is due for, its last missed occurrence being
 * `last`: `last`, or, when later, the latest occurrence of its timed schedules that has come
 * at `moment`, which the catch-up run also stands for since it starts after it (CL-TRV-08), so
 * that the pass neither postpones that occurrence nor runs the task again for it (TRV-28,
 * CL-TRV-07).
 */
function catchUpDueAt(task: ScheduledTask, last: EpochMs, moment: CatchUpMoment): EpochMs {
  const latest = task.schedules.flatMap((schedule) => {
    if (schedule.kind === 'chained' || schedule.kind === 'computed') {
      return [];
    }
    const local = localTimesOf(schedule, moment.params);
    return latestOccurrenceAtOrBefore(moment.at, local, moment.timeZone) ?? [];
  });
  return toEpochMs(Math.max(last, ...latest));
}

/**
 * The occurrence that the one catch-up run of `task` is due for while it is still to start,
 * or null (TRV-31, CL-TRV-08).
 */
export function catchUpOf(
  task: ScheduledTask,
  facts: CatchUpFacts,
  moment: CatchUpMoment,
): EpochMs | null {
  const last = pendingMissOf(task, facts, moment.params);
  return last === null ? null : catchUpDueAt(task, last, moment);
}

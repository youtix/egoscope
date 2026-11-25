// The occurrences of the timed schedules: local times in the owner's zone, each day or
// on one weekday, one instant per configured time and day whatever the clock change
// (TRV-27, CL-TRV-18).
import { localOccurrenceInstant, startOfLocalDay, toEpochMs, userDay } from '@/lib/time';

import type { TaskSchedule, Weekday } from './types';
import type { ParamReader } from '@/lib/params';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A schedule of local times: each day, or on a weekday. */
export type TimedSchedule = Extract<TaskSchedule, Readonly<{ kind: 'daily' | 'weekly' }>>;

/** The local times of a timed schedule, and the weekday they fall on. */
type LocalTimes = Readonly<{ times: readonly string[]; weekday: Weekday }>;

// A week and a day: any weekly occurrence falls within them.
const DAYS_SCANNED = 8;

const DAY_MS = 86_400_000;

// The weekdays from Thursday, the weekday of 1 January 1970, the day that `EpochMs` counts from.
const WEEKDAYS_FROM_EPOCH: readonly Weekday[] = [
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
];

/** The local times of `schedule`, with the weekday they fall on (TRV-27). */
export function localTimesOf(schedule: TimedSchedule, params: ParamReader): LocalTimes {
  if (schedule.kind === 'daily') {
    return { times: schedule.times(params), weekday: 'every_day' };
  }
  const { weekday, time } = schedule.occurrence(params);
  return { times: [time], weekday };
}

/** The calendar date `days` after `day` (before it when negative). */
function shift(day: IsoDate, days: number): IsoDate {
  return userDay(toEpochMs(startOfLocalDay(day, 'UTC') + days * DAY_MS), 'UTC');
}

/** The instants of `local` on `day` in `zone`, in order: one per time, none on another weekday. */
function instantsOn(day: IsoDate, local: LocalTimes, zone: string): readonly EpochMs[] {
  const dayNumber = Math.floor(startOfLocalDay(day, 'UTC') / DAY_MS);
  const weekday = WEEKDAYS_FROM_EPOCH[dayNumber % WEEKDAYS_FROM_EPOCH.length];
  return local.weekday === 'every_day' || local.weekday === weekday
    ? local.times
        .map((time) => localOccurrenceInstant(day, time, zone))
        .toSorted((left, right) => left - right)
    : [];
}

/** The first occurrence of `local` after `after`, or none when it has no time (TRV-27, CL-TRV-18). */
export function firstOccurrenceAfter(
  after: EpochMs,
  local: LocalTimes,
  zone: string,
): EpochMs | null {
  const start = userDay(after, zone);
  for (let scanned = 0; scanned < DAYS_SCANNED; scanned += 1) {
    const found = instantsOn(shift(start, scanned), local, zone).find((instant) => instant > after);
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

/** The last occurrence of `local` at or before `at`, or none when it has no time (TRV-27, CL-TRV-18). */
export function latestOccurrenceAtOrBefore(
  at: EpochMs,
  local: LocalTimes,
  zone: string,
): EpochMs | null {
  const start = userDay(at, zone);
  for (let scanned = 0; scanned < DAYS_SCANNED; scanned += 1) {
    const found = instantsOn(shift(start, -scanned), local, zone).findLast(
      (instant) => instant <= at,
    );
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

/** The occurrences of `local` in `range`, after its start and at or before its end, in order (TRV-31, CL-TRV-08). */
export function occurrencesBetween(
  range: Readonly<{ after: EpochMs; until: EpochMs }>,
  local: LocalTimes,
  zone: string,
): readonly EpochMs[] {
  const found: EpochMs[] = [];
  let next = firstOccurrenceAfter(range.after, local, zone);
  while (next !== null && next <= range.until) {
    found.push(next);
    next = firstOccurrenceAfter(next, local, zone);
  }
  return found;
}

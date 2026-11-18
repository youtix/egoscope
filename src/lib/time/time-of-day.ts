import type { TimeParseError } from './calendar-date';

/** A time of day on the 24-hour clock: its hour, 0 to 23, and its minute, 0 to 59. */
export type TimeOfDayResult =
  | Readonly<{ ok: true; hour: number; minute: number }>
  | Readonly<{ ok: false; error: TimeParseError }>;

// The one form of a time of day, two digits, a colon and two digits, and the times
// that form can write, from 00:00 to 23:59.
const HH_MM = /^\d{2}:\d{2}$/u;
const TIME_OF_DAY = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/u;

/**
 * Reads a time of day written `HH:MM` on the 24-hour clock, from `00:00` to
 * `23:59`, that comes from outside the code, such as a collection time or the
 * start of the quiet hours (TRV-27, CL-TRV-16). The form is strict, two digits
 * each and nothing else, so that a time it accepts is always one that
 * `localOccurrenceInstant` schedules. A time of that form that no clock shows,
 * such as `24:00`, is `nonexistent`; seconds, a one-digit hour, a space or any
 * other form is `malformed`.
 */
export function parseTimeOfDay(text: string): TimeOfDayResult {
  const groups = TIME_OF_DAY.exec(text)?.groups;
  if (groups !== undefined) {
    return { ok: true, hour: Number(groups['hour']), minute: Number(groups['minute']) };
  }
  return { ok: false, error: { kind: HH_MM.test(text) ? 'nonexistent' : 'malformed' } };
}

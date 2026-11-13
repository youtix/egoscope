import { Temporal } from 'temporal-polyfill';

import { addDays, toIsoDate } from './calendar-date';
import { toEpochMs } from './instant';

import type { IsoDate } from './calendar-date';
import type { EpochMs } from './instant';

/**
 * The league's calendar: a game's day is the date of its tip-off in US Eastern
 * time, games played abroad included (CL-TRV-03, ADR 0028).
 */
export const US_EASTERN = 'America/New_York';
// The westernmost zone where the league plays, whose day ends last (SEN-01, CL-SEN-02).
const US_PACIFIC = 'America/Los_Angeles';

/** The date and the wall-clock time `HH:MM` at which an instant reads in one zone. */
export type LocalDateTime = Readonly<{ on: IsoDate; time: string }>;

/**
 * An instant as Temporal's date-time in `zone`, for this module's formatters.
 * Throws a RangeError for an unknown zone.
 */
export function zonedDateTime(instant: EpochMs, zone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone);
}

/**
 * The date and the wall-clock time, to the minute, at which `instant` reads in
 * `zone`, an IANA time-zone ID such as `Europe/Paris`. Every conversion goes
 * through the time-zone database, never a fixed offset, since Europe and the
 * United States change their clocks on different dates (TRV-70, CL-IHM-17).
 * Throws a RangeError for an unknown zone, which validating the setting rules out.
 */
export function toZoned(instant: EpochMs, zone: string): LocalDateTime {
  const local = zonedDateTime(instant, zone);
  return {
    on: toIsoDate(local.toPlainDate().toString()),
    time: local.toPlainTime().toString({ smallestUnit: 'minute' }),
  };
}

/**
 * The owner's day of an instant, by which tasks and displays count days: its
 * date in the owner's zone, the setting that the caller reads and passes in
 * (TRV-72, IHM-14).
 */
export function userDay(instant: EpochMs, zone: string): IsoDate {
  return toZoned(instant, zone).on;
}

/**
 * A game's day, for every rule and every display: the date of its tip-off in
 * US Eastern time, the date of the league's schedule, games played abroad
 * included. It never depends on the owner's zone (TRV-72, H-TRV-11, CL-TRV-03,
 * ADR 0028).
 */
export function gameDay(tipOff: EpochMs): IsoDate {
  return userDay(tipOff, US_EASTERN);
}

/**
 * The first instant of `day` in `zone`: 00:00, or the end of the gap when a
 * clock change skips midnight (TRV-72).
 */
export function startOfLocalDay(day: IsoDate, zone: string): EpochMs {
  const start = Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: zone });
  return toEpochMs(start.epochMilliseconds);
}

/**
 * The instant at which `day` ends in `zone`, which is the start of the next
 * day: an instant belongs to the day when start ≤ instant < end, so a day of
 * clock change lasts 23 or 25 hours (TRV-70, TRV-72).
 */
export function endOfLocalDay(day: IsoDate, zone: string): EpochMs {
  return startOfLocalDay(addDays(day, 1), zone);
}

/**
 * 00:00 US Eastern time on a game's day: the instant at which a game whose
 * time is to be determined is deemed to start, for every comparison (STA-31,
 * CL-STA-14, ADR 0028).
 */
export function gameDayStart(day: IsoDate): EpochMs {
  return startOfLocalDay(day, US_EASTERN);
}

/**
 * The end of `day` on the Pacific coast of North America, 00:00 Los Angeles
 * time on the next day: the instant at which an event known only by its date
 * is deemed public (SEN-01, H-SEN-01, CL-SEN-02). Pacific time changes its
 * offset on its own dates, which this follows (TRV-70).
 */
export function endOfDayPacific(day: IsoDate): EpochMs {
  return endOfLocalDay(day, US_PACIFIC);
}

// A skipped wall time lies just before a clock change; Temporal's "earlier"
// reading of it falls before that change, so the next transition ends the gap.
function endOfGap(beforeGap: Temporal.ZonedDateTime): Temporal.ZonedDateTime {
  const transition = beforeGap.getTimeZoneTransition('next');
  if (transition === null) {
    throw new RangeError(`No clock change follows ${beforeGap.toString()}.`);
  }
  return transition;
}

/**
 * The one instant of a scheduled wall-clock time on `day` in `zone`, such as
 * 16:30 in the owner's zone (TRV-27, CL-TRV-18). `time` is `HH:MM`, seconds
 * allowed. A day of clock change still gives exactly one instant: a time that
 * the change skips moves forward past the gap, to its first instant (02:30
 * becomes 03:00 in Paris), and a time that occurs twice takes its first
 * occurrence (TRV-70).
 */
export function localOccurrenceInstant(day: IsoDate, time: string, zone: string): EpochMs {
  const wallClock = Temporal.PlainDate.from(day).toPlainDateTime(Temporal.PlainTime.from(time));
  const earlier = wallClock.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const occurrence = earlier.toPlainDateTime().equals(wallClock) ? earlier : endOfGap(earlier);
  return toEpochMs(occurrence.epochMilliseconds);
}

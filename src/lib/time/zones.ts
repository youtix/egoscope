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
/** An instant at which to look a zone up: its ID and its history are the same at every instant. */
export const ANY_INSTANT = toEpochMs(0);
// What the conversion accepts besides the names of the zone database: an offset such
// as +02:00, and the SystemV names, which only ICU still knows. The database dropped
// them in 2020b, and Bun's own Temporal refuses them while Node.js accepts them.
const OFFSET_ID = /^[+-]/u;
const ICU_ONLY_AREA = 'systemv/';

/** The date and the wall-clock time `HH:MM` at which an instant reads in one zone. */
export type LocalDateTime = Readonly<{ on: IsoDate; time: string }>;

/** Why a text was refused as a zone: the time-zone database has no zone of that name. */
export type TimeZoneError = Readonly<{ kind: 'unknown_zone' }>;

export type TimeZoneResult =
  Readonly<{ ok: true; zone: string }> | Readonly<{ ok: false; error: TimeZoneError }>;

const UNKNOWN_ZONE: TimeZoneResult = { ok: false, error: { kind: 'unknown_zone' } };

/**
 * An instant as Temporal's date-time in `zone`, for this module's formatters.
 * Throws a RangeError for an unknown zone.
 */
export function zonedDateTime(instant: EpochMs, zone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone);
}

/** An instant as the conversion reads it in `zone`, or undefined when it knows no such zone. */
function knownZone(zone: string): Temporal.ZonedDateTime | undefined {
  try {
    return zonedDateTime(ANY_INSTANT, zone);
  } catch {
    // The conversion refuses a zone that the time-zone database does not know.
    return undefined;
  }
}

/**
 * An instant read in the zone that `value` names, when `value` names one of the
 * database's zones in any letter case, the owner's zone among them (IHM-14,
 * CL-TRV-16); its `timeZoneId` is the database's spelling.
 */
export function databaseZone(value: string): Temporal.ZonedDateTime | undefined {
  const zoned = knownZone(value);
  const lowerId = zoned?.timeZoneId.toLowerCase();
  const isZoneName =
    lowerId === value.toLowerCase() &&
    !OFFSET_ID.test(lowerId) &&
    !lowerId.startsWith(ICU_ONLY_AREA);
  return isZoneName ? zoned : undefined;
}

/**
 * Says whether the IANA time-zone database knows `value`, in any letter case:
 * `Europe/Paris`, `UTC`, `Etc/GMT+12` or the alias `US/Pacific`, but not `Paris`,
 * `Europe/Atlantis` or an offset such as `+02:00`. The owner's zone may be any
 * zone of the database, which this checks (IHM-14, CL-TRV-16). It asks the
 * conversion itself, never throws, and answers the same on Node.js and on Bun.
 */
export function isTimeZone(value: string): boolean {
  return databaseZone(value) !== undefined;
}

/**
 * The time-zone database's own spelling of a zone that `isTimeZone` accepts, so
 * that the owner's zone is stored under one name whatever its letter case
 * (IHM-14, CL-TRV-16): `Europe/Paris` for `europe/paris` or `EUROPE/PARIS`, `UTC`
 * for `utc`, `Etc/GMT+5` unchanged. The spelling comes from the conversion
 * itself. An alias keeps its own name, `Asia/Calcutta` and not the `Asia/Kolkata`
 * it links to: the conversion spells a link as the database does on Node.js and
 * on Bun alike, while only Node.js's `Intl` would follow it, so that is the one
 * answer both runtimes give. Any other text, an offset such as `+02:00`
 * included, is an `unknown_zone`; it never throws.
 */
export function canonicalTimeZone(value: string): TimeZoneResult {
  const zone = databaseZone(value)?.timeZoneId;
  return zone === undefined ? UNKNOWN_ZONE : { ok: true, zone };
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

/** The wall-clock time `time` on `day`, in no zone yet. */
function wallClockOf(day: IsoDate, time: string): Temporal.PlainDateTime {
  return Temporal.PlainDate.from(day).toPlainDateTime(Temporal.PlainTime.from(time));
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
  const wallClock = wallClockOf(day, time);
  const earlier = wallClock.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const occurrence = earlier.toPlainDateTime().equals(wallClock) ? earlier : endOfGap(earlier);
  return toEpochMs(occurrence.epochMilliseconds);
}

/**
 * The latest instant that a wall-clock time read without an offset can stand
 * for, on `day` in `zone`, so that an article is never deemed public too early
 * (COL-21, CL-COL-02). `time` is `HH:MM`, seconds allowed. On a day of clock
 * change, a time that occurs twice takes its later occurrence, and a time that
 * the change skips moves forward by the length of the gap (02:30 becomes 03:30
 * in Paris), so it is never before `localOccurrenceInstant` (TRV-70).
 */
export function latestLocalInstant(day: IsoDate, time: string, zone: string): EpochMs {
  const latest = wallClockOf(day, time).toZonedDateTime(zone, { disambiguation: 'later' });
  return toEpochMs(latest.epochMilliseconds);
}

import { Temporal } from 'temporal-polyfill';

import { ANY_INSTANT, gameDay, US_EASTERN, userDay, zonedDateTime } from './zones';

import type { IsoDate } from './calendar-date';
import type { EpochMs } from './instant';

/**
 * How much a date spells out (CL-IHM-04): `full` where one instant is the
 * subject of a block, naming the zone; `short` in lists, tables and summaries,
 * on screens that state the zone once at the top.
 */
export type DisplayForm = 'full' | 'short';

/**
 * A game's start as the games table stores it: the scheduled start, and
 * whether its time is to be determined, in which case the start is 00:00 US
 * Eastern time on the game's day (STA-31, CL-STA-14).
 */
export type TipOff = Readonly<{ scheduledStartAt: EpochMs; isStartTimeTbd: boolean }>;

type CalendarFields = Readonly<{ year: number; month: number; day: number; dayOfWeek: number }>;

// Temporal counts weekdays from Monday = 1 and months from January = 1.
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
// The short form keeps the first three letters: Wed, Nov.
const SHORT_NAME_LENGTH = 3;
// The part of day of a game's start in US Eastern time (CL-IHM-07).
const AFTERNOON_FROM_HOUR = 12;
const EVENING_FROM_HOUR = 17;
// The offset of UTC, as Temporal writes it.
const UTC_OFFSET = '+00:00';

function nameAt(names: readonly string[], position: number): string {
  const name = names[position - 1];
  if (name === undefined) {
    throw new RangeError(`No name at position ${String(position)}.`);
  }
  return name;
}

function formatFields(fields: CalendarFields, form: DisplayForm): string {
  const weekday = nameAt(WEEKDAYS, fields.dayOfWeek);
  const month = nameAt(MONTHS, fields.month);
  const day = String(fields.day);
  const year = String(fields.year);
  return form === 'full'
    ? `${weekday} ${day} ${month} ${year}`
    : `${weekday.slice(0, SHORT_NAME_LENGTH)} ${day} ${month.slice(0, SHORT_NAME_LENGTH)} ${year}`;
}

const twoDigits = (value: number): string => String(value).padStart(2, '0');

// "Paris time" for Europe/Paris, "New York time" for America/New_York.
function cityTime(timeZoneId: string): string {
  const city = timeZoneId.slice(timeZoneId.lastIndexOf('/') + 1).replaceAll('_', ' ');
  return `${city} time`;
}

// A zone that has never changed its offset is an offset, not a place: the Etc
// area, whose POSIX names invert the sign (Etc/GMT+5 is five hours behind UTC),
// and UTC under its other names. Every zone of a place has changed at least once.
function isOffsetZone(zoned: Temporal.ZonedDateTime): boolean {
  return (
    zoned.getTimeZoneTransition('previous') === null && zoned.getTimeZoneTransition('next') === null
  );
}

// The one way this module names a zone: "Paris time", or "UTC-05:00 time" and
// "UTC time" for a zone that is an offset.
function zoneName(zoned: Temporal.ZonedDateTime): string {
  if (!isOffsetZone(zoned)) {
    return cityTime(zoned.timeZoneId);
  }
  return zoned.offset === UTC_OFFSET ? 'UTC time' : `UTC${zoned.offset} time`;
}

/**
 * A date alone, without a time and without a zone (CL-IHM-04): in short,
 * "Wed 18 Nov 2026", unless told otherwise, or in full, where the date is the
 * subject of a block: "Wednesday 18 November 2026".
 */
export function formatDate(day: IsoDate, form: DisplayForm = 'short'): string {
  return formatFields(Temporal.PlainDate.from(day), form);
}

/**
 * A day and month without a year, such as a birthday, which never keeps one (JOU-11,
 * CL-DSN-21, CL-VUE-15): "26 October".
 */
export function formatDayAndMonth(dayAndMonth: Readonly<{ month: number; day: number }>): string {
  return `${String(dayAndMonth.day)} ${nameAt(MONTHS, dayAndMonth.month)}`;
}

/**
 * An instant in the owner's zone, on the 24-hour clock (TRV-71, ADR 0010):
 * "Wednesday 18 November 2026, 01:30 Paris time" in full, which names the
 * zone as `formatZoneName` does, or "Wed 18 Nov 2026, 01:30" in short, on a
 * screen that states its zone once at the top (CL-IHM-04).
 */
export function formatInstant(instant: EpochMs, zone: string, form: DisplayForm): string {
  const local = zonedDateTime(instant, zone);
  const shown = `${formatFields(local, form)}, ${twoDigits(local.hour)}:${twoDigits(local.minute)}`;
  return form === 'full' ? `${shown} ${zoneName(local)}` : shown;
}

function partOfDay(hour: number): string {
  if (hour < AFTERNOON_FROM_HOUR) {
    return 'morning';
  }
  return hour < EVENING_FROM_HOUR ? 'afternoon' : 'evening';
}

// "Tuesday evening in the US": the game's day by its weekday, which is enough
// because it is never more than one day away from the owner's date.
function usDayRecall(tipOff: EpochMs): string {
  const eastern = zonedDateTime(tipOff, US_EASTERN);
  return `${nameAt(WEEKDAYS, eastern.dayOfWeek)} ${partOfDay(eastern.hour)} in the US`;
}

/**
 * A game's start in the owner's zone, followed by its US date when that
 * differs from the owner's date, with the part of day of its US Eastern start:
 * "Wed 18 Nov 2026, 01:30 — Tuesday evening in the US" (TRV-71, TRV-72,
 * IHM-14, CL-TRV-02, CL-IHM-07). The venue's local time is never shown. A game
 * whose time is to be determined shows its day and "time TBD", never 00:00
 * (ADR 0028).
 */
export function formatGameTime(tipOff: TipOff, zone: string, form: DisplayForm): string {
  const at = tipOff.scheduledStartAt;
  if (tipOff.isStartTimeTbd) {
    return `${formatDate(gameDay(at), form)}, time TBD`;
  }
  const shown = formatInstant(at, zone, form);
  return gameDay(at) === userDay(at, zone) ? shown : `${shown} — ${usDayRecall(at)}`;
}

/**
 * The name of a zone, as "<city> time": "Paris time", "New York time"
 * (CL-IHM-04, IHM-14). A zone without a city that is an offset, of the Etc area
 * or UTC under another name, is named by that offset: "UTC time",
 * "UTC-05:00 time" for Etc/GMT+5, "UTC+14:00 time" for Etc/GMT-14. A zone
 * without a city whose offset has changed, such as CET, keeps its own name.
 */
export function formatZoneName(zone: string): string {
  return zoneName(zonedDateTime(ANY_INSTANT, zone));
}

/**
 * The statement at the top of a screen that shows instants in the short form:
 * "Times in Paris time" (CL-IHM-04, TRV-71).
 */
export function formatZoneStatement(zone: string): string {
  return `Times in ${formatZoneName(zone)}`;
}

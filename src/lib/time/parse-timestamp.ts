import { Temporal } from 'temporal-polyfill';

import { parseIsoDate, toIsoDate } from './calendar-date';
import { MS_PER_MINUTE, toEpochMs } from './instant';

import type { IsoDate, TimeParseError } from './calendar-date';
import type { EpochMs } from './instant';

/**
 * What a timestamp says, and nothing more:
 * - `instant`: a date and time with an offset, read as the absolute instant
 *   `at`, the date `on` as written in that offset, and the original offset in
 *   minutes east of UTC, kept because it helps to understand the source (TRV-68);
 * - `date`: a date without a time;
 * - `no_offset`: a date and a wall-clock time `HH:MM:SS` without any offset.
 *   It could be one of many instants, so it is never guessed: the caller
 *   decides, as the rules of its spec say (COL-20, CL-COL-02, CL-IMP-08).
 */
export type ParsedTimestamp =
  | Readonly<{ kind: 'instant'; on: IsoDate; at: EpochMs; offsetMinutes: number }>
  | Readonly<{ kind: 'date'; on: IsoDate }>
  | Readonly<{ kind: 'no_offset'; on: IsoDate; time: string }>;

export type TimestampResult =
  | Readonly<{ ok: true; timestamp: ParsedTimestamp }>
  | Readonly<{ ok: false; error: TimeParseError }>;

type Groups = Readonly<Record<string, string | undefined>>;
type Fields = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;
// An offset as read: minutes east of UTC, none written, or one that cannot exist.
type Offset = number | 'none' | 'nonexistent';

// ISO 8601 and RFC 3339: a date, then optionally a time and an offset. A space or a
// lowercase t and z are accepted (the i flag), and so are the offsets ±HHMM and ±HH.
const ISO_DATE = String.raw`(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})`;
const ISO_TIME = String.raw`(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:[,.](?<fraction>\d{1,9}))?)?`;
const ISO_OFFSET = String.raw`(?<offset>z|[+-]\d{2}(?::?\d{2})?)`;
const ISO_TIMESTAMP = new RegExp(`^${ISO_DATE}(?:[ t]${ISO_TIME}${ISO_OFFSET}?)?$`, 'iu');

// RFC 822 and RFC 2822, the dates of RSS feeds: an optional weekday, a day, a month
// name, a year of four or two digits, a time, then a zone and an optional comment.
const RFC_DATE = String.raw`(?:[a-z]{3},\s*)?(?<day>\d{1,2})\s+(?<month>[a-z]{3})\s+(?<year>\d{4}|\d{2})`;
const RFC_TIME = String.raw`(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?`;
const RFC_ZONE = String.raw`(?:\s+(?<zone>[+-]\d{4}|[a-z]+))?(?:\s*\([^)]*\))?`;
const RFC_2822 = new RegExp(String.raw`^${RFC_DATE}\s+${RFC_TIME}${RFC_ZONE}$`, 'iu');
const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
// The zone names of RFC 822 that carry a reliable offset (RFC 2822, section 4.3).
// Its military letters, and every other name, say nothing reliable: no offset.
const ZONE_OFFSETS: ReadonlyMap<string, string> = new Map([
  ['UT', '+0000'],
  ['GMT', '+0000'],
  ['Z', '+0000'],
  ['EST', '-0500'],
  ['EDT', '-0400'],
  ['CST', '-0600'],
  ['CDT', '-0500'],
  ['MST', '-0700'],
  ['MDT', '-0600'],
  ['PST', '-0800'],
  ['PDT', '-0700'],
]);
// Two-digit years (RFC 2822, section 4.3): 00 to 49 are 2000 to 2049, 50 to 99 are
// 1950 to 1999.
const TWO_DIGIT_YEAR_BASE = 1900;
const TWO_DIGIT_YEAR_PIVOT = 50;
const CENTURY = 100;
const MAX_OFFSET_HOURS = 23;
const MAX_OFFSET_MINUTES = 59;
const MINUTES_PER_HOUR = 60;
const MILLISECOND_DIGITS = 3;

const MALFORMED: TimestampResult = { ok: false, error: { kind: 'malformed' } };
const NONEXISTENT: TimestampResult = { ok: false, error: { kind: 'nonexistent' } };

const read = (timestamp: ParsedTimestamp): TimestampResult => ({ ok: true, timestamp });

// A group of the match, or '' when the timestamp leaves it out.
const field = (groups: Groups, name: string): string => groups[name] ?? '';

// `text` is ±HH, ±HH:MM or ±HHMM.
function numericOffset(text: string): Offset {
  const digits = text.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (hours > MAX_OFFSET_HOURS || minutes > MAX_OFFSET_MINUTES) {
    return 'nonexistent';
  }
  const total = hours * MINUTES_PER_HOUR + minutes;
  // 0 - total, so that -00:00 reads as 0 and not as -0.
  return text.startsWith('-') ? 0 - total : total;
}

function isoOffset(text: string): Offset {
  if (text === '') {
    return 'none';
  }
  return text.toUpperCase() === 'Z' ? 0 : numericOffset(text);
}

function rfcOffset(zone: string): Offset {
  const numeric = /^[+-]/u.test(zone) ? zone : ZONE_OFFSETS.get(zone.toUpperCase());
  return numeric === undefined ? 'none' : numericOffset(numeric);
}

function toWallClock(fields: Fields): Temporal.PlainDateTime | undefined {
  try {
    return Temporal.PlainDateTime.from(fields, { overflow: 'reject' });
  } catch {
    // Temporal refuses a field out of its range: February 30, 24:00, a leap second.
    return undefined;
  }
}

function timestampOf(fields: Fields, offset: Offset): TimestampResult {
  const wallClock = toWallClock(fields);
  if (wallClock === undefined || offset === 'nonexistent') {
    return NONEXISTENT;
  }
  const on = toIsoDate(wallClock.toPlainDate().toString());
  if (offset === 'none') {
    return read({ kind: 'no_offset', on, time: wallClock.toPlainTime().toString() });
  }
  const asIfUtc = wallClock.toZonedDateTime('UTC').epochMilliseconds;
  const at = toEpochMs(asIfUtc - offset * MS_PER_MINUTE);
  return read({ kind: 'instant', on, at, offsetMinutes: offset });
}

function timeFields(groups: Groups): Pick<Fields, 'hour' | 'minute' | 'second' | 'millisecond'> {
  const fraction = field(groups, 'fraction').padEnd(MILLISECOND_DIGITS, '0');
  return {
    hour: Number(field(groups, 'hour')),
    minute: Number(field(groups, 'minute')),
    second: Number(field(groups, 'second')),
    millisecond: Number(fraction.slice(0, MILLISECOND_DIGITS)),
  };
}

function fromIso(text: string, groups: Groups): TimestampResult {
  if (field(groups, 'hour') === '') {
    const day = parseIsoDate(text);
    return day.ok ? read({ kind: 'date', on: day.on }) : day;
  }
  const date = {
    year: Number(field(groups, 'year')),
    month: Number(field(groups, 'month')),
    day: Number(field(groups, 'day')),
  };
  return timestampOf({ ...date, ...timeFields(groups) }, isoOffset(field(groups, 'offset')));
}

function fullYear(digits: string): number {
  const year = Number(digits);
  if (digits.length > 2) {
    return year;
  }
  return year + TWO_DIGIT_YEAR_BASE + (year < TWO_DIGIT_YEAR_PIVOT ? CENTURY : 0);
}

function fromRfc2822(groups: Groups): TimestampResult {
  const month = MONTH_NAMES.indexOf(field(groups, 'month').toLowerCase()) + 1;
  if (month === 0) {
    return MALFORMED;
  }
  const date = { year: fullYear(field(groups, 'year')), month, day: Number(field(groups, 'day')) };
  return timestampOf({ ...date, ...timeFields(groups) }, rfcOffset(field(groups, 'zone')));
}

/**
 * Reads a timestamp in the forms the app meets: ISO 8601 with `Z` or an offset
 * (RFC 3339), the RFC 822 and RFC 2822 dates of RSS feeds, and dates alone.
 * A date and time without an offset is never given one: it comes back as
 * `no_offset` for the caller to decide (TRV-68, TRV-73). Anything else is
 * `malformed`; a day, time or offset that cannot exist is `nonexistent`.
 */
export function parseTimestamp(text: string): TimestampResult {
  const trimmed = text.trim();
  const iso = ISO_TIMESTAMP.exec(trimmed)?.groups;
  if (iso !== undefined) {
    return fromIso(trimmed, iso);
  }
  const rfc = RFC_2822.exec(trimmed)?.groups;
  return rfc === undefined ? MALFORMED : fromRfc2822(rfc);
}

// The dates of a research result as the import reads them (CL-IMP-08), the same for the
// dates of an exploration response (CL-TAX-04). The format writes a date YYYY-MM-DD, or
// YYYY-MM-DDTHH:MM±HH:MM with its time and offset (BKT-21), and research AIs often write
// other spellings of these. Those that name one instant without doubt read as that instant,
// with a warning. A time without an offset, or at midnight, would make a fact look earlier
// than it was, and reads as a date alone, with a warning (SEN-01, IMP-18, TRV-73). Anything
// else is refused. A list of dates is in order when their calendar dates never decrease
// (CL-BKT-15).
import { isAbsent, parseExchangeDate } from '../conventions';

import type { DateParseError, ExchangeDate } from '../conventions';

/**
 * Why a date reads with a warning (CL-IMP-08): `non_standard_date`, a spelling that the
 * format does not define but that names one instant without doubt; `time_ignored`, a
 * time without an offset, or at midnight, read as a date alone.
 */
export type DateWarning = 'non_standard_date' | 'time_ignored';

/**
 * Why a date of the result is refused (CL-IMP-06, CL-IMP-08): `missing`, left out, `null`,
 * blank or no text; `malformed`, in no spelling that CL-IMP-08 reads, such as a month
 * name or another order; `nonexistent`, a day, a time or an offset that cannot exist, such
 * as 2021-02-30. `text` is the date as written.
 */
export type DateReadingError =
  Readonly<{ kind: 'missing' }> | Readonly<{ kind: DateParseError['kind']; text: string }>;

/**
 * A date of the result as read (CL-IMP-08): its text as written and the date or the
 * instant it names, with the warning that its spelling gives, if any; or why it is refused.
 */
export type DateReading =
  | Readonly<{ ok: true; text: string; date: ExchangeDate; warning: DateWarning | undefined }>
  | Readonly<{ ok: false; error: DateReadingError }>;

type Groups = Readonly<Record<string, string | undefined>>;

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;
const MAX_SECOND = 59;
// The digits of a fraction of a second that make whole milliseconds.
const MILLISECOND_DIGITS = 3;
// The offset that `Z` names, as the format writes an offset.
const UTC_OFFSET = '+00:00';
// Where the parts of a date and time written YYYY-MM-DDTHH:MM±HH:MM start and end.
const DATE_LENGTH = 'YYYY-MM-DD'.length;
const TIME_START = 'YYYY-MM-DDT'.length;
const TIME_END = 'YYYY-MM-DDTHH:MM'.length;
// Where the hours and the minutes of an offset written ±HH:MM start and end.
const OFFSET_HOURS_START = '+'.length;
const OFFSET_HOURS_END = '+HH'.length;
const OFFSET_MINUTES_START = '+HH:'.length;
const OFFSET_MINUTES_LENGTH = 'MM'.length;

// A date and time: the date, then `T`, `t` or a space, then the time in hours and
// minutes, then seconds and their fraction, if any, then what may be its offset, which
// cannot start with a digit.
const DATE_AND_TIME =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[ t](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d+))?)?(?<offset>\D.*)?$/iu;

// An offset: `Z`, or hours, with or without minutes and the colon before them.
const OFFSET = /^(?:z|[+-]\d{2}(?::?\d{2})?)$/iu;

function refused(error: DateReadingError): DateReading {
  return { ok: false, error };
}

// Every named group but the optional ones takes part in a match: digits.
function numberIn(groups: Groups, name: string): number {
  return Number(groups[name]);
}

/** The offset of a date and time written ±HH:MM, or undefined when the value has none. */
function standardOffset(offset: string | undefined): string | undefined {
  if (offset === undefined) {
    return undefined;
  }
  if (offset.toUpperCase() === 'Z') {
    return UTC_OFFSET;
  }
  const compact = offset.replace(':', '');
  const minutes = compact.slice(OFFSET_HOURS_END).padEnd(OFFSET_MINUTES_LENGTH, '0');
  return `${compact.slice(0, OFFSET_HOURS_END)}:${minutes}`;
}

/** The minutes east of UTC of an offset written ±HH:MM. */
function offsetMinutesOf(offset: string): number {
  const hours = Number(offset.slice(OFFSET_HOURS_START, OFFSET_HOURS_END));
  const total = hours * MINUTES_PER_HOUR + Number(offset.slice(OFFSET_MINUTES_START));
  // 0 - total, so that -00:00 reads as 0 and not as -0.
  return offset.startsWith('-') ? 0 - total : total;
}

/** The whole milliseconds of a fraction of a second written in digits, the rest dropped. */
function millisecondsOf(fraction = ''): number {
  return Number(fraction.slice(0, MILLISECOND_DIGITS).padEnd(MILLISECOND_DIGITS, '0'));
}

/** Whether a time is midnight exactly, its seconds and their fraction zero (CL-IMP-08). */
function isMidnight(groups: Groups): boolean {
  const parts = [groups['hour'], groups['minute'], groups['second'], groups['fraction']];
  return parts.every((part) => Number(part ?? 0) === 0);
}

/** The instant that a date and time that exists names, given its offset east of UTC. */
function instantOf(groups: Groups, offsetMinutes: number): number {
  const instant = new Date(0);
  // setUTCFullYear, unlike Date.UTC, reads the years 0 to 99 as written.
  instant.setUTCFullYear(
    numberIn(groups, 'year'),
    numberIn(groups, 'month') - 1,
    numberIn(groups, 'day'),
  );
  const second = Number(groups['second'] ?? 0);
  const milliseconds = millisecondsOf(groups['fraction']);
  const time = instant.setUTCHours(
    numberIn(groups, 'hour'),
    numberIn(groups, 'minute'),
    second,
    milliseconds,
  );
  return time - offsetMinutes * MS_PER_MINUTE;
}

// A date alone, or a value in no spelling of a date and time.
function readDateOnly(text: string): DateReading {
  const read = parseExchangeDate(text);
  return read.ok
    ? { ok: true, text, date: read.date, warning: undefined }
    : refused({ kind: read.error.kind, text });
}

function readDateAndTime(text: string, groups: Groups): DateReading {
  const offset = standardOffset(groups['offset']);
  // The value in the format's own spelling, without its seconds, which tells whether
  // its day, its time and its offset exist.
  const standard = `${text.slice(0, DATE_LENGTH)}T${text.slice(TIME_START, TIME_END)}${offset ?? UTC_OFFSET}`;
  if (!parseExchangeDate(standard).ok || Number(groups['second'] ?? 0) > MAX_SECOND) {
    return refused({ kind: 'nonexistent', text });
  }
  const on = text.slice(0, DATE_LENGTH);
  if (offset === undefined || isMidnight(groups)) {
    return { ok: true, text, date: { kind: 'date', on }, warning: 'time_ignored' };
  }
  const offsetMinutes = offsetMinutesOf(offset);
  const date: ExchangeDate = {
    kind: 'instant',
    on,
    at: instantOf(groups, offsetMinutes),
    offsetMinutes,
  };
  return { ok: true, text, date, warning: text === standard ? undefined : 'non_standard_date' };
}

/**
 * Reads a date of a research result (IMP-09, IMP-12, IMP-14, CL-IMP-08), `public_date`,
 * `publication_date` and the bounds of `covered_period` alike. As written:
 * `YYYY-MM-DD`, and `YYYY-MM-DDTHH:MM±HH:MM`. With `non_standard_date`, the instant
 * unchanged: the offset `Z`, an offset without its colon (`±HHMM`) or in hours alone
 * (`±HH`), seconds and their fraction, kept in the instant to the millisecond, a space
 * in place of the `T`, a lowercase `t` or `z`. As a date alone, its date part as
 * written, with `time_ignored`: a date and time without an offset, and one at midnight
 * exactly, seconds zero, whatever its offset. Anything else is malformed, and a day, a
 * time or an offset that cannot exist is nonexistent; left out, `null`, blank or no text,
 * the date is missing (CL-IMP-06).
 */
export function readDate(value: unknown): DateReading {
  if (typeof value !== 'string' || isAbsent(value)) {
    return refused({ kind: 'missing' });
  }
  const groups = DATE_AND_TIME.exec(value)?.groups;
  if (groups === undefined) {
    return readDateOnly(value);
  }
  const offset = groups['offset'];
  return offset === undefined || OFFSET.test(offset)
    ? readDateAndTime(value, groups)
    : refused({ kind: 'malformed', text: value });
}

/**
 * The calendar date of a date as written: its `YYYY-MM-DD` before any time (CL-BKT-15,
 * CL-IMP-09), when that names a day that exists; otherwise undefined.
 */
export function calendarDate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const day = value.slice(0, DATE_LENGTH);
  return parseExchangeDate(day).ok ? day : undefined;
}

/**
 * The index of the first of these calendar dates that comes before an earlier one, the
 * undefined ones taking no part (CL-BKT-15, CL-IMP-19): undefined when the dates never
 * decrease along the list. Dates of one day may come in any order.
 */
export function firstUnsorted(days: readonly (string | undefined)[]): number | undefined {
  const dated = days
    .map((day, index) => ({ day, index }))
    .filter((entry): entry is Readonly<{ day: string; index: number }> => entry.day !== undefined);
  return dated.find(({ day }, rank) => day < (dated[rank - 1]?.day ?? day))?.index;
}

/** Whether calendar dates never decrease along the list, the undefined ones taking no part (CL-BKT-15, CL-IMP-19). */
export function isSorted(days: readonly (string | undefined)[]): boolean {
  return firstUnsorted(days) === undefined;
}

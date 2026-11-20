// The conventions every exchange format shares (glossary, section 6): dates written
// YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM when the time is known; enumerated values in
// lowercase; no `null`, an optional field without content being left out. Readers
// compare closed values without case or accents, and take `null` or an empty text
// for an absent field (CL-IMP-06, CL-IMP-22).

/**
 * A date of an exchange format as written: a calendar date alone, or a date and time
 * with its offset, which names an absolute instant. `on` is the date part as written,
 * `YYYY-MM-DD`, so the date in the value's own offset (CL-IMP-09); `at` is the instant
 * in epoch milliseconds, and `offsetMinutes` the offset east of UTC, kept because it
 * helps to understand the source (TRV-68).
 */
export type ExchangeDate =
  | Readonly<{ kind: 'date'; on: string }>
  | Readonly<{ kind: 'instant'; on: string; at: number; offsetMinutes: number }>;

/**
 * Why a date was refused: it is in neither form (`malformed`), or it names a day, a
 * time or an offset that cannot exist (`nonexistent`), such as 2021-02-30.
 */
export type DateParseError = Readonly<{ kind: 'malformed' | 'nonexistent' }>;

export type ExchangeDateResult =
  Readonly<{ ok: true; date: ExchangeDate }> | Readonly<{ ok: false; error: DateParseError }>;

type Groups = Readonly<Record<string, string | undefined>>;

const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;

// The two forms of a date in the exchange formats: a calendar date alone, and a date
// and time with its offset.
const DATE_ONLY = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const DATE_AND_TIME =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?<sign>[+-])(?<offsetHours>\d{2}):(?<offsetMinutes>\d{2})$/u;

// A combining mark, such as the accent of a letter once the text is decomposed.
const COMBINING_MARK = /\p{M}/gu;

function refused(kind: DateParseError['kind']): ExchangeDateResult {
  return { ok: false, error: { kind } };
}

// Every named group of the two forms takes part in their matches: digits, or a sign.
function numberIn(groups: Groups, name: string): number {
  return Number(groups[name]);
}

/** The instant at which the UTC day of `groups` starts, or undefined when that day does not exist. */
function dayStart(groups: Groups): number | undefined {
  const month = numberIn(groups, 'month') - 1;
  const date = new Date(0);
  // setUTCFullYear, unlike Date.UTC, reads the years 0 to 99 as written. A month or a
  // day out of range, at most 99, moves the date into another month of the calendar.
  const start = date.setUTCFullYear(numberIn(groups, 'year'), month, numberIn(groups, 'day'));
  return date.getUTCMonth() === month ? start : undefined;
}

/** The offset east of UTC, in minutes, or undefined when no zone can have it. */
function offsetOf(groups: Groups): number | undefined {
  const hours = numberIn(groups, 'offsetHours');
  const minutes = numberIn(groups, 'offsetMinutes');
  if (hours > MAX_HOUR || minutes > MAX_MINUTE) {
    return undefined;
  }
  const total = hours * MINUTES_PER_HOUR + minutes;
  // 0 - total, so that -00:00 reads as 0 and not as -0.
  return groups['sign'] === '-' ? 0 - total : total;
}

function readDate(text: string, groups: Groups): ExchangeDateResult {
  return dayStart(groups) === undefined
    ? refused('nonexistent')
    : { ok: true, date: { kind: 'date', on: text } };
}

function readDateTime(text: string, groups: Groups): ExchangeDateResult {
  const start = dayStart(groups);
  const offsetMinutes = offsetOf(groups);
  const hour = numberIn(groups, 'hour');
  const minute = numberIn(groups, 'minute');
  if (
    start === undefined ||
    offsetMinutes === undefined ||
    hour > MAX_HOUR ||
    minute > MAX_MINUTE
  ) {
    return refused('nonexistent');
  }
  const at = start + (hour * MINUTES_PER_HOUR + minute - offsetMinutes) * MS_PER_MINUTE;
  const on = text.slice(0, 'YYYY-MM-DD'.length);
  return { ok: true, date: { kind: 'instant', on, at, offsetMinutes } };
}

/**
 * Reads a date of an exchange format in the two forms the formats define (BKT-21,
 * IMP-12): `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM±HH:MM` for a date and time with its
 * offset. Any other spelling is `malformed`, and a day, a time or an offset that
 * cannot exist is `nonexistent`: each reader decides which variants it tolerates.
 */
export function parseExchangeDate(text: string): ExchangeDateResult {
  const date = DATE_ONLY.exec(text)?.groups;
  if (date !== undefined) {
    return readDate(text, date);
  }
  const dateTime = DATE_AND_TIME.exec(text)?.groups;
  return dateTime === undefined ? refused('malformed') : readDateTime(text, dateTime);
}

// Trimmed, without accents (Unicode NFD, combining marks removed) and in lowercase.
function fold(text: string): string {
  return text.trim().normalize('NFD').replaceAll(COMBINING_MARK, '').toLowerCase();
}

/**
 * The value among `values` that `read` names, compared trimmed and without case or
 * accents, inner spaces and punctuation kept (IMP-11, IMP-15): the canonical value,
 * never the AI's spelling. Undefined when `read` is not a text or names none of them.
 */
export function canonicalValue<T extends string>(
  read: unknown,
  values: readonly T[],
): T | undefined {
  if (typeof read !== 'string') {
    return undefined;
  }
  const folded = fold(read);
  return values.find((value) => fold(value) === folded);
}

/**
 * Says whether a field of an exchange format is absent: left out, `null`, or a text
 * with nothing but spaces, which the formats never write for a field with content
 * (CL-IMP-06: `null` or an empty text for an optional field is treated as absent).
 */
export function isAbsent(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

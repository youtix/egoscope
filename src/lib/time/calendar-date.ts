import { Temporal } from 'temporal-polyfill';

declare const isoDateBrand: unique symbol;

/**
 * A calendar date as an ISO 8601 string, `YYYY-MM-DD`, with no time and no
 * zone. Only this module's functions make one, so it always names a day that
 * exists. Which calendar it belongs to is the producer's to say (TRV-72): the
 * owner's day, a game's US Eastern date, or a date as written.
 */
export type IsoDate = string & { readonly [isoDateBrand]: true };

/**
 * Why a text was refused: it is in none of the accepted forms (`malformed`),
 * or it names a date, a time or an offset that does not exist (`nonexistent`),
 * such as 2026-02-30.
 */
export type TimeParseError = Readonly<{ kind: 'malformed' | 'nonexistent' }>;

export type IsoDateResult =
  Readonly<{ ok: true; on: IsoDate }> | Readonly<{ ok: false; error: TimeParseError }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isExistingDay(text: string): boolean {
  try {
    Temporal.PlainDate.from(text);
    return true;
  } catch {
    // Temporal refuses a month beyond 12 or a day beyond the end of its month.
    return false;
  }
}

function isIsoDate(text: string): text is IsoDate {
  return ISO_DATE.test(text) && isExistingDay(text);
}

/**
 * Reads a calendar date written `YYYY-MM-DD` that comes from outside the code,
 * such as a form field: an expected failure is a value, never a throw.
 */
export function parseIsoDate(text: string): IsoDateResult {
  if (isIsoDate(text)) {
    return { ok: true, on: text };
  }
  return { ok: false, error: { kind: ISO_DATE.test(text) ? 'nonexistent' : 'malformed' } };
}

/**
 * Brands a `YYYY-MM-DD` date that the code already holds, such as a `date`
 * column or a literal. Throws a RangeError for a malformed or nonexistent
 * date: that is a bug.
 */
export function toIsoDate(text: string): IsoDate {
  if (!isIsoDate(text)) {
    throw new RangeError(`Not a calendar date written YYYY-MM-DD: "${text}".`);
  }
  return text;
}

/**
 * Orders two calendar dates, for sorting: negative when `left` is the earlier
 * day, zero when they are the same day, positive otherwise. Dates of different
 * calendars never compare as instants do (TRV-69, TRV-72).
 */
export function compareIsoDates(left: IsoDate, right: IsoDate): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** The calendar date `days` days after `day` (before it when negative). */
export function addDays(day: IsoDate, days: number): IsoDate {
  return toIsoDate(Temporal.PlainDate.from(day).add({ days }).toString());
}

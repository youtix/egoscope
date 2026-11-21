// The day arithmetic of the engine, which belongs to no single part, so that every part
// counts days alike: the backtest's periods and deadlines, the correspondence window of
// the import and the attachment window of an event known in advance. Its dates are
// calendar dates written YYYY-MM-DD, each in the calendar that its producer names,
// compared as written (CL-IMP-09): the owner's day, a game's US date or a date as
// written. A date counts as days from 1970-01-01 of its own calendar, through the UTC
// arithmetic of Date, which knows no time zone and so no clock change.

import type { IsoDate } from './types';

/** The milliseconds of a day of 24 hours, which the UTC arithmetic of Date counts. */
export const MS_PER_DAY = 86_400_000;
// A date written YYYY-MM-DD is the start of an instant written in ISO 8601.
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

/**
 * Counts the days of a date written YYYY-MM-DD from 1970-01-01 of the same calendar,
 * negative before it: 1970-01-02 is day 1. It counts a backtest's days (IMP-10,
 * CL-IMP-09), the days a reference date stands for in the correspondence window
 * (CL-IMP-12), and the calendar days of the attachment window of an event known in
 * advance (SEN-02, CL-SEN-04).
 */
export function dayCount(day: IsoDate): number {
  const [year = NaN, month = NaN, date = NaN] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) / MS_PER_DAY;
}

/**
 * Writes YYYY-MM-DD the date of a day counted from 1970-01-01 (IMP-10, CL-IMP-09): day 1
 * is 1970-01-02. A count that makes no date, which only a date not written YYYY-MM-DD
 * gives, makes toISOString throw a RangeError: a bug.
 */
export function dateOf(count: number): IsoDate {
  return new Date(count * MS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH);
}

/**
 * Gives the calendar date right after a date written YYYY-MM-DD, in the same calendar
 * (BKT-09, CL-BKT-05 rule 3): the day after the end of a covered period.
 */
export function dayAfter(day: IsoDate): IsoDate {
  return dateOf(dayCount(day) + 1);
}

/**
 * Counts the calendar days from one date written YYYY-MM-DD to another, negative when the
 * second comes first (BKT-16, CL-BKT-24): 0 from a date to itself.
 */
export function daysBetween(fromOn: IsoDate, toOn: IsoDate): number {
  return dayCount(toOn) - dayCount(fromOn);
}

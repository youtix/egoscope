import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareIsoDates, parseIsoDate, toIsoDate } from './calendar-date';

const DAY_MS = 86_400_000;

// Every day from 0001-01-01 to 9999-12-31, as days since 1970-01-01.
const anyDayNumber = fc.integer({ min: -719_162, max: 2_932_896 });
const isoDateOf = (dayNumber: number): string =>
  new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);

describe('parseIsoDate', () => {
  it.each(['2026-11-10', '2028-02-29', '2000-02-29', '2026-12-31', '0000-01-01', '9999-12-31'])(
    'reads %s as a calendar date',
    (text) => {
      expect(parseIsoDate(text)).toStrictEqual({ ok: true, on: text });
    },
  );

  it.each([
    '',
    '2026-1-10',
    '2026/11/10',
    '20261110',
    '10-11-2026',
    ' 2026-11-10',
    '2026-11-10T19:30',
    '+002026-11-10',
    'yesterday',
  ])('refuses "%s" as malformed', (text) => {
    expect(parseIsoDate(text)).toStrictEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it.each([
    ['February 29 of a common year', '2026-02-29'],
    ['February 29 of a century year not divisible by 400', '2100-02-29'],
    ['February 30', '2028-02-30'],
    ['April 31', '2026-04-31'],
    ['day 0', '2026-11-00'],
    ['month 0', '2026-00-10'],
    ['month 13', '2026-13-01'],
  ])('refuses %s, a day that does not exist', (_day, text) => {
    expect(parseIsoDate(text)).toStrictEqual({ ok: false, error: { kind: 'nonexistent' } });
  });

  it('reads back every day that the calendar has', () => {
    fc.assert(
      fc.property(anyDayNumber, (dayNumber) => {
        const text = isoDateOf(dayNumber);

        expect(parseIsoDate(text)).toStrictEqual({ ok: true, on: text });
      }),
    );
  });
});

describe('toIsoDate', () => {
  it('brands a date that the code already holds, unchanged', () => {
    expect(toIsoDate('2026-11-10')).toBe('2026-11-10');
  });

  it.each(['2026-11-10T19:30:00Z', '2026-02-29'])('throws for "%s", which is a bug', (text) => {
    expect(() => toIsoDate(text)).toThrow(`Not a calendar date written YYYY-MM-DD: "${text}".`);
  });
});

describe('compareIsoDates', () => {
  it('orders calendar dates as the days follow each other, across months and years', () => {
    fc.assert(
      fc.property(anyDayNumber, anyDayNumber, (first, second) => {
        const comparison = compareIsoDates(
          toIsoDate(isoDateOf(first)),
          toIsoDate(isoDateOf(second)),
        );

        expect(Math.sign(comparison)).toBe(Math.sign(first - second));
      }),
    );
  });

  it('sorts the days of a year boundary and a leap day in calendar order', () => {
    const days = ['2028-03-01', '2027-01-01', '2028-02-29', '2026-12-31'].map((text) =>
      toIsoDate(text),
    );

    expect(days.toSorted(compareIsoDates)).toStrictEqual([
      '2026-12-31',
      '2027-01-01',
      '2028-02-29',
      '2028-03-01',
    ]);
  });
});

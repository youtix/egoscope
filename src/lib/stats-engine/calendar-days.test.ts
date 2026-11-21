import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { dateOf, dayAfter, dayCount, daysBetween } from './calendar-days';

// The days of every date from 1900 to 2100.
const anyCount = fc.integer({ min: -25_567, max: 47_846 });
const anyDate = anyCount.map((count) => dateOf(count));

describe('dayCount and dateOf', () => {
  it.each([
    ['1970-01-01', 0],
    ['1970-01-02', 1],
    ['1969-12-31', -1],
    ['2019-10-23', 18_192],
    ['2024-02-29', 19_782],
    ['2024-03-01', 19_783],
  ])(
    '[IMP-10] [CL-IMP-09] count %s as day %i from 1970-01-01 of its calendar, and write it back',
    (day, count) => {
      expect(dayCount(day)).toBe(count);
      expect(dateOf(count)).toBe(day);
    },
  );

  it('[IMP-10] [CL-IMP-09] write back every day they count, from 1900 to 2100', () => {
    fc.assert(
      fc.property(anyCount, (count) => {
        expect(dayCount(dateOf(count))).toBe(count);
      }),
    );
  });

  it('[CL-IMP-09] refuse, as the bug it is, a date not written YYYY-MM-DD', () => {
    expect(() => dateOf(dayCount('2024/02/29'))).toThrow(RangeError);
  });
});

describe('dayAfter', () => {
  it.each([
    ['a month', '2022-04-30', '2022-05-01'],
    ['a year', '2025-12-31', '2026-01-01'],
    ['February in a leap year', '2024-02-28', '2024-02-29'],
    ['a leap day', '2024-02-29', '2024-03-01'],
    ['February in a common year', '2023-02-28', '2023-03-01'],
    ['the day before 1970', '1969-12-31', '1970-01-01'],
  ])('[BKT-09] [CL-BKT-05] gives the day after the end of %s', (_, day, expected) => {
    expect(dayAfter(day)).toBe(expected);
  });
});

describe('daysBetween', () => {
  it.each([
    ['2026-11-20', '2026-11-20', 0],
    ['2026-11-20', '2026-11-22', 2],
    ['2026-11-22', '2026-11-20', -2],
    ['2026-11-30', '2026-12-01', 1],
    ['2026-12-30', '2027-01-02', 3],
    ['2028-02-28', '2028-03-01', 2],
    // Across New York's clock change, which a calendar date knows nothing of.
    ['2026-10-31', '2026-11-02', 2],
  ])('[BKT-16] [CL-BKT-24] counts the calendar days from %s to %s: %i', (fromOn, toOn, days) => {
    expect(daysBetween(fromOn, toOn)).toBe(days);
  });

  it('[BKT-16] [CL-BKT-24] counts one day from any date to the day after it, and minus one back', () => {
    fc.assert(
      fc.property(anyDate, (day) => {
        expect(daysBetween(day, dayAfter(day))).toBe(1);
        expect(daysBetween(dayAfter(day), day)).toBe(-1);
      }),
    );
  });
});

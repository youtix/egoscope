import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareInstants, toEpochMs } from './instant';

// The range of ECMAScript dates: 100,000,000 days on either side of 1970-01-01.
const LIMIT = 8.64e15;
const anyValues = fc.array(fc.integer({ min: -LIMIT, max: LIMIT }));

describe('toEpochMs', () => {
  it.each([0, 1, -1, 1_794_353_400_000, LIMIT, -LIMIT])(
    'brands %d milliseconds as an instant, unchanged',
    (value) => {
      expect(toEpochMs(value)).toBe(value);
    },
  );

  it.each([0.5, NaN, Infinity, LIMIT + 1, -LIMIT - 1])(
    'refuses %d, which is no whole number of milliseconds within the range of dates',
    (value) => {
      expect(() => toEpochMs(value)).toThrow('Not an instant in epoch milliseconds');
    },
  );
});

describe('compareInstants', () => {
  it('[TRV-69] sorts instants from the earliest to the latest', () => {
    fc.assert(
      fc.property(anyValues, (values) => {
        const instants = values.map((value) => toEpochMs(value));

        expect(instants.toSorted(compareInstants)).toStrictEqual(
          values.toSorted((left, right) => left - right),
        );
      }),
    );
  });

  it('[TRV-69] puts the earlier of two instants first, and finds one instant equal to itself', () => {
    const tipOff = toEpochMs(Date.UTC(2026, 10, 11, 0, 30));
    const article = toEpochMs(Date.UTC(2026, 10, 10, 23, 30));

    expect(compareInstants(article, tipOff)).toBeLessThan(0);
    expect(compareInstants(tipOff, article)).toBeGreaterThan(0);
    expect(compareInstants(tipOff, toEpochMs(tipOff))).toBe(0);
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import {
  BUCKET_MS,
  bucketOf,
  fixedPeriodAt,
  followingEnd,
  leavesAt,
  rollingSince,
} from './periods';

import type { FixedUnit } from './limits';

const utc = (...parts: [number, number, number, number?, number?, number?]) =>
  toEpochMs(Date.UTC(...parts));
const MINUTE = 60_000;
const DAY = 86_400_000;
const UNITS: readonly FixedUnit[] = ['second', 'minute', 'day', 'month'];

// Instants from 1999 to 2101, which cross every minute, day, month and year boundary,
// leap days and the turns of centuries included.
const instants = fc
  .integer({ min: Date.UTC(1999, 0, 1), max: Date.UTC(2101, 0, 1) })
  .map((ms) => toEpochMs(ms));
const units = fc.constantFrom(...UNITS);

/** Whether `at` is on the UTC boundary of `unit`. */
function isBoundary(unit: FixedUnit, at: number): boolean {
  const date = new Date(at);
  const isMidnight = date.getUTCHours() + date.getUTCMinutes() + date.getUTCSeconds() === 0;
  const lengths = { second: 1000, minute: MINUTE, day: DAY } as const;
  return unit === 'month'
    ? isMidnight && date.getUTCMilliseconds() === 0 && date.getUTCDate() === 1
    : at % lengths[unit] === 0;
}

describe('quota periods', () => {
  it('[TRV-03] [CL-TRV-12] puts every instant in the one fixed period of its UTC boundaries', () => {
    fc.assert(
      fc.property(units, instants, (unit, at) => {
        const { start, end } = fixedPeriodAt(unit, at);

        expect(start <= at && at < end).toBe(true);
        expect([isBoundary(unit, start), isBoundary(unit, end)]).toStrictEqual([true, true]);
        expect(fixedPeriodAt(unit, toEpochMs(end - 1)).start).toBe(start);
        expect(fixedPeriodAt(unit, end).start).toBe(end);
      }),
    );
  });

  it('[TRV-03] [CL-TRV-12] changes period at the change of minute, of UTC day and of month, never at a local midnight', () => {
    const lastOfNovember = utc(2026, 10, 30, 23, 59, 59);
    const parisMidnight = utc(2026, 10, 23, 23);

    expect(fixedPeriodAt('minute', lastOfNovember)).toStrictEqual({
      start: utc(2026, 10, 30, 23, 59),
      end: utc(2026, 11, 1),
    });
    expect(fixedPeriodAt('day', lastOfNovember)).toStrictEqual({
      start: utc(2026, 10, 30),
      end: utc(2026, 11, 1),
    });
    expect(fixedPeriodAt('month', lastOfNovember)).toStrictEqual({
      start: utc(2026, 10, 1),
      end: utc(2026, 11, 1),
    });
    expect(fixedPeriodAt('day', parisMidnight)).toStrictEqual({
      start: utc(2026, 10, 23),
      end: utc(2026, 10, 24),
    });
  });

  it('[TRV-03] [CL-TRV-12] gives a leap February its 29 days and a second its own period', () => {
    const midnight = utc(2026, 10, 23);
    const inSecond = toEpochMs(midnight + 1999);

    expect(fixedPeriodAt('month', utc(2028, 1, 29, 12))).toStrictEqual({
      start: utc(2028, 1, 1),
      end: utc(2028, 2, 1),
    });
    expect(fixedPeriodAt('second', inSecond)).toStrictEqual({
      start: midnight + 1000,
      end: midnight + 2000,
    });
  });

  it('[TRV-03] [CL-TRV-12] counts a rolling bucket until its operations have all left the window', () => {
    const lengths = fc.constantFrom(MINUTE, DAY);
    fc.assert(
      fc.property(lengths, instants, fc.integer({ min: -2000, max: 2 }), (length, at, offset) => {
        const bucket = toEpochMs(bucketOf(at) + offset * BUCKET_MS);
        const isCounted = bucket >= rollingSince(length, at);

        expect(bucket % BUCKET_MS).toBe(0);
        expect(isCounted).toBe(at < leavesAt(bucket, length));
      }),
    );
  });

  it('[CL-TRV-11] [CL-TRV-12] ends the full period that follows a refused one', () => {
    expect(followingEnd({ kind: 'fixed', unit: 'day' }, utc(2026, 10, 24))).toBe(utc(2026, 10, 25));
    expect(followingEnd({ kind: 'fixed', unit: 'month' }, utc(2026, 11, 1))).toBe(utc(2027, 0, 1));
    expect(followingEnd({ kind: 'reported', lengthMs: DAY }, utc(2026, 10, 24, 6))).toBe(
      utc(2026, 10, 25, 6),
    );
    expect(followingEnd({ kind: 'rolling', lengthMs: MINUTE }, utc(2026, 10, 24, 6))).toBe(
      utc(2026, 10, 24, 6, 1),
    );
  });
});

// The arithmetic of quota periods (CL-TRV-12): fixed periods on UTC boundaries, never a
// local day, the one-minute buckets of rolling windows, and the period after another.
import { toEpochMs } from '@/lib/time';

import type { FixedUnit, Window } from './limits';
import type { EpochMs } from '@/lib/time';

/** One period instance: from `start`, included, to `end`, excluded. */
export type Period = Readonly<{ start: EpochMs; end: EpochMs }>;

/** The length of a rolling window's bucket, the start of each `quota_usage` row it counts. */
export const BUCKET_MS = 60_000;

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;
const FIXED_LENGTHS = { second: MS_PER_SECOND, minute: BUCKET_MS, day: MS_PER_DAY } as const;

/** The start of the one-minute bucket that holds `at`. */
export function bucketOf(at: EpochMs): EpochMs {
  return toEpochMs(Math.floor(at / BUCKET_MS) * BUCKET_MS);
}

/**
 * The fixed period of `unit` that holds `at`, on UTC boundaries: the second, the
 * minute, the UTC day from 00:00 UTC, or the calendar month from 00:00 UTC on the 1st
 * (TRV-03, CL-TRV-12).
 */
export function fixedPeriodAt(unit: FixedUnit, at: EpochMs): Period {
  if (unit === 'month') {
    const date = new Date(at);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    return {
      start: toEpochMs(Date.UTC(year, month, 1)),
      end: toEpochMs(Date.UTC(year, month + 1, 1)),
    };
  }
  const length = FIXED_LENGTHS[unit];
  const start = Math.floor(at / length) * length;
  return { start: toEpochMs(start), end: toEpochMs(start + length) };
}

/**
 * The earliest bucket start that a rolling window of `lengthMs` still counts at `at`:
 * an operation of a bucket leaves the window at the latest `lengthMs` after the
 * bucket's end, so the count never falls below the real use (TRV-04).
 */
export function rollingSince(lengthMs: number, at: EpochMs): EpochMs {
  return toEpochMs(bucketOf(at) - lengthMs);
}

/** When the operations of the bucket that starts at `bucket` have all left a window of `lengthMs`. */
export function leavesAt(bucket: EpochMs, lengthMs: number): EpochMs {
  return toEpochMs(bucket + BUCKET_MS + lengthMs);
}

/**
 * The end of the full period that follows a period of `window` ending at `end`, which
 * a refusal before the limit must see pass without another one (CL-TRV-11).
 */
export function followingEnd(window: Window, end: EpochMs): EpochMs {
  return window.kind === 'fixed'
    ? fixedPeriodAt(window.unit, end).end
    : toEpochMs(end + window.lengthMs);
}

import { MS_PER_MINUTE } from './instant';

import type { EpochMs } from './instant';

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
// From two days on, a delay reads in days ("3 days ago"); below, in hours and
// minutes ("in 3 h 20", "25 h 50").
const HOURS_SHOWN_BELOW = 48;

/**
 * A delay, without a zone (CL-IHM-04): "less than 1 min", "12 min", "3 h 20",
 * "42 h", then whole days from two days on, "3 days". Each unit is rounded
 * down. Throws a RangeError for a negative or infinite duration: that is a bug.
 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError(`Not a duration in milliseconds: ${String(durationMs)}.`);
  }
  const minutes = Math.floor(durationMs / MS_PER_MINUTE);
  if (minutes < 1) {
    return 'less than 1 min';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours >= HOURS_SHOWN_BELOW) {
    return `${String(Math.floor(hours / HOURS_PER_DAY))} days`;
  }
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest).padStart(2, '0')}`;
}

/**
 * How far `instant` is from `reference`, usually now, without a zone
 * (CL-IHM-04): "in 3 h 20" ahead of it, "12 min ago" behind it.
 */
export function formatRelative(instant: EpochMs, reference: EpochMs): string {
  const delta = instant - reference;
  const length = formatDuration(Math.abs(delta));
  return delta > 0 ? `in ${length}` : `${length} ago`;
}

import { describe, expect, it } from 'vitest';

import { formatDuration, formatRelative } from './format-duration';
import { toEpochMs } from './instant';

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const TIP_OFF = toEpochMs(Date.UTC(2026, 10, 18, 0, 30));

describe('formatDuration', () => {
  it.each([
    [0, 'less than 1 min'],
    [59 * SECOND_MS, 'less than 1 min'],
    [MINUTE_MS, '1 min'],
    [12 * MINUTE_MS + 59 * SECOND_MS, '12 min'],
    [59 * MINUTE_MS, '59 min'],
    [HOUR_MS, '1 h'],
    [3 * HOUR_MS + 5 * MINUTE_MS, '3 h 05'],
    [3 * HOUR_MS + 20 * MINUTE_MS, '3 h 20'],
    [25 * HOUR_MS + 50 * MINUTE_MS, '25 h 50'],
    [42 * HOUR_MS, '42 h'],
    [47 * HOUR_MS + 59 * MINUTE_MS, '47 h 59'],
    [2 * DAY_MS, '2 days'],
    [3 * DAY_MS + 23 * HOUR_MS, '3 days'],
  ])('shows %d ms as "%s", each unit rounded down', (durationMs, shown) => {
    expect(formatDuration(durationMs)).toBe(shown);
  });

  it.each([-1, NaN, Infinity])('throws for %d, which is no duration', (durationMs) => {
    expect(() => formatDuration(durationMs)).toThrow('Not a duration in milliseconds');
  });
});

describe('formatRelative', () => {
  it.each([
    [3 * HOUR_MS + 20 * MINUTE_MS, 'in 3 h 20'],
    [42 * HOUR_MS, 'in 42 h'],
    [30 * SECOND_MS, 'in less than 1 min'],
    [0, 'less than 1 min ago'],
    [-12 * MINUTE_MS, '12 min ago'],
    [-3 * DAY_MS, '3 days ago'],
  ])('shows an instant %d ms from now as "%s", without a zone', (fromNowMs, shown) => {
    expect(formatRelative(toEpochMs(TIP_OFF + fromNowMs), TIP_OFF)).toBe(shown);
  });
});

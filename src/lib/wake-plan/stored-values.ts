import { z } from 'zod';

import { toEpochMs } from '@/lib/time';

// The latest instant that a date can hold, 100,000,000 days after 1970-01-01.
const LATEST_INSTANT = 8.64e15;

/** An instant as the cache holds it: whole milliseconds since 1970, read back as an `EpochMs`. */
export const storedInstant = z
  .int()
  .min(0)
  .max(LATEST_INSTANT)
  .transform((value) => toEpochMs(value));

/**
 * A SHA-256 digest, an HMAC-SHA-256 included, in lowercase hexadecimal: what the cache
 * holds in place of a value that must not be kept in clear (module map §1.9).
 */
export const storedHash = z.string().regex(/^[0-9a-f]{64}$/u);

const SECONDS_PER_DAY = 86_400;
const DAYS_KEPT = 30;

/**
 * How long the cache keeps the tick records, the counters and the inbound filter:
 * longer than any wait for the next database pass, which writes them again or drains
 * them; the cache may still evict an entry sooner (module map §1.9).
 */
export const LONG_TTL_SECONDS = DAYS_KEPT * SECONDS_PER_DAY;

/** A minute, the least time between two accepted ticks and between two counter writes. */
export const MINUTE_MS = 60_000;

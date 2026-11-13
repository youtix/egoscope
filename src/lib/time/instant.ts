declare const epochMsBrand: unique symbol;

/**
 * An absolute instant (TRV-68): whole milliseconds since 1970-01-01T00:00:00Z,
 * the same moment wherever it is read. Only this module's functions make one,
 * so a value of this type is always valid. It crosses the server/client boundary
 * as a plain number, and the pure core receives it under a plain alias.
 */
export type EpochMs = number & { readonly [epochMsBrand]: true };

/** Milliseconds in a minute, the unit of every offset and duration this module shows. */
export const MS_PER_MINUTE = 60_000;
// The range of ECMAScript dates and Temporal instants: 100,000,000 days on either
// side of 1970-01-01.
const MAX_EPOCH_MS = 8.64e15;

function isEpochMs(value: number): value is EpochMs {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_EPOCH_MS;
}

/**
 * Brands a number of epoch milliseconds that the code already holds, such as
 * a `timestamptz` read back from the database (TRV-68). Throws a RangeError for
 * a fraction, NaN or a value outside the range of dates: that is a bug.
 */
export function toEpochMs(value: number): EpochMs {
  if (!isEpochMs(value)) {
    throw new RangeError(`Not an instant in epoch milliseconds: ${String(value)}.`);
  }
  return value;
}

/**
 * Orders two instants, for sorting: negative when `left` comes first, zero
 * when they are the same moment, positive otherwise. "Before" and "after" are
 * always decided this way, between absolute instants, never between local
 * dates or times (TRV-69).
 */
export function compareInstants(left: EpochMs, right: EpochMs): number {
  return left - right;
}

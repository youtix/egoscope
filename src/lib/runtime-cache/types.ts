import type { CacheFailure } from './errors';

/**
 * A small JSON value that the cache holds (module map §5): what goes in comes back
 * as JSON gives it back, so it holds no date, map, function or undefined.
 */
export type CacheValue =
  | null
  | boolean
  | number
  | string
  | readonly CacheValue[]
  | Readonly<{ [key: string]: CacheValue }>;

/**
 * What a read gives: the value the key holds, `null` when it holds none, unchecked
 * since an outside service gave it, or the cache's failure.
 */
export type CacheRead = Readonly<{ ok: true; value: unknown }> | CacheFailure;

/** What a write or a delete gives: done, or the cache's failure. */
export type CacheWrite = Readonly<{ ok: true }> | CacheFailure;

/**
 * The Runtime Cache, as the application uses it (module map §5): `get`, `set` with a
 * time to live in seconds, after which the entry is gone, and `delete`, on small JSON
 * values; nothing else. An entry can also be evicted at any time, so that a reader
 * always copes with a missing one.
 */
export type RuntimeCache = Readonly<{
  get: (key: string) => Promise<CacheRead>;
  set: (key: string, value: CacheValue, ttlSeconds: number) => Promise<CacheWrite>;
  delete: (key: string) => Promise<CacheWrite>;
}>;

import { getCache } from '@vercel/functions';

import { UNAVAILABLE } from './errors';

import type { CacheFailure } from './errors';
import type { CacheRead, CacheValue, CacheWrite, RuntimeCache } from './types';

/** Runs `operation` on Vercel's cache, its failure becoming `unavailable` (module map §5). */
async function attempt<T>(operation: () => Promise<T>): Promise<T | CacheFailure> {
  try {
    return await operation();
  } catch {
    return UNAVAILABLE;
  }
}

/** Reads `key`, which Vercel's cache gives back as `null` when it holds nothing. */
async function get(key: string): Promise<CacheRead> {
  return attempt(async () => ({ ok: true, value: await getCache().get(key) }));
}

/** Writes `value` under `key` for `ttlSeconds`, Vercel's own unit for a time to live. */
async function set(key: string, value: CacheValue, ttlSeconds: number): Promise<CacheWrite> {
  return attempt(async () => {
    await getCache().set(key, value, { ttl: ttlSeconds });
    return { ok: true };
  });
}

/** Deletes `key`, which succeeds as well when the key held nothing. */
async function remove(key: string): Promise<CacheWrite> {
  return attempt(async () => {
    await getCache().delete(key);
    return { ok: true };
  });
}

/**
 * The Runtime Cache of Vercel, through `getCache` of `@vercel/functions` (module map §5,
 * hosting sheet): a key that holds nothing reads as `null`, and every failure of the
 * cache, a refusal while it is paused for the month included, answers `unavailable`, so
 * that an idle tick falls back to the hourly database check (module map §1.9; TRV-25,
 * TRV-31).
 */
export const vercelRuntimeCache: RuntimeCache = { get, set, delete: remove };

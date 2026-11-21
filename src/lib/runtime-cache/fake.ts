import { now, toEpochMs } from '@/lib/time';

import { UNAVAILABLE } from './errors';

import type { CacheFailure } from './errors';
import type { CacheRead, CacheValue, CacheWrite, RuntimeCache } from './types';
import type { EpochMs } from '@/lib/time';

/** The cache of tests, development and the hermetic mode, with the faults it plays on demand. */
export type FakeRuntimeCache = RuntimeCache &
  Readonly<{
    /** Drops the entry of `key`, as the real cache may at any time. */
    evict: (key: string) => void;
    /** Drops every entry, as a cache that lost its whole content. */
    loseAll: () => void;
    /** Fails every operation with `unavailable` until it is made available again. */
    setAvailable: (isAvailable: boolean) => void;
    /** Fails every write and delete with `unavailable`, while reads still work, until undone. */
    setWritable: (isWritable: boolean) => void;
    /**
     * Loses the next write to `key` to a racing writer, which read the entry before
     * that write and wrote it back after: the key keeps the value it held.
     */
    raceNextWrite: (key: string) => void;
    /** The writes and deletes that the cache took, on `key`, or on every key. */
    writeCount: (key?: string) => number;
  }>;

const MS_PER_SECOND = 1000;

/** The result of `operation`, or `unavailable` when it is not allowed, on a later turn. */
async function answer<T>(isAllowed: boolean, operation: () => T): Promise<T | CacheFailure> {
  // The fake answers on a later turn, as a cache across the network does.
  await Promise.resolve();
  return isAllowed ? operation() : UNAVAILABLE;
}

/**
 * A fresh in-memory Runtime Cache (module map §5): it keeps each value as JSON until
 * its time to live has passed, and plays on demand an eviction, the loss of every
 * entry, an outage and two writers racing on one key; it counts the writes it took,
 * so that a test can hold the month's writes to the allowance (module map §1.9).
 */
export function createFakeRuntimeCache(): FakeRuntimeCache {
  // An entry as the real cache keeps it: serialized, with the instant it expires.
  type Entry = Readonly<{ json: string; expiresAt: EpochMs }>;
  const entries = new Map<string, Entry>();
  const racing = new Set<string>();
  const writes = new Map<string, number>();
  let isAvailable = true;
  let isWritable = true;
  let totalWrites = 0;

  const tookWrite = (key: string): CacheWrite => {
    writes.set(key, (writes.get(key) ?? 0) + 1);
    totalWrites += 1;
    return { ok: true };
  };
  const read = (key: string): CacheRead => {
    const entry = entries.get(key);
    const isLive = entry !== undefined && now() < entry.expiresAt;
    const value: unknown = isLive ? JSON.parse(entry.json) : null;
    return { ok: true, value };
  };
  const store = (key: string, value: CacheValue, ttlSeconds: number): CacheWrite => {
    if (!racing.delete(key)) {
      const expiresAt = toEpochMs(now() + ttlSeconds * MS_PER_SECOND);
      entries.set(key, { json: JSON.stringify(value), expiresAt });
    }
    return tookWrite(key);
  };
  const remove = (key: string): CacheWrite => {
    entries.delete(key);
    return tookWrite(key);
  };
  return {
    get: async (key) => answer(isAvailable, () => read(key)),
    set: async (key, value, ttlSeconds) =>
      answer(isAvailable && isWritable, () => store(key, value, ttlSeconds)),
    delete: async (key) => answer(isAvailable && isWritable, () => remove(key)),
    evict: (key) => {
      entries.delete(key);
    },
    loseAll: () => {
      entries.clear();
    },
    setAvailable: (value) => {
      isAvailable = value;
    },
    setWritable: (value) => {
      isWritable = value;
    },
    raceNextWrite: (key) => {
      racing.add(key);
    },
    writeCount: (key) => (key === undefined ? totalWrites : (writes.get(key) ?? 0)),
  };
}

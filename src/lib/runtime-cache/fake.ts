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
    /** The units that the reads the cache answered cost, on `key`, or on every key. */
    readUnits: (key?: string) => number;
    /** The units that the writes and deletes the cache took cost, on `key`, or on every key. */
    writeUnits: (key?: string) => number;
  }>;

const MS_PER_SECOND = 1000;

// The host meters each read and each write in units of 8 KB of the value, one at least
// (hosting sheet, Runtime Cache item).
const UNIT_BYTES = 8192;

const utf8 = new TextEncoder();

/** The units that an operation on `json` costs; one for an operation that carries no value. */
function unitsOf(json: string | null): number {
  const bytes = json === null ? 0 : utf8.encode(json).length;
  return Math.max(1, Math.ceil(bytes / UNIT_BYTES));
}

/** A tally by key and in all: of operations, or of the units they cost. */
function createTally() {
  const byKey = new Map<string, number>();
  let total = 0;
  return {
    add: (key: string, amount: number) => {
      byKey.set(key, (byKey.get(key) ?? 0) + amount);
      total += amount;
    },
    of: (key?: string) => (key === undefined ? total : (byKey.get(key) ?? 0)),
  };
}

/** The result of `operation`, or `unavailable` when it is not allowed, on a later turn. */
async function answer<T>(isAllowed: boolean, operation: () => T): Promise<T | CacheFailure> {
  // The fake answers on a later turn, as a cache across the network does.
  await Promise.resolve();
  return isAllowed ? operation() : UNAVAILABLE;
}

/**
 * A fresh in-memory Runtime Cache (module map §5; TRV-12, TRV-31): it keeps each value
 * as JSON until its time to live has passed, and plays on demand an eviction, the loss
 * of every entry, an outage and two writers racing on one key, so that a tick's
 * fallback to the database can be tested. It counts the writes it took and the units
 * of 8 KB that its reads and writes cost, as the host meters them, so that a test can
 * hold a month's traffic to the allowance (module map §1.9; TRV-04, CL-TRV-25).
 */
export function createFakeRuntimeCache(): FakeRuntimeCache {
  // An entry as the real cache keeps it: serialized, with the instant it expires.
  type Entry = Readonly<{ json: string; expiresAt: EpochMs }>;
  const entries = new Map<string, Entry>();
  const racing = new Set<string>();
  const writes = createTally();
  const readUnits = createTally();
  const writeUnits = createTally();
  let isAvailable = true;
  let isWritable = true;

  const tookWrite = (key: string, json: string | null): CacheWrite => {
    writes.add(key, 1);
    writeUnits.add(key, unitsOf(json));
    return { ok: true };
  };
  const read = (key: string): CacheRead => {
    const entry = entries.get(key);
    const json = entry !== undefined && now() < entry.expiresAt ? entry.json : null;
    readUnits.add(key, unitsOf(json));
    return { ok: true, value: json === null ? null : (JSON.parse(json) as unknown) };
  };
  const store = (key: string, value: CacheValue, ttlSeconds: number): CacheWrite => {
    const json = JSON.stringify(value);
    if (!racing.delete(key)) {
      const expiresAt = toEpochMs(now() + ttlSeconds * MS_PER_SECOND);
      entries.set(key, { json, expiresAt });
    }
    return tookWrite(key, json);
  };
  const remove = (key: string): CacheWrite => {
    entries.delete(key);
    return tookWrite(key, null);
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
    writeCount: writes.of,
    readUnits: readUnits.of,
    writeUnits: writeUnits.of,
  };
}

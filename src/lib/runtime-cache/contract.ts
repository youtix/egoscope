// The behavior that every Runtime Cache adapter shares (module map §2.3 and §5), run by
// the port's own tests against the fake and against each real adapter. Each case acts
// on a fresh cache and names what it must give back; this file is never re-exported.
import type { RuntimeCache } from './types';

/** A fresh cache to hold to the contract, and the way to make it fail. */
type ContractSubject = Readonly<{ cache: RuntimeCache; breakCache: () => void }>;

/** One behavior of the contract: what `run` gives back on a fresh subject. */
type ContractCase = Readonly<{
  title: string;
  run: (subject: ContractSubject) => Promise<unknown>;
  expected: unknown;
}>;

const KEY = 'contract:entry';
const OTHER_KEY = 'contract:other';
const TTL_SECONDS = 3600;
const VALUE = { task: 'purge', isDue: true, steps: ['read', { done: null }] };
const NEWER_VALUE = { task: 'backup', isDue: false, steps: [] };
const UNAVAILABLE = { ok: false, error: { kind: 'unavailable' } };

async function setThenGet({ cache }: ContractSubject): Promise<unknown> {
  await cache.set(KEY, VALUE, TTL_SECONDS);
  return cache.get(KEY);
}

async function getMissing({ cache }: ContractSubject): Promise<unknown> {
  return cache.get(KEY);
}

async function setTwice({ cache }: ContractSubject): Promise<unknown> {
  await cache.set(KEY, VALUE, TTL_SECONDS);
  await cache.set(KEY, NEWER_VALUE, TTL_SECONDS);
  return cache.get(KEY);
}

async function deleteOne({ cache }: ContractSubject): Promise<unknown> {
  await cache.set(KEY, VALUE, TTL_SECONDS);
  await cache.set(OTHER_KEY, NEWER_VALUE, TTL_SECONDS);
  const deleted = await cache.delete(KEY);
  return [deleted, await cache.get(KEY), await cache.get(OTHER_KEY)];
}

async function useBroken({ cache, breakCache }: ContractSubject): Promise<unknown> {
  breakCache();
  return [await cache.get(KEY), await cache.set(KEY, VALUE, TTL_SECONDS), await cache.delete(KEY)];
}

/**
 * The cases every adapter passes, so that one cache can replace another (TRV-12): a
 * value comes back as it was set, a missing key reads as `null`, a second write
 * replaces the first, a delete forgets its key alone, and each operation answers
 * `unavailable` while the cache fails.
 */
export const RUNTIME_CACHE_CONTRACT: readonly ContractCase[] = [
  {
    title: 'gives back the JSON value that it holds under a key',
    run: setThenGet,
    expected: { ok: true, value: VALUE },
  },
  {
    title: 'reads a key that holds nothing as null',
    run: getMissing,
    expected: { ok: true, value: null },
  },
  {
    title: 'replaces the value of a key that it writes again',
    run: setTwice,
    expected: { ok: true, value: NEWER_VALUE },
  },
  {
    title: 'forgets a deleted key and keeps the others',
    run: deleteOne,
    expected: [{ ok: true }, { ok: true, value: null }, { ok: true, value: NEWER_VALUE }],
  },
  {
    title: 'answers unavailable to every operation while the cache fails',
    run: useBroken,
    expected: [UNAVAILABLE, UNAVAILABLE, UNAVAILABLE],
  },
];

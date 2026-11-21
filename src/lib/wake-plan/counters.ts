import { z } from 'zod';

import { runtimeCache } from '@/lib/runtime-cache';
import { toEpochMs } from '@/lib/time';

import { LONG_TTL_SECONDS, MINUTE_MS, storedInstant } from './stored-values';

import type { CacheFailure, CacheWrite } from '@/lib/runtime-cache';
import type { EpochMs } from '@/lib/time';

const ATTEMPT_KINDS = ['refused_trigger', 'private', 'group', 'channel'] as const;
const PROBE_SERVICES = ['statsSource', 'telegram'] as const;

/**
 * An attempt counted without the database: a refused tick, or a stranger's Telegram
 * update by the kind of its conversation (TRV-65, CL-TRV-21).
 */
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/** A service that a tick's probe calls without the database, by its quota name (module map §6). */
export type ProbeService = (typeof PROBE_SERVICES)[number];

/** What a request counts: an attempt, or a probe's call to a service. */
export type CounterBump =
  Readonly<{ attempt: AttemptKind }> | Readonly<{ probeCall: ProbeService }>;

/**
 * What the counters hold until a database pass drains them (CL-TRV-25): each attempt
 * with its instant and kind, up to 1,000; beyond, their count by kind with the first
 * and the last instant; and each probe call with its service and instant.
 */
export type Counters = Readonly<{
  attempts: readonly Readonly<{ kind: AttemptKind; at: EpochMs }>[];
  beyond: readonly Readonly<{
    kind: AttemptKind;
    count: number;
    firstAt: EpochMs;
    lastAt: EpochMs;
  }>[];
  probeCalls: readonly Readonly<{ service: ProbeService; at: EpochMs }>[];
}>;

/** What the cache held, which the database pass journals, or why it could not be read. */
export type CountersDrain = Readonly<{ ok: true; counters: Counters }> | CacheFailure;

type Beyond = Counters['beyond'][number];

// What this server instance recorded and has not written yet, and when it last wrote.
type InstanceCounters = { pending: Counters; lastWriteAt: EpochMs | null };

const COUNTERS_KEY = 'wake:counters';

/** The attempts kept one by one, in an instance and in the cache (CL-TRV-25). */
export const MAX_ATTEMPTS = 1000;

const EMPTY: Counters = { attempts: [], beyond: [], probeCalls: [] };

const attemptKind = z.enum(ATTEMPT_KINDS);

const attemptSchema = z.strictObject({ kind: attemptKind, at: storedInstant });

const beyondSchema = z.strictObject({
  kind: attemptKind,
  count: z.int().min(1),
  firstAt: storedInstant,
  lastAt: storedInstant,
});

const probeCallSchema = z.strictObject({ service: z.enum(PROBE_SERVICES), at: storedInstant });

const countersSchema = z.strictObject({
  attempts: z.array(attemptSchema),
  beyond: z.array(beyondSchema),
  probeCalls: z.array(probeCallSchema),
});

// The counters of this server instance live on globalThis under a registered symbol,
// so that every copy of this module in the process shares one buffer.
const INSTANCE_COUNTERS = Symbol.for('egoscope.wake-plan.instance-counters');

type Registry = Map<'instance', InstanceCounters>;

const isRegistry = (value: unknown): value is Registry => value instanceof Map;

/** This server instance's counters, created at its first count. */
function instanceCounters(): InstanceCounters {
  const existing: unknown = Reflect.get(globalThis, INSTANCE_COUNTERS);
  const registry = isRegistry(existing) ? existing : new Map<'instance', InstanceCounters>();
  Reflect.set(globalThis, INSTANCE_COUNTERS, registry);
  const instance = registry.get('instance') ?? { pending: EMPTY, lastWriteAt: null };
  registry.set('instance', instance);
  return instance;
}

/** The one count of `kind` in `counts`: their sum, the first first instant and the last last one. */
function countOf(kind: AttemptKind, counts: readonly Beyond[]): Beyond {
  const ofKind = counts.filter((count) => count.kind === kind);
  return {
    kind,
    count: ofKind.reduce((sum, { count }) => sum + count, 0),
    firstAt: toEpochMs(Math.min(...ofKind.map(({ firstAt }) => firstAt))),
    lastAt: toEpochMs(Math.max(...ofKind.map(({ lastAt }) => lastAt))),
  };
}

/** `earlier` then `later`: the first 1,000 attempts one by one, the others counted by kind. */
function merge(earlier: Counters, later: Counters): Counters {
  const attempts = [...earlier.attempts, ...later.attempts];
  const folded = attempts
    .slice(MAX_ATTEMPTS)
    .map(({ kind, at }) => ({ kind, count: 1, firstAt: at, lastAt: at }));
  const counts = [...earlier.beyond, ...later.beyond, ...folded];
  return {
    attempts: attempts.slice(0, MAX_ATTEMPTS),
    beyond: ATTEMPT_KINDS.filter((kind) => counts.some((count) => count.kind === kind)).map(
      (kind) => countOf(kind, counts),
    ),
    probeCalls: [...earlier.probeCalls, ...later.probeCalls],
  };
}

const isEmpty = (counters: Counters): boolean =>
  counters.attempts.length + counters.beyond.length + counters.probeCalls.length === 0;

/** The counters that the cache holds, none when it holds none it can read, or its failure. */
async function cachedCounters(): Promise<CountersDrain> {
  const read = await runtimeCache().get(COUNTERS_KEY);
  if (!read.ok) {
    return read;
  }
  const parsed = countersSchema.safeParse(read.value);
  return { ok: true, counters: parsed.success ? parsed.data : EMPTY };
}

/** Adds `sent` to what the cache holds, in one write. */
async function addToCache(sent: Counters): Promise<CacheWrite> {
  const cached = await cachedCounters();
  return cached.ok
    ? runtimeCache().set(COUNTERS_KEY, merge(cached.counters, sent), LONG_TTL_SECONDS)
    : cached;
}

/**
 * Writes what this instance recorded to the cache, when it recorded something since
 * its last successful write and its last write, failed or not, is a minute or more from
 * `at`; a failed write puts it back before what the instance recorded meanwhile
 * (CL-TRV-25).
 */
async function writePending(at: EpochMs): Promise<void> {
  const instance = instanceCounters();
  const isRecent = instance.lastWriteAt !== null && Math.abs(at - instance.lastWriteAt) < MINUTE_MS;
  if (isRecent || isEmpty(instance.pending)) {
    return;
  }
  const sent = instance.pending;
  instance.pending = EMPTY;
  instance.lastWriteAt = at;
  const written = await addToCache(sent);
  if (!written.ok) {
    instance.pending = merge(sent, instance.pending);
  }
}

/**
 * Counts, in this server instance's memory and without the database, a refused tick or
 * a stranger's Telegram update with its instant and kind, or a probe's call to a
 * service (TRV-65, TRV-03, CL-TRV-21, CL-TRV-25). Returns the write that the request
 * runs after its response (`after(bumpCounter(...))`): it adds what the instance
 * recorded to the cache, at once for an isolated attempt and at most once a minute
 * under a stream, and keeps it, beyond 1,000 attempts as a count by kind with the first
 * and the last instant, until a write succeeds.
 */
export function bumpCounter(bump: CounterBump, at: EpochMs): () => Promise<void> {
  const instance = instanceCounters();
  const counted: Counters =
    'attempt' in bump
      ? { ...EMPTY, attempts: [{ kind: bump.attempt, at }] }
      : { ...EMPTY, probeCalls: [{ service: bump.probeCall, at }] };
  instance.pending = merge(instance.pending, counted);
  return async () => writePending(at);
}

/**
 * Takes what the counters entry holds and empties it, for the database pass to journal
 * each attempt as its own entry, and the count beyond 1,000, and to hand the probe calls
 * to `quotas` (CL-TRV-21, CL-TRV-25). A failed delete gives the failure, so that the
 * pass journals nothing that the next pass would journal again.
 */
export async function drainCounters(): Promise<CountersDrain> {
  const cached = await cachedCounters();
  if (!cached.ok || isEmpty(cached.counters)) {
    return cached;
  }
  const deleted = await runtimeCache().delete(COUNTERS_KEY);
  return deleted.ok ? cached : deleted;
}

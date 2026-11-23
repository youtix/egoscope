import { AsyncLocalStorage } from 'node:async_hooks';

import { runtimeCache } from '@/lib/runtime-cache';
import { now } from '@/lib/time';

import { PLAN_KEY, readPlan, writePlan } from './plan';

import type { TaskKey } from './plan';
import type { CacheFailure, CacheWrite } from '@/lib/runtime-cache';
import type { EpochMs } from '@/lib/time';

/** Whether `wakeAt` wrote the plan, or why it could not read it. */
export type WakeOutcome = Readonly<{ ok: true; written: boolean }> | CacheFailure;

// The database pass that the current async context runs in, if any.
const pass = new AsyncLocalStorage<true>();

const UNWRITTEN: WakeOutcome = { ok: true, written: false };
const UNAVAILABLE: WakeOutcome = { ok: false, error: { kind: 'unavailable' } };

/**
 * Runs `work` as a database pass (module map §1.6 steps 5 to 7; TRV-25, TRV-31): inside
 * it, `wakeAt` writes nothing, since the pass rewrites the plan at its end, after the
 * run check. Only the async context
 * of `work` is a pass, so that a request served meanwhile by the same instance keeps
 * its own `wakeAt`.
 */
export async function duringPass<T>(work: () => Promise<T>): Promise<T> {
  return pass.run(true, work);
}

/**
 * Merges into the wake plan that `task` has work due at `dueAt` (module map §1.9; TRV-25),
 * writing only when that moves the plan's earliest due instant earlier: a later instant,
 * a plan that a tick would not trust, which sends the next tick to the database anyway,
 * and a call inside a database pass, which rewrites the plan at its end, write nothing.
 * The plan keeps its `computedAt`, so that a write lost to a racing writer delays the
 * work by an hour at most, until the hourly check (TRV-31).
 */
export async function wakeAt(dueAt: EpochMs, task: TaskKey): Promise<WakeOutcome> {
  if (pass.getStore() === true) {
    return UNWRITTEN;
  }
  const reading = await readPlan(now());
  if (!reading.ok) {
    return reading.error.kind === 'unavailable' ? UNAVAILABLE : UNWRITTEN;
  }
  if (reading.earliestDueAt !== null && reading.earliestDueAt <= dueAt) {
    return UNWRITTEN;
  }
  const { computedAt, entries, probes } = reading.plan;
  const others = entries.filter((entry) => entry.task !== task);
  const written = await writePlan({ computedAt, entries: [...others, { task, dueAt }], probes });
  return written.ok ? { ok: true, written: true } : written;
}

/**
 * Drops the wake plan, so that the next tick opens the database and the pass rewrites
 * it (module map §1.9): a schedule parameter or the time zone changed (TRV-25, TRV-27).
 */
export async function invalidate(): Promise<CacheWrite> {
  return runtimeCache().delete(PLAN_KEY);
}

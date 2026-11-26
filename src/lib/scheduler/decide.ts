// Whether a tick needs the database, from the wake plan alone (module map §1.6 step 4,
// §1.9; ADR 0025): an idle tick runs no query.
import { readPlan, writePlan } from '@/lib/wake-plan';

import { HOUR_MS } from './limits';

import type { ProbeOutcome, Registry } from './types';
import type { EpochMs } from '@/lib/time';
import type { PlanUnusable, WakePlan, WakeProbe } from '@/lib/wake-plan';

/** Why a tick opens the database: no plan it can trust, work due, or a probe that found work. */
export type PassReason = PlanUnusable['kind'] | 'due' | 'probe';

/** What a tick does: nothing more, or a database pass. */
export type Decision =
  Readonly<{ kind: 'idle' }> | Readonly<{ kind: 'database'; reason: PassReason }>;

// What this server instance remembers between its ticks: its last database pass and its
// last write of the plan, for the hourly fallback while the cache fails.
const instance: { lastPassAt: EpochMs | null; planWrittenAt: EpochMs | null } = {
  lastPassAt: null,
  planWrittenAt: null,
};

const IDLE: Decision = { kind: 'idle' };

/** Notes that this instance wrote the plan at `at`, as the end of a database pass does (TRV-31). */
export function notePlanWritten(at: EpochMs): void {
  instance.planWrittenAt = at;
}

const isWithinHour = (since: EpochMs | null, at: EpochMs): boolean =>
  since !== null && Math.abs(at - since) < HOUR_MS;

/** A database pass, which this instance remembers. */
function pass(reason: PassReason, at: EpochMs): Decision {
  instance.lastPassAt = at;
  return { kind: 'database', reason };
}

/**
 * Whether a plan that the tick cannot use comes from a failing cache: one that fails, or,
 * since Vercel's client swallows its errors outside a request, a plan missing within the
 * hour after this instance wrote it, which a failed write leaves.
 */
const isCacheFailing = (unusable: PlanUnusable, at: EpochMs): boolean =>
  unusable.kind === 'unavailable' ||
  (unusable.kind === 'missing' && isWithinHour(instance.planWrittenAt, at));

/**
 * Makes the due probes of `plan` through the calls that the registry's ready guards
 * declare: the first that finds work sends the tick to the database; otherwise each one
 * moves to its next call and the plan keeps its `computedAt`, so that the hourly check
 * still comes. A probe that no active task declares waits for the next pass.
 */
async function probe(registry: Registry, plan: WakePlan, at: EpochMs): Promise<Decision> {
  const probes: WakeProbe[] = [];
  for (const planned of plan.probes) {
    const guard = registry.find((task) => task.readyGuard?.probe === planned.kind)?.readyGuard;
    const outcome: ProbeOutcome =
      guard === undefined || planned.dueAt > at
        ? { found: false, next: planned }
        : await guard.call(planned, at);
    if (outcome.found) {
      return pass('probe', at);
    }
    probes.push(outcome.next);
  }
  const isMoved = probes.some((next, index) => next !== plan.probes[index]);
  if (isMoved) {
    await writePlan({ computedAt: plan.computedAt, entries: plan.entries, probes });
  }
  return IDLE;
}

/**
 * Decides, from the wake plan alone and without any query, whether the tick at `at` needs
 * the database (module map §1.6 step 4; TRV-25, TRV-31; ADR 0025): a pass when the plan
 * is missing, unreadable, foreign, older than an hour or due; a database-free probe when
 * the plan asks for one, which either finds work or moves to its next call; nothing
 * otherwise. While the cache fails, a pass at most once an hour per server instance.
 */
export async function decide(registry: Registry, at: EpochMs): Promise<Decision> {
  const reading = await readPlan(at);
  if (!reading.ok) {
    const isFallback = isCacheFailing(reading.error, at);
    return isFallback && isWithinHour(instance.lastPassAt, at)
      ? IDLE
      : pass(reading.error.kind, at);
  }
  return reading.earliestDueAt !== null && reading.earliestDueAt <= at
    ? pass('due', at)
    : probe(registry, reading.plan, at);
}

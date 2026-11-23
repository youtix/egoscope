// Recording what a call used, then what follows from it: a limit reached by the app's
// own count, a refusal before the declared limit, the incidents and the warning
// (TRV-03 to TRV-06, CL-TRV-11, CL-TRV-12).
import { readStates, writeRow } from './ledger';
import { SERVICES } from './limits';
import { bucketOf, leavesAt } from './periods';
import { isReachedByCount, syncReached, syncWarning } from './quota-incidents';

import type { LimitState, RowChange } from './ledger';
import type { QuotaService } from './limits';
import type { SyncContext } from './quota-incidents';
import type { CallUsage } from './readers';
import type { Transaction } from '@/lib/db';
import type { QuotaIncidentCause } from '@/lib/incidents';
import type { EpochMs } from '@/lib/time';

/**
 * Until when a refusal at `at` without a retry instant holds the limit of `state`: its
 * next reset, or for a rolling window, until the operations of its current bucket have
 * left it (CL-TRV-12).
 */
function refusalEnd(state: LimitState, at: EpochMs): EpochMs {
  const { window } = state.limit;
  return window.kind === 'rolling' ? leavesAt(bucketOf(at), window.lengthMs) : state.period.end;
}

/** The reset that `usage` reports for the limit of `state`, if its window is a reported one. */
function reportedResetOf(state: LimitState, usage: CallUsage): EpochMs | null {
  const { measure, window } = state.limit;
  return window.kind === 'reported' ? (usage.resets[measure] ?? null) : null;
}

/**
 * Until when the refusal of `usage` at `at` marks the limit of `state` reached, or null.
 * A retry-after is for the limits that no header reports: a refusal with one leaves a
 * reported window counting to the reset its header gives, one without marks it reached
 * until that reset (CL-TRV-12; data model, `quota_usage.resets_at`).
 */
function markOf(state: LimitState, usage: CallUsage, at: EpochMs): EpochMs | null {
  const { refusal } = usage;
  if (refusal === null) {
    return null;
  }
  if (state.limit.window.kind !== 'reported') {
    return refusal.retryAt ?? refusalEnd(state, at);
  }
  return refusal.retryAt === null ? (reportedResetOf(state, usage) ?? refusalEnd(state, at)) : null;
}

/** What `usage` adds to the current row of `state`: its amount, a reported reset, a refusal's mark. */
function changeOf(
  state: LimitState,
  usage: CallUsage,
  at: EpochMs,
): (RowChange & Readonly<{ at: EpochMs }>) | null {
  const used = usage.amounts[state.limit.measure] ?? 0;
  const reportedReset = reportedResetOf(state, usage);
  const markedUntil = markOf(state, usage, at);
  if (markedUntil !== null) {
    return { at, used, resetsAt: markedUntil, reachedAt: at };
  }
  return used === 0 && reportedReset === null ? null : { at, used, resetsAt: reportedReset };
}

/**
 * Adds the use of one call of `service` at `at` to the current rows of its limits, in
 * the caller's transaction `tx`: the amounts the port reported, the reset instants its
 * provider reported, and for a refusal for quota, the limits marked reached until its
 * retry instant or else their reset (TRV-03, TRV-06, CL-TRV-12).
 */
export async function addUsage(
  tx: Transaction,
  service: QuotaService,
  call: Readonly<{ usage: CallUsage; at: EpochMs }>,
): Promise<void> {
  const states = await readStates(tx, SERVICES[service].limits, call.at);
  for (const state of states) {
    const change = changeOf(state, call.usage, call.at);
    if (change !== null) {
      await writeRow(tx, state, change);
    }
  }
}

/**
 * Settles `service` once its use is recorded, in the caller's transaction `tx`: marks
 * each limit its count reached, opens or updates "quota reached" with the causes found,
 * a refusal counting as a refusal before the declared limit while no count reached it,
 * closes the causes gone once work resumed, and gives or ends the warning (TRV-05,
 * TRV-06, CL-TRV-11).
 */
export async function settle(
  tx: Transaction,
  service: QuotaService,
  context: SyncContext & Readonly<{ resumed: boolean; refused: boolean }>,
): Promise<void> {
  const { limits, role } = SERVICES[service];
  const states = await readStates(tx, limits, context.at);
  const reached = states.filter(
    (state) => state.limit.window.kind !== 'rolling' && isReachedByCount(state, context.values),
  );
  for (const state of reached) {
    if (state.rows.at(-1)?.reachedAt === null) {
      await writeRow(tx, state, { at: context.at, reachedAt: context.at });
    }
  }
  const isCounted = states.some((state) => isReachedByCount(state, context.values));
  const causes = new Set<QuotaIncidentCause>();
  if (isCounted) {
    causes.add('limit_reached');
  } else if (context.refused) {
    causes.add('refused_before_limit');
  }
  await syncReached(tx, service, { ...context, causes });
  await syncWarning(tx, role, context);
}

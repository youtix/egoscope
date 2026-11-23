// Whether a call may be made now, from the state of each limit of its service and the
// values in force (TRV-04, TRV-06, STA-39): a call that would exceed a declared limit is
// deferred to the instant the limit makes room, never made.
import { toEpochMs } from '@/lib/time';

import { scaleOf } from './limits';
import { leavesAt } from './periods';

import type { LimitState } from './ledger';
import type { Measure } from './limits';
import type { EpochMs } from '@/lib/time';

/** What a call expects to use, by measure; a measure left out counts as none. */
export type Estimate = Readonly<Partial<Record<Measure, number>>>;

/** A limit's state with its value in force, null while the owner has not entered it. */
export type LimitView = Readonly<{ state: LimitState; value: number | null }>;

/** What a check asks: the call's estimate, its priority and the reserve kept for priority calls. */
export type CheckRequest = Readonly<{
  estimate: Estimate;
  priority: boolean;
  /** The share of each limit, in percent, that only priority calls may use (STA-39). */
  reserveShare: number;
  /** The size limit of one call in megabytes, checked against the estimate's bytes, or null. */
  callSize: number | null;
}>;

/** The answer of a check. */
export type Verdict = Readonly<{
  allowed: boolean;
  /** Allowed without touching the reserve, which tells that deferred work resumes (STA-39). */
  resumes: boolean;
  /**
   * Deferred by a limit that the app's own count reached, which opens "quota reached"
   * (TRV-05): not by a rate, which only spaces the calls, nor by a refusal that still
   * holds (TRV-06).
   */
  reached: boolean;
  /** When the call may be made: `at` when allowed, null when no reset ever makes room. */
  availableAt: EpochMs | null;
}>;

type Blocker = Readonly<{ until: EpochMs | null; reached: boolean }>;

const PERCENT = 100;

/** Whether `need` more on top of `used` goes over `allowance`, or nothing is left of it. */
function isOver(used: number, need: number, allowance: number): boolean {
  return used >= allowance || used + need > allowance;
}

/** When `need` fits under `allowance` again: the period's end, or a rolling window's bucket leaving it. */
function freeAt(state: LimitState, need: number, allowance: number): EpochMs | null {
  const { window } = state.limit;
  if (need > allowance) {
    return null;
  }
  if (window.kind !== 'rolling') {
    return state.period.end;
  }
  let used = state.used;
  for (const row of state.rows) {
    used -= row.used;
    if (!isOver(used, need, allowance)) {
      return leavesAt(row.start, window.lengthMs);
    }
  }
  return null;
}

/** The blocker of `view` by the app's count under `share` percent of its value, if any (TRV-04). */
function countBlocker(view: LimitView, request: CheckRequest, share: number): Blocker | null {
  const { state, value } = view;
  if (value === null || !state.limit.enforced) {
    return null;
  }
  const allowance = (value * scaleOf(state.limit.measure) * share) / PERCENT;
  const need = request.estimate[state.limit.measure] ?? 0;
  return isOver(state.used, need, allowance)
    ? { until: freeAt(state, need, allowance), reached: !state.limit.rate }
    : null;
}

/** What blocks a call under `share` percent of each limit: refusals that hold, counts, its size. */
function blockersOf(views: readonly LimitView[], request: CheckRequest, share: number): Blocker[] {
  const marks = views.flatMap(({ state }) =>
    state.blockedUntil === null ? [] : { until: state.blockedUntil, reached: false },
  );
  const counts = views.flatMap((view) => countBlocker(view, request, share) ?? []);
  const bytes = request.estimate.bytes ?? 0;
  const isTooLarge = request.callSize !== null && bytes > request.callSize * scaleOf('bytes');
  return [...marks, ...counts, ...(isTooLarge ? [{ until: null, reached: true }] : [])];
}

/** The latest instant at which every blocker has made room, or null when one never does. */
function latest(blockers: readonly Blocker[]): EpochMs | null {
  const known = blockers.map((blocker) => blocker.until).filter((until) => until !== null);
  return known.length < blockers.length ? null : toEpochMs(Math.max(...known));
}

/**
 * Whether a call that `request` describes may be made at `at`: not while a refusal
 * still holds (TRV-06), nor when its estimate would go over a limit entered, of which a
 * non-priority call leaves the reserve to priority ones (TRV-04, STA-39); a limit not
 * entered is counted but never defers (CL-TRV-12).
 */
export function check(views: readonly LimitView[], request: CheckRequest, at: EpochMs): Verdict {
  const normalShare = PERCENT - request.reserveShare;
  const blockers = blockersOf(views, request, request.priority ? PERCENT : normalShare);
  const isAllowed = blockers.length === 0;
  return {
    allowed: isAllowed,
    resumes: isAllowed && blockersOf(views, request, normalShare).length === 0,
    reached: blockers.some((blocker) => blocker.reached),
    availableAt: isAllowed ? at : latest(blockers),
  };
}

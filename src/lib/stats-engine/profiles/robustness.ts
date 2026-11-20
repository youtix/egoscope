// The robustness test (SEN-26, CL-SEN-14): the verdict recomputed after setting aside the
// valid case that supports it most, to tell whether a single game is enough to tip it.
// A verdict whose level or direction then changes is fragile, and its profile confidence
// steps down a level (SEN-25).

import { compareCasesInFixedOrder, signalVerdict, verdictQuantities } from './verdict';

import type { CaseId, EngineParams } from '../types';
import type { ProfileCase } from './tally';
import type { Verdict, VerdictQuantities } from './verdict';

type ValidCase = Extract<ProfileCase, { status: 'measured' }>;

/**
 * One recomputation of the robustness test (SEN-26, CL-SEN-14): the valid case it set
 * aside, and what the other valid cases give, their quantities (SEN-22) and their verdict
 * under the thresholds of SEN-23 without the valid-case threshold.
 */
export type RobustnessTrial = Readonly<{
  removedCaseId: CaseId;
  quantities: VerdictQuantities | null;
  verdict: Verdict;
}>;

/**
 * The robustness test of a verdict (SEN-26): whether it is fragile, and its
 * recomputations, none when the test does not run (CL-SEN-14).
 */
export type RobustnessTest = Readonly<{
  isFragile: boolean;
  trials: readonly RobustnessTrial[];
}>;

const NOT_RUN: RobustnessTest = { isFragile: false, trials: [] };

/**
 * Says whether two verdicts have the same level and the same direction: a change of
 * either is how the robustness test and the checks tell that a verdict changed (SEN-26,
 * SEN-27).
 */
export function isSameVerdict(left: Verdict, right: Verdict): boolean {
  return left.level === right.level && left.direction === right.direction;
}

/**
 * The first case in the fixed order (CL-SEN-14) whose gap is the one that `pick` picks
 * among them all, the highest or the lowest, as a list of one case.
 */
function firstCaseOf(
  ordered: readonly ValidCase[],
  pick: (...gaps: number[]) => number,
): ValidCase[] {
  const picked = pick(...ordered.map((caseItem) => caseItem.normalizedGap));
  return ordered.filter((caseItem) => caseItem.normalizedGap === picked).slice(0, 1);
}

/**
 * The cases to set aside, one at a time (SEN-26, CL-SEN-14): the highest gap for an
 * increase, the lowest for a decrease, and for an inconclusive verdict the highest, then
 * the lowest. A tie goes to the first case in the fixed order.
 */
function supportingCases(ordered: readonly ValidCase[], verdict: Verdict): ValidCase[] {
  if (verdict.direction === 'increase') {
    return firstCaseOf(ordered, Math.max);
  }
  return verdict.direction === 'decrease'
    ? firstCaseOf(ordered, Math.min)
    : [...firstCaseOf(ordered, Math.max), ...firstCaseOf(ordered, Math.min)];
}

/** What the other valid cases give without `removed`, summed in the fixed order (CL-STA-09). */
function trialWithout(
  ordered: readonly ValidCase[],
  removed: ValidCase,
  params: EngineParams,
): RobustnessTrial {
  const quantities = verdictQuantities(
    ordered.filter((caseItem) => caseItem !== removed).map((caseItem) => caseItem.normalizedGap),
  );
  return { removedCaseId: removed.caseId, quantities, verdict: signalVerdict(quantities, params) };
}

/**
 * Runs the robustness test of a verdict (SEN-26, CL-SEN-14) on the valid cases, in the
 * fixed order of CL-STA-09, only when they reach sensitivity.minValidCases: below it, it
 * does not run and nothing is fragile. A possible or probable verdict is recomputed once,
 * without the highest gap for an increase or the lowest for a decrease, and is fragile
 * when its level or its direction changes. An inconclusive verdict is recomputed without
 * the highest gap, then without the lowest, each time from all the valid cases, and is
 * fragile when either gives possible or probable. A tie goes to the first case in the
 * fixed order. Each recomputation retains the dispersion anew, never below 1 (SEN-22),
 * and applies the thresholds of SEN-23 without the valid-case threshold. The verdict
 * tested is the caller's: a profile's from profileVerdict, a general trend's its own,
 * whose 3-player rule no recomputation applies (SEN-29).
 */
export function runRobustnessTest(
  cases: readonly ProfileCase[],
  verdict: Verdict,
  params: EngineParams,
): RobustnessTest {
  const ordered = cases
    .filter((caseItem) => caseItem.status === 'measured')
    .toSorted(compareCasesInFixedOrder);
  if (ordered.length < params.sensitivity.minValidCases) {
    return NOT_RUN;
  }
  const trials = supportingCases(ordered, verdict).map((removed) =>
    trialWithout(ordered, removed, params),
  );
  return { isFragile: trials.some((trial) => !isSameVerdict(trial.verdict, verdict)), trials };
}

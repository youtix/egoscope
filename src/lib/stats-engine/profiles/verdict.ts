// The verdict of a profile (SEN-20, SEN-22 to SEN-24, ADR 0021): the quantities of its
// valid gaps, then the level and the direction they give. The thresholds are
// parameters, never corrected for the number of profiles (ADR 0021).

import type { CaseId, EngineParams, EpochMs } from '../types';
import type { ProfileCase } from './tally';

// SEN-22: the retained dispersion never goes below 1, the variability that gaps have
// by construction when no effect exists, and the plausible range spans two expected
// noises on each side of the mean gap.
const DISPERSION_FLOOR = 1;
const RANGE_NOISES = 2;
// The dispersion divides by n − 1, so it needs two gaps (CL-SEN-15).
const MIN_GAPS_FOR_DISPERSION = 2;

/** The level of a verdict (SEN-23). */
export type VerdictLevel = 'inconclusive' | 'possible' | 'probable';

/** The direction of a possible or probable verdict, from the mean gap's sign (SEN-24). */
export type VerdictDirection = 'increase' | 'decrease';

/** A verdict: inconclusive, or possible or probable with its direction (SEN-23, SEN-24). */
export type Verdict =
  | Readonly<{ level: 'inconclusive'; direction: null }>
  | Readonly<{ level: Exclude<VerdictLevel, 'inconclusive'>; direction: VerdictDirection }>;

/**
 * What a non-empty set of gaps gives the verdict (SEN-20, SEN-22): the mean gap; the
 * gap dispersion, their sample standard deviation, null below two gaps (CL-SEN-15);
 * the retained dispersion, the expected noise, the signal-to-noise ratio and the
 * plausible range.
 */
export type VerdictQuantities = Readonly<{
  meanGap: number;
  gapDispersion: number | null;
  retainedDispersion: number;
  expectedNoise: number;
  signalToNoise: number;
  rangeLow: number;
  rangeHigh: number;
}>;

/**
 * The verdict values of a profile (SEN-20, SEN-22 to SEN-24): the quantities of its
 * valid gaps, null without a valid case (no mean, range or ratio, CL-SEN-15), how many
 * of those gaps lie above and below zero, and the verdict.
 */
export type ProfileVerdict = Readonly<{
  quantities: VerdictQuantities | null;
  aboveZeroCount: number;
  belowZeroCount: number;
  verdict: Verdict;
}>;

type OrderedCase = Readonly<{ caseId: CaseId; measuredGameScheduledStartAt: EpochMs }>;

const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };

/** The sum of `values`, added in their order. */
function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Computes the verdict quantities of a set of gaps (SEN-20, SEN-22, CL-SEN-15): mean
 * gap = sum ÷ n; gap dispersion = √(sum of the squared differences to the mean ÷
 * (n − 1)), null below two gaps; retained dispersion = the larger of the dispersion and
 * 1, and 1 below two gaps; expected noise = retained ÷ √n; signal-to-noise = mean ÷
 * noise; plausible range = mean ± 2 × noise. Null without a gap. The sums run in the
 * order of `gaps`, which the caller fixes (CL-STA-09); nothing is rounded (SEN-09).
 */
export function verdictQuantities(gaps: readonly number[]): VerdictQuantities | null {
  if (gaps.length === 0) {
    return null;
  }
  const meanGap = sumOf(gaps) / gaps.length;
  const gapDispersion =
    gaps.length < MIN_GAPS_FOR_DISPERSION
      ? null
      : Math.sqrt(sumOf(gaps.map((gap) => (gap - meanGap) ** 2)) / (gaps.length - 1));
  // Below two gaps the dispersion is the floor itself.
  const retainedDispersion = Math.max(gapDispersion ?? DISPERSION_FLOOR, DISPERSION_FLOOR);
  const expectedNoise = retainedDispersion / Math.sqrt(gaps.length);
  return {
    meanGap,
    gapDispersion,
    retainedDispersion,
    expectedNoise,
    signalToNoise: meanGap / expectedNoise,
    rangeLow: meanGap - RANGE_NOISES * expectedNoise,
    rangeHigh: meanGap + RANGE_NOISES * expectedNoise,
  };
}

/** The level that the thresholds give the signal, or null when it reaches neither. */
function strengthOf(
  quantities: VerdictQuantities,
  thresholds: EngineParams['sensitivity'],
): Exclude<VerdictLevel, 'inconclusive'> | null {
  const ratio = Math.abs(quantities.signalToNoise);
  const meanGap = Math.abs(quantities.meanGap);
  if (ratio >= thresholds.probableSignalToNoise && meanGap >= thresholds.probableMeanGap) {
    return 'probable';
  }
  if (ratio >= thresholds.possibleSignalToNoise && meanGap >= thresholds.possibleMeanGap) {
    return 'possible';
  }
  return null;
}

/** The mean gap's direction, or null for a mean gap of zero, which has none. */
function directionOf(meanGap: number): VerdictDirection | null {
  if (meanGap > 0) {
    return 'increase';
  }
  return meanGap < 0 ? 'decrease' : null;
}

/**
 * Gives the verdict of a signal (SEN-23, SEN-24): probable when the absolute
 * signal-to-noise ratio reaches sensitivity.probableSignalToNoise and the absolute mean
 * gap sensitivity.probableMeanGap; otherwise possible when both reach the possible
 * thresholds; inconclusive otherwise, and without a gap. A possible or probable verdict
 * takes the mean gap's direction, increase above zero and decrease below, judged alike
 * (H-04); a mean gap of zero has none and stays inconclusive. The valid-case threshold
 * is left to the caller, since the robustness test recomputes without it (CL-SEN-14).
 */
export function signalVerdict(quantities: VerdictQuantities | null, params: EngineParams): Verdict {
  if (quantities === null) {
    return INCONCLUSIVE;
  }
  const level = strengthOf(quantities, params.sensitivity);
  const direction = directionOf(quantities.meanGap);
  return level === null || direction === null ? INCONCLUSIVE : { level, direction };
}

/**
 * Orders two cases for sorting, in the fixed order of the sums over cases (CL-STA-09,
 * SEN-36): negative when `left` comes first, by its measured game's scheduled start,
 * then by case identifier, so that the same cases always give the same bits. The
 * robustness test breaks its ties in this order too (CL-SEN-14).
 */
export function compareCasesInFixedOrder(left: OrderedCase, right: OrderedCase): number {
  const byStart = left.measuredGameScheduledStartAt - right.measuredGameScheduledStartAt;
  return byStart === 0 ? left.caseId - right.caseId : byStart;
}

/**
 * Computes the verdict values of a profile from its cases (SEN-20, SEN-22 to SEN-24,
 * ADR 0021): the quantities of its valid gaps, summed in the order of their measured
 * games' scheduled starts, then of the case identifiers (CL-STA-09), so that the same
 * cases give the same bits in any order (SEN-36); how many gaps lie above and below
 * zero; and the verdict, inconclusive below sensitivity.minValidCases valid cases
 * (H-03), the signal's otherwise. Only valid cases count: an excluded case's gap never
 * enters a verdict (SEN-10).
 */
export function profileVerdict(
  cases: readonly ProfileCase[],
  params: EngineParams,
): ProfileVerdict {
  const gaps = cases
    .filter((caseItem) => caseItem.status === 'measured')
    .toSorted(compareCasesInFixedOrder)
    .map((caseItem) => caseItem.normalizedGap);
  const quantities = verdictQuantities(gaps);
  return {
    quantities,
    aboveZeroCount: gaps.filter((gap) => gap > 0).length,
    belowZeroCount: gaps.filter((gap) => gap < 0).length,
    verdict:
      gaps.length < params.sensitivity.minValidCases
        ? INCONCLUSIVE
        : signalVerdict(quantities, params),
  };
}

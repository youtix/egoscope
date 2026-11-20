// The profile confidence (SEN-25, D-11): low, medium or high, what a verdict rests on,
// whatever that verdict. It starts from n, the number of valid cases, then steps down one
// level for each sign of a weak base, never below low, and keeps the reason of each step.
// The thresholds are parameters (H-SEN-11).

import type { EngineParams } from '../types';

/** The profile confidence of a profile or a general trend (SEN-25, D-11). */
export type ProfileConfidence = 'low' | 'medium' | 'high';

/**
 * Why a profile confidence steps down a level (SEN-25, SEN-29), in the glossary's order:
 * the gaps disagree, many cases were doubtful, the verdict is fragile, and one player
 * brings most of the valid cases, a step that only a general trend takes, on top of the
 * others (SEN-29). The starting level comes from n and is no reason.
 */
export type ConfidenceStepDownReason =
  'high_dispersion' | 'high_doubtful_share' | 'fragile_verdict' | 'dominant_player';

/**
 * What the profile confidence of a profile rests on (SEN-25): its valid cases, n; its
 * excluded cases, by hand or not; its gap dispersion, the observed one and never the
 * retained one, null below two valid cases (CL-SEN-15); and whether the robustness test
 * found its verdict fragile, which it never does below the valid-case threshold
 * (SEN-26, CL-SEN-14), nor for a general trend whose valid cases come from fewer than
 * sensitivity.trendMinPlayers players, where the test does not run either (SEN-29).
 */
export type ConfidenceInputs = Readonly<{
  validCount: number;
  excludedCount: number;
  gapDispersion: number | null;
  isFragile: boolean;
}>;

/** A profile confidence and the reason of each step down, in the order of SEN-25. */
export type ConfidenceValues = Readonly<{
  profileConfidence: ProfileConfidence;
  confidenceStepDownReasons: readonly ConfidenceStepDownReason[];
}>;

// The registry gives the doubtful-share drop in percent.
const PERCENT = 100;

// One level down, never below low (SEN-25).
const ONE_LEVEL_DOWN: Readonly<Record<ProfileConfidence, ProfileConfidence>> = {
  high: 'medium',
  medium: 'low',
  low: 'low',
};

type ConfidenceThresholds = EngineParams['sensitivity'];

/**
 * Computes the doubtful-case share of a profile or a general trend (SEN-25): its excluded
 * cases divided by its valid and excluded cases together, exact, never rounded
 * (CL-SEN-21); null when it has neither.
 */
export function doubtfulShare(validCount: number, excludedCount: number): number | null {
  const judgedCount = validCount + excludedCount;
  return judgedCount === 0 ? null : excludedCount / judgedCount;
}

/**
 * Says whether an exact share, a fraction never rounded, exceeds `percent` percent, the
 * unit of the registry's shares (SEN-25, SEN-29, CL-SEN-21): it meets the parameter's own
 * fraction, so 3 cases of 10 make exactly 30 %, not more.
 */
export function isAbovePercent(share: number, percent: number): boolean {
  return share > percent / PERCENT;
}

/** The level that n gives, before any step down (SEN-25). */
function startingConfidence(
  validCount: number,
  thresholds: ConfidenceThresholds,
): ProfileConfidence {
  if (validCount >= thresholds.confidenceHighFromCases) {
    return 'high';
  }
  return validCount >= thresholds.confidenceMediumFromCases ? 'medium' : 'low';
}

/**
 * Steps a profile confidence down one level, never below low, and gives `reason` after
 * the earlier reasons (SEN-25): the step of each sign of a weak base, and the one that a
 * general trend takes on top when one player dominates (SEN-29).
 */
export function steppedDown(
  values: ConfidenceValues,
  reason: ConfidenceStepDownReason,
): ConfidenceValues {
  return {
    profileConfidence: ONE_LEVEL_DOWN[values.profileConfidence],
    confidenceStepDownReasons: [...values.confidenceStepDownReasons, reason],
  };
}

/**
 * Computes the profile confidence of a profile (SEN-25, D-11): low below
 * sensitivity.confidenceMediumFromCases valid cases, medium from it and high from
 * sensitivity.confidenceHighFromCases; then one level down for a gap dispersion above
 * sensitivity.confidenceDispersionDrop, one for a doubtful-case share above
 * sensitivity.confidenceDoubtfulShareDrop percent, and one for a fragile verdict (SEN-26),
 * never below low. Every sign that holds is a reason, kept when the level can drop no
 * further, as for a profile that starts low (CA-SEN-14), so the profile shows each one.
 * A general trend steps down once more on top when one player dominates (SEN-29).
 */
export function profileConfidence(
  inputs: ConfidenceInputs,
  params: EngineParams,
): ConfidenceValues {
  const thresholds = params.sensitivity;
  let values: ConfidenceValues = {
    profileConfidence: startingConfidence(inputs.validCount, thresholds),
    confidenceStepDownReasons: [],
  };
  // Below two valid cases there is no dispersion, and no gaps to disagree (CL-SEN-15).
  if ((inputs.gapDispersion ?? 0) > thresholds.confidenceDispersionDrop) {
    values = steppedDown(values, 'high_dispersion');
  }
  // Without a valid or an excluded case, no case was doubtful.
  const share = doubtfulShare(inputs.validCount, inputs.excludedCount) ?? 0;
  if (isAbovePercent(share, thresholds.confidenceDoubtfulShareDrop)) {
    values = steppedDown(values, 'high_doubtful_share');
  }
  if (inputs.isFragile) {
    values = steppedDown(values, 'fragile_verdict');
  }
  return values;
}

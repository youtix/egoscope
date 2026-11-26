// The comparisons of an alert sheet's caveats with their thresholds (ALE-16, CL-ALE-05,
// H-ALE-06): a profile or a general trend that rests on a small sample, a model's detection
// confidence near the detection threshold. Every threshold is received as data, the
// registry parameters that the caller reads.

import type { ProfileConfidence } from '../profiles/confidence';
import type { Verdict } from '../profiles/verdict';

/** The thresholds the caveats compare with (CL-ALE-05, ALE-16), each a registry parameter. */
export type CaveatThresholds = Readonly<{
  /** Valid cases a verdict needs, `sensitivity.minValidCases` (SEN-23). */
  minValidCases: number;
  /** Distinct players a general trend needs, `sensitivity.trendMinPlayers` (SEN-29). */
  trendMinPlayers: number;
  /** Points a detection needs, `detection.threshold` (DET-24). */
  detectionThreshold: number;
  /** Points above the detection threshold within which a confidence is near it (H-ALE-06). */
  confidenceVigilanceMargin: number;
}>;

/**
 * The frozen values of a section's profile that its caveats read (ALE-09, SEN-25, SEN-46),
 * its verdict with its direction, which no caveat tells apart (H-04).
 */
export type CaveatProfile = Readonly<{
  validCount: number;
  verdict: Verdict;
  profileConfidence: ProfileConfidence;
  /** « profil incomplet »: the type's coverage has gaps, or a widening change awaits its supplement. */
  isIncomplete: boolean;
  /** Its cases that rest on an earlier version of the type sheet (TAX-25). */
  earlierVersionCaseCount: number;
}>;

/** The frozen values of the type's general trend that the caveats read (ALE-12, SEN-29). */
export type CaveatTrend = Readonly<{
  validCount: number;
  playerCount: number;
  profileConfidence: ProfileConfidence;
}>;

/** Whether the player has fewer valid cases than a verdict needs (ALE-12, SEN-31). */
export function isBelowThreshold(profile: CaveatProfile, thresholds: CaveatThresholds): boolean {
  return profile.validCount < thresholds.minValidCases;
}

/** Whether the general trend rests on a small sample (CL-ALE-05), no trend resting on no case. */
export function isSmallTrend(trend: CaveatTrend | null, thresholds: CaveatThresholds): boolean {
  return (
    trend === null ||
    trend.validCount < thresholds.minValidCases ||
    trend.playerCount < thresholds.trendMinPlayers ||
    trend.profileConfidence === 'low'
  );
}

/**
 * Whether a model's detection confidence is below the threshold plus the vigilance margin
 * (H-ALE-06); an owner's classification or rescue, without a confidence, never is (CL-DET-07).
 */
export function isConfidenceNearThreshold(
  detectionConfidence: number | null,
  thresholds: CaveatThresholds,
): boolean {
  return (
    detectionConfidence !== null &&
    detectionConfidence < thresholds.detectionThreshold + thresholds.confidenceVigilanceMargin
  );
}

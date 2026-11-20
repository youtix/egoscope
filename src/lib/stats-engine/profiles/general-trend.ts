// The general trend of an event type (SEN-28 to SEN-30, D-11): the same calculation as a
// profile, over the cases of every followed player together, each case weighing the same
// (Q-SEN-02, settled per case), with the number of distinct players and the share of the
// player who brings the most valid cases. Its verdicts, those of its checks included, also
// need valid cases from sensitivity.trendMinPlayers players, and its profile confidence
// steps down once more when one player brings more than sensitivity.trendMaxTopShare
// percent of them (SEN-29). Its robustness test runs only from that number of players on,
// as it runs only from the valid-case threshold on, and its recomputations leave the
// player rule out (CL-SEN-14): a trend that the player rule alone holds inconclusive is
// never fragile.

import { profileChecks } from './checks';
import { isAbovePercent, profileConfidence, steppedDown } from './confidence';
import { runRobustnessTest } from './robustness';
import { tallyProfile } from './tally';
import { profileVerdict } from './verdict';

import type { EngineParams, PlayerId } from '../types';
import type { ManuallyDecidedCase, ProfileChecks } from './checks';
import type { ConfidenceInputs, ConfidenceValues } from './confidence';
import type { ProfileCase, ProfileTally, TallyExitReason } from './tally';
import type { ProfileVerdict, Verdict } from './verdict';

/** A case of a general trend: a profile's case, with the followed player it belongs to (SEN-28). */
export type TrendCase = ProfileCase & Readonly<{ playerId: PlayerId }>;

/**
 * What the general trend of a type is computed from (SEN-28): its cases, every player's,
 * a withdrawn player's included (H-JOU-07); the reasons of its events that left the tally,
 * one per event (SEN-33); and its cases that a manual decision rules (SEN-17, SEN-27).
 */
export type GeneralTrendInput = Readonly<{
  cases: readonly TrendCase[];
  exitReasons: readonly TallyExitReason[];
  manuallyDecidedCases: readonly ManuallyDecidedCase[];
}>;

/**
 * The values of a general trend (SEN-20, SEN-28, SEN-29): those of a profile, its tally,
 * verdict values, fragility, profile confidence and checks, under the trend's rules; the
 * number of distinct players, those with a valid case; and the valid cases of the player
 * who brings the most, which give the top-contributor share (topContributorShare).
 */
export type GeneralTrendValues = ProfileVerdict &
  ConfidenceValues &
  ProfileChecks &
  Readonly<{
    tally: ProfileTally;
    isFragile: boolean;
    distinctPlayerCount: number;
    topContributorValidCount: number;
  }>;

const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };

/**
 * Computes the top-contributor share of a general trend (SEN-28, SEN-29): the valid cases
 * of the player who brings the most, divided by all its valid cases, exact, never rounded
 * (CL-SEN-21); null without a valid case.
 */
export function topContributorShare(
  topContributorValidCount: number,
  validCount: number,
): number | null {
  return validCount === 0 ? null : topContributorValidCount / validCount;
}

/** How many valid cases each player who has one brings, in no particular order. */
function validCountsByPlayer(cases: readonly TrendCase[]): number[] {
  const validByPlayer = Map.groupBy(
    cases.filter((caseItem) => caseItem.status === 'measured'),
    (caseItem) => caseItem.playerId,
  );
  return Array.from(validByPlayer.values(), (validCases) => validCases.length);
}

/**
 * The verdict values that the trend's rules give these cases (SEN-23, SEN-29): those of a
 * profile, with the verdict inconclusive unless the valid cases come from at least
 * sensitivity.trendMinPlayers distinct players. The checks apply it too.
 */
function trendVerdict(cases: readonly TrendCase[], params: EngineParams): ProfileVerdict {
  const values = profileVerdict(cases, params);
  return validCountsByPlayer(cases).length < params.sensitivity.trendMinPlayers
    ? { ...values, verdict: INCONCLUSIVE }
    : values;
}

/**
 * The profile confidence of a general trend (SEN-25, SEN-29): a profile's, then one level
 * down more, never below low, when the top-contributor share exceeds
 * sensitivity.trendMaxTopShare percent, a reason given after the others.
 */
function trendConfidence(
  inputs: ConfidenceInputs,
  topContributorValidCount: number,
  params: EngineParams,
): ConfidenceValues {
  const values = profileConfidence(inputs, params);
  // Without a valid case, no player brings any.
  const share = topContributorShare(topContributorValidCount, inputs.validCount) ?? 0;
  return isAbovePercent(share, params.sensitivity.trendMaxTopShare)
    ? steppedDown(values, 'dominant_player')
    : values;
}

/**
 * Computes the general trend of a type (SEN-20, SEN-22 to SEN-29, D-11): the tally, the
 * verdict values, the robustness test, the profile confidence and the checks of a profile,
 * over the cases of every player, each case weighing the same, its sums in the fixed order
 * of CL-STA-09 whatever the players, plus the number of distinct players with a valid case
 * and the valid cases of the one who brings the most. The verdict, the control's and the
 * one without manual decisions alike, is inconclusive unless the valid cases come from
 * sensitivity.trendMinPlayers distinct players (CA-SEN-15). Below that number of players,
 * the robustness test does not run, as below the valid-case threshold: nothing is fragile
 * and no confidence level is lost for fragility. From it on, the test recomputes without
 * the player rule (CL-SEN-14). The profile confidence steps down once more when one player
 * brings more than sensitivity.trendMaxTopShare percent of the valid cases.
 */
export function generalTrend(input: GeneralTrendInput, params: EngineParams): GeneralTrendValues {
  const { cases, exitReasons } = input;
  const tally = tallyProfile(cases, exitReasons);
  const verdictValues = trendVerdict(cases, params);
  const validCounts = validCountsByPlayer(cases);
  const isFragile =
    validCounts.length >= params.sensitivity.trendMinPlayers &&
    runRobustnessTest(cases, verdictValues.verdict, params).isFragile;
  const topContributorValidCount = Math.max(0, ...validCounts);
  const confidenceInputs: ConfidenceInputs = {
    validCount: tally.validCount,
    excludedCount: tally.excludedCount,
    gapDispersion: verdictValues.quantities?.gapDispersion ?? null,
    isFragile,
  };
  return {
    tally,
    ...verdictValues,
    isFragile,
    ...trendConfidence(confidenceInputs, topContributorValidCount, params),
    ...profileChecks(input, params, trendVerdict),
    distinctPlayerCount: validCounts.length,
    topContributorValidCount,
  };
}

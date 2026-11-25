// One view of a player's profile (SEN-20 to SEN-27, SEN-31, CL-SEN-19), as generalTrend
// gives one of a general trend: its values computed on the view's own cases, its valid
// cases of each origin, and the threshold of valid cases that its verdict applied.

import { profileChecks } from './checks';
import { profileConfidence } from './confidence';
import { validCountOf } from './evaluate-trend';
import { runRobustnessTest } from './robustness';
import { tallyProfile } from './tally';
import { profileVerdict } from './verdict';

import type { EngineParams } from '../types';
import type { ManuallyDecidedCase, ProfileChecks } from './checks';
import type { ConfidenceValues } from './confidence';
import type { OriginCase } from './evaluate-cases';
import type { ProfileView } from './evaluate-trend';
import type { ProfileTally, TallyExitReason } from './tally';
import type { ProfileVerdict } from './verdict';

/**
 * One view of a profile (SEN-20 to SEN-27, SEN-31, CL-SEN-19): its tally, verdict values,
 * fragility, profile confidence and checks, its valid cases of each origin (SEN-21), and
 * the threshold of valid cases that its verdict applied, the parameter in force at this
 * calculation.
 */
export type ProfileViewValues = ProfileVerdict &
  ConfidenceValues &
  ProfileChecks &
  Readonly<{ view: ProfileView; tally: ProfileTally; isFragile: boolean }> &
  Readonly<{ historicalValidCount: number; trackedValidCount: number }> &
  Readonly<{ validCaseThreshold: number }>;

/**
 * What one view of a profile is computed from (SEN-21, CL-SEN-19): the view, its cases,
 * those of its origins, the reasons of its events that left the tally, and the player's
 * cases of the type that a manual decision rules (SEN-17, SEN-27).
 */
type ProfileViewInput = Readonly<{
  view: ProfileView;
  cases: readonly OriginCase[];
  exitReasons: readonly TallyExitReason[];
  manuallyDecidedCases: readonly ManuallyDecidedCase[];
}>;

/**
 * Computes one view of a profile (SEN-20 to SEN-27, SEN-31, CL-SEN-19): its tally,
 * verdict values, robustness test, profile confidence and checks, each computed on the
 * view's own cases; its valid cases of each origin, which make its valid cases (SEN-21);
 * and the threshold of valid cases in force at this calculation, the one its verdict and
 * robustness test applied.
 */
export function profileViewValues(
  input: ProfileViewInput,
  params: EngineParams,
): ProfileViewValues {
  const { view, cases, exitReasons, manuallyDecidedCases } = input;
  const tally = tallyProfile(cases, exitReasons);
  const verdictValues = profileVerdict(cases, params);
  const { isFragile } = runRobustnessTest(cases, verdictValues.verdict, params);
  const confidenceInputs = {
    validCount: tally.validCount,
    excludedCount: tally.excludedCount,
    gapDispersion: verdictValues.quantities?.gapDispersion ?? null,
    isFragile,
  };
  return {
    view,
    tally,
    ...verdictValues,
    isFragile,
    ...profileConfidence(confidenceInputs, params),
    ...profileChecks({ cases, manuallyDecidedCases }, params),
    historicalValidCount: validCountOf(cases, 'historical'),
    trackedValidCount: validCountOf(cases, 'tracked'),
    validCaseThreshold: params.sensitivity.minValidCases,
  };
}

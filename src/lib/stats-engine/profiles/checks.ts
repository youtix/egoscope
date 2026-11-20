// The two checks shown beside a profile's verdict, which never replace it (SEN-27,
// H-SEN-12): the control mean gap, over the valid cases and the excluded ones, with the
// verdict it would give; and the warning "verdict depends on manual exclusions", when
// undoing every manual decision of the profile would change its level or its direction.

import { isSameVerdict } from './robustness';
import { profileVerdict } from './verdict';

import type { CaseId, EngineParams } from '../types';
import type { ProfileCase } from './tally';
import type { Verdict, VerdictQuantities } from './verdict';

type GapCase = Extract<ProfileCase, { status: 'excluded' | 'measured' }>;
type ValidCase = Extract<ProfileCase, { status: 'measured' }>;

/**
 * A case of the profile that a manual decision rules (SEN-17), with the status it would
 * have without that decision: the one its automatic criteria give it, measured when none
 * holds and excluded otherwise. The profile's cases carry the status that the decision
 * gives them, which is the other one unless the criteria agree with the decision.
 */
export type ManuallyDecidedCase = Readonly<{
  caseId: CaseId;
  statusWithoutDecision: GapCase['status'];
}>;

/**
 * The checks of a profile (SEN-27): the number of control cases, the valid ones and the
 * excluded ones; their quantities, among them the control mean gap, null without such a
 * case; the verdict they would give; and whether the verdict depends on manual exclusions.
 */
export type ProfileChecks = Readonly<{
  controlCaseCount: number;
  controlQuantities: VerdictQuantities | null;
  controlVerdict: Verdict;
  dependsOnManualExclusions: boolean;
}>;

/** The case as a valid one, as the control and the profile without manual decisions count it. */
function countedValid({
  caseId,
  events,
  isCoOccurring,
  measuredGameScheduledStartAt,
  normalizedGap,
  gapStatus,
}: GapCase): ValidCase {
  return {
    caseId,
    events,
    isCoOccurring,
    status: 'measured',
    measuredGameScheduledStartAt,
    normalizedGap,
    gapStatus,
  };
}

/**
 * Computes the checks of a profile (SEN-27, H-SEN-12), which never replace its verdict.
 * The control takes the valid cases and the excluded ones, every excluded case having its
 * gap (SEN-10), never an awaiting or a not-measurable case (CL-SEN-08), and gives the
 * verdict that SEN-23 would give them as valid cases, the valid-case threshold included,
 * its sums in the fixed order of CL-STA-09. The verdict depends on manual exclusions when
 * undoing every manual decision of the profile, the reinstatements as well, would change
 * its level or its direction: each case of `manuallyDecidedCases` then takes its status
 * without the decision, and every other case keeps its own.
 */
export function profileChecks(
  cases: readonly ProfileCase[],
  manuallyDecidedCases: readonly ManuallyDecidedCase[],
  params: EngineParams,
): ProfileChecks {
  const gapCases = cases.filter(
    (caseItem) => caseItem.status === 'measured' || caseItem.status === 'excluded',
  );
  const control = profileVerdict(
    gapCases.map((caseItem) => countedValid(caseItem)),
    params,
  );
  const statusesWithoutDecision = new Map(
    manuallyDecidedCases.map(
      ({ caseId, statusWithoutDecision }) => [caseId, statusWithoutDecision] as const,
    ),
  );
  const validWithoutDecisions = gapCases.filter(
    (caseItem) => (statusesWithoutDecision.get(caseItem.caseId) ?? caseItem.status) === 'measured',
  );
  return {
    controlCaseCount: gapCases.length,
    controlQuantities: control.quantities,
    controlVerdict: control.verdict,
    dependsOnManualExclusions: !isSameVerdict(
      profileVerdict(cases, params).verdict,
      profileVerdict(
        validWithoutDecisions.map((caseItem) => countedValid(caseItem)),
        params,
      ).verdict,
    ),
  };
}

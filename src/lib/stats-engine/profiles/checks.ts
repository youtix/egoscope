// The two checks shown beside a profile's verdict, which never replace it (SEN-27,
// H-SEN-12): the control mean gap, over the valid cases and the excluded ones, with the
// verdict it would give; and the warning "verdict depends on manual exclusions", when
// undoing every manual decision of the profile would change its level or its direction.
// A general trend shows the same checks under its own verdict rule (SEN-29).

import { isSameVerdict } from './robustness';
import { profileVerdict } from './verdict';

import type { CaseId, EngineParams } from '../types';
import type { ProfileCase } from './tally';
import type { ProfileVerdict, Verdict, VerdictQuantities } from './verdict';

type GapCase = Extract<ProfileCase, { status: 'excluded' | 'measured' }>;

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
 * What the checks of a profile or a general trend are computed from (SEN-27): its cases,
 * with the statuses that the manual decisions give them, and its cases that a manual
 * decision rules (SEN-17).
 */
type ChecksInput<C extends ProfileCase> = Readonly<{
  cases: readonly C[];
  manuallyDecidedCases: readonly ManuallyDecidedCase[];
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

/** The verdict values that a rule gives a set of cases: a profile's or a general trend's. */
type VerdictRule<C extends ProfileCase> = (
  cases: readonly C[],
  params: EngineParams,
) => ProfileVerdict;

/**
 * The case as a valid one, as the control and the profile without manual decisions count
 * it: measured, with its gap and its other values as they are, such as the player of a
 * trend's case, which a trend's rule reads. An excluded case keeps its criteria, which no
 * verdict reads.
 */
function countedValid<C extends ProfileCase>(caseItem: C & GapCase): C {
  return { ...caseItem, status: 'measured' };
}

/**
 * Computes the checks of a profile (SEN-27, H-SEN-12), which never replace its verdict.
 * The control takes the valid cases and the excluded ones, every excluded case having its
 * gap (SEN-10), never an awaiting or a not-measurable case (CL-SEN-08), and gives the
 * verdict that the rule would give them as valid cases, its sums in the fixed order of
 * CL-STA-09. The verdict depends on manual exclusions when undoing every manual decision
 * of the profile, the reinstatements as well, would change its level or its direction:
 * each case of `manuallyDecidedCases` then takes its status without the decision, and
 * every other case keeps its own. The rule is a profile's, profileVerdict, the valid-case
 * threshold of SEN-23 included, unless a general trend passes its own, which needs valid
 * cases from sensitivity.trendMinPlayers players too (SEN-29).
 */
export function profileChecks<C extends ProfileCase>(
  { cases, manuallyDecidedCases }: ChecksInput<C>,
  params: EngineParams,
  verdictOf: VerdictRule<C> = profileVerdict,
): ProfileChecks {
  const gapCases = cases.filter(
    (caseItem): caseItem is C & GapCase =>
      caseItem.status === 'measured' || caseItem.status === 'excluded',
  );
  const control = verdictOf(
    gapCases.map((caseItem) => countedValid(caseItem)),
    params,
  );
  const statusesWithoutDecision = new Map<CaseId, GapCase['status']>(
    manuallyDecidedCases.map(({ caseId, statusWithoutDecision }) => [
      caseId,
      statusWithoutDecision,
    ]),
  );
  const validWithoutDecisions = gapCases.filter(
    (caseItem) => (statusesWithoutDecision.get(caseItem.caseId) ?? caseItem.status) === 'measured',
  );
  return {
    controlCaseCount: gapCases.length,
    controlQuantities: control.quantities,
    controlVerdict: control.verdict,
    dependsOnManualExclusions: !isSameVerdict(
      verdictOf(cases, params).verdict,
      verdictOf(
        validWithoutDecisions.map((caseItem) => countedValid(caseItem)),
        params,
      ).verdict,
    ),
  };
}

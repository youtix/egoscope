// The effect of the owner's manual decisions on a case (SEN-17, CL-SEN-12). A decision
// belongs to the measured game it was made on: the latest one made on the case's
// measured game prevails over the automatic criteria, an exclusion making the case
// excluded and a reinstatement making it measured, through every recalculation and
// parameter change that keeps that game. A decision made on another game stops applying
// and stays in the case's history, where it applies again if the case comes back to its
// game. The decision form, its closed reason lists and the history are the sensitivity
// module's.

import type { EpochMs, GameId } from '../types';
import type { CaseStatus } from './case-state';

/**
 * A manual decision as the engine reads it (SEN-17, CL-SEN-12): its id, which orders two
 * decisions of one instant; its kind, the exclusion of a measured case or the
 * reinstatement of an excluded one; its instant; and the measured game it was made on.
 */
export type ManualDecision = Readonly<{
  id: number;
  kind: 'exclude' | 'reinstate';
  decidedAt: EpochMs;
  measuredGameId: GameId;
}>;

/**
 * A case as its manual decisions read it: the status that its automatic rules give it
 * (CL-SEN-05), and its measured game, null when its walk reached none.
 */
export type DecidableCase = Readonly<{ status: CaseStatus; measuredGameId: GameId | null }>;

/**
 * The case once its manual decisions apply (SEN-17): its status, and the decision that
 * rules it, null when none does.
 */
export type DecidedCase<D extends ManualDecision> = Readonly<{
  status: CaseStatus;
  decision: D | null;
}>;

// The status that each kind of decision gives a case whose gap is computed (SEN-17).
const DECIDED_STATUS: Readonly<Record<ManualDecision['kind'], 'excluded' | 'measured'>> = {
  exclude: 'excluded',
  reinstate: 'measured',
};

/** By instant, then by id. */
function inDecisionOrder(left: ManualDecision, right: ManualDecision): number {
  const byInstant = left.decidedAt - right.decidedAt;
  return byInstant === 0 ? left.id - right.id : byInstant;
}

/**
 * The latest of `decisions`, whatever their order (SEN-17, CL-SEN-12): by instant, of
 * two at one instant the one of the greater id; null without any.
 */
export function latestDecision<D extends ManualDecision>(decisions: readonly D[]): D | null {
  return decisions.toSorted(inDecisionOrder).at(-1) ?? null;
}

/**
 * The decision that rules a case on its measured game `measuredGameId` (SEN-17,
 * CL-SEN-12): the latest of its `decisions` made on that game, whatever was decided on
 * another game since; null when none was, as for a case whose walk reached no game. It
 * reads no status, while applyManualDecisions returns no decision for a case awaiting its
 * game or not measurable: a page shows the decision in force from applyManualDecisions'
 * result.
 */
export function effectiveDecision<D extends ManualDecision>(
  decisions: readonly D[],
  measuredGameId: GameId | null,
): D | null {
  return latestDecision(decisions.filter((decision) => decision.measuredGameId === measuredGameId));
}

/**
 * Applies the manual `decisions` of a case to the status that its automatic rules give
 * it (SEN-17, CL-SEN-12). A decision rules only a case whose gap is computed, measured or
 * excluded: its effective decision, the latest made on its measured game, prevails over
 * the automatic criteria, an exclusion making it excluded and a reinstatement making it
 * measured, whatever the criteria say after a recalculation or a parameter change. A
 * case awaiting its game or not measurable keeps its status, and a decision made on
 * another game rules nothing.
 */
export function applyManualDecisions<D extends ManualDecision>(
  caseItem: DecidableCase,
  decisions: readonly D[],
): DecidedCase<D> {
  const { status, measuredGameId } = caseItem;
  const decision =
    status === 'measured' || status === 'excluded'
      ? effectiveDecision(decisions, measuredGameId)
      : null;
  return { status: decision === null ? status : DECIDED_STATUS[decision.kind], decision };
}

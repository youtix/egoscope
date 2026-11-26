// The owner's decisions that touch a tracked case, as the validation table reads them (SUI-16,
// SUI-17, CL-DET-09, CL-DET-15, CL-SUI-10). Every decision is stored with its effect whatever
// its position; whether it came after tip-off is derived on each read, against the measured
// game once established, else the expected game, else "before", so that a later-established
// game reclassifies it. A case whose latest decision came after tip-off is touched: it tests
// nothing and shows once, by the effect of that decision. A case all of whose events are
// dismissed leaves every calculation: it shows nowhere when the dismissal that left none of
// them came before tip-off, and only among the cases now out of the counts otherwise. A
// parameter change is no decision (CL-SUI-04).

import { valuesOf } from '../cases/case-state';
import { isDetectedAfterTipOff } from '../measured-game/late-detection';

import type { EpochMs } from '../types';

// The glossary's effects, in its order, which is also the precedence of two decisions taken
// at the same instant: an exit, then an entry, then a measured-game change.
const POST_TIP_OFF_DECISION_EFFECTS = valuesOf(['exit', 'entry', 'measured_game_change']);

/**
 * The effect of a tracked-case decision (SUI-17, CL-SUI-10), the glossary's
 * `PostTipOffDecisionEffect`: the case left the counts, entered them, or changed its measured
 * game.
 */
export type PostTipOffDecisionEffect = (typeof POST_TIP_OFF_DECISION_EFFECTS)[number];

/** A decision recorded on a tracked case (SUI-17): its effect and its instant. */
export type TrackedCaseDecision = Readonly<{
  effect: PostTipOffDecisionEffect;
  decidedAt: EpochMs;
}>;

/**
 * The games a decision's position is derived against (CL-DET-15, CL-SUI-13): the last known
 * scheduled start of the case's measured game, null until one is established, and of its
 * expected game, null while none is known.
 */
export type TipOffGames = Readonly<{
  measuredGameStartAt: EpochMs | null;
  expectedGameStartAt: EpochMs | null;
}>;

/**
 * What the table reads of a tracked case's decisions (SUI-16, SUI-17, CL-DET-09): its games,
 * its decisions in any order, and, when all of its events are dismissed, the instant of the
 * dismissal that left none of them undismissed, null while one of them is not dismissed.
 */
export type DecisionStandingInput = TipOffGames &
  Readonly<{
    decisions: readonly TrackedCaseDecision[];
    allEventsDismissedAt: EpochMs | null;
  }>;

/**
 * Where the owner's decisions leave a tracked case in the validation table (SUI-16, SUI-17,
 * CL-SUI-10): `untouched`, it counts by its own situation; `removed`, it shows nowhere; or the
 * effect under which it shows among the post-tip-off counts.
 */
export type DecisionStanding = 'untouched' | 'removed' | PostTipOffDecisionEffect;

/**
 * Whether an instant is after tip-off (SUI-17, CL-DET-15, CL-SUI-13): at or after the
 * scheduled start of the measured game once established, otherwise of the expected game; with
 * neither known, it is before. The rule is that of the "detected after tip-off" mark.
 */
export function isPostTipOff(instant: EpochMs, games: TipOffGames): boolean {
  return isDetectedAfterTipOff({
    createdAt: instant,
    measuredGameStartAt: games.measuredGameStartAt,
    expectedGameStartAt: games.expectedGameStartAt,
  });
}

/**
 * Gives where the owner's decisions leave a tracked case (SUI-16, SUI-17, CL-DET-09,
 * CL-DET-15, CL-SUI-10). A case all of whose events are dismissed is `removed` when the
 * dismissal that left none of them came before tip-off, and an `exit` when it came at or
 * after it, whatever its other decisions. Otherwise the case is touched when its latest
 * decision is after tip-off, which it is as soon as one of its decisions is, and stands by
 * that decision's effect, `exit`, `entry` or `measured_game_change`; of two decisions at the
 * same instant, an exit counts as the later, then an entry. A case with no decision after
 * tip-off is `untouched`, so that dismissing or reinstating one event of a case that keeps
 * another counts apart only through the decision recorded for it.
 */
export function decisionStanding(input: DecisionStandingInput): DecisionStanding {
  if (input.allEventsDismissedAt !== null) {
    return isPostTipOff(input.allEventsDismissedAt, input) ? 'exit' : 'removed';
  }
  const afterTipOff = input.decisions.filter((decision) => isPostTipOff(decision.decidedAt, input));
  const latestAt = Math.max(...afterTipOff.map((decision) => decision.decidedAt));
  const latestEffect = POST_TIP_OFF_DECISION_EFFECTS.find((effect) =>
    afterTipOff.some((decision) => decision.decidedAt === latestAt && decision.effect === effect),
  );
  return latestEffect ?? 'untouched';
}

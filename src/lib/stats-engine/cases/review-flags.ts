// The review flags of a case (SEN-16, CL-SEN-11, CL-SEN-12): situations shown to the
// owner on the case and in the to-do list, which exclude nothing, since no rule of a
// case's state reads them. The first game he played for a team other than his previous
// game's; an ejection, only when the source reports one, never inferred; and a manual
// decision made on another measured game than the case's. Storing a flag with the game it
// is about, and its acknowledgment, are the sensitivity module's.

import { latestDecision } from './manual-decisions';
import { byScheduledStart } from '../schedule/series';

import type { TeamGame } from '../schedule/team-membership';
import type { GameId } from '../types';
import type { ManualDecision } from './manual-decisions';

/** A review flag (SEN-16, CL-SEN-11, CL-SEN-12), as it is stored, in the glossary's order. */
export type ReviewFlag = 'first_game_with_new_team' | 'ejection' | 'manual_decision_to_review';

/**
 * What the review flags of a case read: its measured game, the game its walk stopped at,
 * null when it reached none, with whether the source reports him ejected from that game,
 * null when it does not say, which the chosen source never does (CL-SEN-11); his team
 * games, from teamGames, in any order; and the case's manual decisions, in any order.
 */
export type ReviewFlagInput = Readonly<{
  measuredGame: Readonly<{ id: GameId; ejected: boolean | null }> | null;
  teamGames: readonly TeamGame[];
  decisions: readonly ManualDecision[];
}>;

/**
 * Whether the measured game is the first game he played for a team other than the team
 * of his previous game played, whatever the season (CL-SEN-11, CL-STA-05), in the fixed
 * order of scheduled start, then id (CL-STA-09). A game he did not play, or has not
 * played yet, is no game played.
 */
function isFirstGameWithNewTeam(measuredGameId: GameId, teamGames: readonly TeamGame[]): boolean {
  const played = teamGames
    .filter(({ participation }) => participation === 'played')
    .toSorted((left, right) => byScheduledStart(left.game, right.game));
  const measured = played.find(({ game }) => game.id === measuredGameId);
  if (measured === undefined) {
    return false;
  }
  const previous = played.findLast(({ game }) => byScheduledStart(game, measured.game) < 0);
  return previous !== undefined && previous.teamId !== measured.teamId;
}

/**
 * Whether the latest manual decision of the case was made on another measured game than
 * its own (CL-SEN-12): it stopped applying when the measured game changed, and the owner
 * has not decided again on the new game.
 */
function isDecisionToReview(measuredGameId: GameId, decisions: readonly ManualDecision[]): boolean {
  const latest = latestDecision(decisions);
  return latest !== null && latest.measuredGameId !== measuredGameId;
}

/**
 * The review flags of a case, in the glossary's order (SEN-16, CL-SEN-11, CL-SEN-12):
 * "first game with a new team" when its measured game is the first game he played for a
 * team other than his previous game's, whatever the season; "ejection" only when the
 * source reports him ejected from that game, never inferred, and nothing when it says he
 * was not or does not say; "manual decision to review" when the latest manual decision
 * was made on another measured game. A case whose walk reached no game has none. No flag
 * changes the state of the case.
 */
export function caseReviewFlags(input: ReviewFlagInput): readonly ReviewFlag[] {
  const { measuredGame, teamGames, decisions } = input;
  if (measuredGame === null) {
    return [];
  }
  const flags: readonly Readonly<{ flag: ReviewFlag; holds: boolean }>[] = [
    {
      flag: 'first_game_with_new_team',
      holds: isFirstGameWithNewTeam(measuredGame.id, teamGames),
    },
    { flag: 'ejection', holds: measuredGame.ejected === true },
    { flag: 'manual_decision_to_review', holds: isDecisionToReview(measuredGame.id, decisions) },
  ];
  return flags.filter(({ holds }) => holds).map(({ flag }) => flag);
}

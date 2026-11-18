/**
 * The twelve box-score totals of one player in one game that Hollinger's Game
 * Score needs (STA-08). Field goals count every shot from the field, two- and
 * three-pointers alike, and exclude free throws. Minutes are not part of the
 * score: they turn it into the performance index (STA-12).
 */
export type GameScoreInput = Readonly<{
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  steals: number;
  assists: number;
  blocks: number;
  personalFouls: number;
  turnovers: number;
}>;

// Weights of the formula in H-13; points, steals and turnovers weigh exactly 1.
const FIELD_GOAL_MADE_WEIGHT = 0.4;
const FIELD_GOAL_ATTEMPT_WEIGHT = 0.7;
const MISSED_FREE_THROW_WEIGHT = 0.4;
const OFFENSIVE_REBOUND_WEIGHT = 0.7;
const DEFENSIVE_REBOUND_WEIGHT = 0.3;
const ASSIST_WEIGHT = 0.7;
const BLOCK_WEIGHT = 0.7;
const PERSONAL_FOUL_WEIGHT = 0.4;

/**
 * Computes Hollinger's Game Score of one game (STA-11, H-13), without rounding
 * (STA-12): points + 0.4 × field goals made − 0.7 × field goals attempted
 * − 0.4 × missed free throws + 0.7 × offensive rebounds + 0.3 × defensive
 * rebounds + steals + 0.7 × assists + 0.7 × blocks − 0.4 × personal fouls
 * − turnovers. The sheet must already be complete and checked (STA-09,
 * STA-10): this function validates nothing. A zero or negative score is valid.
 */
export function gameScore(line: GameScoreInput): number {
  const missedFreeThrows = line.freeThrowsAttempted - line.freeThrowsMade;
  return (
    line.points +
    FIELD_GOAL_MADE_WEIGHT * line.fieldGoalsMade -
    FIELD_GOAL_ATTEMPT_WEIGHT * line.fieldGoalsAttempted -
    MISSED_FREE_THROW_WEIGHT * missedFreeThrows +
    OFFENSIVE_REBOUND_WEIGHT * line.offensiveRebounds +
    DEFENSIVE_REBOUND_WEIGHT * line.defensiveRebounds +
    line.steals +
    ASSIST_WEIGHT * line.assists +
    BLOCK_WEIGHT * line.blocks -
    PERSONAL_FOUL_WEIGHT * line.personalFouls -
    line.turnovers
  );
}

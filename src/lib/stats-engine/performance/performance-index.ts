import { gameScore } from './game-score';

import type { CheckedBoxScore } from './box-score';

/**
 * The performance index of a game (STA-12, H-13): its Game Score divided by the decimal
 * minutes he played, without rounding, so a negative index is kept as it is; screens
 * round it to three decimals. Only a box score that verifyBoxScore found complete and
 * consistent has one (STA-09, STA-10): any other line does not compile here.
 */
export function performanceIndex(boxScore: CheckedBoxScore): number {
  return gameScore(boxScore) / boxScore.decimalMinutes;
}

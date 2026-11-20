import { countsOf } from './box-score';

import type { BoxScoreLine } from './box-score';

/** Whether a player played one of his team's final official games (STA-13, CL-STA-04). */
export type Participation = 'played' | 'not_played' | 'unknown';

function hasPlayed(line: BoxScoreLine): boolean {
  // An unknown time is not above zero.
  const isOnCourt = [line.minutes, line.seconds].some((value) => (value ?? 0) > 0);
  return isOnCourt || countsOf(line).some((value) => value !== null && value !== 0);
}

/**
 * The participation of a player in a final official game of his team (STA-13,
 * CL-STA-04, CL-STA-06): played when his line shows a time on court above zero, or any
 * count other than zero whatever its minutes; otherwise not played once the source has
 * published his team's lines, whether he has a did-not-play line, no line, or zero
 * minutes and nothing else; unknown while it has not. No cause of absence is read.
 */
export function participationOf(
  line: BoxScoreLine | null,
  areTeamLinesPublished: boolean,
): Participation {
  if (line !== null && hasPlayed(line)) {
    return 'played';
  }
  return areTeamLinesPublished ? 'not_played' : 'unknown';
}

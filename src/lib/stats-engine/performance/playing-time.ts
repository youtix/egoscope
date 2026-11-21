// The playing-time threshold of a player's season and the class of each of his games
// (STA-13 to STA-15): one threshold per player and season, which the baselines and the
// measured game share (CL-STA-07).

import { SECONDS_PER_MINUTE } from './box-score';

import type { EngineParams, EpochMs, GameId } from '../types';
import type { BoxScoreCheck } from './box-score';

// games.minutesAverageShare is a percentage.
const PERCENT = 100;

/**
 * One of a player's team games of a season whose lines the source has published
 * (CL-STA-04, CL-STA-05): `boxScore` is the check of his line when he played, null when
 * he did not. A game of unknown participation has no box score, so it is none of these.
 */
export type PlayerGame = Readonly<{
  gameId: GameId;
  scheduledStartAt: EpochMs;
  phase: 'regular_season' | 'play_in' | 'playoffs';
  boxScore: BoxScoreCheck | null;
}>;

/** The class of a game for the baselines and the measured game (STA-13, STA-14). */
export type GamePlayClassification = 'not_played' | 'played_not_usable' | 'usable';

/** His whole seconds on court in a game of the average (CL-STA-07), or null outside it. */
function averagedSeconds(game: PlayerGame): number | null {
  const { boxScore } = game;
  return boxScore !== null && game.phase === 'regular_season' && boxScore.status !== 'suspect'
    ? boxScore.secondsOnCourt
    : null;
}

/**
 * The playing-time threshold of a player's season (STA-14, STA-15, CL-STA-06, CL-STA-07,
 * CL-STA-09): the larger of games.minutesFloor and games.minutesAverageShare percent of
 * his mean minutes over the regular-season games he played with a time on court above
 * zero and a box score that is not suspect, incomplete ones included; the floor alone
 * without such a game. `games` are his team games of that season, the measured game
 * among them, since one threshold serves every game of the season. The mean comes from
 * whole seconds, whole minutes counting as they are: the seconds add up exactly, in any
 * order, and the share multiplies their sum before the one division by 100 × 60 × the
 * games, so a whole share gives the exact quotient rounded once. A game's decimal minutes
 * are its seconds divided by 60 once (verifyBoxScore), so a game at exactly the threshold
 * reaches it: 17 whole minutes reach a threshold of exactly 17, and 15 min 4 s beside
 * 45 min 12 s reach half their mean.
 */
export function playingTimeThreshold(games: readonly PlayerGame[], params: EngineParams): number {
  const { minutesFloor, minutesAverageShare } = params.games;
  const seconds = games.map((game) => averagedSeconds(game)).filter((value) => value !== null);
  if (seconds.length === 0) {
    return minutesFloor;
  }
  const totalSeconds = seconds.reduce((total, value) => total + value, 0);
  return Math.max(
    minutesFloor,
    (minutesAverageShare * totalSeconds) / (PERCENT * SECONDS_PER_MINUTE * seconds.length),
  );
}

/**
 * The class of one of a player's games with the threshold of its season (STA-13 to
 * STA-15, CL-STA-06): not played when he has no played line; usable when his box score
 * is complete and consistent and his minutes reach the threshold, whole minutes as they
 * are, so 15 reach a 15-minute floor; played but not usable otherwise.
 */
export function classifyGame(game: PlayerGame, threshold: number): GamePlayClassification {
  const { boxScore } = game;
  if (boxScore === null) {
    return 'not_played';
  }
  return boxScore.status === 'complete' && boxScore.decimalMinutes >= threshold
    ? 'usable'
    : 'played_not_usable';
}

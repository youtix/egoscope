// The playing-time threshold of a player's season and the class of each of his games
// (STA-13 to STA-15): one threshold per player and season, which the baselines and the
// measured game share (CL-STA-07).

import type { BoxScoreCheck } from './box-score';
import type { EngineParams, EpochMs, GameId } from '../types';

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

/** His minutes in a game of the average (CL-STA-07), or null for a game outside it. */
function averagedMinutes(game: PlayerGame): number | null {
  const { boxScore } = game;
  return boxScore !== null && game.phase === 'regular_season' && boxScore.status !== 'suspect'
    ? boxScore.decimalMinutes
    : null;
}

/** Scheduled start, then game id: the fixed order of every sum (CL-STA-09). */
function inFixedOrder(left: PlayerGame, right: PlayerGame): number {
  return left.scheduledStartAt === right.scheduledStartAt
    ? left.gameId - right.gameId
    : left.scheduledStartAt - right.scheduledStartAt;
}

/**
 * The playing-time threshold of a player's season (STA-14, STA-15, CL-STA-06, CL-STA-07,
 * CL-STA-09): the larger of games.minutesFloor and games.minutesAverageShare percent of
 * his mean minutes over the regular-season games he played with a time on court above
 * zero and a box score that is not suspect, incomplete ones included; the floor alone
 * without such a game. `games` are his team games of that season, the measured game
 * among them, since one threshold serves every game of the season. Whole minutes count
 * as they are, and the minutes add up by scheduled start, then game id.
 */
export function playingTimeThreshold(games: readonly PlayerGame[], params: EngineParams): number {
  const { minutesFloor, minutesAverageShare } = params.games;
  const minutes = games
    .toSorted((left, right) => inFixedOrder(left, right))
    .map((game) => averagedMinutes(game))
    .filter((value) => value !== null);
  if (minutes.length === 0) {
    return minutesFloor;
  }
  let sum = 0;
  for (const value of minutes) {
    sum += value;
  }
  return Math.max(minutesFloor, (minutesAverageShare / PERCENT) * (sum / minutes.length));
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

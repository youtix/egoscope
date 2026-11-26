// A team's win-loss record (STA-06), counted from the final regular-season scores of the
// stored schedule and never from the record columns of the source's rows, which give the
// record on the day the file was written (CL-STA-19). The games that never count, the
// All-Star games and the NBA Cup final, are dropped at ingestion and never reach the
// core (CL-STA-16). The other rules of the part read games through the helpers of this
// file, and the game types of the shared types.

import type { GameId, ScheduleGame, TeamId } from '../types';

/** A team's wins and losses over one season's regular season (STA-06). */
export type TeamWinLossRecord = Readonly<{ wins: number; losses: number }>;

/**
 * Whether `teamId` plays `game`, at home or away; a placeholder whose teams are still to
 * be determined is no team's game (STA-05, CL-STA-14).
 */
export function hasTeam(game: ScheduleGame, teamId: TeamId): boolean {
  return game.homeTeamId === teamId || game.awayTeamId === teamId;
}

/**
 * The team that won `game`, read from its final score, or null when the game has no
 * result: it is not final, its score is missing, or the score is level, which no NBA
 * game ends on (STA-05, CL-STA-19).
 */
export function winnerOf(game: ScheduleGame): TeamId | null {
  const score = game.finalScore;
  if (score === null || game.status !== 'final') {
    return null;
  }
  if (score.home > score.away) {
    return game.homeTeamId;
  }
  return score.away > score.home ? game.awayTeamId : null;
}

/**
 * The regular-season record of `teamId` in `games`, one season's stored schedule
 * (STA-06): the wins and losses of its final regular-season games with a result, the
 * excluded game, such as the measured game whose opponent SEN-15 judges, left out. A game
 * listed without a result counts neither way, and nothing but the scores is read
 * (CL-STA-19).
 */
export function teamRecord(
  games: readonly ScheduleGame[],
  teamId: TeamId,
  excludedGameId?: GameId,
): TeamWinLossRecord {
  const winners = games
    .filter(
      (game) =>
        game.phase === 'regular_season' && game.id !== excludedGameId && hasTeam(game, teamId),
    )
    .map((game) => winnerOf(game))
    .filter((winner) => winner !== null);
  const wins = winners.filter((winner) => winner === teamId).length;
  return { wins, losses: winners.length - wins };
}

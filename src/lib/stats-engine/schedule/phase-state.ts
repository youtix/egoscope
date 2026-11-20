// Whether a phase is finished, and whether its last game is past its correction window
// (STA-20, CL-STA-02): what a season baseline needs to tell building from insufficient
// and provisional from final. The regular season finishes league-wide; the postseason
// finishes for each team.

import { byScheduledStart, isCounted, playInLoserEliminated } from './series';
import { hasTeam, winnerOf } from './team-record';

import type { EpochMs, TeamId } from '../types';
import type { RebuiltSeries } from './series';
import type { ScheduleGame } from './team-record';

/**
 * A game of the stored schedule with its scheduled start and the instant it was
 * consolidated, null while it is in its correction window (STA-33).
 */
export type PhaseGame = ScheduleGame &
  Readonly<{ scheduledStartAt: EpochMs; consolidatedAt: EpochMs | null }>;

/** A series of the season, as the rebuild gives it or as it is stored (CL-STA-18). */
export type PhaseSeries = Pick<
  RebuiltSeries,
  'phase' | 'round' | 'teamAId' | 'teamBId' | 'winsNeeded'
>;

/**
 * One season's stored schedule: its games of every phase, its series, and whether a game
 * of a later season is stored, which tells that the season is over (CL-STA-18).
 */
export type SeasonSchedule = Readonly<{
  games: readonly PhaseGame[];
  series: readonly PhaseSeries[];
  hasLaterSeasonGame: boolean;
}>;

/**
 * The phase asked about: the regular season, league-wide, at an instant; or the
 * postseason of one team (CL-STA-02).
 */
export type PhaseOf =
  | Readonly<{ phase: 'postseason'; teamId: TeamId }>
  | Readonly<{ phase: 'regular_season'; at: EpochMs }>;

/**
 * Whether a phase is finished and, once it is, whether its last game is consolidated,
 * its correction window over (STA-20, STA-33).
 */
export type PhaseState = Readonly<{ finished: boolean; lastGameConsolidated: boolean }>;

/** The state of a phase made of `games`, whose last final game is the phase's last game. */
function stateOf(isFinished: boolean, games: readonly PhaseGame[]): PhaseState {
  const lastGame = games
    .filter((game) => game.status === 'final')
    .toSorted(byScheduledStart)
    .at(-1);
  return {
    finished: isFinished,
    lastGameConsolidated: isFinished && lastGame !== undefined && lastGame.consolidatedAt !== null,
  };
}

function regularSeasonState(games: readonly PhaseGame[], at: EpochMs): PhaseState {
  const regularSeason = games.filter((game) => game.phase === 'regular_season');
  const postseasonStart = Math.min(
    ...games
      .filter((game) => game.phase !== 'regular_season' && isCounted(game))
      .map((game) => game.scheduledStartAt),
  );
  const hasGames = regularSeason.length > 0;
  const hasOpenGame = regularSeason.some(
    (game) => game.status !== 'final' && game.status !== 'canceled',
  );
  return stateOf((hasGames && !hasOpenGame) || at >= postseasonStart, regularSeason);
}

/** The games of `series`: those of its phase between its two teams. */
function gamesOf(series: PhaseSeries, games: readonly PhaseGame[]): readonly PhaseGame[] {
  return games.filter(
    (game) =>
      game.phase === series.phase && hasTeam(game, series.teamAId) && hasTeam(game, series.teamBId),
  );
}

function winsOf(games: readonly PhaseGame[], teamId: TeamId): number {
  return games.filter((game) => winnerOf(game) === teamId).length;
}

/**
 * Whether `series` put `teamId` out of the postseason: its opponent won the series, and
 * the series is one whose loser is out, a playoff series or the 9-10 or 8th-seed play-in
 * game (STA-20, CL-STA-02).
 */
function isKnockedOutBy(series: PhaseSeries, games: readonly PhaseGame[], teamId: TeamId): boolean {
  const opponentId = series.teamAId === teamId ? series.teamBId : series.teamAId;
  const isLoserOut = series.phase === 'playoffs' || playInLoserEliminated(series.round) === true;
  return (
    isLoserOut &&
    (series.teamAId === teamId || series.teamBId === teamId) &&
    winsOf(gamesOf(series, games), opponentId) >= series.winsNeeded
  );
}

/**
 * Whether `series` is the Finals and a team won them (CL-STA-02, CL-STA-18, CL-STA-20):
 * while the season may be in progress, a game the source has not listed yet leaves them
 * under way.
 */
function isFinalsOver(series: PhaseSeries, games: readonly PhaseGame[]): boolean {
  const finals = gamesOf(series, games);
  return (
    series.round === 'finals' &&
    [series.teamAId, series.teamBId].some((teamId) => winsOf(finals, teamId) >= series.winsNeeded)
  );
}

function postseasonState(schedule: SeasonSchedule, teamId: TeamId): PhaseState | null {
  const teamGames = schedule.games.filter(
    (game) =>
      game.phase !== 'regular_season' && game.status !== 'canceled' && hasTeam(game, teamId),
  );
  if (teamGames.length === 0 && !schedule.hasLaterSeasonGame) {
    return null;
  }
  // Once a game of a later season is stored, the season is over, for every team.
  const isFinished =
    schedule.hasLaterSeasonGame ||
    schedule.series.some(
      (series) =>
        isKnockedOutBy(series, schedule.games, teamId) || isFinalsOver(series, schedule.games),
    );
  return stateOf(isFinished, teamGames);
}

/**
 * The state of a phase of one season's `schedule` (STA-20, CL-STA-02, CL-STA-17,
 * CL-STA-18). The regular season is finished, league-wide, once the schedule holds its
 * games and none of them is scheduled, in progress or postponed, and at the latest at the
 * scheduled start of the season's first play-in or playoff game, so that a postponed game
 * that no make-up was linked to never holds it open past that start; its last game is the
 * season's last final regular-season game. Once a game of a later season is stored, the
 * postseason is finished for every team of the season and its Finals are over, whatever
 * its stored playoff games say: none stored, a series cut short, Finals never listed.
 * Until then the season may be in progress: the postseason is finished for a team once a
 * series put it out or a team won the Finals, a series ending on wins only, since the
 * source may list a game only once it is scheduled (CL-STA-20). Its last game is the
 * team's last final postseason game, and while no game of a later season is stored, a
 * team that never entered it has no postseason: null.
 */
export function phaseState(schedule: SeasonSchedule, of: PhaseOf): PhaseState | null {
  return of.phase === 'regular_season'
    ? regularSeasonState(schedule.games, of.at)
    : postseasonState(schedule, of.teamId);
}

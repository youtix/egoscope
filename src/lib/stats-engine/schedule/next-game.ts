// A followed player's next game (STA-26) and his expected game after an instant
// (STA-27), both read on stored data whenever they are asked for and never copied
// (STA-28). The next game is his current team's (STA-25, JOU-14): the first official
// game of its schedule still to play, and the reason given when there is none comes from
// the state of the season's phases (CL-STA-20). The expected game is the first of his
// team games after an instant, under his membership (CL-STA-05): the precedence
// shortcut of the import preview (CL-IMP-17) and, in Lot 2, the expected game of SUI-03
// and ALE-15. A game whose time is to be determined comes with its deemed start, 00:00
// US Eastern time on its US date, as its scheduled start (STA-31, CL-STA-14), and every
// comparison here reads that start.

import { phaseState } from './phase-state';
import { byScheduledStart } from './series';
import { teamGames } from './team-membership';
import { hasTeam } from './team-record';

import type { DeadlineGame, NoGameScheduled, NoNextGameReason } from '../backtest/deadline';
import type { EpochMs, GameId, IsoDate, TeamId } from '../types';
import type { PhaseGame, PhaseOf, SeasonSchedule } from './phase-state';
import type { LinesGame, PlayerLine, TeamGame, TeamStint } from './team-membership';
import type { GamePhase } from './team-record';

/** Where his team plays a game: at home or away (STA-26). */
export type GameVenue = 'home' | 'away';

/**
 * A game of the stored schedule as the next game reads it (STA-05, STA-31, CL-STA-14):
 * its US date, and whether its time is to be determined, its scheduled start being then
 * the deemed start, 00:00 US Eastern time on that date.
 */
export type NextGameCandidate = PhaseGame &
  Readonly<{ isStartTimeTbd: boolean; gameDayOn: IsoDate }>;

/**
 * The stored schedule that the next game is read from (STA-26, CL-STA-20): the season in
 * progress or, between seasons, the season that ended last, with its series; and the
 * stored games of the season after it, none until its schedule is stored.
 */
export type NextGameSchedule = Readonly<{
  season: SeasonSchedule & Readonly<{ games: readonly NextGameCandidate[] }>;
  nextSeasonGames: readonly NextGameCandidate[];
}>;

/**
 * A followed player's next game (STA-26), a game that gives a deadline (BKT-16): its
 * scheduled start, with the mark "time TBD" and its US date; its phase; its opponent and
 * where his team plays it; and the date of his last game played, which tells the owner
 * that a trade the source does not show yet leaves the old team's game in place.
 */
export type NextGame = DeadlineGame &
  Readonly<{
    gameId: GameId;
    phase: GamePhase;
    opponentTeamId: TeamId;
    venue: GameVenue;
    lastGamePlayedOn: IsoDate | null;
  }>;

/**
 * The expected game after an instant (STA-27, CL-IMP-17): one of the games given, as his
 * team game, with the team he belonged to at its start, his participation and his minutes.
 */
export type ExpectedGame<G extends LinesGame> = TeamGame & Readonly<{ game: G }>;

/** A game whose two teams are set: no placeholder (CL-STA-14). */
type SetTeams = Readonly<{ homeTeamId: TeamId; awayTeamId: TeamId }>;

/**
 * Whether `game` is a game of `teamId` still to play after `now` (STA-26, CL-STA-14,
 * CL-STA-17): scheduled, which no postponed, canceled, live or final game is, its
 * scheduled start strictly after `now`, its two teams set, and `teamId` one of them.
 */
function isToPlay(
  game: NextGameCandidate,
  teamId: TeamId,
  now: EpochMs,
): game is NextGameCandidate & SetTeams {
  return (
    game.status === 'scheduled' &&
    game.scheduledStartAt > now &&
    game.homeTeamId !== null &&
    game.awayTeamId !== null &&
    hasTeam(game, teamId)
  );
}

function nextGameOf(
  game: NextGameCandidate & SetTeams,
  teamId: TeamId,
  lastGamePlayedOn: IsoDate | null,
): NextGame {
  const isHome = game.homeTeamId === teamId;
  return {
    kind: 'game',
    gameId: game.id,
    scheduledStartAt: game.scheduledStartAt,
    isStartTimeTbd: game.isStartTimeTbd,
    gameDayOn: game.gameDayOn,
    phase: game.phase,
    opponentTeamId: isHome ? game.awayTeamId : game.homeTeamId,
    venue: isHome ? 'home' : 'away',
    lastGamePlayedOn,
  };
}

/**
 * Whether a phase of `season` is finished (STA-20, CL-STA-02): undefined for the
 * postseason of a team that never entered it.
 */
function isFinished(season: SeasonSchedule, of: PhaseOf): boolean | undefined {
  return phaseState(season, of)?.finished;
}

/** The postseason of `teamId`, as phaseState asks for it (CL-STA-02). */
function postseasonOf(teamId: TeamId): PhaseOf {
  // Stryker disable next-line StringLiteral: phaseState tells the regular season from any other value, so any other phase also asks for this team's postseason
  return { phase: 'postseason', teamId };
}

/**
 * Whether the Finals of `season` are over (CL-STA-02, CL-STA-20): a team of theirs has
 * finished the postseason, which only the end of the Finals does for a finalist.
 */
function areFinalsOver(season: SeasonSchedule): boolean {
  const finals = season.series.find(({ round }) => round === 'finals');
  return finals !== undefined && isFinished(season, postseasonOf(finals.teamAId)) === true;
}

/**
 * Whether the season of `teamId` is over (CL-STA-20): the regular season is finished,
 * league-wide, and his team was put out of the postseason or never entered it.
 */
function isSeasonOverFor(season: SeasonSchedule, teamId: TeamId, now: EpochMs): boolean {
  return (
    isFinished(season, { phase: 'regular_season', at: now }) === true &&
    isFinished(season, postseasonOf(teamId)) !== false
  );
}

/**
 * Why his team has no game to play (CL-STA-20), the first reason that applies once he has
 * a team: eliminated while the league's postseason is under way, its Finals not over and
 * his team's season over; the offseason once the Finals are over and no game of the next
 * season is stored; otherwise the schedule is not published.
 */
function reasonOf(schedule: NextGameSchedule, teamId: TeamId, now: EpochMs): NoNextGameReason {
  const haveFinalsEnded = areFinalsOver(schedule.season);
  if (!haveFinalsEnded && isSeasonOverFor(schedule.season, teamId, now)) {
    return 'team_eliminated';
  }
  return haveFinalsEnded && schedule.nextSeasonGames.length === 0
    ? 'offseason'
    : 'schedule_not_published';
}

/**
 * A followed player's next game at `now` (STA-26, STA-31, JOU-14, CL-STA-14, CL-STA-20):
 * the first official game of his current team, by scheduled start then game id
 * (CL-STA-09), that is scheduled and starts strictly after `now`, its deemed start for a
 * time to be determined, in the season's schedule or in the next season's, with its
 * opponent, where his team plays it, its phase and the date of his last game played; a
 * placeholder whose teams are not both set is no team's game. After a trade it is read in
 * the new current team's schedule. Without one, the answer "no game scheduled" with the
 * first reason that applies: a player without a team; his team eliminated while the
 * postseason is under way, its Finals not over and his team's season over, eliminated or
 * never in the postseason; the offseason, the Finals over and no game of the next season
 * stored; otherwise the schedule not published.
 */
export function nextGame(
  player: Readonly<{ teamId: TeamId | null; lastGamePlayedOn: IsoDate | null }>,
  schedule: NextGameSchedule,
  now: EpochMs,
): NextGame | NoGameScheduled {
  const { teamId, lastGamePlayedOn } = player;
  if (teamId === null) {
    return { kind: 'no_game_scheduled', reason: 'player_without_team' };
  }
  const [game] = [...schedule.season.games, ...schedule.nextSeasonGames]
    .filter((candidate) => isToPlay(candidate, teamId, now))
    .toSorted(byScheduledStart);
  return game === undefined
    ? { kind: 'no_game_scheduled', reason: reasonOf(schedule, teamId, now) }
    : nextGameOf(game, teamId, lastGamePlayedOn);
}

/**
 * His expected game after the instant `after` (STA-27, STA-31, CL-STA-05, CL-STA-14,
 * CL-IMP-17): the first of his team games whose scheduled start, the deemed start of a
 * game whose time is to be determined, is strictly after `after`, as teamGames lists them
 * from his `stints` and `lines`, under any status but those that make no team game (a
 * postponed game that no make-up was linked to, a canceled game, a placeholder), so a
 * final game he did not play included; null while none of `games` is one. It is one of
 * `games`, returned as itself with the team he belonged to at its start.
 */
export function expectedGame<G extends LinesGame>(
  player: Readonly<{ stints: readonly TeamStint[]; lines: readonly PlayerLine[] }>,
  games: readonly G[],
  after: EpochMs,
): ExpectedGame<G> | null {
  const [first] = teamGames(player, games, after);
  // The first team game is one of `games`: picked out again, as itself, under their type.
  const [expected = null] = games.flatMap((game) =>
    game === first?.game ? { ...first, game } : [],
  );
  return expected;
}

// The cases of the statistics-source contract (contract.ts) that read the games: their
// days and tip-offs, their teams, their results, and the box scores and directory
// entries that go with them (STA-05, STA-08, CL-TRV-03, CL-STA-14, CL-STA-17).
import { gameDay, gameDayStart } from '@/lib/time';

import {
  idsOf,
  linesOf,
  open,
  problem,
  readOf,
  scheduleOf,
  schedulesOf,
  unreadSchedules,
} from './contract-support';

import type { Problems, StatsSourceHarness } from './contract-support';
import type {
  DirectoryEntry,
  Season,
  SeasonGames,
  SourceBoxScore,
  SourcePlayerId,
  SourceTeamId,
} from './types';

/** Every game has the US Eastern date of its tip-off, 00:00 US Eastern while its time is to be determined (STA-31, CL-TRV-03). */
export async function datesGames(harness: StatsSourceHarness): Promise<Problems> {
  const schedules = await schedulesOf(harness);
  const games = schedules.flatMap(([, schedule]) => schedule.games);
  const otherSeason = schedules.flatMap(([season, schedule]) =>
    schedule.games.filter((game) => game.season !== season),
  );
  const offDay = games.filter((game) => gameDay(game.tipOff) !== game.gameDay);
  const offStart = games.filter(
    (game) => !game.isTimeKnown && game.tipOff !== gameDayStart(game.gameDay),
  );
  return [
    ...unreadSchedules(schedules),
    ...problem('game days that are not the US Eastern date of the tip-off', idsOf(offDay)),
    ...problem('times to be determined that do not start at 00:00 US Eastern', idsOf(offStart)),
    ...problem('games of another season', idsOf(otherSeason)),
  ];
}

/** Every team that a season's games name is listed, and a placeholder is scheduled. */
function teamProblems({ games, teams }: SeasonGames): Problems {
  const listed = new Set(teams.map(({ team }) => team));
  const sides = games.flatMap((game) =>
    [game.homeTeam, game.awayTeam].map((team) => ({ game: game.game, team })),
  );
  const placeholders = games.filter(
    (game) => game.exclusion === null && (game.homeTeam === null || game.awayTeam === null),
  );
  const selfGames = games.filter(
    (game) => game.homeTeam !== null && game.homeTeam === game.awayTeam,
  );
  return [
    ...problem(
      'teams of the games that the season does not list',
      sides.filter(({ team }) => team !== null && !listed.has(team)),
    ),
    ...problem(
      'games without both teams that are not scheduled',
      idsOf(placeholders.filter((game) => game.status !== 'scheduled')),
    ),
    ...problem('games between a team and itself', idsOf(selfGames)),
  ];
}

/** A season's results: scores and overtimes of final games only, coverage of counted ones, held-back rows apart. */
function resultProblems({ games, coverage, heldBack }: SeasonGames): Problems {
  const counted = new Set(
    idsOf(games.filter((game) => game.status === 'final' && game.exclusion === null)),
  );
  const listed = new Set(idsOf(games));
  const scoredOtherwise = games.filter(
    (game) => (game.status === 'final') !== (game.score !== null),
  );
  return [
    ...problem('games whose score does not match their being final', idsOf(scoredOtherwise)),
    ...problem(
      'overtimes of a game that is not final',
      idsOf(games.filter((game) => game.overtimes !== null && game.status !== 'final')),
    ),
    ...problem(
      'games without box scores that are not final, counted games',
      coverage.gamesWithoutBoxScores.filter((game) => !counted.has(game)),
    ),
    ...problem(
      'held-back rows among the games',
      heldBack.filter(({ game }) => listed.has(game)),
    ),
  ];
}

/** Every team that the games name is among the season's teams (STA-05, CL-STA-14). */
export async function namesTeams(harness: StatsSourceHarness): Promise<Problems> {
  const schedules = await schedulesOf(harness);
  return [
    ...unreadSchedules(schedules),
    ...schedules.flatMap(([, schedule]) => teamProblems(schedule)),
  ];
}

/** Final games only have scores and overtimes, and held-back rows stay apart (STA-05, CL-STA-03, CL-STA-17). */
export async function scoresGames(harness: StatsSourceHarness): Promise<Problems> {
  const schedules = await schedulesOf(harness);
  return [
    ...unreadSchedules(schedules),
    ...schedules.flatMap(([, schedule]) => resultProblems(schedule)),
  ];
}

/** Only the requested box scores, each in a final game between the player's team and its opponent (STA-08). */
export async function placesBoxScores(harness: StatsSourceHarness): Promise<Problems> {
  const requested = harness.players.slice(0, 1);
  const lines = await linesOf(harness, harness.season, requested);
  const schedule = await scheduleOf(harness, harness.season);
  const games = new Map(schedule.games.map((game) => [game.game, game]));
  const misplaced = lines.filter((line) => {
    const game = games.get(line.game);
    const sides = [game?.homeTeam, game?.awayTeam];
    const [team, opponent] = line.isHome ? sides : sides.toReversed();
    return game?.status !== 'final' || line.team !== team || line.opponent !== opponent;
  });
  return [
    ...problem('box scores not read', lines.length === 0 ? requested : []),
    ...problem(
      'box scores of a player not requested',
      lines.filter((line) => !requested.includes(line.player)),
    ),
    ...problem('box scores outside a final game between his team and its opponent', misplaced),
    ...problem(
      'did-not-play box scores with playing time',
      lines.filter((line) => line.didNotPlay && line.playingTime !== null),
    ),
  ];
}

/** A box score with the day of its game, empty when the season's games do not list that game. */
type DatedLine = Readonly<{ line: SourceBoxScore; day: string }>;

/** A player's team on one day. */
type TeamDay = Readonly<{ player: SourcePlayerId; team: SourceTeamId; day: string }>;

/** Says whether the directory lists the player of `line` with its team over `day`. */
const isListedOn = (directory: readonly DirectoryEntry[], { line, day }: DatedLine): boolean =>
  directory.some(
    (entry) =>
      entry.player === line.player &&
      entry.teams.some(
        (team) => team.team === line.team && team.firstGameDay <= day && day <= team.lastGameDay,
      ),
  );

/** Says whether `lines` hold a box score of the player with his team on that day. */
const hasLineOn = (lines: readonly DatedLine[], { player, team, day }: TeamDay): boolean =>
  lines.some(
    ({ line, day: lineDay }) => line.player === player && line.team === team && lineDay === day,
  );

/** The directory teams whose first or last game day is the day of none of the player's box scores with that team. */
const unboundedTeams = (
  directory: readonly DirectoryEntry[],
  lines: readonly DatedLine[],
): readonly Readonly<{ player: SourcePlayerId; team: SourceTeamId }>[] =>
  directory.flatMap(({ player, teams }) =>
    teams
      .filter(({ team, firstGameDay, lastGameDay }) =>
        [firstGameDay, lastGameDay].some((day) => !hasLineOn(lines, { player, team, day })),
      )
      .map(({ team }) => ({ player, team })),
  );

/**
 * One season's directory, against the box scores of every player it lists and of the
 * harness's players: each team of a player's box scores, from the earliest to the
 * latest day of his box scores with it (module map §5, STA-03, JOU-13).
 */
async function directoryProblems(harness: StatsSourceHarness, season: Season): Promise<Problems> {
  const { source, players } = harness;
  const directory =
    readOf(await source.getSeasonPlayers(open(), { season, knownVersion: null })) ?? [];
  const schedule = await scheduleOf(harness, season);
  const days = new Map(schedule.games.map((game) => [game.game, game.gameDay]));
  const requested = [...new Set([...players, ...directory.map(({ player }) => player)])];
  const boxScores = await linesOf(harness, season, requested);
  const lines = boxScores.map((line) => ({ line, day: days.get(line.game) ?? '' }));
  const unlisted = lines
    .filter((dated) => !isListedOn(directory, dated))
    .map(({ line: { game, player, team } }) => ({ game, player, team }));
  return [
    ...problem('directory not read', directory.length === 0 ? [season] : []),
    ...problem('box scores not read', lines.length === 0 ? [season] : []),
    ...problem(
      'box scores whose player and team the directory does not list on that day',
      unlisted,
    ),
    ...problem(
      'directory teams whose first or last game day is the day of none of his box scores with it',
      unboundedTeams(directory, lines).map((team) => ({ season, ...team })),
    ),
  ];
}

/** Each season's directory lists every player of its box scores, each team over the days of his box scores with it (STA-03, JOU-13). */
export async function listsDirectory(harness: StatsSourceHarness): Promise<Problems> {
  const problems = await Promise.all(
    [harness.season, harness.currentSeason].map(async (season) =>
      directoryProblems(harness, season),
    ),
  );
  return problems.flat();
}

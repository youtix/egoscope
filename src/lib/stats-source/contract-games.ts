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

import type { Problems, StatsSourceHarness } from './contract';
import type { DirectoryEntry, SeasonGames, SourceBoxScore } from './types';

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
  const lines = await linesOf(harness, requested);
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

/** Says whether the directory lists the player of `line` with its team over `day`. */
const isListedOn = (
  directory: readonly DirectoryEntry[],
  line: SourceBoxScore,
  day: string,
): boolean =>
  directory.some(
    (entry) =>
      entry.player === line.player &&
      entry.teams.some(
        (team) => team.team === line.team && team.firstGameDay <= day && day <= team.lastGameDay,
      ),
  );

/** The directory lists every player of the box scores, with each team over the days of his lines (STA-03, JOU-13). */
export async function listsDirectory(harness: StatsSourceHarness): Promise<Problems> {
  const { source, season } = harness;
  const directory =
    readOf(await source.getSeasonPlayers(open(), { season, knownVersion: null })) ?? [];
  const schedule = await scheduleOf(harness, season);
  const days = new Map(schedule.games.map((game) => [game.game, game.gameDay]));
  const lines = await linesOf(harness, harness.players);
  const unlisted = lines.filter((line) => !isListedOn(directory, line, days.get(line.game) ?? ''));
  return [
    ...problem('directory not read', directory.length === 0 ? [season] : []),
    ...problem('box scores not read', lines.length === 0 ? harness.players : []),
    ...problem(
      'box scores whose player and team the directory does not list on that day',
      unlisted,
    ),
  ];
}

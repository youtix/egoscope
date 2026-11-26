// The invented league that the fake serves, generated from the short scenario of
// data/fixtures/stats-source/world/scenario.json (fake-scenario.ts): each season's
// schedule (fake-schedule.ts), then, from the players' careers, every box score,
// each season's player directory and each season's player file.
import { compareIsoDates, localOccurrenceInstant, toIsoDate } from '@/lib/time';

import { at, EASTERN, isBefore, LEAGUE } from './fake-scenario';
import { hasLines, isCountedFinal, seasonGamesOf } from './fake-schedule';

import type { Player, Schedule, Stint } from './fake-scenario';
import type {
  BoxScoreCounts,
  CurrentTeam,
  DirectoryEntry,
  HeldBackRow,
  PlayerRecord,
  Season,
  SeasonCoverage,
  SidesWithLines,
  SourceBoxScore,
  SourceGame,
  SourceTeam,
} from './types';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A season of the league as the fake serves it; null where the source has not published that file. */
export type WorldSeason = Readonly<{
  season: Season;
  games: readonly SourceGame[];
  teams: readonly SourceTeam[];
  coverage: SeasonCoverage;
  heldBack: readonly HeldBackRow[];
  boxScores: readonly SourceBoxScore[] | null;
  /** Each game of `boxScores`, with the sides that hold its lines (CL-STA-04). */
  sidesWithLines: readonly SidesWithLines[];
  directory: readonly DirectoryEntry[] | null;
  /** The season's player file: each player it lists, with his team on its last day. */
  playerFile: readonly PlayerRecord[] | null;
}>;

/** The whole invented league, oldest season first. */
type World = Readonly<{
  firstCoveredSeason: Season;
  refreshedAt: EpochMs;
  seasons: readonly WorldSeason[];
}>;

type Side = Readonly<{ team: string; opponent: string; isHome: boolean }>;
type GameBetweenTeams = SourceGame & Readonly<{ homeTeam: string; awayTeam: string }>;
type LineFor = Readonly<{ player: Player; side: Side; game: SourceGame; index: number }>;
// A box score with the day of its game, from which the directory follows.
type DatedLine = Readonly<{ line: SourceBoxScore; day: IsoDate }>;

const NO_COUNTS: BoxScoreCounts = {
  points: null,
  fieldGoalsMade: null,
  fieldGoalsAttempted: null,
  threePointersMade: null,
  freeThrowsMade: null,
  freeThrowsAttempted: null,
  offensiveRebounds: null,
  defensiveRebounds: null,
  assists: null,
  steals: null,
  blocks: null,
  turnovers: null,
  personalFouls: null,
};

const isWithin = (stint: Stint, first: string, last: string): boolean =>
  !isBefore(last, stint.from) && (stint.to === undefined || !isBefore(stint.to, first));

/** The team a player belongs to on `day`, if any. */
const teamOn = (player: Player, day: string): string | undefined =>
  player.stints.find((stint) => isWithin(stint, day, day))?.team;

const isBetweenTeams = (game: SourceGame): game is GameBetweenTeams =>
  game.homeTeam !== null && game.awayTeam !== null;

const sidesOf = ({ homeTeam, awayTeam }: GameBetweenTeams): readonly Side[] => [
  { team: homeTeam, opponent: awayTeam, isHome: true },
  { team: awayTeam, opponent: homeTeam, isHome: false },
];

/** A player's line, the scenario's lines taken in turn; a did-not-play line has no time and no count. */
function lineOf({ player, side, game, index }: LineFor, hasWholeMinutes: boolean): SourceBoxScore {
  const didNotPlay = player.didNotPlay?.includes(game.gameDay) ?? false;
  const { minutes, seconds, ...counts } = at(LEAGUE.lines, index % LEAGUE.lines.length);
  const playingTime = hasWholeMinutes
    ? { precision: 'whole_minutes' as const, minutes }
    : { precision: 'seconds' as const, minutes, seconds };
  return {
    game: game.game,
    player: player.id,
    ...side,
    didNotPlay,
    playingTime: didNotPlay ? null : playingTime,
    counts: didNotPlay ? NO_COUNTS : counts,
    ejected: null,
  };
}

/** A line for each player of either team in each final, counted game whose box scores the source holds. */
function boxScoresOf(games: readonly SourceGame[], schedule: Schedule): readonly DatedLine[] {
  const withLines = games
    .filter((game) => isBetweenTeams(game))
    .filter((game) => isCountedFinal(game) && hasLines(game, schedule));
  return withLines.flatMap((game, gameIndex) =>
    sidesOf(game).flatMap((side) =>
      LEAGUE.players
        .filter((player) => teamOn(player, game.gameDay) === side.team)
        .map((player) => ({
          player,
          side,
          game,
          index: gameIndex + LEAGUE.players.indexOf(player),
        }))
        .map((line) => ({ line: lineOf(line, schedule.hasWholeMinutes), day: game.gameDay })),
    ),
  );
}

/** Each game of `lines`, with the sides that hold one of them, a did-not-play line included (CL-STA-04). */
function sidesWithLinesOf(lines: readonly DatedLine[]): readonly SidesWithLines[] {
  const byGame = Map.groupBy(lines, ({ line }) => line.game);
  return Array.from(byGame, ([game, held]) => ({
    game,
    home: held.some(({ line }) => line.isHome),
    away: held.some(({ line }) => !line.isHome),
  }));
}

/**
 * Every player with a box score in `lines`, each team of his lines with the earliest
 * and the latest day of his lines with it (STA-03, JOU-13): his lines taken by day,
 * since a make-up comes after the games of its season in `lines`.
 */
function directoryOf(lines: readonly DatedLine[]): readonly DirectoryEntry[] {
  return LEAGUE.players
    .map((player) => {
      const own = lines
        .filter(({ line }) => line.player === player.id)
        .toSorted((left, right) => compareIsoDates(left.day, right.day));
      const teams = [...new Set(own.map(({ line }) => line.team))].map((team) => {
        const days = own.filter(({ line }) => line.team === team).map(({ day }) => day);
        return { team, firstGameDay: at(days, 0), lastGameDay: at(days, -1) };
      });
      return {
        player: player.id,
        displayName: player.name,
        otherNames: [player.shortName],
        teams,
      };
    })
    .filter((entry) => entry.teams.length > 0);
}

function currentTeamOf(player: Player, day: string): CurrentTeam {
  const team = teamOn(player, day);
  return team === undefined ? { kind: 'without_team' } : { kind: 'team', team };
}

/** The players the season's file lists, each with his team at its last day: in progress, the day of the file. */
function playerFileOf(schedule: Schedule, games: readonly SourceGame[]): readonly PlayerRecord[] {
  const days = games.map((game) => game.gameDay).toSorted(compareIsoDates);
  const [first, last] = [at(days, 0), at(days, -1)];
  return LEAGUE.players
    .filter((player) => player.stints.some((stint) => isWithin(stint, first, last)))
    .map((player) => ({
      player: player.id,
      displayName: player.name,
      birthday: player.birthday,
      currentTeam: currentTeamOf(player, schedule.playedBefore ?? last),
    }));
}

function seasonOf(schedule: Schedule): WorldSeason {
  const seasonGames = seasonGamesOf(schedule);
  const lines = schedule.hasBoxScores ? boxScoresOf(seasonGames.games, schedule) : null;
  return {
    season: schedule.season,
    ...seasonGames,
    boxScores: lines?.map(({ line }) => line) ?? null,
    sidesWithLines: sidesWithLinesOf(lines ?? []),
    directory: lines === null ? null : directoryOf(lines),
    playerFile: schedule.hasBoxScores ? playerFileOf(schedule, seasonGames.games) : null,
  };
}

/** The invented league of the scenario, built afresh: each fake holds its own, and may change it (STA-05, STA-08). */
export function buildWorld(): World {
  const { on, time } = LEAGUE.refresh;
  return {
    firstCoveredSeason: LEAGUE.firstCoveredSeason,
    refreshedAt: localOccurrenceInstant(toIsoDate(on), time, EASTERN),
    seasons: LEAGUE.seasons.map((schedule) => seasonOf(schedule)),
  };
}

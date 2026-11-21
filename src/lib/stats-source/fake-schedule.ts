// The schedule of each season of the invented league: a double round robin of the
// teams, a game every few days, then the play-in and the series of the scenario,
// with the games the scenario sets apart (an All-Star game, a postponed game and its
// make-up, a placeholder, a time to be determined, a game abroad, overtimes, a row
// held back), and the season's teams and coverage.
import { gameDayStart, localOccurrenceInstant, toIsoDate } from '@/lib/time';

import { at, dayAfter, EASTERN, isBefore, LEAGUE } from './fake-scenario';
import { SERIES_ROUNDS } from './types';

import type { Schedule } from './fake-scenario';
import type {
  GamePhase,
  Season,
  SeasonCoverage,
  SeasonGames,
  SeriesPlace,
  SeriesRound,
  SourceGame,
  SourceTeam,
} from './types';
import type { EpochMs, IsoDate } from '@/lib/time';

// A game before it gets its status, score and times.
type Slot = Readonly<{
  game: string;
  day: IsoDate;
  home: string | null;
  away: string | null;
  phase: GamePhase;
  series: SeriesPlace | null;
  winner: string | null;
  isAllStar: boolean;
  makeUpOf: string | null;
}>;

const PLAY_IN_ROUND: SeriesRound = 'play_in_7_vs_8';
const PHASES: readonly GamePhase[] = ['regular_season', 'play_in', 'playoffs'];
const ROUND_DIGITS = 2;
const TEAM_IDS = LEAGUE.teams.map((team) => team.id);
const REGULAR: Omit<Slot, 'game' | 'day' | 'home' | 'away'> = {
  phase: 'regular_season',
  series: null,
  winner: null,
  isAllStar: false,
  makeUpOf: null,
};

function roundOf(round: string): SeriesRound {
  const known = SERIES_ROUNDS.find((candidate) => candidate === round);
  if (known === undefined) {
    throw new RangeError(`The invented league names an unknown series round: ${round}.`);
  }
  return known;
}

/** One round robin by the circle method: the first team stays, the others turn by one each round. */
function roundRobin(teams: readonly string[]): readonly (readonly (readonly [string, string])[])[] {
  const [fixed, others] = [at(teams, 0), teams.slice(1)];
  return others.map((_, round) => {
    const circle = [fixed, ...others.slice(round), ...others.slice(0, round)];
    const facing = circle.toReversed();
    return circle
      .slice(0, circle.length / 2)
      .map((team, index): readonly [string, string] =>
        round % 2 === 0 ? [team, at(facing, index)] : [at(facing, index), team],
      );
  });
}

function regularSlots(schedule: Schedule): readonly Slot[] {
  const firstHalf = roundRobin(TEAM_IDS);
  const secondHalf = firstHalf.map((pairs) => pairs.map(([home, away]) => [away, home] as const));
  return [...firstHalf, ...secondHalf].flatMap((pairs, round) =>
    pairs.map(([home, away]) => ({
      ...REGULAR,
      game: `${schedule.season}:r${String(round + 1).padStart(ROUND_DIGITS, '0')}:h${home}`,
      day: dayAfter(schedule.start, round * LEAGUE.calendar.daysBetweenRounds),
      home,
      away,
    })),
  );
}

function postseasonSlots(schedule: Schedule, after: IsoDate): readonly Slot[] {
  const gap = LEAGUE.calendar.daysBetweenPostseasonGames;
  const playIn = schedule.playIn === undefined ? [] : [schedule.playIn];
  const games = (schedule.series ?? []).flatMap((series, index) =>
    series.winners.map((winner, game) => ({ series, index, game, winner })),
  );
  return [
    ...playIn.map(({ home, away, winner }) => ({
      ...REGULAR,
      game: `${schedule.season}:pi`,
      day: dayAfter(after, gap),
      home,
      away,
      phase: 'play_in' as const,
      series: { round: PLAY_IN_ROUND, gameNumber: null },
      winner,
    })),
    ...games.map(({ series, index, game, winner }, order) => ({
      ...REGULAR,
      game: `${schedule.season}:s${String(index + 1)}g${String(game + 1)}`,
      day: dayAfter(after, gap * (order + playIn.length + 1)),
      home: game % 2 === 0 ? series.high : series.low,
      away: game % 2 === 0 ? series.low : series.high,
      phase: 'playoffs' as const,
      series: { round: roundOf(series.round), gameNumber: game + 1 },
      winner,
    })),
  ];
}

/** The All-Star game, the make-up of each postponed game and the play-in placeholder of a season. */
function specialSlots(schedule: Schedule, regular: readonly Slot[]): readonly Slot[] {
  const allStarDays = schedule.allStarDay === undefined ? [] : [schedule.allStarDay];
  const placeholderDays =
    schedule.playInToBeDeterminedOn === undefined ? [] : [schedule.playInToBeDeterminedOn];
  const makeUps = LEAGUE.games.postponed.flatMap(({ game, makeUpOn }) =>
    regular
      .filter((slot) => slot.game === game)
      .map((slot) => ({
        ...slot,
        game: `${game}:make-up`,
        day: toIsoDate(makeUpOn),
        makeUpOf: game,
      })),
  );
  return [
    ...allStarDays.map((day) => ({
      ...REGULAR,
      game: `${schedule.season}:all-star`,
      day: toIsoDate(day),
      home: null,
      away: null,
      isAllStar: true,
    })),
    ...makeUps,
    ...placeholderDays.map((day) => ({
      ...REGULAR,
      game: `${schedule.season}:pi`,
      day: toIsoDate(day),
      home: null,
      away: null,
      phase: 'play_in' as const,
      series: { round: PLAY_IN_ROUND, gameNumber: null },
    })),
  ];
}

function scoreOf(slot: Slot, index: number): SourceGame['score'] {
  const { home, away } = at(LEAGUE.scores, index % LEAGUE.scores.length);
  if (slot.winner === null) {
    return { home, away };
  }
  const [high, low] = [Math.max(home, away), Math.min(home, away)];
  return slot.winner === slot.home ? { home: high, away: low } : { home: low, away: high };
}

function statusOf(slot: Slot, schedule: Schedule): SourceGame['status'] {
  if (LEAGUE.games.postponed.some(({ game }) => game === slot.game)) {
    return 'postponed';
  }
  const isPlayed = schedule.playedBefore === undefined || isBefore(slot.day, schedule.playedBefore);
  return isPlayed ? 'final' : 'scheduled';
}

function tipOffOf(slot: Slot): EpochMs {
  if (LEAGUE.games.timeToBeDetermined.includes(slot.game)) {
    return gameDayStart(slot.day);
  }
  const { tipOff, tipOffAbroad } = LEAGUE.calendar;
  const time = LEAGUE.games.abroad.includes(slot.game) ? tipOffAbroad : tipOff;
  return localOccurrenceInstant(slot.day, time, EASTERN);
}

function gameOf(slot: Slot, index: number, schedule: Schedule): SourceGame {
  const status = statusOf(slot, schedule);
  const isFinal = status === 'final';
  return {
    game: slot.game,
    season: schedule.season,
    phase: slot.phase,
    exclusion: slot.isAllStar ? 'all_star' : null,
    tipOff: tipOffOf(slot),
    isTimeKnown: !LEAGUE.games.timeToBeDetermined.includes(slot.game),
    gameDay: slot.day,
    homeTeam: slot.home,
    awayTeam: slot.away,
    isNeutralSite: LEAGUE.games.abroad.includes(slot.game),
    status,
    score: isFinal ? scoreOf(slot, index) : null,
    overtimes: isFinal ? (LEAGUE.games.overtimes[slot.game] ?? 0) : null,
    series: slot.series,
    makeUpOf: slot.makeUpOf,
  };
}

function teamsOf(season: Season): readonly SourceTeam[] {
  return LEAGUE.teams.map(({ id, names }) => {
    const { location, name, abbreviation } = at(
      names.filter(({ from }) => from <= season),
      -1,
    );
    return { team: id, location, name, abbreviation };
  });
}

/** Says whether the source holds the box scores of a game (STA-35, CL-STA-22). */
export const hasLines = (game: SourceGame, schedule: Schedule): boolean =>
  schedule.hasBoxScores && !LEAGUE.games.withoutBoxScores.includes(game.game);

/** Says whether a game is final and counts (STA-04, CL-STA-16). */
export const isCountedFinal = (game: SourceGame): boolean =>
  game.status === 'final' && game.exclusion === null;

function coverageOf(games: readonly SourceGame[], schedule: Schedule): SeasonCoverage {
  const counted = games.filter((game) => isCountedFinal(game));
  const phases = new Set(
    counted.filter((game) => hasLines(game, schedule)).map(({ phase }) => phase),
  );
  return {
    phasesWithBoxScores: PHASES.filter((phase) => phases.has(phase)),
    gamesWithoutBoxScores: counted
      .filter((game) => !hasLines(game, schedule))
      .map(({ game }) => game),
  };
}

/** A season's schedule as the fake serves it, its rows held back apart from its games (STA-05, CL-STA-17). */
export function seasonGamesOf(schedule: Schedule): SeasonGames {
  const regular = regularSlots(schedule);
  const slots = [
    ...regular,
    ...specialSlots(schedule, regular),
    ...postseasonSlots(schedule, at(regular, -1).day),
  ];
  const { heldBack } = LEAGUE.games;
  const heldBackGames = new Set(heldBack.map((row) => row.game));
  const games = slots
    .map((slot, index) => gameOf(slot, index, schedule))
    .filter((game) => !heldBackGames.has(game.game));
  return {
    games,
    teams: teamsOf(schedule.season),
    coverage: coverageOf(games, schedule),
    heldBack: heldBack.filter((row) => row.game.startsWith(`${schedule.season}:`)),
  };
}

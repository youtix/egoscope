// Play-in and playoff series rebuilt from the stored schedule (STA-05, STA-07,
// CL-STA-18). The source labels rounds only from 2003-04 and numbers games only from
// 2008-09, so a series' round comes from its label or else from the series its teams
// played before it, and the number of each game and the wins of each team before it
// come from the results in date order, checked against the source's numbers wherever it
// gives them. A series that cannot be rebuilt leaves every game of it without a number,
// without wins before and with an unknown elimination flag.

import { winnerOf } from './team-record';

import type { EpochMs, GameId, TeamId } from '../types';
import type { GamePhase, ScheduleGame } from './team-record';

/**
 * The round of a series, as the source labels it or as the order of the season's
 * series gives it (STA-05, CL-STA-18).
 */
export type SeriesRound =
  | 'conference_finals'
  | 'conference_semifinals'
  | 'finals'
  | 'first_round'
  | 'play_in_7_vs_8'
  | 'play_in_8th_seed'
  | 'play_in_9_vs_10';

type SeriesPhase = Exclude<GamePhase, 'regular_season'>;

/**
 * A game of one season's schedule as the rebuild reads it (STA-05): its scheduled
 * start, and the round label and game number that the source gives, each null where it
 * gives none (round labels before 2003-04, game numbers before 2008-09).
 */
export type SeriesGame = ScheduleGame &
  Readonly<{
    scheduledStartAt: EpochMs;
    roundLabel: SeriesRound | null;
    sourceGameNumber: number | null;
  }>;

/**
 * Where a game stands in its series (STA-05, STA-07): its number, the series wins of
 * each team before it, and whether a loss in it eliminates one of the two teams. Every
 * value is null when it is unknown: the series cannot be rebuilt, or no series counts
 * the game (postponed, canceled), or it comes after the next game to play.
 */
export type SeriesGamePosition = Readonly<{
  gameId: GameId;
  gameNumber: number | null;
  homeSeriesWinsBefore: number | null;
  awaySeriesWinsBefore: number | null;
  isEliminationGame: boolean | null;
}>;

/**
 * One play-in or playoff series of a season (CL-STA-18): its two teams, the lower
 * identifier first; its round, null when neither a label nor the order tells it; the
 * wins that take it; whether it could be rebuilt; and the position of each of its games,
 * in date order.
 */
export type RebuiltSeries = Readonly<{
  phase: SeriesPhase;
  teamAId: TeamId;
  teamBId: TeamId;
  round: SeriesRound | null;
  winsNeeded: number;
  isRebuilt: boolean;
  games: readonly SeriesGamePosition[];
}>;

type PairedGame = SeriesGame &
  Readonly<{ phase: SeriesPhase; homeTeamId: TeamId; awayTeamId: TeamId }>;

type Pairing = Readonly<{
  phase: SeriesPhase;
  teamAId: TeamId;
  teamBId: TeamId;
  games: readonly PairedGame[];
}>;

type SeriesFacts = Readonly<{ phase: SeriesPhase; round: SeriesRound | null; winsNeeded: number }>;

/** A numbered game, with the series wins of each team before it. */
type Placed = Readonly<{
  game: PairedGame;
  gameNumber: number;
  homeWins: number;
  awayWins: number;
}>;

type Ordered = Readonly<{ id: GameId; scheduledStartAt: EpochMs }>;

// The playoff rounds in order: a team's first series is its first round (CL-STA-18).
const PLAYOFF_ROUNDS: readonly SeriesRound[] = [
  'first_round',
  'conference_semifinals',
  'conference_finals',
  'finals',
];

// Whether the loser of a play-in game is out of the postseason: the loser of the 7-8
// game plays the 8th-seed game (STA-07).
const PLAY_IN_LOSER_ELIMINATED = new Map<SeriesRound | null, boolean>([
  ['play_in_7_vs_8', false],
  ['play_in_9_vs_10', true],
  ['play_in_8th_seed', true],
]);

// The round-length table (CL-STA-18): a best of five in the first round up to 2001-02, a
// best of seven otherwise, and one game for a play-in pairing.
const LAST_BEST_OF_FIVE_SEASON = '2001-02';
const BEST_OF_FIVE_WINS = 3;
const BEST_OF_SEVEN_WINS = 4;
const PLAY_IN_WINS = 1;

/**
 * Orders games by scheduled start, then by identifier: the fixed order of CL-STA-09, so
 * that the same schedule always gives the same series and phase states.
 */
export function byScheduledStart(left: Ordered, right: Ordered): number {
  const byStart = left.scheduledStartAt - right.scheduledStartAt;
  return byStart === 0 ? left.id - right.id : byStart;
}

/**
 * Whether a game counts in the rules of series and phases: a canceled game is ignored by
 * every rule, and a postponed one that no make-up was linked to counts in none
 * (CL-STA-17).
 */
export function isCounted(game: ScheduleGame): boolean {
  return game.status !== 'postponed' && game.status !== 'canceled';
}

/**
 * Whether the loser of a play-in game of `round` is out of the postseason (STA-07,
 * CL-STA-18): the loser of the 9-10 game and of the 8th-seed game is, the loser of the
 * 7-8 game plays again, and a round that no label tells, such as that of the 2019-20
 * seeding play-in, leaves it unknown.
 */
export function playInLoserEliminated(round: SeriesRound | null): boolean | null {
  return PLAY_IN_LOSER_ELIMINATED.get(round) ?? null;
}

function isPaired(game: SeriesGame): game is PairedGame {
  return game.phase !== 'regular_season' && game.homeTeamId !== null && game.awayTeamId !== null;
}

/** The series of the season: the games of each pair of teams in each phase, in date order. */
function pairingsOf(games: readonly SeriesGame[]): readonly Pairing[] {
  const pairings = new Map<string, Pairing>();
  for (const game of games.toSorted(byScheduledStart)) {
    if (!isPaired(game)) {
      continue;
    }
    const teamAId = Math.min(game.homeTeamId, game.awayTeamId);
    const teamBId = Math.max(game.homeTeamId, game.awayTeamId);
    const key = `${game.phase} ${String(teamAId)} ${String(teamBId)}`;
    const pairing = pairings.get(key) ?? { phase: game.phase, teamAId, teamBId, games: [] };
    pairings.set(key, { ...pairing, games: [...pairing.games, game] });
  }
  return Array.from(pairings, ([, pairing]) => pairing);
}

/** The number of playoff series of `teamId` among `pairings`: a play-in pairing is no round. */
function playoffSeriesOf(teamId: TeamId, pairings: readonly Pairing[]): number {
  return pairings.filter(
    (pairing) =>
      pairing.phase === 'playoffs' && (pairing.teamAId === teamId || pairing.teamBId === teamId),
  ).length;
}

/** The round label that the labeled games of a series share, or null. */
function labelOf(games: readonly PairedGame[]): SeriesRound | null {
  const labels = games.map((game) => game.roundLabel).filter((label) => label !== null);
  const [label] = labels;
  return label !== undefined && labels.every((other) => other === label) ? label : null;
}

/**
 * The round of `pairing`: its label, or else, for a playoff series, the number of playoff
 * series each of its two teams played before it, when they agree (CL-STA-18).
 */
function roundOf(pairing: Pairing, earlier: readonly Pairing[]): SeriesRound | null {
  const label = labelOf(pairing.games);
  if (label !== null || pairing.phase === 'play_in') {
    return label;
  }
  const played = playoffSeriesOf(pairing.teamAId, earlier);
  return played === playoffSeriesOf(pairing.teamBId, earlier)
    ? (PLAYOFF_ROUNDS[played] ?? null)
    : null;
}

function winsNeededFor(season: string, phase: SeriesPhase, round: SeriesRound | null): number {
  if (phase === 'play_in') {
    return PLAY_IN_WINS;
  }
  // A playoff series that neither a label nor the order places comes after a first
  // round: one of its teams has played a playoff series before it.
  return round === 'first_round' && season <= LAST_BEST_OF_FIVE_SEASON
    ? BEST_OF_FIVE_WINS
    : BEST_OF_SEVEN_WINS;
}

/** Whether a numbered game agrees with the source's number and comes before the series is won. */
function isConsistent(place: Placed, winsNeeded: number): boolean {
  const { sourceGameNumber } = place.game;
  return (
    (sourceGameNumber === null || sourceGameNumber === place.gameNumber) &&
    place.homeWins < winsNeeded &&
    place.awayWins < winsNeeded
  );
}

/**
 * The games that a series numbers, in date order: its final games, then, while no team
 * has the wins needed, the next game to play; and whether the series could be rebuilt:
 * every final game has a result and comes before any game still to play, the source's
 * numbers agree, no game follows the deciding win, and a series without a winner still
 * has a game to play (CL-STA-18).
 */
function placeGames(
  pairing: Pairing,
  winsNeeded: number,
): Readonly<{ placed: readonly Placed[]; isRebuilt: boolean }> {
  const sequence = pairing.games.filter((game) => isCounted(game));
  const played = sequence.filter((game) => game.status === 'final');
  const winners = played.map((game) => winnerOf(game));
  const winsBefore = (teamId: TeamId, games: number): number =>
    winners.slice(0, games).filter((winner) => winner === teamId).length;
  const isDecided = [pairing.teamAId, pairing.teamBId].some(
    (teamId) => winsBefore(teamId, played.length) >= winsNeeded,
  );
  const placed = sequence
    .slice(0, isDecided ? played.length : played.length + 1)
    .map((game, index) => ({
      game,
      gameNumber: index + 1,
      homeWins: winsBefore(game.homeTeamId, index),
      awayWins: winsBefore(game.awayTeamId, index),
    }));
  const isRebuilt =
    (isDecided || placed.length > played.length) &&
    sequence.slice(0, played.length).every((game) => game.status === 'final') &&
    !winners.includes(null) &&
    placed.every((place) => isConsistent(place, winsNeeded));
  return { placed, isRebuilt };
}

function isEliminationGame(series: SeriesFacts, place: Placed): boolean | null {
  if (series.phase === 'play_in') {
    return playInLoserEliminated(series.round);
  }
  const oneWinAway = series.winsNeeded - 1;
  return place.homeWins === oneWinAway || place.awayWins === oneWinAway;
}

function positionOf(
  gameId: GameId,
  place: Placed | undefined,
  series: SeriesFacts,
): SeriesGamePosition {
  return place === undefined
    ? {
        gameId,
        gameNumber: null,
        homeSeriesWinsBefore: null,
        awaySeriesWinsBefore: null,
        isEliminationGame: null,
      }
    : {
        gameId,
        gameNumber: place.gameNumber,
        homeSeriesWinsBefore: place.homeWins,
        awaySeriesWinsBefore: place.awayWins,
        isEliminationGame: isEliminationGame(series, place),
      };
}

function rebuild(season: string, pairing: Pairing, round: SeriesRound | null): RebuiltSeries {
  const series = {
    phase: pairing.phase,
    round,
    winsNeeded: winsNeededFor(season, pairing.phase, round),
  };
  const { placed, isRebuilt } = placeGames(pairing, series.winsNeeded);
  const places = new Map<GameId, Placed>(
    isRebuilt ? placed.map((place) => [place.game.id, place] as const) : [],
  );
  return {
    phase: series.phase,
    teamAId: pairing.teamAId,
    teamBId: pairing.teamBId,
    round,
    winsNeeded: series.winsNeeded,
    isRebuilt,
    games: pairing.games.map((game) => positionOf(game.id, places.get(game.id), series)),
  };
}

/**
 * Rebuilds the play-in and playoff series of `season`, written `2024-25`, from its
 * games (STA-05, STA-07, CL-STA-18). A series is the games of one pair of teams in one
 * phase; a placeholder whose teams are still to be determined belongs to none. Its round
 * is the label its games carry, or else, for a playoff series, the number of playoff
 * series each team played before it, the first being the first round; a play-in round
 * comes from its label only. Its final games are numbered in date order with the wins of
 * each team before each, the next game to play after them too, and the source's numbers
 * are checked wherever it gives them. The wins needed come from the round-length table:
 * three in the first round up to 2001-02, four otherwise, one in the play-in. A playoff
 * game is an elimination game when a team's wins before it are one short of the wins
 * needed; a 9-10 or 8th-seed play-in game eliminates its loser, a 7-8 game does not. A
 * series with a game missing, numbers that disagree or no team reaching the wins needed
 * once no game is left to play cannot be rebuilt, and its games' positions are unknown.
 */
export function rebuildSeries(
  season: string,
  games: readonly SeriesGame[],
): readonly RebuiltSeries[] {
  const pairings = pairingsOf(games);
  return pairings.map((pairing, index) =>
    rebuild(season, pairing, roundOf(pairing, pairings.slice(0, index))),
  );
}

// The season baseline that a measured game is compared with (STA-16 to STA-22, STA-24):
// the mean index of the player's usable games of one season and baseline phase, the
// measured game alone left out, with its sample standard deviation, its status and the
// "partial" notice. The classes and indices come from the performance part, the state of
// the phase from the schedule part (phaseState).

import type { PhaseState } from '../schedule/phase-state';
import type { GamePhase } from '../schedule/team-record';
import type { BaselinePhase, EngineParams, EpochMs, GameId } from '../types';

// games.partialBaselineShare is a percentage.
const PERCENT = 100;
// The sample standard deviation divides by n − 1 (STA-16, H-STA-04), so it needs two games.
const MIN_GAMES_FOR_DEVIATION = 2;

/**
 * One of the player's team games of a season as a baseline reads it (STA-13, STA-14,
 * STA-24, CL-STA-04): its class (GamePlayClassification) and its performance index. A
 * usable game has an index. A game he played that is not usable has one when he stayed
 * under the playing-time threshold with a complete and consistent box score, and none
 * when his box score is incomplete or suspect. A game he did not play has none, nor a
 * game of unknown participation, which has no class while his team's lines are missing
 * or unavailable.
 */
export type BaselineGame = Readonly<{
  gameId: GameId;
  scheduledStartAt: EpochMs;
  phase: GamePhase;
}> &
  (
    | Readonly<{ classification: 'usable'; performanceIndex: number }>
    | Readonly<{ classification: 'played_not_usable'; performanceIndex: number | null }>
    | Readonly<{ classification: 'not_played' | null; performanceIndex: null }>
  );

/** What a season baseline is computed for (STA-16, STA-17, STA-20, CL-STA-02). */
export type SeasonBaselineInput = Readonly<{
  /** His final team games of the season, of every phase. */
  games: readonly BaselineGame[];
  /** The baseline phase of the measured game, from baselinePhaseOf (STA-18). */
  phase: BaselinePhase;
  /** The measured game, the one game left out of its own baseline (STA-17). */
  excludedGameId: GameId;
  /** The state of that phase: league-wide for the regular season, his team's for the postseason. */
  phaseState: PhaseState;
}>;

/** The status of a season baseline (STA-19 to STA-22). */
export type SeasonBaselineStatus = 'final' | 'provisional' | 'building' | 'insufficient';

/**
 * A season baseline (STA-16, STA-24): the usable games it retains, their mean index and
 * its sample standard deviation, its status and the "partial" notice. A final or
 * provisional baseline, the only one a case is measured against, has both numbers; a
 * building or insufficient one has its mean from one game on and its deviation from two.
 */
export type SeasonBaseline = Readonly<{ gameCount: number; isPartial: boolean }> &
  (
    | Readonly<{ status: 'final' | 'provisional'; mean: number; standardDeviation: number }>
    | Readonly<{
        status: 'building' | 'insufficient';
        mean: number | null;
        standardDeviation: number | null;
      }>
  );

type Moments = Readonly<{ mean: number; standardDeviation: number }>;

/**
 * The baseline phase that a game of `phase` is compared with (STA-18, CL-STA-02): a
 * regular-season game with the regular season of its season; a play-in or playoff game
 * with the postseason, the play-in and playoff games of its season together, or with its
 * season's regular season when games.postseasonBaseline says so.
 */
export function baselinePhaseOf(phase: GamePhase, params: EngineParams): BaselinePhase {
  return phase === 'regular_season' ? 'regular_season' : params.games.postseasonBaseline;
}

/**
 * Whether `game` is one of the games of a baseline of `phase` (STA-18, CL-STA-02): a
 * regular-season baseline holds the regular-season games alone, even when a play-in or
 * playoff game is compared with it, and a postseason baseline the play-in and playoff games.
 */
function isGameOf(phase: BaselinePhase, game: BaselineGame): boolean {
  return (game.phase === 'regular_season') === (phase === 'regular_season');
}

/** Scheduled start, then game id: the fixed order of every sum (CL-STA-09). */
function inFixedOrder(left: BaselineGame, right: BaselineGame): number {
  const byStart = left.scheduledStartAt - right.scheduledStartAt;
  return byStart === 0 ? left.gameId - right.gameId : byStart;
}

/** The indices of the usable games of `games` but the measured game, in the fixed order. */
function retainedIndices(
  games: readonly BaselineGame[],
  excludedGameId: GameId,
): readonly number[] {
  return games
    .filter((game) => game.gameId !== excludedGameId)
    .toSorted(inFixedOrder)
    .flatMap((game) => (game.classification === 'usable' ? game.performanceIndex : []));
}

/** The sum of `values`, added in their order. */
function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * The mean of `indices` and their sample standard deviation (STA-16, H-STA-04): the sum
 * of the indices divided by their number, and the square root of the sum of their squared
 * differences to that mean divided by their number minus one. Indices that are all the
 * same have a deviation of exactly zero, which the rounded sums can miss: ten indices of
 * 0.1 add up to a mean one unit in the last place below 0.1.
 */
function momentsOf(indices: readonly number[]): Moments {
  const mean = sumOf(indices) / indices.length;
  const [first] = indices;
  const squares = indices.map((index) => (index - mean) ** 2);
  return {
    mean,
    standardDeviation: indices.every((index) => index === first)
      ? 0
      : Math.sqrt(sumOf(squares) / (indices.length - 1)),
  };
}

/** The mean from one game on and the deviation from two, of a baseline short of its minimum. */
function shortMoments(
  indices: readonly number[],
): Readonly<{ mean: number | null; standardDeviation: number | null }> {
  if (indices.length === 0) {
    return { mean: null, standardDeviation: null };
  }
  const { mean, standardDeviation } = momentsOf(indices);
  return {
    mean,
    standardDeviation: indices.length < MIN_GAMES_FOR_DEVIATION ? null : standardDeviation,
  };
}

/**
 * The status of a baseline that reaches its minimum of games (STA-19 to STA-21, CL-STA-08):
 * insufficient when its deviation is zero, whatever the phase; final once the phase is
 * finished and its last game consolidated; provisional before.
 */
function reachedStatus(
  standardDeviation: number,
  phaseState: PhaseState,
): Exclude<SeasonBaselineStatus, 'building'> {
  if (standardDeviation === 0) {
    return 'insufficient';
  }
  return phaseState.finished && phaseState.lastGameConsolidated ? 'final' : 'provisional';
}

/**
 * Whether more than games.partialBaselineShare percent of the games he played lack an
 * index, a game of unknown participation counting on both sides (STA-24, CL-STA-04).
 */
function isPartialOf(games: readonly BaselineGame[], params: EngineParams): boolean {
  const counted = games.filter((game) => game.classification !== 'not_played');
  const missing = counted.filter((game) => game.performanceIndex === null);
  return PERCENT * missing.length > params.games.partialBaselineShare * counted.length;
}

/**
 * The season baseline of a measured game (STA-16 to STA-22, STA-24, CL-STA-02, CL-STA-04,
 * CL-STA-08, CL-STA-09). It averages the indices of the usable games of `input.games` in
 * the baseline phase, before and after the measured game, which alone is left out: the
 * measured games of other cases stay. The indices add up by scheduled start, then game id.
 * Its status: building below games.minBaselineGames games while the phase runs, and
 * insufficient once the phase is finished below it; then insufficient when the deviation
 * is zero, whatever the phase; provisional while the phase runs or its last game is in
 * its correction window; final once that game is consolidated. It is partial when more
 * than games.partialBaselineShare percent of the played games of the season and baseline
 * phase, the measured game among them, lack an index, their box score incomplete or
 * suspect, a game of unknown participation counting as played and without an index.
 */
export function seasonBaseline(input: SeasonBaselineInput, params: EngineParams): SeasonBaseline {
  const { phase, excludedGameId, phaseState } = input;
  const games = input.games.filter((game) => isGameOf(phase, game));
  const indices = retainedIndices(games, excludedGameId);
  const isPartial = isPartialOf(games, params);
  if (indices.length < params.games.minBaselineGames) {
    return {
      ...shortMoments(indices),
      gameCount: indices.length,
      status: phaseState.finished ? 'insufficient' : 'building',
      isPartial,
    };
  }
  const moments = momentsOf(indices);
  return {
    ...moments,
    gameCount: indices.length,
    status: reachedStatus(moments.standardDeviation, phaseState),
    isPartial,
  };
}

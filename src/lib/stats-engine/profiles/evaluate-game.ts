// What a player's case reads of its measured game (SEN-03, SEN-08, SEN-11 to SEN-16,
// STA-12 to STA-24, CL-SEN-05, CL-SEN-09): his team games and the stored schedules, from
// which his statistics in a game, the baseline of its season and phase, the run of games
// he missed before it, the playing-time threshold of its season, the automatic criteria
// of the case and its review flags are computed.

import { baselinePhaseOf, seasonBaseline } from '../baseline/season-baseline';
import { doubtfulCaseCriteria } from '../cases/doubtful-criteria';
import { caseReviewFlags } from '../cases/review-flags';
import { performanceIndex } from '../performance/performance-index';
import { classifyGame, playingTimeThreshold } from '../performance/playing-time';
import { phaseState } from '../schedule/phase-state';
import { byScheduledStart } from '../schedule/series';

import type { BaselineGame, SeasonBaseline } from '../baseline/season-baseline';
import type { MeasuredGameStatistics } from '../cases/case-state';
import type {
  ContextIndications,
  DoubtfulCaseCriteriaInput,
  TriggeredCriterion,
} from '../cases/doubtful-criteria';
import type { ManualDecision } from '../cases/manual-decisions';
import type { ReviewFlag } from '../cases/review-flags';
import type { BoxScoreCheck, CheckedBoxScore } from '../performance/box-score';
import type { PhaseGame, PhaseState, SeasonSchedule } from '../schedule/phase-state';
import type { LinesGame, TeamGame } from '../schedule/team-membership';
import type {
  BaselinePhase,
  EngineParams,
  EpochMs,
  EventTypeId,
  GameId,
  IsoDate,
  TeamId,
} from '../types';

/**
 * A game of the stored schedule that is one of his team games (STA-27): its lines, its
 * consolidation (STA-33), its season (STA-48), its two teams, set since no placeholder is
 * a team game (CL-STA-14), and whether a loss in it eliminates a team, null when that is
 * unknown or the game is not a playoff game (CL-STA-18).
 */
export type EvaluationGame = LinesGame &
  PhaseGame &
  Readonly<{ season: string; homeTeamId: TeamId; awayTeamId: TeamId }> &
  Readonly<{ isEliminationGame: boolean | null }>;

/**
 * One of his team games, as teamGames gives it, with the marks of the attachment
 * (AttachmentGame), the check of his line, null when the source gives him none
 * (verifyBoxScore), and whether the source reports him ejected, null when it does not say
 * (CL-SEN-11).
 */
export type EvaluationTeamGame = TeamGame<EvaluationGame> &
  Readonly<{ gameDayOn: IsoDate; endOfDayPacificAt: EpochMs; isBoxScoreUnavailable: boolean }> &
  Readonly<{ boxScore: BoxScoreCheck | null; ejected: boolean | null }>;

/** The baseline a case was measured against (SEN-08, STA-16), with its season and phase. */
export type BaselineUsed = SeasonBaseline & Readonly<{ season: string; phase: BaselinePhase }>;

/**
 * What a case records of its measured game (SEN-03, SEN-08, STA-12, STA-14, STA-16):
 * the run of team games he missed right before it in its season, the playing-time
 * threshold of that season, his minutes, and, once his box score is complete, his
 * performance index and the baseline used; all null when it has no measured game.
 */
export type MeasuredValues = Readonly<{
  teamGamesMissedBefore: number | null;
  playingTimeThresholdMinutes: number | null;
  measuredMinutes: number | null;
  performanceIndex: number | null;
  baseline: BaselineUsed | null;
}>;

/** The automatic criteria of a case whose gap is computed, and their notices (SEN-11). */
export type Judgment = Readonly<{
  triggeredCriteria: readonly TriggeredCriterion[];
  opponentStrengthNotEvaluable: boolean;
  stakesNotEvaluable: boolean;
}>;

/** What a case reads of its measured game: its values, criteria and review flags. */
export type GameFacts = Readonly<{
  values: MeasuredValues;
  judgment: Judgment;
  reviewFlags: readonly ReviewFlag[];
}>;

/**
 * What the criteria of a case read besides its game (SEN-13 to SEN-15, CL-SEN-28): the
 * context indications of each of its events, its co-occurring types, the criterion its
 * type's sheet switches off, and its manual decisions, which raise a review flag.
 */
type CaseFacts = Readonly<{
  contextIndications: readonly ContextIndications[];
  coOccurringTypeIds: readonly EventTypeId[];
  switchedOffCriterion: DoubtfulCaseCriteriaInput['switchedOffCriterion'];
  decisions: readonly ManualDecision[];
}>;

/**
 * What the measurement of a game reads: his team games, every season's, the stored
 * schedule of each season, the instant of the evaluation, the parameters, and his team
 * games by id.
 */
type GameContext = Readonly<{
  input: Readonly<{
    teamGames: readonly EvaluationTeamGame[];
    schedules: readonly Readonly<{ season: string; schedule: SeasonSchedule }>[];
    now: EpochMs;
  }>;
  params: EngineParams;
  gameById: ReadonlyMap<GameId, EvaluationTeamGame>;
}>;

/** The criteria of a case whose gap is not computed: none, and no notice (SEN-07, SEN-11). */
export const NOT_JUDGED: Judgment = {
  triggeredCriteria: [],
  opponentStrengthNotEvaluable: false,
  stakesNotEvaluable: false,
};
/** What a case without a measured game records of it: nothing (SEN-07). */
export const NO_GAME: GameFacts = {
  values: {
    teamGamesMissedBefore: null,
    playingTimeThresholdMinutes: null,
    measuredMinutes: null,
    performanceIndex: null,
    baseline: null,
  },
  judgment: NOT_JUDGED,
  reviewFlags: [],
};
// A season is written `2024-25`: its first year is its first four characters, and its
// second year is written by the last two digits of the year after (seasons.ts).
const YEAR_LENGTH = 4;
const CENTURY_DIGITS = 2;

/**
 * One of his team games, from its id (CL-SEN-05): an id that is none of them is a bug of
 * the caller.
 */
export function teamGameOf(gameId: GameId, context: GameContext): EvaluationTeamGame {
  const teamGame = context.gameById.get(gameId);
  if (teamGame === undefined) {
    throw new Error(`Game ${String(gameId)} is not one of his team games`);
  }
  return teamGame;
}

/**
 * The stored schedule of `season`, which the season of a measured game always has: a
 * season without it is a bug of the caller.
 */
function scheduleOf(season: string, context: GameContext): SeasonSchedule {
  const stored = context.input.schedules.find((each) => each.season === season);
  if (stored === undefined) {
    throw new Error(`The schedule of ${season} is not stored`);
  }
  return stored.schedule;
}

/** The games of the stored schedule of `season`, none when it is not stored (SEN-15). */
function storedGamesOf(season: string, context: GameContext): readonly PhaseGame[] {
  return context.input.schedules
    .filter((each) => each.season === season)
    .flatMap(({ schedule }) => schedule.games);
}

/** The season before `season`: `2017-18` before `2018-19`, `1999-00` before `2000-01`. */
function previousSeasonOf(season: string): string {
  const firstYear = Number(season.slice(0, YEAR_LENGTH)) - 1;
  return `${String(firstYear)}-${season.slice(CENTURY_DIGITS, YEAR_LENGTH)}`;
}

/** His team games of `season`, of every phase, in any order. */
function seasonGamesOf(season: string, context: GameContext): readonly EvaluationTeamGame[] {
  return context.input.teamGames.filter(({ game }) => game.season === season);
}

/** His final team games of `season`, of known or unknown participation (CL-STA-04). */
function finalGamesOf(season: string, context: GameContext): readonly EvaluationTeamGame[] {
  return seasonGamesOf(season, context).filter(({ participation }) => participation !== null);
}

/** The playing-time threshold of `season`, one for its baselines and measured games (CL-STA-07). */
function thresholdOf(season: string, context: GameContext): number {
  const games = finalGamesOf(season, context).map(({ game, boxScore }) => ({
    gameId: game.id,
    scheduledStartAt: game.scheduledStartAt,
    phase: game.phase,
    boxScore,
  }));
  return playingTimeThreshold(games, context.params);
}

/**
 * A final team game as a baseline reads it (STA-13, STA-14, STA-24): with no line of his,
 * not played, or of no class while its participation is unknown; with an incomplete or
 * suspect line, played but not usable and without an index; with a complete one, usable
 * or not as classifyGame says against the season's threshold, with its index.
 */
function baselineGameOf(teamGame: EvaluationTeamGame, threshold: number): BaselineGame {
  const { game, boxScore } = teamGame;
  const key = { gameId: game.id, scheduledStartAt: game.scheduledStartAt, phase: game.phase };
  if (boxScore === null) {
    const classification = teamGame.participation === 'unknown' ? null : 'not_played';
    return { ...key, classification, performanceIndex: null };
  }
  if (boxScore.status !== 'complete') {
    return { ...key, classification: 'played_not_usable', performanceIndex: null };
  }
  const index = performanceIndex(boxScore);
  return classifyGame({ ...key, boxScore }, threshold) === 'usable'
    ? { ...key, classification: 'usable', performanceIndex: index }
    : { ...key, classification: 'played_not_usable', performanceIndex: index };
}

/**
 * The state of the baseline phase of a measured game (STA-20, CL-STA-02): the regular
 * season league-wide at the evaluation's instant, or his team's postseason, which a
 * postseason game of his team always has: a schedule without it is a bug of the caller.
 */
function phaseStateOf(
  teamGame: EvaluationTeamGame,
  phase: BaselinePhase,
  context: GameContext,
): PhaseState {
  const { season } = teamGame.game;
  const schedule = scheduleOf(season, context);
  if (phase === 'regular_season') {
    return phaseState(schedule, { regularSeasonAt: context.input.now });
  }
  const state = phaseState(schedule, { postseasonTeamId: teamGame.teamId });
  if (state === null) {
    throw new Error(`The schedule of ${season} holds no postseason of his team`);
  }
  return state;
}

/**
 * The baseline of a measured game (STA-16 to STA-22, STA-24): his final team games of its
 * season, in its baseline phase, the measured game left out.
 */
function baselineOf(teamGame: EvaluationTeamGame, context: GameContext): BaselineUsed {
  const { game } = teamGame;
  const phase = baselinePhaseOf(game.phase, context.params);
  const threshold = thresholdOf(game.season, context);
  const baselineInput = {
    games: finalGamesOf(game.season, context).map((each) => baselineGameOf(each, threshold)),
    phase,
    excludedGameId: game.id,
    phaseState: phaseStateOf(teamGame, phase, context),
  };
  return { season: game.season, phase, ...seasonBaseline(baselineInput, context.params) };
}

/**
 * The statistics of a game he played (CL-SEN-05 steps 8 and 9, STA-14, STA-16): his
 * complete box score with its index and baseline; or an incomplete or suspect one, with
 * whether the game is still in its correction window (STA-33). A game he played without
 * the check of his line is a bug of the caller.
 */
export function statisticsOf(gameId: GameId, context: GameContext): MeasuredGameStatistics {
  const teamGame = teamGameOf(gameId, context);
  const { boxScore } = teamGame;
  if (boxScore === null) {
    throw new Error(`Game ${String(gameId)} has no checked line of his`);
  }
  if (boxScore.status === 'complete') {
    return {
      boxScoreStatus: 'complete',
      performanceIndex: performanceIndex(boxScore),
      baseline: baselineOf(teamGame, context),
    };
  }
  const isConsolidated = teamGame.game.consolidatedAt !== null;
  return {
    boxScoreStatus: boxScore.status,
    consolidation: isConsolidated ? 'consolidated' : 'in_correction_window',
  };
}

/** The run of his final team games missed right before `teamGame` in its season (CL-SEN-09). */
function missedBefore(teamGame: EvaluationTeamGame, context: GameContext): number {
  const before = finalGamesOf(teamGame.game.season, context)
    .filter(({ game }) => byScheduledStart(game, teamGame.game) < 0)
    .toSorted((left, right) => byScheduledStart(right.game, left.game));
  const lastPlayed = before.findIndex(({ participation }) => participation === 'played');
  return lastPlayed === -1 ? before.length : lastPlayed;
}

/**
 * The automatic criteria of a case whose measured game has his complete box score
 * (SEN-11 to SEN-15, SEN-06, CL-SEN-28): read on his team games and the playing-time
 * threshold of its season, the schedules of that season and of the one before, and the
 * facts of the case. Only a case whose gap is computed keeps them.
 */
function judgmentOf(
  measured: Readonly<{ teamGame: EvaluationTeamGame; boxScore: CheckedBoxScore }>,
  facts: CaseFacts,
  context: GameContext,
): Judgment {
  const { teamGame, boxScore } = measured;
  const { game } = teamGame;
  const input: DoubtfulCaseCriteriaInput = {
    measuredGame: {
      game,
      teamId: teamGame.teamId,
      minutes: boxScore.decimalMinutes,
      isEliminationGame: game.isEliminationGame,
    },
    seasonTeamGames: seasonGamesOf(game.season, context),
    playingTimeThresholdMinutes: thresholdOf(game.season, context),
    seasonSchedule: scheduleOf(game.season, context).games,
    previousSeasonSchedule: storedGamesOf(previousSeasonOf(game.season), context),
    contextIndications: facts.contextIndications,
    coOccurringTypeIds: facts.coOccurringTypeIds,
    switchedOffCriterion: facts.switchedOffCriterion,
  };
  return doubtfulCaseCriteria(input, context.params);
}

/**
 * What a case records of its measured game (SEN-03, SEN-08, SEN-16, STA-12, STA-14,
 * STA-16): the run of games he missed right before it, the threshold of its season and
 * his minutes; with his complete box score, his index, the baseline and the automatic
 * criteria; and the review flags, which read his team games and the case's decisions.
 */
export function gameFactsOf(
  teamGame: EvaluationTeamGame,
  facts: CaseFacts,
  context: GameContext,
): GameFacts {
  const { boxScore, game } = teamGame;
  const checked = boxScore?.status === 'complete' ? boxScore : null;
  return {
    values: {
      teamGamesMissedBefore: missedBefore(teamGame, context),
      playingTimeThresholdMinutes: thresholdOf(game.season, context),
      measuredMinutes: boxScore?.decimalMinutes ?? null,
      performanceIndex: checked === null ? null : performanceIndex(checked),
      baseline: checked === null ? null : baselineOf(teamGame, context),
    },
    judgment:
      checked === null ? NOT_JUDGED : judgmentOf({ teamGame, boxScore: checked }, facts, context),
    reviewFlags: caseReviewFlags({
      measuredGame: { id: game.id, ejected: teamGame.ejected },
      teamGames: context.input.teamGames,
      decisions: facts.decisions,
    }),
  };
}

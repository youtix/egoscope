// The doubtful-case criteria (SEN-11 to SEN-15, and SEN-06 while its parameter is on):
// the automatic criteria that exclude a case whose gap is computed, each listed with the
// values that trigger it, and the notices of the criteria that could not be evaluated
// (CL-SEN-10). None of them reads the measured game's performance or its result: they
// look at the playing time, the absences, the stakes, the opponent and the co-occurring
// types. A type sheet can switch one of them off, and that one is then never evaluated
// for the type's cases (ADR 0016, CL-SEN-13). Manual decisions (SEN-17) are not among them.

import { byScheduledStart } from '../schedule/series';
import { teamRecord } from '../schedule/team-record';

import type { Participation } from '../performance/participation';
import type { TeamWinLossRecord } from '../schedule/team-record';
import type {
  EngineParams,
  EpochMs,
  EventTypeId,
  GameId,
  GamePhase,
  ScheduleGame,
  TeamId,
} from '../types';

// sensitivity.opponentWinShareLow and sensitivity.opponentWinShareHigh are percentages.
const PERCENT = 100;

/**
 * The context indications of an event (SEN-13, SEN-14): whether the press presents its
 * measured game as a return from injury, and the stakes of that game, each possibly
 * unknown, whether research, the classification or the owner set it.
 */
export type ContextIndications = Readonly<{
  injuryReturn: 'yes' | 'no' | 'unknown';
  gameStakes: 'high' | 'normal' | 'unknown';
}>;

/**
 * A criterion that applies to a case, with the values that trigger it (SEN-11, SEN-18),
 * as a row of `case_triggered_criteria` holds it. Its condition, for a return from injury
 * and unusual stakes only, tells whether a context indication flagged it or the
 * statistics gave it (SEN-13, SEN-14).
 */
export type TriggeredCriterion =
  | Readonly<{
      criterion: 'playing_time_too_low';
      condition: null;
      /** His decimal minutes, and the playing-time threshold they stay under (SEN-12). */
      triggeringValues: Readonly<{ minutes: number; threshold: number }>;
    }>
  | Readonly<{
      criterion: 'injury_return';
      condition: 'flagged';
      triggeringValues: Readonly<{ injuryReturn: 'yes' }>;
    }>
  | Readonly<{
      criterion: 'injury_return';
      condition: 'calculated';
      /** The run of team games he missed, and how many of them had no box score (CL-SEN-09). */
      triggeringValues: Readonly<{ runLength: number; gamesWithoutBoxScore: number }>;
    }>
  | Readonly<{
      criterion: 'unusual_stakes';
      condition: 'flagged';
      triggeringValues: Readonly<{ gameStakes: 'high' }>;
    }>
  | Readonly<{
      criterion: 'unusual_stakes';
      condition: 'calculated';
      /** A play-in game, or a playoff game with its elimination flag (SEN-14, CL-STA-18). */
      triggeringValues:
        | Readonly<{ phase: 'play_in' }>
        | Readonly<{ phase: 'playoffs'; isEliminationGame: boolean | null }>;
    }>
  | Readonly<{
      criterion: 'opponent_strength';
      condition: null;
      /** The opponent's record behind its share of wins, and whether it is the previous season's (SEN-15). */
      triggeringValues: Readonly<{ wins: number; losses: number; isPreviousSeason: boolean }>;
    }>
  | Readonly<{
      criterion: 'co_occurring';
      condition: null;
      /** The other types whose cases share the measured game (SEN-06). */
      triggeringValues: Readonly<{ coOccurringTypeIds: readonly EventTypeId[] }>;
    }>;

/** A criterion that a type sheet can switch off: every automatic one (ADR 0016, CL-SEN-13). */
type AutomaticCriterion = TriggeredCriterion['criterion'];

/** One of his team games, with his participation, null while the game is not final (CL-STA-04). */
type SeasonTeamGame = Readonly<{
  game: Readonly<{ id: GameId; scheduledStartAt: EpochMs }>;
  participation: Participation | null;
}>;

/** What the criteria of a case read (SEN-11 to SEN-15, SEN-06). */
export type DoubtfulCaseCriteriaInput = Readonly<{
  /**
   * The measured game, a final game that he played (SEN-03): the game, whose two teams
   * are set (CL-STA-14), his team in it (CL-STA-05), his decimal minutes from its complete
   * box score (STA-12) and whether a loss in it eliminates a team, as
   * `games.is_elimination_game` holds it, null when that is unknown or the game is not a
   * playoff game (STA-07, CL-STA-18). Its result is not among them.
   */
  measuredGame: Readonly<{
    game: Readonly<{
      id: GameId;
      scheduledStartAt: EpochMs;
      phase: GamePhase;
      homeTeamId: TeamId;
      awayTeamId: TeamId;
    }>;
    teamId: TeamId;
    minutes: number;
    isEliminationGame: boolean | null;
  }>;
  /**
   * His team games of the measured game's season, of every phase, in any order, as
   * teamGames gives them (CL-STA-05): no game of another season (CL-SEN-09).
   */
  seasonTeamGames: readonly SeasonTeamGame[];
  /**
   * The playing-time threshold of that season, which playingTimeThreshold gives once for
   * its baselines and its measured games alike (STA-14, STA-15, CL-STA-07).
   */
  playingTimeThresholdMinutes: number;
  /** The stored schedule of that season, every team's games, the measured game among them (STA-06). */
  seasonSchedule: readonly ScheduleGame[];
  /** The stored schedule of the season before it, empty when none is stored (SEN-15). */
  previousSeasonSchedule: readonly ScheduleGame[];
  /** The context indications of each of the case's events (SEN-05, CL-SEN-28). */
  contextIndications: readonly ContextIndications[];
  /** The other types whose cases share the measured game, none when it is not co-occurring (SEN-06). */
  coOccurringTypeIds: readonly EventTypeId[];
  /** The criterion that the type sheet switches off, null when none is (ADR 0016, CL-SEN-13). */
  switchedOffCriterion: AutomaticCriterion | null;
}>;

/**
 * The automatic criteria of a case (SEN-11): those that apply, in the glossary's order of
 * the criteria and, within one, the flagged condition before the calculated one; and the
 * notices that the opponent's level or the calculated stakes could not be evaluated,
 * neither of which excludes the case (SEN-15, CL-SEN-10).
 */
export type DoubtfulCaseCriteria = Readonly<{
  triggeredCriteria: readonly TriggeredCriterion[];
  opponentStrengthNotEvaluable: boolean;
  stakesNotEvaluable: boolean;
}>;

/** What one criterion gives: the entries it triggers, and whether it could not be evaluated. */
type Evaluation = Readonly<{
  triggeredCriteria: readonly TriggeredCriterion[];
  isNotEvaluable: boolean;
}>;

/** A run of team games he missed (CL-SEN-09). */
type AbsenceRun = Readonly<{ runLength: number; gamesWithoutBoxScore: number }>;

/** The opponent's record that its level is judged on (SEN-15). */
type JudgedRecord = TeamWinLossRecord & Readonly<{ isPreviousSeason: boolean }>;

const NOT_TRIGGERED: Evaluation = { triggeredCriteria: [], isNotEvaluable: false };
const NOT_EVALUABLE: Evaluation = { triggeredCriteria: [], isNotEvaluable: true };
const NO_RUN: AbsenceRun = { runLength: 0, gamesWithoutBoxScore: 0 };

const FLAGGED_INJURY_RETURN: TriggeredCriterion = {
  criterion: 'injury_return',
  condition: 'flagged',
  triggeringValues: { injuryReturn: 'yes' },
};
const FLAGGED_STAKES: TriggeredCriterion = {
  criterion: 'unusual_stakes',
  condition: 'flagged',
  triggeringValues: { gameStakes: 'high' },
};

/** The evaluation of a criterion that applies, with one entry. */
function triggered(criterion: TriggeredCriterion): Evaluation {
  return { triggeredCriteria: [criterion], isNotEvaluable: false };
}

/** Playing time too low (SEN-12): his minutes do not reach the threshold of the season. */
function playingTimeTooLow(input: DoubtfulCaseCriteriaInput): readonly TriggeredCriterion[] {
  const { minutes } = input.measuredGame;
  const threshold = input.playingTimeThresholdMinutes;
  return minutes < threshold
    ? [
        {
          criterion: 'playing_time_too_low',
          condition: null,
          triggeringValues: { minutes, threshold },
        },
      ]
    : [];
}

/**
 * The runs of team games he missed in `before`, his team games latest first, each ended
 * by a game he played: the run right before the first of them, then the run before the
 * next one he played, and so on, the run up to the start of the season last. A game of
 * unknown participation is missed, and has no box score (CL-STA-04, CL-SEN-09).
 */
function absenceRuns(before: readonly SeasonTeamGame[]): readonly AbsenceRun[] {
  const runs: AbsenceRun[] = [];
  let run = NO_RUN;
  for (const { participation } of before) {
    if (participation === 'played') {
      runs.push(run);
      run = NO_RUN;
    } else {
      const withoutBoxScore = participation === 'unknown' ? 1 : 0;
      run = {
        runLength: run.runLength + 1,
        gamesWithoutBoxScore: run.gamesWithoutBoxScore + withoutBoxScore,
      };
    }
  }
  return [...runs, run];
}

/**
 * The run of absences that makes the measured game a return from injury (SEN-13,
 * CL-SEN-09): the latest run of at least sensitivity.injuryReturnMinGamesMissed team
 * games he missed in a row, after which the measured game is among the first
 * sensitivity.injuryReturnFirstGames games he played. Only his team games of its season
 * before it count, in the fixed order of scheduled start, then id (CL-STA-09), and a game
 * not final yet counts neither way.
 */
function returnRun(input: DoubtfulCaseCriteriaInput, params: EngineParams): AbsenceRun | undefined {
  const { injuryReturnMinGamesMissed, injuryReturnFirstGames } = params.sensitivity;
  const measured = input.measuredGame.game;
  const before = input.seasonTeamGames
    .filter(
      ({ game, participation }) => participation !== null && byScheduledStart(game, measured) < 0,
    )
    .toSorted((left, right) => byScheduledStart(right.game, left.game));
  return absenceRuns(before)
    .slice(0, injuryReturnFirstGames)
    .find(({ runLength }) => runLength >= injuryReturnMinGamesMissed);
}

/**
 * Return from injury (SEN-13): flagged when one of the case's events says yes, unknown
 * triggering nothing (CL-SEN-28); calculated when the measured game follows a run of
 * absences closely enough (CL-SEN-09).
 */
function injuryReturn(
  input: DoubtfulCaseCriteriaInput,
  params: EngineParams,
): readonly TriggeredCriterion[] {
  const isFlagged = input.contextIndications.some((context) => context.injuryReturn === 'yes');
  const run = returnRun(input, params);
  const calculated: readonly TriggeredCriterion[] =
    run === undefined
      ? []
      : [{ criterion: 'injury_return', condition: 'calculated', triggeringValues: run }];
  return [...(isFlagged ? [FLAGGED_INJURY_RETURN] : []), ...calculated];
}

/**
 * The calculated condition of unusual stakes (SEN-14, CL-SEN-10, CL-STA-18): every
 * play-in game; a playoff game that eliminates a team, or any playoff game with
 * sensitivity.allPlayoffGamesUnusualStakes; not evaluable for another playoff game whose
 * elimination flag is unknown.
 */
function calculatedStakes(
  measuredGame: DoubtfulCaseCriteriaInput['measuredGame'],
  params: EngineParams,
): Evaluation {
  const { game, isEliminationGame } = measuredGame;
  if (game.phase === 'regular_season') {
    return NOT_TRIGGERED;
  }
  if (game.phase === 'play_in') {
    return triggered({
      criterion: 'unusual_stakes',
      condition: 'calculated',
      triggeringValues: { phase: game.phase },
    });
  }
  if (isEliminationGame === true || params.sensitivity.allPlayoffGamesUnusualStakes) {
    return triggered({
      criterion: 'unusual_stakes',
      condition: 'calculated',
      triggeringValues: { phase: game.phase, isEliminationGame },
    });
  }
  return isEliminationGame === null ? NOT_EVALUABLE : NOT_TRIGGERED;
}

/**
 * Unusual stakes (SEN-14): flagged when one of the case's events says high, whether or
 * not the calculated condition can be evaluated (CL-SEN-10, CL-SEN-28); calculated from
 * the game's phase and elimination flag.
 */
function unusualStakes(input: DoubtfulCaseCriteriaInput, params: EngineParams): Evaluation {
  const isFlagged = input.contextIndications.some((context) => context.gameStakes === 'high');
  const calculated = calculatedStakes(input.measuredGame, params);
  return {
    triggeredCriteria: [...(isFlagged ? [FLAGGED_STAKES] : []), ...calculated.triggeredCriteria],
    isNotEvaluable: calculated.isNotEvaluable,
  };
}

/**
 * The opponent's record that its level is judged on (SEN-15, CL-SEN-10, CL-STA-19): the
 * final regular-season games of the measured game's season, the measured game alone left
 * out, the later ones included, and those played so far for a season under way; with fewer
 * than sensitivity.opponentMinGames of them, the whole regular season before; none when
 * that one holds no game either.
 */
function judgedRecord(
  opponentId: TeamId,
  input: DoubtfulCaseCriteriaInput,
  params: EngineParams,
): JudgedRecord | undefined {
  const season = teamRecord(input.seasonSchedule, opponentId, input.measuredGame.game.id);
  if (season.wins + season.losses >= params.sensitivity.opponentMinGames) {
    return { ...season, isPreviousSeason: false };
  }
  const previousSeason = teamRecord(input.previousSeasonSchedule, opponentId);
  return previousSeason.wins + previousSeason.losses > 0
    ? { ...previousSeason, isPreviousSeason: true }
    : undefined;
}

/**
 * Opponent strength (SEN-15, CL-SEN-10): the opponent's share of wins is strictly below
 * sensitivity.opponentWinShareLow or strictly above sensitivity.opponentWinShareHigh,
 * compared without a division, so that a share of exactly 25 % stays normal. Without a
 * record, the criterion is not evaluable.
 */
function opponentStrength(input: DoubtfulCaseCriteriaInput, params: EngineParams): Evaluation {
  const { game, teamId } = input.measuredGame;
  const opponentId = game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;
  const record = judgedRecord(opponentId, input, params);
  if (record === undefined) {
    return NOT_EVALUABLE;
  }
  const { opponentWinShareLow, opponentWinShareHigh } = params.sensitivity;
  const games = record.wins + record.losses;
  const isUnusual =
    PERCENT * record.wins < opponentWinShareLow * games ||
    PERCENT * record.wins > opponentWinShareHigh * games;
  return isUnusual
    ? triggered({ criterion: 'opponent_strength', condition: null, triggeringValues: record })
    : NOT_TRIGGERED;
}

/** Co-occurring (SEN-06): another type's case shares the measured game, while its parameter is on. */
function coOccurring(
  input: DoubtfulCaseCriteriaInput,
  params: EngineParams,
): readonly TriggeredCriterion[] {
  const { coOccurringTypeIds } = input;
  return params.sensitivity.coOccurringCasesDoubtful && coOccurringTypeIds.length > 0
    ? [{ criterion: 'co_occurring', condition: null, triggeringValues: { coOccurringTypeIds } }]
    : [];
}

/**
 * The doubtful-case criteria of a case whose gap is computed (SEN-11 to SEN-15, SEN-06,
 * CL-SEN-05 step 10): every criterion that applies, with the values that trigger it,
 * and the notices of the criteria that could not be evaluated. Playing time too low,
 * return from injury, flagged or calculated, unusual stakes, flagged or calculated,
 * opponent strength, and co-occurring while sensitivity.coOccurringCasesDoubtful is on.
 * The criterion that the type sheet switches off is never evaluated: it neither applies
 * nor gives a notice (ADR 0016, CL-SEN-13). No criterion reads the measured game's
 * performance or its result, and none reads the gap (SEN-11).
 */
export function doubtfulCaseCriteria(
  input: DoubtfulCaseCriteriaInput,
  params: EngineParams,
): DoubtfulCaseCriteria {
  const isEvaluated = (criterion: AutomaticCriterion): boolean =>
    criterion !== input.switchedOffCriterion;
  const stakes = isEvaluated('unusual_stakes') ? unusualStakes(input, params) : NOT_TRIGGERED;
  const opponent = isEvaluated('opponent_strength')
    ? opponentStrength(input, params)
    : NOT_TRIGGERED;
  return {
    triggeredCriteria: [
      ...(isEvaluated('playing_time_too_low') ? playingTimeTooLow(input) : []),
      ...(isEvaluated('injury_return') ? injuryReturn(input, params) : []),
      ...stakes.triggeredCriteria,
      ...opponent.triggeredCriteria,
      ...(isEvaluated('co_occurring') ? coOccurring(input, params) : []),
    ],
    opponentStrengthNotEvaluable: opponent.isNotEvaluable,
    stakesNotEvaluable: stakes.isNotEvaluable,
  };
}

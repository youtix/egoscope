// A box score is checked before any calculation (STA-09), and it is incomplete when it
// lacks its time on court or a total of the Game Score (STA-10); no missing value is
// ever replaced. Only verifyBoxScore makes a CheckedBoxScore, the one box score that the
// performance index accepts: its brand is a symbol that no other file can name, so a
// raw line does not compile where a checked one is due.

import type { GameScoreInput } from './game-score';

// A game lasts 48 minutes, and each overtime adds 5 (STA-09).
const REGULATION_MINUTES = 48;
const OVERTIME_MINUTES = 5;
/** The seconds of a minute, by which whole seconds make decimal minutes (STA-12). */
export const SECONDS_PER_MINUTE = 60;
// A made field goal scores 2 points; a three-pointer 1 more, a free throw 1 (STA-09).
const FIELD_GOAL_POINTS = 2;

// The twelve totals of the Game Score, in the order of STA-08.
const GAME_SCORE_TOTALS: readonly (keyof GameScoreInput)[] = [
  'points',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'freeThrowsMade',
  'freeThrowsAttempted',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'personalFouls',
];

const checkedBrand: unique symbol = Symbol();

/**
 * One player's line for one game as the source gives it (STA-08), each value null when
 * the source does not provide it. A source gives whole minutes, rounded to the nearest
 * minute, as the chosen one does (`whole_minutes`, CL-STA-06), or minutes and seconds.
 * The three-pointers made serve the points check only (STA-09).
 */
export type BoxScoreLine = Readonly<{ [Total in keyof GameScoreInput]: number | null }> &
  Readonly<{ threePointersMade: number | null }> &
  (
    | Readonly<{ minutesPrecision: 'whole_minutes'; minutes: number | null; seconds: null }>
    | Readonly<{ minutesPrecision: 'seconds'; minutes: number | null; seconds: number | null }>
  );

/** A consistency check of STA-09 that a line fails, as `box_scores.failed_checks` stores it. */
export type FailedCheck =
  | 'negative_value'
  | 'made_above_attempted'
  | 'points_mismatch'
  | 'minutes_above_game_length'
  | 'statistic_without_minutes';

/** What an incomplete line lacks (STA-10): its minutes, its seconds or a total of the Game Score. */
export type MissingElement = 'minutes' | 'seconds' | keyof GameScoreInput;

/**
 * A box score that verifyBoxScore found complete and consistent (STA-09, STA-10), the
 * only one that has a performance index (STA-12): the twelve totals of the Game Score,
 * and his time on court in whole seconds and in decimal minutes, above zero. Its brand
 * lives under a symbol of this file, so no other code can make one, from a raw line or
 * from an object literal.
 */
export type CheckedBoxScore = GameScoreInput &
  Readonly<{
    status: 'complete';
    hasRoundedMinutes: boolean;
    secondsOnCourt: number;
    decimalMinutes: number;
    [checkedBrand]: typeof checkedBrand;
  }>;

/**
 * What verifyBoxScore says of a line: complete, as a CheckedBoxScore; incomplete, with
 * what it lacks; or suspect, with the checks it fails. Each says whether the line carries
 * the "rounded minutes" mention (STA-12) and gives his time on court in whole seconds,
 * which the playing-time threshold adds up exactly (CL-STA-09), and in decimal minutes,
 * both null unless that time is known and above zero.
 */
export type BoxScoreCheck =
  | CheckedBoxScore
  | Readonly<{
      status: 'incomplete';
      hasRoundedMinutes: boolean;
      secondsOnCourt: number | null;
      decimalMinutes: number | null;
      missing: readonly MissingElement[];
    }>
  | Readonly<{
      status: 'suspect';
      hasRoundedMinutes: boolean;
      secondsOnCourt: number | null;
      decimalMinutes: number | null;
      failedChecks: readonly FailedCheck[];
    }>;

/** Whether `value` is known and above `bound`: an unknown value is above nothing. */
function isKnownAbove(value: number | null, bound: number): boolean {
  return (value ?? bound) > bound;
}

/**
 * His time on court in whole seconds, when the line gives it: 34 min 30 s is 2,070 and 35
 * whole minutes 2,100 (STA-12, CL-STA-06).
 */
function secondsOf(line: BoxScoreLine): number | null {
  const seconds = line.minutesPrecision === 'whole_minutes' ? 0 : line.seconds;
  return seconds === null || line.minutes === null
    ? null
    : SECONDS_PER_MINUTE * line.minutes + seconds;
}

/**
 * His time on court in decimal minutes, when the line gives it (STA-12): its whole seconds
 * divided by 60 at once, so 34 min 30 s is 34.5 and 35 whole minutes are 35 exactly.
 */
function timeOnCourt(line: BoxScoreLine): number | null {
  const seconds = secondsOf(line);
  return seconds === null ? null : seconds / SECONDS_PER_MINUTE;
}

// His time on court as a check gives it, in whole seconds and in decimal minutes, or none
// while it is unknown or zero.
type CheckedTime =
  | Readonly<{ secondsOnCourt: number; decimalMinutes: number }>
  | Readonly<{ secondsOnCourt: null; decimalMinutes: null }>;

const NO_TIME: CheckedTime = { secondsOnCourt: null, decimalMinutes: null };

/** His time on court when it is known and above zero (STA-12): an unknown time is none. */
function checkedTimeOf(line: BoxScoreLine): CheckedTime {
  const seconds = secondsOf(line) ?? 0;
  return seconds > 0
    ? { secondsOnCourt: seconds, decimalMinutes: seconds / SECONDS_PER_MINUTE }
    : NO_TIME;
}

/**
 * The thirteen counts of a line (STA-08): the totals of the Game Score, then the
 * three-pointers made. The time on court is not among them.
 */
export function countsOf(line: BoxScoreLine): readonly (number | null)[] {
  return [...GAME_SCORE_TOTALS.map((total) => line[total]), line.threePointersMade];
}

function hasNegativeValue(line: BoxScoreLine): boolean {
  // An unknown value is not below zero.
  return [line.minutes, line.seconds, ...countsOf(line)].some((value) => (value ?? 0) < 0);
}

function isMadeAboveAttempted(made: number | null, attempted: number | null): boolean {
  return made !== null && attempted !== null && made > attempted;
}

function hasMadeAboveAttempted(line: BoxScoreLine): boolean {
  return (
    isMadeAboveAttempted(line.fieldGoalsMade, line.fieldGoalsAttempted) ||
    isMadeAboveAttempted(line.freeThrowsMade, line.freeThrowsAttempted)
  );
}

function hasPointsMismatch(line: BoxScoreLine): boolean {
  const { points, fieldGoalsMade, threePointersMade, freeThrowsMade } = line;
  return (
    points !== null &&
    fieldGoalsMade !== null &&
    threePointersMade !== null &&
    freeThrowsMade !== null &&
    points !== FIELD_GOAL_POINTS * fieldGoalsMade + threePointersMade + freeThrowsMade
  );
}

function isAboveGameLength(line: BoxScoreLine, overtimeCount: number | null): boolean {
  // Unknown overtimes skip the bound (CL-STA-03). While the seconds are unknown, the known
  // minutes alone can already exceed it.
  return (
    overtimeCount !== null &&
    isKnownAbove(
      timeOnCourt(line) ?? line.minutes,
      REGULATION_MINUTES + OVERTIME_MINUTES * overtimeCount,
    )
  );
}

function hasStatisticWithoutMinutes(line: BoxScoreLine): boolean {
  // Zero whole minutes stand for less than 30 seconds on court (CL-STA-06): only a source
  // in seconds says that he played no time at all.
  return (
    line.minutesPrecision === 'seconds' &&
    timeOnCourt(line) === 0 &&
    countsOf(line).some((value) => value !== null && value !== 0)
  );
}

// The checks of STA-09, in the order of `box_scores.failed_checks`.
const CHECKS: readonly Readonly<{
  name: FailedCheck;
  fails: (line: BoxScoreLine, overtimeCount: number | null) => boolean;
}>[] = [
  { name: 'negative_value', fails: hasNegativeValue },
  { name: 'made_above_attempted', fails: hasMadeAboveAttempted },
  { name: 'points_mismatch', fails: hasPointsMismatch },
  { name: 'minutes_above_game_length', fails: isAboveGameLength },
  { name: 'statistic_without_minutes', fails: hasStatisticWithoutMinutes },
];

/** Whether the line gives the twelve totals of the Game Score (STA-10). */
function hasEveryTotal(line: BoxScoreLine): line is BoxScoreLine & GameScoreInput {
  return GAME_SCORE_TOTALS.every((total) => line[total] !== null);
}

function totalsOf(line: GameScoreInput): GameScoreInput {
  return {
    points: line.points,
    fieldGoalsMade: line.fieldGoalsMade,
    fieldGoalsAttempted: line.fieldGoalsAttempted,
    freeThrowsMade: line.freeThrowsMade,
    freeThrowsAttempted: line.freeThrowsAttempted,
    offensiveRebounds: line.offensiveRebounds,
    defensiveRebounds: line.defensiveRebounds,
    assists: line.assists,
    steals: line.steals,
    blocks: line.blocks,
    turnovers: line.turnovers,
    personalFouls: line.personalFouls,
  };
}

/** The time elements of a line without a time on court above zero (STA-10, CL-STA-06). */
function missingTimeOf(line: BoxScoreLine): readonly MissingElement[] {
  if (line.minutesPrecision === 'whole_minutes') {
    // Unknown, or zero: less than 30 seconds on court, a time that is not known.
    return ['minutes'];
  }
  const timeElements: readonly Extract<MissingElement, 'minutes' | 'seconds'>[] = [
    'minutes',
    'seconds',
  ];
  const unknown = timeElements.filter((element) => line[element] === null);
  // Minutes and seconds both zero: no time on court to divide by.
  return unknown.length > 0 ? unknown : ['minutes'];
}

function missingOf(line: BoxScoreLine, decimalMinutes: number | null): readonly MissingElement[] {
  const time = decimalMinutes === null ? missingTimeOf(line) : [];
  return [...time, ...GAME_SCORE_TOTALS.filter((total) => line[total] === null)];
}

/**
 * Checks a line before any calculation (STA-09, STA-10, STA-12, CL-STA-03, CL-STA-06):
 * suspect when it fails a consistency check, every failed check listed; otherwise
 * incomplete when it lacks its time on court or a total of the Game Score, each missing
 * element listed and none replaced by zero, a mean or an estimate; otherwise complete. A
 * whole-minutes line carries the "rounded minutes" mention, and zero whole minutes with
 * a statistic make it incomplete, not suspect. `overtimeCount` is null when the number
 * of overtimes is unknown, which skips the bound on the minutes; while the seconds of a
 * source in seconds are unknown, the bound applies to the known minutes.
 */
export function verifyBoxScore(line: BoxScoreLine, overtimeCount: number | null): BoxScoreCheck {
  const hasRoundedMinutes = line.minutesPrecision === 'whole_minutes';
  const time = checkedTimeOf(line);
  const failedChecks = CHECKS.filter((check) => check.fails(line, overtimeCount)).map(
    (check) => check.name,
  );
  if (failedChecks.length > 0) {
    return { status: 'suspect', hasRoundedMinutes, ...time, failedChecks };
  }
  if (time.secondsOnCourt !== null && hasEveryTotal(line)) {
    return {
      ...totalsOf(line),
      status: 'complete',
      hasRoundedMinutes,
      ...time,
      [checkedBrand]: checkedBrand,
    };
  }
  return {
    status: 'incomplete',
    hasRoundedMinutes,
    ...time,
    missing: missingOf(line, time.decimalMinutes),
  };
}

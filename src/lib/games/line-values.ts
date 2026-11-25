// What a source line becomes in `box_scores`, beside lines.ts, which stores it: the
// engine's check of the line, the columns written, and the elements that a correction
// traces (STA-08 to STA-10, STA-12, STA-33).
import { participationOf, verifyBoxScore } from '@/lib/stats-engine';

import type { BoxScoreRow, NewBoxScoreRow, NewStatCorrectionRow } from './types';
import type { BoxScoreLine } from '@/lib/stats-engine';
import type { SourceBoxScore } from '@/lib/stats-source';

/** The columns of a line that ingestion writes from the source, its keys and fetch instant aside (STA-08). */
export type LineValues = Required<
  Omit<NewBoxScoreRow, 'id' | 'playerId' | 'gameId' | 'statsSource' | 'fetchedAt'>
>;

/** An element of a line whose value changed, absent values null, as `stat_corrections` traces it (STA-33). */
export type Difference = Pick<NewStatCorrectionRow, 'element' | 'oldValue' | 'newValue'>;

// The columns of a line that hold a number: the team, the time and the counts.
type NumberColumn = {
  [Column in keyof BoxScoreRow]: BoxScoreRow[Column] extends number | null ? Column : never;
}[keyof BoxScoreRow & keyof LineValues];

/** The elements of a line that a correction traces, with their columns (STA-33). */
const TRACED_ELEMENTS: readonly (readonly [NewStatCorrectionRow['element'], NumberColumn])[] = [
  ['team', 'teamId'],
  ['minutes', 'minutes'],
  ['seconds', 'seconds'],
  ['points', 'points'],
  ['field_goals_made', 'fieldGoalsMade'],
  ['field_goals_attempted', 'fieldGoalsAttempted'],
  ['three_pointers_made', 'threePointersMade'],
  ['free_throws_made', 'freeThrowsMade'],
  ['free_throws_attempted', 'freeThrowsAttempted'],
  ['offensive_rebounds', 'offensiveRebounds'],
  ['defensive_rebounds', 'defensiveRebounds'],
  ['assists', 'assists'],
  ['steals', 'steals'],
  ['blocks', 'blocks'],
  ['turnovers', 'turnovers'],
  ['personal_fouls', 'personalFouls'],
];

/** The engine's view of a source line, its time with the precision the source gave (STA-08, CL-STA-06). */
function engineLineOf({ counts, playingTime: time }: SourceBoxScore): BoxScoreLine {
  if (time === null) {
    return { ...counts, minutesPrecision: 'seconds', minutes: null, seconds: null };
  }
  return time.precision === 'seconds'
    ? { ...counts, minutesPrecision: 'seconds', minutes: time.minutes, seconds: time.seconds }
    : { ...counts, minutesPrecision: 'whole_minutes', minutes: time.minutes, seconds: null };
}

/**
 * Whether the source line is one he played (CL-STA-04, CL-STA-06): time on court above
 * zero, or a count other than zero whatever his minutes; a did-not-play line never is.
 */
export function isPlayed(line: SourceBoxScore): boolean {
  return !line.didNotPlay && participationOf(engineLineOf(line), true) === 'played';
}

/**
 * The columns of a played line for the team he played for (STA-08 to STA-10, STA-12,
 * CL-STA-06): the engine's status and failed checks, each count as the source gives
 * it, null when not provided, whole minutes without seconds and with the "rounded
 * minutes" mention, and the ejection as the source says it, null when it says nothing.
 * `overtimeCount` is the game's, null when unknown.
 */
export function valuesOf(
  line: SourceBoxScore,
  teamId: number,
  overtimeCount: number | null,
): LineValues {
  const engineLine = engineLineOf(line);
  const check = verifyBoxScore(engineLine, overtimeCount);
  return {
    sourcePlayerRef: line.player,
    status: check.status,
    hasRoundedMinutes: check.hasRoundedMinutes,
    ejected: line.ejected,
    failedChecks: check.status === 'suspect' ? [...check.failedChecks] : [],
    teamId,
    minutes: engineLine.minutes,
    seconds: engineLine.seconds,
    ...line.counts,
  };
}

/**
 * The elements that differ between a stored line and a new state, team included, in
 * the order of the data model; no line on either side reads as every value absent
 * (STA-33, STA-34).
 */
export function differencesOf(
  stored: BoxScoreRow | undefined,
  next: LineValues | null,
): readonly Difference[] {
  return TRACED_ELEMENTS.flatMap(([element, column]) => {
    const oldValue = stored?.[column] ?? null;
    const newValue = next?.[column] ?? null;
    return oldValue === newValue ? [] : { element, oldValue, newValue };
  });
}

/** Whether the stored line already holds every value of the new one, its traced elements and the rest (STA-33). */
export function isUnchanged(stored: BoxScoreRow, next: LineValues): boolean {
  return (
    differencesOf(stored, next).length === 0 &&
    stored.sourcePlayerRef === next.sourcePlayerRef &&
    stored.status === next.status &&
    stored.hasRoundedMinutes === next.hasRoundedMinutes &&
    stored.ejected === next.ejected &&
    stored.failedChecks.join(',') === next.failedChecks.join(',')
  );
}

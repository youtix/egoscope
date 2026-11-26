// The rows that the recalculation of one case computes (events-and-cases.md sections 1.7 to
// 1.11): the columns of the case, its triggered criteria, its review flags and its history
// entries. Internal to the module: the case store writes them for each evaluated case.
import 'server-only';

import { isDeepStrictEqual } from 'node:util';

import { eq, inArray } from 'drizzle-orm';

import { caseHistoryEntries, caseReviewFlags, caseTriggeredCriteria } from '@/lib/db';
import { now } from '@/lib/time';

import type { RecalculationCause } from './recalculate';
import type { CaseReviewFlagRow, CaseRow, CaseTriggeredCriterionRow, NewCaseRow } from './types';
import type { Transaction } from '@/lib/db';
import type { CaseId, EvaluatedCase } from '@/lib/stats-engine';

/** The columns of a case that its recalculation computes (CL-SEN-05). */
export type CaseValues = Omit<
  NewCaseRow,
  'id' | 'playerId' | 'eventTypeId' | 'origin' | 'createdAt' | 'computedAt' | 'rowVersion'
>;

/** A case just written: its id, its evaluation, its columns, and its row before the write, null for a new case. */
type WrittenCase = Readonly<{
  caseId: CaseId;
  evaluated: EvaluatedCase;
  values: CaseValues;
  before: CaseRow | null;
}>;

/** What the rows of a case are compared with: the stored criteria and flags of the player's cases, and the job's cause. */
type StoredRows = Readonly<{
  criteria: readonly CaseTriggeredCriterionRow[];
  flags: readonly CaseReviewFlagRow[];
  cause: RecalculationCause;
}>;

/** The baseline columns of a case, all null without a baseline (STA-16 to STA-22). */
function baselineValuesOf(baseline: EvaluatedCase['baseline']) {
  return {
    baselineSeason: baseline === null ? null : baseline.season,
    baselinePhase: baseline === null ? null : baseline.phase,
    baselineGameCount: baseline === null ? null : baseline.gameCount,
    baselineMean: baseline === null ? null : baseline.mean,
    baselineStandardDeviation: baseline === null ? null : baseline.standardDeviation,
    baselineStatus: baseline === null ? null : baseline.status,
    baselineIsPartial: baseline === null ? null : baseline.isPartial,
  };
}

/** The columns of the case `evaluated`, as its row holds them (SEN-07 to SEN-17, CL-SEN-05). */
export function valuesOf(evaluated: EvaluatedCase): CaseValues {
  const { referenceInstantAt } = evaluated;
  return {
    status: evaluated.status,
    statusReason: evaluated.statusReason,
    referenceInstantAt: referenceInstantAt === null ? null : new Date(referenceInstantAt),
    referenceInstantOrigin: evaluated.referenceInstantOrigin,
    measuredGameId: evaluated.measuredGameId,
    teamGamesMissedBefore: evaluated.teamGamesMissedBefore,
    playingTimeThresholdMinutes: evaluated.playingTimeThresholdMinutes,
    measuredMinutes: evaluated.measuredMinutes,
    hasRoundedMinutes: evaluated.hasRoundedMinutes,
    measuredGameScore: evaluated.measuredGameScore,
    performanceIndex: evaluated.performanceIndex,
    ...baselineValuesOf(evaluated.baseline),
    normalizedGap: evaluated.normalizedGap,
    gapStatus: evaluated.gapStatus,
    opponentStrengthNotEvaluable: evaluated.opponentStrengthNotEvaluable,
    stakesNotEvaluable: evaluated.stakesNotEvaluable,
  };
}

// The columns whose change a history entry records, named in it as in the case (events-and-cases.md section 1.11).
const HISTORY_COLUMNS: readonly (keyof CaseValues)[] = [
  'status',
  'statusReason',
  'measuredGameId',
  'normalizedGap',
  'gapStatus',
];

/**
 * Whether `row` already holds `values` in each of `columns`, all of them by default, an
 * instant compared by its time: a case that holds them is not written again (CL-IMP-17).
 */
export function isHeldBy(
  row: CaseRow,
  values: CaseValues,
  columns: readonly string[] = Object.keys(values),
): boolean {
  const stored = new Map<string, unknown>(Object.entries(row));
  return Object.entries(values).every(
    ([column, value]) => !columns.includes(column) || isDeepStrictEqual(stored.get(column), value),
  );
}

/**
 * Rewrites the criteria of the case whole with their values, in their order, when they
 * change (SEN-11 to SEN-17); jsonb keeps no key order, which the comparison ignores.
 */
async function writeCriteria(
  tx: Transaction,
  { evaluated, caseId }: WrittenCase,
  rows: StoredRows,
) {
  const stored = rows.criteria
    .filter((row) => row.caseId === caseId)
    .map(({ criterion, condition, triggeringValues }) => ({
      criterion,
      condition,
      triggeringValues,
    }));
  const { triggeredCriteria } = evaluated;
  if (isDeepStrictEqual(stored, triggeredCriteria)) {
    return;
  }
  await tx.delete(caseTriggeredCriteria).where(eq(caseTriggeredCriteria.caseId, caseId));
  if (triggeredCriteria.length > 0) {
    await tx
      .insert(caseTriggeredCriteria)
      .values(triggeredCriteria.map((criterion) => ({ ...criterion, caseId })));
  }
}

/**
 * Writes the review flags of the case, each bound to its measured game (SEN-16, CL-SEN-11,
 * CL-SEN-12): a flag raised again on the same game stays as it is, its acknowledgment
 * with it; a flag about another game, or no longer raised, goes; a new one is raised now.
 */
async function writeFlags(tx: Transaction, { evaluated, caseId }: WrittenCase, rows: StoredRows) {
  const gameId = evaluated.measuredGameId;
  const raised = gameId === null ? [] : evaluated.reviewFlags;
  const stored = rows.flags.filter((row) => row.caseId === caseId);
  const kept = stored.filter((row) => raised.includes(row.flag) && row.measuredGameId === gameId);
  const gone = stored.filter((row) => !kept.includes(row)).map(({ id }) => id);
  if (gone.length > 0) {
    await tx.delete(caseReviewFlags).where(inArray(caseReviewFlags.id, gone));
  }
  const fresh = raised.filter((flag) => kept.every((row) => row.flag !== flag));
  if (gameId === null || fresh.length === 0) {
    return;
  }
  const raisedAt = new Date(now());
  await tx
    .insert(caseReviewFlags)
    .values(fresh.map((flag) => ({ caseId, flag, measuredGameId: gameId, raisedAt })));
}

/**
 * Writes the rows of the case `written` beside its own: a history entry with the job's
 * cause when the case is new or its status, reason, measured game or gap changes, each
 * alone enough (SEN-07, SEN-08, SEN-37, CL-SEN-17); its criteria, rewritten whole
 * (SEN-11 to SEN-17); its review flags, which keep their acknowledgment while their game
 * is unchanged (SEN-16, CL-SEN-12).
 */
export async function writeCaseRows(
  tx: Transaction,
  written: WrittenCase,
  rows: StoredRows,
): Promise<void> {
  const { before, values, caseId } = written;
  if (before === null || !isHeldBy(before, values, HISTORY_COLUMNS)) {
    // The insert takes, of the case's values, the columns of the history table.
    const recordedAt = new Date(now());
    await tx
      .insert(caseHistoryEntries)
      .values({ ...values, caseId, recordedAt, cause: rows.cause });
  }
  await writeCriteria(tx, written, rows);
  await writeFlags(tx, written, rows);
}

// The rows that the recalculation of one case computes (events-and-cases.md sections 1.7 to
// 1.11): the row of the case, with the origin and creation instant of a new one, its
// triggered criteria, its review flags and its history entries. Internal to the module: the
// case store writes them for each evaluated case.
import 'server-only';

import { isDeepStrictEqual } from 'node:util';

import { eq, inArray, sql } from 'drizzle-orm';

import {
  caseHistoryEntries,
  caseReviewFlags,
  cases,
  caseTriggeredCriteria,
  events,
} from '@/lib/db';
import { now } from '@/lib/time';

import type { RecalculationCause } from './recalculate';
import type { CaseReviewFlagRow, CaseRow, CaseTriggeredCriterionRow, NewCaseRow } from './types';
import type { Transaction } from '@/lib/db';
import type { CaseId, EvaluatedCase, PlayerEventId } from '@/lib/stats-engine';

/** The columns of a case that its recalculation computes (CL-SEN-05). */
type CaseValues = Omit<
  NewCaseRow,
  'id' | 'playerId' | 'eventTypeId' | 'origin' | 'createdAt' | 'computedAt' | 'rowVersion'
>;

/**
 * Where an evaluated case is written: its evaluation, its earliest-recorded event, whose
 * player, origin and creation instant a new case takes (CL-VUE-03, CL-VUE-13), and the stored
 * case it keeps, null for a new one.
 */
export type CaseTarget = Readonly<{
  evaluated: EvaluatedCase;
  earliest: Readonly<{ id: PlayerEventId; playerId: string; isTracked: boolean }>;
  kept: CaseRow | null;
}>;

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

/**
 * `value`, which the database always gives: its absence is a bug, thrown rather than
 * returned, such as an evaluated case none of whose events is stored (SEN-05).
 */
export function present<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The case store found no ${what}.`);
  }
  return value;
}

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
function valuesOf(evaluated: EvaluatedCase): CaseValues {
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
function isHeldBy(
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
 * Writes the row of `target` and gives its id: a new case takes the origin and the
 * creation instant of its earliest-recorded event (CL-VUE-03, CL-VUE-13, SUI-04); a kept
 * case keeps both and is written only when one of its values changes.
 */
async function writeRow(tx: Transaction, target: CaseTarget, values: CaseValues): Promise<CaseId> {
  const computedAt = new Date(now());
  const { kept, earliest, evaluated } = target;
  if (kept === null) {
    const [inserted] = await tx
      .insert(cases)
      .values({
        ...values,
        playerId: earliest.playerId,
        eventTypeId: evaluated.eventTypeId,
        origin: earliest.isTracked ? 'tracked' : 'historical',
        createdAt: sql`(select ${events.createdAt} from ${events} where ${events.id} = ${earliest.id})`,
        computedAt,
      })
      .returning({ id: cases.id });
    return present(inserted, 'inserted case').id;
  }
  if (!isHeldBy(kept, values)) {
    await tx
      .update(cases)
      .set({ ...values, computedAt })
      .where(eq(cases.id, kept.id));
  }
  return kept.id;
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
 * with it; a flag about another game, or no longer raised, goes; a new one is raised now,
 * and none without a game.
 */
async function writeFlags(tx: Transaction, { evaluated, caseId }: WrittenCase, rows: StoredRows) {
  const gameId = evaluated.measuredGameId;
  const raised = evaluated.reviewFlags;
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
async function writeCaseRows(tx: Transaction, written: WrittenCase, rows: StoredRows) {
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

/**
 * Writes one evaluated case at `target` with its criteria, review flags and history, and
 * gives its id (SEN-07 to SEN-17, SEN-37, CL-SEN-05, CL-SEN-17): a new case takes the origin
 * and the creation instant of its earliest-recorded event, tracked when it would be
 * (CL-VUE-03, CL-VUE-13, SUI-04); a kept case keeps both, and a row whose values are
 * unchanged is not written again (CL-IMP-17).
 */
export async function writeCase(
  tx: Transaction,
  target: CaseTarget,
  rows: StoredRows,
): Promise<CaseId> {
  const values = valuesOf(target.evaluated);
  const caseId = await writeRow(tx, target, values);
  const { evaluated, kept } = target;
  await writeCaseRows(tx, { caseId, evaluated, values, before: kept }, rows);
  return caseId;
}

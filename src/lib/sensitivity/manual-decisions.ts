import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { checkText } from '@/lib/ai-exchange';
import { caseManualDecisions, caseReviewFlags, cases } from '@/lib/db';
import { record } from '@/lib/journal';
import { getParam } from '@/lib/params';
import { changedElsewhere, err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { requestRecalculation } from './recalculate';

import type { CaseRow, NewCaseManualDecisionRow } from './types';
import type { TextRuleBreach } from '@/lib/ai-exchange';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';

/** A reason of the closed exclusion list of SEN-17 (`ManualExclusionReason`). */
export type ExclusionReason = NonNullable<NewCaseManualDecisionRow['exclusionReason']>;

/** A reason of the closed reinstatement list of SEN-17 (`ManualReinstatementReason`). */
export type ReinstatementReason = NonNullable<NewCaseManualDecisionRow['reinstatementReason']>;

/** The owner's exclusion or reinstatement of a case, as the case page sends it (SEN-17, CL-IHM-18). */
export type CaseDecision = Readonly<{
  /** The reason he chose, checked against the closed list of the decision. */
  reason: string;
  /** His comment: required for "other confounding factor" and "criterion unsuited to this case". */
  comment: string | null;
  /** The case's `row_version` that the page showed (CL-IHM-18). */
  expectedVersion: number;
}>;

/** Why an exclusion or a reinstatement is refused. */
export type DecisionRefusal =
  | Readonly<{ kind: 'invalid_reason' }>
  | Readonly<{ kind: 'comment_required' }>
  | Readonly<{ kind: 'invalid_comment'; breaches: readonly TextRuleBreach[] }>
  /** The case is not in the state the decision applies to: its state as the decision reads it. */
  | Readonly<{ kind: 'status_not_allowed'; status: CaseRow['status'] }>
  | ChangedElsewhere<CaseRow>
  | NoLongerExists;

type DecisionKind = NewCaseManualDecisionRow['kind'];
type DecisionColumns = Pick<
  NewCaseManualDecisionRow,
  'kind' | 'exclusionReason' | 'reinstatementReason' | 'previousStatus' | 'comment'
>;

// The closed lists of SEN-17: none of them names the performance itself.
const EXCLUSION_REASONS: readonly string[] = [
  'playing_time',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'other_confounding_factor',
] satisfies readonly ExclusionReason[];
const REINSTATEMENT_REASONS: readonly string[] = [
  'incorrect_context_indication',
  'criterion_unsuited_to_case',
] satisfies readonly ReinstatementReason[];
// The two reasons that SEN-17 makes the owner explain.
const COMMENTED_REASONS: ReadonlySet<string> = new Set([
  'other_confounding_factor',
  'criterion_unsuited_to_case',
] satisfies readonly (ExclusionReason | ReinstatementReason)[]);
// The state each decision applies to, the one it leaves, and the journal entry it writes.
const DECISIONS = {
  exclude: { from: 'measured', to: 'excluded', messageKey: 'case_excluded' },
  reinstate: { from: 'excluded', to: 'measured', messageKey: 'case_reinstated' },
} as const satisfies Readonly<Record<DecisionKind, unknown>>;
const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };

function isExclusionReason(reason: string): reason is ExclusionReason {
  return EXCLUSION_REASONS.includes(reason);
}

function isReinstatementReason(reason: string): reason is ReinstatementReason {
  return REINSTATEMENT_REASONS.includes(reason);
}

/** The reason columns of a decision `kind` for `reason`, or null when its list lacks it. */
function reasonColumns(
  kind: DecisionKind,
  reason: string,
): Omit<DecisionColumns, 'comment'> | null {
  const { from: previousStatus } = DECISIONS[kind];
  if (kind === 'exclude') {
    return isExclusionReason(reason)
      ? { kind, exclusionReason: reason, reinstatementReason: null, previousStatus }
      : null;
  }
  return isReinstatementReason(reason)
    ? { kind, exclusionReason: null, reinstatementReason: reason, previousStatus }
    : null;
}

/**
 * The columns of `decision` once checked: a reason of its list, and a comment that the
 * wording rules accept, present when the reason requires one (SEN-17, DSN-10, DSN-20).
 */
async function checkedColumns(
  tx: Transaction,
  kind: DecisionKind,
  decision: CaseDecision,
): Promise<Result<DecisionColumns, DecisionRefusal>> {
  const columns = reasonColumns(kind, decision.reason);
  if (columns === null) {
    return err({ kind: 'invalid_reason' });
  }
  const comment = decision.comment?.trim() ?? '';
  if (comment === '') {
    return COMMENTED_REASONS.has(decision.reason)
      ? err({ kind: 'comment_required' })
      : ok({ ...columns, comment: null });
  }
  const breaches = checkText(comment, await getParam(tx, 'events.maxDescriptionLength'));
  return breaches.length > 0
    ? err({ kind: 'invalid_comment', breaches })
    : ok({ ...columns, comment });
}

/** The measured game of `row` when SEN-17 decides on its state, measured or excluded, or null. */
function decidedGameOf(row: CaseRow): number | null {
  return row.status === 'measured' || row.status === 'excluded' ? row.measuredGameId : null;
}

/**
 * The state that the latest decision on case `caseId` at game `gameId` gives it, which
 * prevails over the automatic criteria, even before the recalculation it recorded has run;
 * none when no decision was made on that game (SEN-17, CL-SEN-12).
 */
async function stateOfLatestDecision(
  tx: Transaction,
  caseId: number,
  gameId: number,
): Promise<CaseRow['status'] | null> {
  const [latest] = await tx
    .select({ kind: caseManualDecisions.kind })
    .from(caseManualDecisions)
    .where(
      and(eq(caseManualDecisions.caseId, caseId), eq(caseManualDecisions.measuredGameId, gameId)),
    )
    .orderBy(desc(caseManualDecisions.decidedAt), desc(caseManualDecisions.id))
    .limit(1);
  return latest === undefined ? null : DECISIONS[latest.kind].to;
}

/**
 * The game that a decision `kind` on `row` is made on: refused when the page showed
 * another version, or when the case is not in the state the decision applies to.
 */
async function decidableGame(
  tx: Transaction,
  row: CaseRow,
  { kind, expectedVersion }: Readonly<{ kind: DecisionKind; expectedVersion: number }>,
): Promise<Result<number, DecisionRefusal>> {
  if (row.rowVersion !== expectedVersion) {
    return err(changedElsewhere(row));
  }
  const gameId = decidedGameOf(row);
  if (gameId === null) {
    return err({ kind: 'status_not_allowed', status: row.status });
  }
  const status = (await stateOfLatestDecision(tx, row.id, gameId)) ?? row.status;
  return status === DECISIONS[kind].from ? ok(gameId) : err({ kind: 'status_not_allowed', status });
}

/**
 * Records the decision `kind` on case `caseId` in the caller's transaction `tx`: the
 * decision with its instant, reason, comment, previous state and game, the case's new
 * version, the journal entry naming the case alone, and the recalculation job of its
 * player and type with the cause `manual_decision`.
 */
async function decide(
  tx: Transaction,
  caseId: number,
  { kind, decision }: Readonly<{ kind: DecisionKind; decision: CaseDecision }>,
): Promise<Result<undefined, DecisionRefusal>> {
  const columns = await checkedColumns(tx, kind, decision);
  if (!columns.ok) {
    return columns;
  }
  const [row] = await tx.select().from(cases).where(eq(cases.id, caseId)).for('update');
  if (row === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  const game = await decidableGame(tx, row, { kind, expectedVersion: decision.expectedVersion });
  if (!game.ok) {
    return game;
  }
  await tx.insert(caseManualDecisions).values({
    ...columns.value,
    caseId,
    decidedAt: new Date(now()),
    measuredGameId: game.value,
  });
  await tx
    .update(cases)
    .set({ rowVersion: sql`${cases.rowVersion} + 1` })
    .where(eq(cases.id, caseId));
  await record(tx, { messageKey: DECISIONS[kind].messageKey, caseId });
  await requestRecalculation(
    tx,
    { kind: 'event_or_case_change', playerIds: [row.playerId], eventTypeIds: [row.eventTypeId] },
    'manual_decision',
  );
  return ok(undefined);
}

/**
 * Excludes the measured case `caseId` by the owner's hand, in the caller's transaction
 * `tx`, for a reason of the closed list of SEN-17 (playing time, return from injury,
 * unusual stakes, opponent strength, other confounding factor, the last with a comment):
 * none refers to the performance itself. The decision is appended, traced with its
 * instant, reason, comment, previous state and the measured game it was made on
 * (CL-SEN-12), journaled, and its recalculation job recorded with the cause
 * `manual_decision` (SEN-17, CL-SEN-16, CL-SEN-17). Refused, writing nothing, for another
 * reason, a missing or ill-worded comment (DSN-10), a case not measured, or a version
 * other than the one the page showed (CL-IHM-18). A reinstatement undoes it.
 */
export async function excludeCase(
  tx: Transaction,
  caseId: number,
  decision: CaseDecision,
): Promise<Result<undefined, DecisionRefusal>> {
  return decide(tx, caseId, { kind: 'exclude', decision });
}

/**
 * Reinstates the excluded case `caseId` by the owner's hand, in the caller's transaction
 * `tx`, for a reason of the closed list of SEN-17 (incorrect context indication, criterion
 * unsuited to this case, the latter with a comment), traced, journaled and recalculated as
 * an exclusion is (SEN-17, CL-SEN-12, CL-SEN-17). Refused, writing nothing, for another
 * reason, a missing or ill-worded comment (DSN-10), a case not excluded, or a version other
 * than the one the page showed (CL-IHM-18). An exclusion undoes it.
 */
export async function reinstateCase(
  tx: Transaction,
  caseId: number,
  decision: CaseDecision,
): Promise<Result<undefined, DecisionRefusal>> {
  return decide(tx, caseId, { kind: 'reinstate', decision });
}

/**
 * Records, in the caller's transaction `tx`, that the owner looked at the review flag
 * `flagId`: the flag stays on its case and its to-do item goes (SEN-16, SEN-17, IHM-20).
 * A flag already looked at keeps its first instant; one that no longer exists, deleted by
 * a recalculation, is refused (CL-IHM-19).
 */
export async function acknowledgeReviewFlag(
  tx: Transaction,
  flagId: number,
): Promise<Result<undefined, NoLongerExists>> {
  const [flag] = await tx
    .select({ acknowledgedAt: caseReviewFlags.acknowledgedAt })
    .from(caseReviewFlags)
    .where(eq(caseReviewFlags.id, flagId))
    .for('update');
  if (flag === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  if (flag.acknowledgedAt === null) {
    await tx
      .update(caseReviewFlags)
      .set({ acknowledgedAt: new Date(now()) })
      .where(eq(caseReviewFlags.id, flagId));
  }
  return ok(undefined);
}

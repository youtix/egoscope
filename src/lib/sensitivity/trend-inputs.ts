// What evaluateTrend reads of one type (SEN-19, SEN-21, SEN-28, CL-SEN-19): the stored
// outcome of each of its cases, every followed player's, a withdrawn player's included
// (H-JOU-07), its tally exits and its manually decided cases, read from stored data alone.
import 'server-only';

import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import {
  caseManualDecisions,
  cases,
  caseTriggeredCriteria,
  events,
  eventTypes,
  games,
  tallyExits,
} from '@/lib/db';
import { err, ok } from '@/lib/result';
import { effectiveDecision } from '@/lib/stats-engine';
import { toEpochMs } from '@/lib/time';

import { paramsInForce } from './engine-params';

import type { CaseRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type {
  CaseOrigin,
  EngineParams,
  ManualDecision,
  ManuallyDecidedCase,
  ProfileCase,
  TrendCase,
  TrendEvaluationInput,
} from '@/lib/stats-engine';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

/** A type's trend input, and the calculation parameters in force (TRV-35). */
export type TrendInput = Readonly<{ input: TrendEvaluationInput; params: EngineParams }>;

/** Why no input is built: the type does not exist. */
export type TypeNotFound = Readonly<{ kind: 'type_not_found' }>;

type AwaitingReason = Extract<ProfileCase, Readonly<{ status: 'awaiting_game' }>>['statusReason'];
type Criterion = Extract<ProfileCase, Readonly<{ status: 'excluded' }>>['triggeredCriteria'][0];

/** A stored case with the scheduled start of its measured game, null without one. */
type CaseOutcomeRow = CaseRow & Readonly<{ startAt: Date | null }>;

/**
 * A manual decision, with the case it was made on and the status that case had when it
 * was made (SEN-17).
 */
type ManualDecisionRow = ManualDecision &
  Readonly<{ caseId: number; previousStatus: 'measured' | 'excluded' }>;

/**
 * What the rows of one case hold: the research confidence of each of its events that
 * counts, its criteria, its manual decisions, and whether it co-occurs (SEN-06).
 */
type CaseFacts = Readonly<{
  confidences: readonly ProfileCase['events'][number][];
  criteria: readonly Criterion[];
  decisions: readonly ManualDecisionRow[];
  isCoOccurring: boolean;
}>;

// The reasons of a case awaiting its game (SEN-07); every other reason is one of a case
// not measurable.
const AWAITING_REASONS: readonly AwaitingReason[] = [
  'game_not_played_yet',
  'statistics_pending',
  'mapping_not_established',
  'baseline_building',
  'precedence_to_verify',
  'dating_to_verify',
];

const isAwaiting = (reason: NonNullable<CaseRow['statusReason']>): reason is AwaitingReason =>
  AWAITING_REASONS.some((each) => each === reason);

/** A column that the row checks of a case hold set for its status: its absence is a bug. */
function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`A case holds no ${what}, which its status requires`);
  }
  return value;
}

/**
 * A case's outcome as its row holds it (SEN-07, SEN-10, cases_reasoned_status_check):
 * awaiting its game or not measurable with its reason; otherwise measured or excluded
 * with its gap and the scheduled start of its game, an excluded case with its criteria.
 */
function outcomeOf(row: CaseOutcomeRow, criteria: readonly Criterion[]) {
  const { status, statusReason } = row;
  if (statusReason !== null) {
    return isAwaiting(statusReason)
      ? ({ status: 'awaiting_game', statusReason } as const)
      : ({ status: 'not_measurable', statusReason } as const);
  }
  const gap = {
    measuredGameScheduledStartAt: toEpochMs(present(row.startAt, 'game').getTime()),
    normalizedGap: present(row.normalizedGap, 'gap'),
    gapStatus: present(row.gapStatus, 'gap status'),
  };
  if (status === 'measured') {
    return { ...gap, status };
  }
  const [first, ...others] = criteria;
  return {
    ...gap,
    status: 'excluded',
    triggeredCriteria: [present(first, 'criterion'), ...others],
  } as const;
}

/**
 * A stored case as the trend counts it (SEN-20, SEN-28), with the player it belongs to and
 * its origin (SEN-21); none when none of its events counts any more, which a dismissal
 * makes an exit (SEN-48, CL-VUE-03).
 */
function trendCaseOf(
  row: CaseOutcomeRow,
  facts: CaseFacts,
): (TrendCase & Readonly<{ origin: CaseOrigin }>) | null {
  const [first, ...others] = facts.confidences;
  if (first === undefined) {
    return null;
  }
  const base = {
    caseId: row.id,
    playerId: row.playerId,
    origin: row.origin,
    events: [first, ...others] as const,
    isCoOccurring: facts.isCoOccurring,
  };
  return { ...base, ...outcomeOf(row, facts.criteria) };
}

/** Whether `left` was made before `right`: by instant, then by id, as the engine orders them. */
const isEarlier = (left: ManualDecision, right: ManualDecision): boolean =>
  left.decidedAt < right.decidedAt || (left.decidedAt === right.decidedAt && left.id < right.id);

/**
 * The first of `decisions` made on the game of the ruling decision `ruling`, which is one
 * of them (SEN-17, CL-SEN-12).
 */
function firstDecisionOn(
  ruling: ManualDecisionRow,
  decisions: readonly ManualDecisionRow[],
): ManualDecisionRow {
  let first = ruling;
  for (const each of decisions) {
    if (each.measuredGameId === ruling.measuredGameId && isEarlier(each, first)) {
      first = each;
    }
  }
  return first;
}

/**
 * A measured or excluded case that a manual decision rules (SEN-17, SEN-27, CL-SEN-12),
 * with the status its automatic criteria give it. For an exclusion, those stored beside
 * the criterion `manual`. A reinstatement drops the criteria it overrides, so for it the
 * status the case had before the first decision made on its game: no decision ruled it
 * then, and an exclusion is made only on a measured case and a reinstatement only on an
 * excluded one. Undoing an exclusion made by hand thus leaves the case measured.
 */
function decidedCaseOf(row: CaseOutcomeRow, facts: CaseFacts): ManuallyDecidedCase | null {
  const decision = effectiveDecision(facts.decisions, row.measuredGameId);
  if (decision === null || row.statusReason !== null) {
    return null;
  }
  if (decision.kind === 'reinstate') {
    const first = firstDecisionOn(decision, facts.decisions);
    return { caseId: row.id, statusWithoutDecision: first.previousStatus };
  }
  const isAutomaticallyExcluded = facts.criteria.some((criterion) => criterion !== 'manual');
  return {
    caseId: row.id,
    statusWithoutDecision: isAutomaticallyExcluded ? 'excluded' : 'measured',
  };
}

/** The stored cases of the type, every player's, each with its game's scheduled start. */
async function caseRowsOf(db: Reader, eventTypeId: string): Promise<readonly CaseOutcomeRow[]> {
  const rows = await db
    .select({ row: cases, startAt: games.scheduledStartAt })
    .from(cases)
    .leftJoin(games, eq(games.id, cases.measuredGameId))
    .where(eq(cases.eventTypeId, eventTypeId))
    .orderBy(asc(cases.id));
  return rows.map(({ row, startAt }) => ({ ...row, startAt }));
}

/** The key of a player's measured game, to tell two cases that share it (SEN-06). */
const gameKeyOf = (playerId: string, measuredGameId: number | null): string =>
  `${playerId} ${String(measuredGameId)}`;

/** The rows of `items`, grouped by the case each belongs to. */
const byCase = <T extends Readonly<{ caseId: number | null }>>(items: readonly T[]) =>
  Map.groupBy(items, ({ caseId }) => caseId);

/**
 * The measured games, keyed by player, of the cases of another validated type of the
 * players of `rows` on one of their games (SEN-06, CL-SEN-29).
 */
async function sharedGamesOf(
  db: Reader,
  eventTypeId: string,
  rows: readonly CaseOutcomeRow[],
): Promise<ReadonlySet<string>> {
  const playerIds = [...new Set(rows.map(({ playerId }) => playerId))];
  const gameIds = rows.flatMap(({ measuredGameId }) => measuredGameId ?? []);
  const others = await db
    .select({ playerId: cases.playerId, measuredGameId: cases.measuredGameId })
    .from(cases)
    .innerJoin(eventTypes, eq(eventTypes.id, cases.eventTypeId))
    .where(
      and(
        ne(cases.eventTypeId, eventTypeId),
        eq(eventTypes.status, 'validated'),
        inArray(cases.playerId, playerIds),
        inArray(cases.measuredGameId, gameIds),
      ),
    );
  return new Set(others.map((other) => gameKeyOf(other.playerId, other.measuredGameId)));
}

/**
 * The facts of each stored case of the type, from one read of each table: its events not
 * dismissed (SEN-48), its criteria, its manual decisions with their game, and whether a
 * case of another validated type of its player shares its game (SEN-06, CL-SEN-29).
 */
async function factsOf(db: Reader, eventTypeId: string, rows: readonly CaseOutcomeRow[]) {
  const ids = rows.map(({ id }) => id);
  const counted = or(isNull(events.detectedStatus), ne(events.detectedStatus, 'dismissed'));
  const confidences = await db
    .select({ caseId: events.caseId, researchConfidence: events.researchConfidence })
    .from(events)
    .where(and(inArray(events.caseId, ids), counted))
    .orderBy(asc(events.id));
  const criteria = await db
    .select({ caseId: caseTriggeredCriteria.caseId, criterion: caseTriggeredCriteria.criterion })
    .from(caseTriggeredCriteria)
    .where(inArray(caseTriggeredCriteria.caseId, ids))
    .orderBy(asc(caseTriggeredCriteria.id));
  const decisions = await db
    .select()
    .from(caseManualDecisions)
    .where(inArray(caseManualDecisions.caseId, ids));
  const confidencesOf = byCase(confidences);
  const criteriaOf = byCase(criteria);
  const decisionsOf = byCase(decisions);
  const sharedGames = await sharedGamesOf(db, eventTypeId, rows);
  return (row: CaseOutcomeRow): CaseFacts => ({
    confidences: (confidencesOf.get(row.id) ?? []).map(({ researchConfidence }) => ({
      researchConfidence,
    })),
    criteria: (criteriaOf.get(row.id) ?? []).map(({ criterion }) => criterion),
    decisions: (decisionsOf.get(row.id) ?? []).map((decision) => ({
      ...decision,
      decidedAt: toEpochMs(decision.decidedAt.getTime()),
    })),
    isCoOccurring: sharedGames.has(gameKeyOf(row.playerId, row.measuredGameId)),
  });
}

/**
 * Builds what evaluateTrend reads of the type `eventTypeId`, from stored data alone
 * (SEN-19, SEN-21, SEN-28, SEN-33, CL-SEN-19, H-JOU-07): its status; the stored outcome of
 * each of its cases, every followed player's, a withdrawn player's included, with its
 * player, origin, events that count and co-occurrence; the reasons of its events that left
 * the tally; its cases that a manual decision rules; and the calculation parameters in
 * force. Refused when the type does not exist.
 */
export async function buildTrendInput(
  db: Reader,
  eventTypeId: string,
): Promise<Result<TrendInput, TypeNotFound>> {
  const [type] = await db
    .select({ status: eventTypes.status })
    .from(eventTypes)
    .where(eq(eventTypes.id, eventTypeId));
  if (type === undefined) {
    return err({ kind: 'type_not_found' });
  }
  const rows = await caseRowsOf(db, eventTypeId);
  const factsOfCase = await factsOf(db, eventTypeId, rows);
  const exits = await db
    .select({ reason: tallyExits.exitReason })
    .from(tallyExits)
    .where(eq(tallyExits.eventTypeId, eventTypeId))
    .orderBy(asc(tallyExits.id));
  const withFacts = rows.map((row) => ({ row, facts: factsOfCase(row) }));
  const input: TrendEvaluationInput = {
    typeStatus: type.status,
    cases: withFacts.flatMap(({ row, facts }) => trendCaseOf(row, facts) ?? []),
    exitReasons: exits.map(({ reason }) => reason),
    manuallyDecidedCases: withFacts.flatMap(({ row, facts }) => decidedCaseOf(row, facts) ?? []),
  };
  return ok({ input, params: await paramsInForce(db) });
}

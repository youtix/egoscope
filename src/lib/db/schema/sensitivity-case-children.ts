// The tables of the sensitivity module that hang off one case and go with it: its
// triggered criteria, its review flags, the owner's manual decisions and its history
// (events-and-cases.md sections 1.8 to 1.11). They sit apart from sensitivity.ts only
// to keep each schema file and its tests within the size limits.
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { games } from './games';
import {
  CASE_STATUS_REASONS,
  CASE_STATUSES,
  cases,
  GAP_STATUSES,
  VERDICT_CHANGE_CAUSES,
} from './sensitivity';

// DoubtfulCaseCriterion (SEN-11 to SEN-17).
const CRITERIA = [
  'playing_time_too_low',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'co_occurring',
  'manual',
] as const;
// CriterionCondition, of the injury return and the unusual stakes only (SEN-13, SEN-14).
const CRITERION_CONDITIONS = ['flagged', 'calculated'] as const;
// ReviewFlag (SEN-16, CL-SEN-11, CL-SEN-12).
const REVIEW_FLAGS = ['first_game_with_new_team', 'ejection', 'manual_decision_to_review'] as const;
// ManualDecisionKind, ManualExclusionReason and ManualReinstatementReason (SEN-17).
const DECISION_KINDS = ['exclude', 'reinstate'] as const;
const EXCLUSION_REASONS = [
  'playing_time',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'other_confounding_factor',
] as const;
const REINSTATEMENT_REASONS = [
  'incorrect_context_indication',
  'criterion_unsuited_to_case',
] as const;
// The status a manual decision leaves: a measured case or an excluded one (SEN-17).
const DECIDED_STATUSES = [
  'measured',
  'excluded',
] as const satisfies readonly (typeof CASE_STATUSES)[number][];

/**
 * The doubtful-case criteria that apply to an excluded case, each with its triggering
 * values, rewritten whole at each recalculation of the case (SEN-11 to SEN-15, SEN-17).
 */
export const caseTriggeredCriteria = pgTable(
  'case_triggered_criteria',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    criterion: text('criterion', { enum: CRITERIA }).notNull(),
    condition: text('condition', { enum: CRITERION_CONDITIONS }),
    triggeringValues: jsonb('triggering_values').notNull(),
  },
  (table) => [
    check('case_triggered_criteria_criterion_check', oneOf(table.criterion, CRITERIA)),
    check('case_triggered_criteria_condition_check', oneOf(table.condition, CRITERION_CONDITIONS)),
    check(
      'case_triggered_criteria_conditioned_criterion_check',
      sql`${table.condition} IS NULL OR ${table.criterion} IN ('injury_return', 'unusual_stakes')`,
    ),
    unique('case_triggered_criteria_key')
      .on(table.caseId, table.criterion, table.condition)
      .nullsNotDistinct(),
  ],
);

/** The situations shown to the owner on a case without excluding it (SEN-16, CL-SEN-11, CL-SEN-12). */
export const caseReviewFlags = pgTable(
  'case_review_flags',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    flag: text('flag', { enum: REVIEW_FLAGS }).notNull(),
    measuredGameId: integer('measured_game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
    raisedAt: timestamptz('raised_at').notNull().defaultNow(),
    acknowledgedAt: timestamptz('acknowledged_at'),
  },
  (table) => [
    check('case_review_flags_flag_check', oneOf(table.flag, REVIEW_FLAGS)),
    unique('case_review_flags_key').on(table.caseId, table.flag),
  ],
);

/**
 * The owner's exclusion of a measured case or reinstatement of an excluded one, with
 * its closed-list reason; append-only, each bound to the game it was made on (SEN-17,
 * CL-SEN-12).
 */
export const caseManualDecisions = pgTable(
  'case_manual_decisions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    decidedAt: timestamptz('decided_at').notNull().defaultNow(),
    kind: text('kind', { enum: DECISION_KINDS }).notNull(),
    exclusionReason: text('exclusion_reason', { enum: EXCLUSION_REASONS }),
    reinstatementReason: text('reinstatement_reason', { enum: REINSTATEMENT_REASONS }),
    comment: text('comment'),
    previousStatus: text('previous_status', { enum: DECIDED_STATUSES }).notNull(),
    measuredGameId: integer('measured_game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
  },
  (table) => [
    check('case_manual_decisions_kind_check', oneOf(table.kind, DECISION_KINDS)),
    check(
      'case_manual_decisions_exclusion_reason_check',
      oneOf(table.exclusionReason, EXCLUSION_REASONS),
    ),
    check(
      'case_manual_decisions_reinstatement_reason_check',
      oneOf(table.reinstatementReason, REINSTATEMENT_REASONS),
    ),
    check(
      'case_manual_decisions_previous_status_check',
      oneOf(table.previousStatus, DECIDED_STATUSES),
    ),
    check(
      'case_manual_decisions_exclusion_check',
      sql`(${table.kind} = 'exclude') = (${table.exclusionReason} IS NOT NULL AND ${table.reinstatementReason} IS NULL AND ${table.previousStatus} = 'measured')`,
    ),
    check(
      'case_manual_decisions_reinstatement_check',
      sql`(${table.kind} = 'reinstate') = (${table.reinstatementReason} IS NOT NULL AND ${table.exclusionReason} IS NULL AND ${table.previousStatus} = 'excluded')`,
    ),
    check(
      'case_manual_decisions_comment_check',
      sql`${table.comment} IS NOT NULL OR (${table.exclusionReason} IS DISTINCT FROM 'other_confounding_factor' AND ${table.reinstatementReason} IS DISTINCT FROM 'criterion_unsuited_to_case')`,
    ),
    index('case_manual_decisions_case_idx').on(table.caseId, table.decidedAt),
  ],
);

/**
 * The history of a case's status, measured game and gap: a row per change, never
 * updated, with the cause of the recalculation that made it (SEN-07, SEN-08, SEN-37,
 * CL-SEN-17, CL-SUI-17).
 */
export const caseHistoryEntries = pgTable(
  'case_history_entries',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    status: text('status', { enum: CASE_STATUSES }).notNull(),
    statusReason: text('status_reason', { enum: CASE_STATUS_REASONS }),
    measuredGameId: integer('measured_game_id').references(() => games.id, {
      onDelete: 'restrict',
    }),
    normalizedGap: doublePrecision('normalized_gap'),
    gapStatus: text('gap_status', { enum: GAP_STATUSES }),
    cause: text('cause', { enum: VERDICT_CHANGE_CAUSES }).notNull(),
  },
  (table) => [
    check('case_history_entries_status_check', oneOf(table.status, CASE_STATUSES)),
    check(
      'case_history_entries_status_reason_check',
      oneOf(table.statusReason, CASE_STATUS_REASONS),
    ),
    check('case_history_entries_gap_status_check', oneOf(table.gapStatus, GAP_STATUSES)),
    check('case_history_entries_cause_check', oneOf(table.cause, VERDICT_CHANGE_CAUSES)),
    index('case_history_entries_case_idx').on(table.caseId, table.recordedAt),
  ],
);

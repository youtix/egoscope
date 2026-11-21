import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, smallint, text } from 'drizzle-orm/pg-core';

import { notBlank, oneOf, timestamptz } from './builders';

import type { AnyPgColumn, CheckBuilder } from 'drizzle-orm/pg-core';

// EventTypeStatus (TAX-10).
const EVENT_TYPE_STATUSES = ['proposed', 'validated', 'rejected', 'withdrawn'] as const;
// EventTypeOrigin (TAX-15): a type born of a split takes the origin of its parent.
const EVENT_TYPE_ORIGINS = ['scoping', 'exploration', 'detection'] as const;
// CalendarDerivation, set at seeding on the two calendar-derived types only (ADR 0015).
const CALENDAR_DERIVATIONS = ['birthday', 'former_team'] as const;
// DocumentationDifficulty (TAX-01, TAX-08).
const DOCUMENTATION_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
// The doubtful-case criteria a type may switch off, the manual decision aside (ADR 0016).
const SWITCHABLE_CRITERIA = [
  'playing_time_too_low',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'co_occurring',
] as const;
// TypeRejectionReason (TAX-13, H-TAX-04).
const TYPE_REJECTION_REASONS = [
  'not_clean',
  'not_datable',
  'duplicate_of_existing_type',
  'out_of_scope',
  'other',
] as const;
// TypeWithdrawalReasonKind (TAX-27, TAX-29, TAX-31).
const TYPE_WITHDRAWAL_REASON_KINDS = ['entered', 'merged_into', 'split_into'] as const;

// The columns of event_types that its row checks read.
type StateColumns = Readonly<
  Record<
    | 'status'
    | 'origin'
    | 'definition'
    | 'inclusionCriteria'
    | 'exclusionCriteria'
    | 'datingRule'
    | 'knownInAdvance'
    | 'calendarDerivation'
    | 'genericExample'
    | 'documentationDifficulty'
    | 'coverageThresholdOutlets'
    | 'coverageThresholdDays'
    | 'currentVersionNumber'
    | 'rejectionReason'
    | 'rejectionComment'
    | 'withdrawalReasonKind'
    | 'withdrawalReason'
    | 'mergedIntoTypeId'
    | 'noFitReason',
    AnyPgColumn
  >
>;

/**
 * The row checks of event_types, each named after its rule: a validated or withdrawn
 * type has its sheet complete, a rejected one its reason, a withdrawn one the kind of
 * its reason, a coverage threshold both its numbers, and the marks of the calendar and
 * of detection the origin they belong to (TAX-01, TAX-12, TAX-13, TAX-27, TAX-31,
 * CL-TAX-14, CL-TAX-20).
 */
function stateChecks(table: StateColumns): CheckBuilder[] {
  return [
    check(
      'event_types_complete_sheet_check',
      sql`${table.status} NOT IN ('validated', 'withdrawn') OR (${table.currentVersionNumber}, ${table.definition}, ${table.inclusionCriteria}, ${table.exclusionCriteria}, ${table.datingRule}, ${table.genericExample}, ${table.documentationDifficulty}) IS NOT NULL`,
    ),
    check(
      'event_types_rejected_check',
      sql`(${table.status} = 'rejected') = (${table.rejectionReason} IS NOT NULL)`,
    ),
    check(
      'event_types_commented_rejection_check',
      sql`${table.rejectionComment} IS NULL OR ${table.rejectionReason} IS NOT NULL`,
    ),
    check(
      'event_types_withdrawn_check',
      sql`(${table.status} = 'withdrawn') = (${table.withdrawalReasonKind} IS NOT NULL)`,
    ),
    // The converse, that a type merged into another names it, is the taxonomy
    // service's: a restore loads merged_into_type_id in a second pass. Compared with
    // IS NOT DISTINCT FROM, a type that is not withdrawn has no reason kind to let a
    // merge or a reason through.
    check(
      'event_types_merged_into_check',
      sql`${table.mergedIntoTypeId} IS NULL OR ${table.withdrawalReasonKind} IS NOT DISTINCT FROM 'merged_into'`,
    ),
    check(
      'event_types_entered_reason_check',
      sql`(${table.withdrawalReasonKind} IS NOT DISTINCT FROM 'entered') = (${table.withdrawalReason} IS NOT NULL)`,
    ),
    check(
      'event_types_coverage_threshold_check',
      sql`(${table.coverageThresholdOutlets} IS NULL) = (${table.coverageThresholdDays} IS NULL)`,
    ),
    check(
      'event_types_calendar_derived_check',
      sql`${table.calendarDerivation} IS NULL OR (${table.origin} = 'scoping' AND ${table.knownInAdvance})`,
    ),
    check(
      'event_types_detection_proposal_check',
      sql`${table.noFitReason} IS NULL OR ${table.origin} = 'detection'`,
    ),
  ];
}

/**
 * An event type, keyed by the kebab-case slug of CL-TAX-02, which never changes and,
 * types never being deleted, is never reused; the row holds the type's state and its
 * current sheet, which a validated or withdrawn type has complete (TAX-01, TAX-02,
 * TAX-10, TAX-12, TAX-15, ADR 0015, ADR 0016).
 */
export const eventTypes = pgTable(
  'event_types',
  {
    id: text('id').primaryKey(),
    status: text('status', { enum: EVENT_TYPE_STATUSES }).notNull().default('proposed'),
    origin: text('origin', { enum: EVENT_TYPE_ORIGINS }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    name: text('name').notNull(),
    definition: text('definition'),
    inclusionCriteria: text('inclusion_criteria'),
    exclusionCriteria: text('exclusion_criteria'),
    datingRule: text('dating_rule'),
    knownInAdvance: boolean('known_in_advance').notNull().default(false),
    calendarDerivation: text('calendar_derivation', { enum: CALENDAR_DERIVATIONS }),
    genericExample: text('generic_example'),
    documentationDifficulty: text('documentation_difficulty', { enum: DOCUMENTATION_DIFFICULTIES }),
    cautionNotes: text('caution_notes'),
    isIntimateSubject: boolean('is_intimate_subject').notNull().default(false),
    coverageThresholdOutlets: smallint('coverage_threshold_outlets'),
    coverageThresholdDays: smallint('coverage_threshold_days'),
    switchedOffCriterion: text('switched_off_criterion', { enum: SWITCHABLE_CRITERIA }),
    currentVersionNumber: smallint('current_version_number'),
    rejectionReason: text('rejection_reason', { enum: TYPE_REJECTION_REASONS }),
    rejectionComment: text('rejection_comment'),
    withdrawalReasonKind: text('withdrawal_reason_kind', { enum: TYPE_WITHDRAWAL_REASON_KINDS }),
    withdrawalReason: text('withdrawal_reason'),
    mergedIntoTypeId: text('merged_into_type_id').references((): AnyPgColumn => eventTypes.id, {
      onDelete: 'restrict',
    }),
    splitFromTypeId: text('split_from_type_id').references((): AnyPgColumn => eventTypes.id, {
      onDelete: 'restrict',
    }),
    noFitReason: text('no_fit_reason'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check(
      'event_types_id_check',
      sql`${table.id} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${table.id}) <= 50`,
    ),
    check('event_types_status_check', oneOf(table.status, EVENT_TYPE_STATUSES)),
    check('event_types_origin_check', oneOf(table.origin, EVENT_TYPE_ORIGINS)),
    check('event_types_name_check', notBlank(table.name)),
    check(
      'event_types_calendar_derivation_check',
      oneOf(table.calendarDerivation, CALENDAR_DERIVATIONS),
    ),
    check(
      'event_types_documentation_difficulty_check',
      oneOf(table.documentationDifficulty, DOCUMENTATION_DIFFICULTIES),
    ),
    check(
      'event_types_coverage_threshold_outlets_check',
      sql`${table.coverageThresholdOutlets} BETWEEN 2 AND 10`,
    ),
    check(
      'event_types_coverage_threshold_days_check',
      sql`${table.coverageThresholdDays} BETWEEN 1 AND 7`,
    ),
    check(
      'event_types_switched_off_criterion_check',
      oneOf(table.switchedOffCriterion, SWITCHABLE_CRITERIA),
    ),
    check('event_types_current_version_number_check', sql`${table.currentVersionNumber} >= 1`),
    check(
      'event_types_rejection_reason_check',
      oneOf(table.rejectionReason, TYPE_REJECTION_REASONS),
    ),
    check(
      'event_types_withdrawal_reason_kind_check',
      oneOf(table.withdrawalReasonKind, TYPE_WITHDRAWAL_REASON_KINDS),
    ),
    ...stateChecks(table),
  ],
);

/**
 * Every dated transition of a type, reopenings and reactivations included; a change
 * from none is the birth of a type split from another, which is born validated
 * (TAX-10, TAX-29).
 */
export const eventTypeStatusChanges = pgTable(
  'event_type_status_changes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    fromStatus: text('from_status', { enum: EVENT_TYPE_STATUSES }),
    toStatus: text('to_status', { enum: EVENT_TYPE_STATUSES }).notNull(),
  },
  (table) => [
    check(
      'event_type_status_changes_from_status_check',
      oneOf(table.fromStatus, EVENT_TYPE_STATUSES),
    ),
    check('event_type_status_changes_to_status_check', oneOf(table.toStatus, EVENT_TYPE_STATUSES)),
    check(
      'event_type_status_changes_transition_check',
      sql`${table.fromStatus} IS NULL OR (${table.fromStatus}, ${table.toStatus}) IN (('proposed', 'validated'), ('proposed', 'rejected'), ('rejected', 'proposed'), ('validated', 'withdrawn'), ('withdrawn', 'validated'))`,
    ),
    check(
      'event_type_status_changes_split_birth_check',
      sql`${table.fromStatus} IS NOT NULL OR ${table.toStatus} = 'validated'`,
    ),
    index('event_type_status_changes_type_idx').on(table.eventTypeId, table.changedAt),
  ],
);

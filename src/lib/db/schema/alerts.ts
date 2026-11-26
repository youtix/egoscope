// The tables of the alerts module that hold a sheet and its frozen content
// (alert-sheets.md, Lot 2): the sheet, its sections and events, their outcomes and
// the profile values copied into it; its history sits in alerts-history.ts.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { events } from './events';
import { teams } from './games';
import { followedPlayers } from './players';
import { BASELINE_STATUSES, GAP_STATUSES } from './sensitivity';
import { PROFILE_CONFIDENCES, VERDICT_DIRECTIONS, VERDICT_LEVELS } from './sensitivity-profiles';
import { eventTypes } from './taxonomy';
import { CASE_CATEGORIES } from './tracking';

// AlertSheetStatus and AlertSheetCancellationReason (ALE-22, ALE-26, ALE-31, CL-ALE-13).
const ALERT_SHEET_STATUSES = ['open', 'closed', 'canceled'] as const;
const CANCELLATION_REASONS = [
  'all_events_dismissed',
  'attachment_corrected',
  'event_no_longer_applies',
] as const;
// AlertSheetSectionKind, ProfileSnapshotState and the notices of a frozen section
// (ALE-05, ALE-19, ALE-20, ALE-31).
const SECTION_KINDS = ['initial', 'later_event', 'type_change'] as const;
const PROFILE_SNAPSHOT_STATES = ['pending', 'frozen'] as const;
const PROFILE_STATUS_NOTICES = ['recalculation_in_progress', 'no_measured_case_yet'] as const;
// SnapshotKind (ALE-09, ALE-11).
const SNAPSHOT_KINDS = ['profile', 'trend'] as const;

/**
 * The sourced write-up produced for a profiled player's new detected event or an
 * upcoming calendar-derived one; its identifier is its sheet number, never reused
 * (ALE-01 to ALE-07, ALE-22 to ALE-28, ALE-30, CL-ALE-04, CL-ALE-07, CL-ALE-11).
 */
export const alertSheets = pgTable(
  'alert_sheets',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'restrict' }),
    teamIdAtProduction: integer('team_id_at_production').references(() => teams.id, {
      onDelete: 'restrict',
    }),
    producedAt: timestamptz('produced_at').notNull(),
    profileValuesEnteredAt: timestamptz('profile_values_entered_at'),
    status: text('status', { enum: ALERT_SHEET_STATUSES }).notNull().default('open'),
    cancellationReason: text('cancellation_reason', { enum: CANCELLATION_REASONS }),
    isLate: boolean('is_late').notNull().default(false),
    caveatsFrozenAt: timestamptz('caveats_frozen_at'),
  },
  (table) => [
    check(
      'alert_sheets_profile_values_entered_check',
      sql`${table.profileValuesEnteredAt} >= ${table.producedAt}`,
    ),
    check('alert_sheets_status_check', oneOf(table.status, ALERT_SHEET_STATUSES)),
    check(
      'alert_sheets_cancellation_reason_check',
      oneOf(table.cancellationReason, CANCELLATION_REASONS),
    ),
    check(
      'alert_sheets_canceled_check',
      sql`(${table.status} = 'canceled') = (${table.cancellationReason} IS NOT NULL)`,
    ),
    index('alert_sheets_player_idx').on(table.playerId, table.producedAt),
    index('alert_sheets_status_idx').on(table.status, table.producedAt),
    index('alert_sheets_late_idx')
      .on(table.producedAt)
      .where(sql`${table.isLate}`),
  ],
);

/**
 * The block of one event type on a sheet, the initial content or a dated later
 * one, with its own frozen profile (ALE-05, ALE-14, ALE-19, ALE-20, ALE-30,
 * ALE-31, CL-ALE-07, CL-ALE-16).
 */
export const alertSheetSections = pgTable(
  'alert_sheet_sections',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alertSheetId: integer('alert_sheet_id')
      .notNull()
      .references(() => alertSheets.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SECTION_KINDS }).notNull(),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    addedAt: timestamptz('added_at').notNull(),
    profileState: text('profile_state', { enum: PROFILE_SNAPSHOT_STATES }).notNull(),
    frozenAt: timestamptz('frozen_at'),
    profileStatusNotice: text('profile_status_notice', { enum: PROFILE_STATUS_NOTICES }),
    typeNotCovered: boolean('type_not_covered').notNull().default(false),
    profileChangedSinceIssueAt: timestamptz('profile_changed_since_issue_at'),
    vacatedByEventId: integer('vacated_by_event_id').references(() => events.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    check('alert_sheet_sections_kind_check', oneOf(table.kind, SECTION_KINDS)),
    check(
      'alert_sheet_sections_profile_state_check',
      oneOf(table.profileState, PROFILE_SNAPSHOT_STATES),
    ),
    check(
      'alert_sheet_sections_frozen_check',
      sql`(${table.profileState} = 'frozen') = (${table.frozenAt} IS NOT NULL)`,
    ),
    check(
      'alert_sheet_sections_profile_status_notice_check',
      oneOf(table.profileStatusNotice, PROFILE_STATUS_NOTICES),
    ),
    check(
      'alert_sheet_sections_notice_check',
      sql`${table.profileStatusNotice} IS NULL OR ${table.profileState} = 'frozen'`,
    ),
    uniqueIndex('alert_sheet_sections_uq').on(table.alertSheetId, table.eventTypeId),
    uniqueIndex('alert_sheet_sections_initial_uq')
      .on(table.alertSheetId)
      .where(sql`${table.kind} = 'initial'`),
    index('alert_sheet_sections_type_idx').on(table.eventTypeId),
  ],
);

/**
 * An event placed on a sheet, which belongs to one sheet only; only its detection
 * confidence is kept as issued, the rest read from the event (ALE-03, ALE-08,
 * ALE-20, ALE-21, ALE-31, CL-ALE-13, CL-ALE-16).
 */
export const alertSheetEvents = pgTable(
  'alert_sheet_events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alertSheetSectionId: integer('alert_sheet_section_id').notNull(),
    playerEventId: integer('player_event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    addedAt: timestamptz('added_at').notNull(),
    detectionConfidenceAtIssue: smallint('detection_confidence_at_issue'),
  },
  (table) => [
    foreignKey({
      name: 'alert_sheet_events_alert_sheet_section_id_fk',
      columns: [table.alertSheetSectionId],
      foreignColumns: [alertSheetSections.id],
    }).onDelete('cascade'),
    check(
      'alert_sheet_events_detection_confidence_at_issue_check',
      sql`${table.detectionConfidenceAtIssue} BETWEEN 0 AND 100`,
    ),
    uniqueIndex('alert_sheet_events_event_uq').on(table.playerEventId),
  ],
);

/**
 * The outcome of a sheet event's case at closure, which names the event and not
 * the case, and the values it last showed, the base of the next comparison
 * (ALE-27, ALE-29, CL-ALE-12, CL-TRV-24).
 */
export const alertSheetOutcomes = pgTable(
  'alert_sheet_outcomes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alertSheetEventId: integer('alert_sheet_event_id').notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
    shownGap: doublePrecision('shown_gap'),
    shownGapStatus: text('shown_gap_status', { enum: GAP_STATUSES }),
    shownBaselineMean: doublePrecision('shown_baseline_mean'),
    shownBaselineDeviation: doublePrecision('shown_baseline_deviation'),
    shownBaselineStatus: text('shown_baseline_status', { enum: BASELINE_STATUSES }),
    shownCategory: text('shown_category', { enum: CASE_CATEGORIES }),
  },
  (table) => [
    foreignKey({
      name: 'alert_sheet_outcomes_alert_sheet_event_id_fk',
      columns: [table.alertSheetEventId],
      foreignColumns: [alertSheetEvents.id],
    }).onDelete('cascade'),
    check('alert_sheet_outcomes_shown_gap_status_check', oneOf(table.shownGapStatus, GAP_STATUSES)),
    check(
      'alert_sheet_outcomes_shown_gap_check',
      sql`(${table.shownGap} IS NULL) = (${table.shownGapStatus} IS NULL)`,
    ),
    check(
      'alert_sheet_outcomes_shown_baseline_status_check',
      oneOf(table.shownBaselineStatus, BASELINE_STATUSES),
    ),
    check('alert_sheet_outcomes_shown_category_check', oneOf(table.shownCategory, CASE_CATEGORIES)),
    uniqueIndex('alert_sheet_outcomes_uq').on(table.alertSheetEventId),
  ],
);

/**
 * Profile or trend values copied as they were when they entered the sheet, never
 * rewritten and tied to no live profile row: a section's profile and trend, or an
 * outcome's profile after its case (ALE-09 to ALE-12, ALE-19, ALE-27, CL-ALE-12).
 */
export const alertSheetSnapshots = pgTable(
  'alert_sheet_snapshots',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alertSheetSectionId: integer('alert_sheet_section_id'),
    alertSheetOutcomeId: integer('alert_sheet_outcome_id'),
    kind: text('kind', { enum: SNAPSHOT_KINDS }).notNull(),
    meanGap: doublePrecision('mean_gap'),
    rangeLow: doublePrecision('range_low'),
    rangeHigh: doublePrecision('range_high'),
    validCount: integer('valid_count').notNull(),
    historicalCount: integer('historical_count'),
    trackedCount: integer('tracked_count'),
    excludedCount: integer('excluded_count'),
    playerCount: integer('player_count'),
    verdictLevel: text('verdict_level', { enum: VERDICT_LEVELS }).notNull(),
    verdictDirection: text('verdict_direction', { enum: VERDICT_DIRECTIONS }),
    profileConfidence: text('profile_confidence', { enum: PROFILE_CONFIDENCES }).notNull(),
    fragile: boolean('fragile'),
    validCaseThreshold: integer('valid_case_threshold'),
    computedAt: timestamptz('computed_at').notNull(),
    detail: jsonb('detail').notNull().default({}),
  },
  (table) => [
    foreignKey({
      name: 'alert_sheet_snapshots_alert_sheet_section_id_fk',
      columns: [table.alertSheetSectionId],
      foreignColumns: [alertSheetSections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'alert_sheet_snapshots_alert_sheet_outcome_id_fk',
      columns: [table.alertSheetOutcomeId],
      foreignColumns: [alertSheetOutcomes.id],
    }).onDelete('cascade'),
    check(
      'alert_sheet_snapshots_owner_check',
      sql`num_nonnulls(${table.alertSheetSectionId}, ${table.alertSheetOutcomeId}) = 1`,
    ),
    check('alert_sheet_snapshots_kind_check', oneOf(table.kind, SNAPSHOT_KINDS)),
    check(
      'alert_sheet_snapshots_outcome_kind_check',
      sql`${table.alertSheetOutcomeId} IS NULL OR ${table.kind} = 'profile'`,
    ),
    check('alert_sheet_snapshots_range_check', sql`${table.rangeHigh} >= ${table.rangeLow}`),
    check('alert_sheet_snapshots_valid_count_check', sql`${table.validCount} >= 0`),
    check('alert_sheet_snapshots_verdict_level_check', oneOf(table.verdictLevel, VERDICT_LEVELS)),
    check(
      'alert_sheet_snapshots_verdict_direction_check',
      oneOf(table.verdictDirection, VERDICT_DIRECTIONS),
    ),
    check(
      'alert_sheet_snapshots_verdict_check',
      sql`(${table.verdictLevel} = 'inconclusive') = (${table.verdictDirection} IS NULL)`,
    ),
    check(
      'alert_sheet_snapshots_profile_confidence_check',
      oneOf(table.profileConfidence, PROFILE_CONFIDENCES),
    ),
    uniqueIndex('alert_sheet_snapshots_section_uq')
      .on(table.alertSheetSectionId, table.kind)
      .where(sql`${table.alertSheetSectionId} IS NOT NULL`),
    uniqueIndex('alert_sheet_snapshots_outcome_uq')
      .on(table.alertSheetOutcomeId)
      .where(sql`${table.alertSheetOutcomeId} IS NOT NULL`),
  ],
);

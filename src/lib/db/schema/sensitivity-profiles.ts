// The tables of the sensitivity module that reference the parameter snapshot a result
// was computed with: profiles, trends and the recalculation jobs
// (sensitivity-and-profiles.md sections 1.1, 1.2 and 1.4). The snapshot's file imports
// the journal, which references the cases, so they live apart from sensitivity.ts;
// their histories sit in sensitivity-history.ts.
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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { oneOf, subsetOf, timestamptz } from './builders';
import { parameterSnapshots } from './params';
import { followedPlayers } from './players';
import { VERDICT_CHANGE_CAUSES } from './sensitivity';
import { eventTypes } from './taxonomy';

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, CheckBuilder, ForeignKeyBuilder } from 'drizzle-orm/pg-core';

// ProfileView (SEN-21, CL-SEN-19).
const PROFILE_VIEWS = ['all_cases', 'historical_only', 'tracked_only'] as const;
/** VerdictLevel and VerdictDirection (SEN-23, SEN-24). */
export const VERDICT_LEVELS = ['inconclusive', 'possible', 'probable'] as const;
export const VERDICT_DIRECTIONS = ['increase', 'decrease'] as const;
/** ProfileConfidence (SEN-25). */
export const PROFILE_CONFIDENCES = ['low', 'medium', 'high'] as const;
// ConfidenceStepDownReason, of a trend; a profile has no dominant player (SEN-25, SEN-29).
const TREND_STEP_DOWN_REASONS = [
  'high_dispersion',
  'high_doubtful_share',
  'fragile_verdict',
  'dominant_player',
] as const;
const PROFILE_STEP_DOWN_REASONS = [
  'high_dispersion',
  'high_doubtful_share',
  'fragile_verdict',
] as const satisfies readonly (typeof TREND_STEP_DOWN_REASONS)[number][];
// The scopes of a recalculation job, items a to d of SEN-34.
const JOB_SCOPES = ['import', 'statistics_update', 'event_or_case_change', 'full'] as const;
// A job is deleted when it ends (CL-SEN-16).
const JOB_STATUSES = ['pending', 'running'] as const;

/**
 * The columns that a profile and a trend share, from the tally to the date of the
 * calculation, with the plausible range of the control mean gap beside it (SEN-20 to
 * SEN-27, SEN-38).
 */
function calculationColumns<TReasons extends readonly [string, ...string[]]>(reasons: TReasons) {
  return {
    eventCount: integer('event_count').notNull(),
    caseCount: integer('case_count').notNull(),
    groupedEventCount: integer('grouped_event_count').notNull(),
    awaitingCount: integer('awaiting_count').notNull(),
    validCount: integer('valid_count').notNull(),
    excludedCount: integer('excluded_count').notNull(),
    manuallyExcludedCount: integer('manually_excluded_count').notNull(),
    notMeasurableCount: integer('not_measurable_count').notNull(),
    coOccurringCount: integer('co_occurring_count').notNull(),
    provisionalGapCount: integer('provisional_gap_count').notNull(),
    historicalValidCount: integer('historical_valid_count').notNull(),
    trackedValidCount: integer('tracked_valid_count').notNull(),
    tallyReasons: jsonb('tally_reasons').notNull(),
    exitCounts: jsonb('exit_counts').notNull(),
    lowResearchConfidenceCount: integer('low_research_confidence_count').notNull(),
    meanGap: doublePrecision('mean_gap'),
    gapDispersion: doublePrecision('gap_dispersion'),
    retainedDispersion: doublePrecision('retained_dispersion'),
    expectedNoise: doublePrecision('expected_noise'),
    signalToNoise: doublePrecision('signal_to_noise'),
    rangeLow: doublePrecision('range_low'),
    rangeHigh: doublePrecision('range_high'),
    aboveZeroCount: integer('above_zero_count').notNull(),
    belowZeroCount: integer('below_zero_count').notNull(),
    verdictLevel: text('verdict_level', { enum: VERDICT_LEVELS }).notNull(),
    verdictDirection: text('verdict_direction', { enum: VERDICT_DIRECTIONS }),
    isFragile: boolean('is_fragile').notNull(),
    profileConfidence: text('profile_confidence', { enum: PROFILE_CONFIDENCES }).notNull(),
    confidenceStepDownReasons: text('confidence_step_down_reasons', { enum: reasons })
      .array()
      .notNull()
      .default([]),
    controlCaseCount: integer('control_case_count').notNull(),
    controlMeanGap: doublePrecision('control_mean_gap'),
    controlRangeLow: doublePrecision('control_range_low'),
    controlRangeHigh: doublePrecision('control_range_high'),
    controlVerdictLevel: text('control_verdict_level', { enum: VERDICT_LEVELS }).notNull(),
    controlVerdictDirection: text('control_verdict_direction', { enum: VERDICT_DIRECTIONS }),
    dependsOnManualExclusions: boolean('depends_on_manual_exclusions').notNull(),
    validCaseThreshold: smallint('valid_case_threshold').notNull(),
    parameterSnapshotId: integer('parameter_snapshot_id').notNull(),
    computedAt: timestamptz('computed_at').notNull(),
  };
}

// The columns of a profile or a trend that their checks read.
type CalculationColumns = Readonly<
  Record<
    | 'view'
    | 'eventCount'
    | 'caseCount'
    | 'groupedEventCount'
    | 'awaitingCount'
    | 'validCount'
    | 'excludedCount'
    | 'notMeasurableCount'
    | 'historicalValidCount'
    | 'trackedValidCount'
    | 'meanGap'
    | 'gapDispersion'
    | 'verdictLevel'
    | 'verdictDirection'
    | 'profileConfidence'
    | 'confidenceStepDownReasons'
    | 'controlMeanGap'
    | 'controlRangeLow'
    | 'controlRangeHigh'
    | 'controlVerdictLevel'
    | 'controlVerdictDirection'
    | 'parameterSnapshotId',
    AnyPgColumn
  >
>;

/** The condition that a verdict has a direction exactly when it is not inconclusive (SEN-24). */
export function directedVerdict(level: AnyPgColumn, direction: AnyPgColumn): SQL {
  return sql`(${level} = 'inconclusive') = (${direction} IS NULL)`;
}

/**
 * The checks that a profile and a trend share, named after their table: the values of
 * the stored sets, the tally invariants, a direction exactly when the level is not
 * inconclusive, the nulls below one or two valid cases, and the control range set
 * with its mean; and the parameter snapshot every result was computed with (SEN-20,
 * SEN-22, SEN-24, SEN-27, SEN-32, SEN-36, SEN-38, CL-SEN-15).
 */
function calculationChecks(
  name: 'sensitivity_profiles' | 'general_trends',
  table: CalculationColumns,
  reasons: readonly string[],
): (CheckBuilder | ForeignKeyBuilder)[] {
  return [
    check(`${name}_view_check`, oneOf(table.view, PROFILE_VIEWS)),
    check(`${name}_verdict_level_check`, oneOf(table.verdictLevel, VERDICT_LEVELS)),
    check(`${name}_verdict_direction_check`, oneOf(table.verdictDirection, VERDICT_DIRECTIONS)),
    check(`${name}_profile_confidence_check`, oneOf(table.profileConfidence, PROFILE_CONFIDENCES)),
    check(
      `${name}_confidence_step_down_reasons_check`,
      subsetOf(table.confidenceStepDownReasons, reasons),
    ),
    check(`${name}_control_verdict_level_check`, oneOf(table.controlVerdictLevel, VERDICT_LEVELS)),
    check(
      `${name}_control_verdict_direction_check`,
      oneOf(table.controlVerdictDirection, VERDICT_DIRECTIONS),
    ),
    check(
      `${name}_event_count_check`,
      sql`${table.eventCount} = ${table.caseCount} + ${table.groupedEventCount}`,
    ),
    check(
      `${name}_case_count_check`,
      sql`${table.caseCount} = ${table.awaitingCount} + ${table.validCount} + ${table.excludedCount} + ${table.notMeasurableCount}`,
    ),
    check(
      `${name}_valid_count_check`,
      sql`${table.validCount} = ${table.historicalValidCount} + ${table.trackedValidCount}`,
    ),
    check(`${name}_verdict_check`, directedVerdict(table.verdictLevel, table.verdictDirection)),
    check(
      `${name}_control_verdict_check`,
      directedVerdict(table.controlVerdictLevel, table.controlVerdictDirection),
    ),
    check(`${name}_mean_gap_check`, sql`(${table.validCount} = 0) = (${table.meanGap} IS NULL)`),
    check(
      `${name}_gap_dispersion_check`,
      sql`(${table.validCount} < 2) = (${table.gapDispersion} IS NULL)`,
    ),
    check(
      `${name}_control_range_check`,
      sql`(${table.controlRangeLow} IS NULL) = (${table.controlMeanGap} IS NULL) AND (${table.controlRangeHigh} IS NULL) = (${table.controlMeanGap} IS NULL)`,
    ),
    foreignKey({
      name: `${name}_parameter_snapshot_id_fk`,
      columns: [table.parameterSnapshotId],
      foreignColumns: [parameterSnapshots.id],
    }).onDelete('restrict'),
  ];
}

/**
 * The calculation for one player, one type and one view, written whole by each job
 * that covers it, while its tally holds an event or the birthday type is validated
 * (SEN-19 to SEN-27, SEN-32, SEN-36, CL-SEN-16, CL-SEN-18, CL-SEN-19, CL-SEN-26).
 */
export const sensitivityProfiles = pgTable(
  'sensitivity_profiles',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    view: text('view', { enum: PROFILE_VIEWS }).notNull(),
    ...calculationColumns(PROFILE_STEP_DOWN_REASONS),
  },
  (table) => [
    ...calculationChecks('sensitivity_profiles', table, PROFILE_STEP_DOWN_REASONS),
    unique('sensitivity_profiles_key').on(table.playerId, table.eventTypeId, table.view),
    index('sensitivity_profiles_type_view_idx').on(table.eventTypeId, table.view),
  ],
);

/**
 * The same calculation for one type and one view over every followed player, each case
 * weighing the same, which names no player (SEN-28 to SEN-30, H-JOU-07, CL-SEN-18).
 */
export const generalTrends = pgTable(
  'general_trends',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    view: text('view', { enum: PROFILE_VIEWS }).notNull(),
    ...calculationColumns(TREND_STEP_DOWN_REASONS),
    distinctPlayerCount: integer('distinct_player_count').notNull(),
    topContributorValidCount: integer('top_contributor_valid_count').notNull(),
  },
  (table) => [
    ...calculationChecks('general_trends', table, TREND_STEP_DOWN_REASONS),
    unique('general_trends_key').on(table.eventTypeId, table.view),
  ],
);

/**
 * A recalculation recorded with its scope and its cause in the transaction of its
 * change, run one at a time in the order recorded and deleted when its last chunk ends;
 * a job of the whole base names no player (SEN-34, SEN-36, SEN-37, CL-SEN-16,
 * CL-SEN-17, CL-JOU-06).
 */
export const recalculationJobs = pgTable(
  'recalculation_jobs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    scope: text('scope', { enum: JOB_SCOPES }).notNull(),
    playerIds: uuid('player_ids').array(),
    eventTypeIds: text('event_type_ids').array(),
    gameIds: integer('game_ids').array(),
    cause: text('cause', { enum: VERDICT_CHANGE_CAUSES }).notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('pending'),
    startedAt: timestamptz('started_at'),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    progressCursor: text('progress_cursor'),
    parameterSnapshotId: integer('parameter_snapshot_id'),
  },
  (table) => [
    check('recalculation_jobs_scope_check', oneOf(table.scope, JOB_SCOPES)),
    check('recalculation_jobs_cause_check', oneOf(table.cause, VERDICT_CHANGE_CAUSES)),
    check('recalculation_jobs_status_check', oneOf(table.status, JOB_STATUSES)),
    check(
      'recalculation_jobs_full_scope_check',
      sql`(${table.scope} = 'full') = (${table.playerIds} IS NULL)`,
    ),
    foreignKey({
      name: 'recalculation_jobs_parameter_snapshot_id_fk',
      columns: [table.parameterSnapshotId],
      foreignColumns: [parameterSnapshots.id],
    }).onDelete('restrict'),
    uniqueIndex('recalculation_jobs_one_running_key')
      .on(sql`(true)`)
      .where(sql`${table.status} = 'running'`),
  ],
);

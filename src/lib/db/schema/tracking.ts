// The tables of the tracking module (tracking-and-validation.md, Lot 2): what file
// 10 adds to a core case of origin tracked, and the exits a regrouping leaves.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { events } from './events';
import { followedPlayers } from './players';
import { cases, GAP_STATUSES } from './sensitivity';
import { PROFILE_CONFIDENCES, VERDICT_DIRECTIONS } from './sensitivity-profiles';
import { eventTypes } from './taxonomy';

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// ForecastState, ForecastSource and the level of a forecast (SUI-08 to SUI-10, CL-SUI-03).
const FORECAST_STATES = ['frozen', 'late', 'none'] as const;
const FORECAST_SOURCES = ['player_profile', 'general_trend', 'none'] as const;
const FORECAST_LEVELS = ['possible', 'probable'] as const;
// CaseCategory (SUI-22).
export const CASE_CATEGORIES = ['confirmed', 'refuted', 'neutral', 'no_forecast'] as const;
// TrackedGameResultKind (SUI-19, SUI-20).
const TRACKED_GAME_RESULT_KINDS = ['indicative', 'final'] as const;
// PostTipOffDecisionKind and PostTipOffDecisionEffect (SUI-17, CL-SUI-10).
const DECISION_KINDS = [
  'event_dismissed',
  'event_reinstated',
  'case_excluded',
  'case_reinstated',
  'context_corrected',
  'reference_date_corrected',
  'player_corrected',
  'type_corrected',
  'dating_mark_lifted',
] as const;
const DECISION_EFFECTS = ['exit', 'entry', 'measured_game_change'] as const;
// OverallSubrowKind (SUI-28, CL-SUI-16).
const OVERALL_SUBROWS = ['probable_profile', 'possible_profile', 'general_trend'] as const;

/**
 * The condition that a forecast's fields are all set when it comes from a profile
 * or a trend, and none of them otherwise, a missing source included (SUI-08).
 */
function forecastFields(source: AnyPgColumn, fields: readonly AnyPgColumn[]): SQL {
  const list = sql.join([...fields], sql.raw(', '));
  return sql`CASE WHEN ${source} IN ('player_profile', 'general_trend') THEN num_nulls(${list}) = 0 ELSE num_nonnulls(${list}) = 0 END`;
}

/**
 * The file-10 extension of a core case of origin tracked: its frozen or late
 * forecast and its current category (SUI-01, SUI-05, SUI-08 to SUI-10, SUI-22,
 * CL-SUI-03, CL-SUI-05).
 */
export const trackedCases = pgTable(
  'tracked_cases',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    forecastState: text('forecast_state', { enum: FORECAST_STATES }),
    forecastSource: text('forecast_source', { enum: FORECAST_SOURCES }),
    forecastLevel: text('forecast_level', { enum: FORECAST_LEVELS }),
    forecastDirection: text('forecast_direction', { enum: VERDICT_DIRECTIONS }),
    announcedMeanGap: doublePrecision('announced_mean_gap'),
    forecastCaseCount: integer('forecast_case_count'),
    forecastProfileConfidence: text('forecast_profile_confidence', { enum: PROFILE_CONFIDENCES }),
    forecastFrozenAt: timestamptz('forecast_frozen_at'),
    awaitingLateForecast: boolean('awaiting_late_forecast').notNull().default(false),
    category: text('category', { enum: CASE_CATEGORIES }),
  },
  (table) => [
    check('tracked_cases_forecast_state_check', oneOf(table.forecastState, FORECAST_STATES)),
    check('tracked_cases_forecast_source_check', oneOf(table.forecastSource, FORECAST_SOURCES)),
    check(
      'tracked_cases_forecast_chosen_check',
      sql`(${table.forecastState} IS NULL) = (${table.forecastSource} IS NULL)`,
    ),
    check(
      'tracked_cases_no_forecast_check',
      sql`(${table.forecastState} IS NOT DISTINCT FROM 'none') = (${table.forecastSource} IS NOT DISTINCT FROM 'none')`,
    ),
    check('tracked_cases_forecast_level_check', oneOf(table.forecastLevel, FORECAST_LEVELS)),
    check(
      'tracked_cases_forecast_direction_check',
      oneOf(table.forecastDirection, VERDICT_DIRECTIONS),
    ),
    check('tracked_cases_forecast_case_count_check', sql`${table.forecastCaseCount} >= 1`),
    check(
      'tracked_cases_forecast_profile_confidence_check',
      oneOf(table.forecastProfileConfidence, PROFILE_CONFIDENCES),
    ),
    check(
      'tracked_cases_forecast_check',
      forecastFields(table.forecastSource, [
        table.forecastLevel,
        table.forecastDirection,
        table.announcedMeanGap,
        table.forecastCaseCount,
        table.forecastProfileConfidence,
      ]),
    ),
    check(
      'tracked_cases_forecast_frozen_check',
      sql`(${table.forecastState} IS NULL) = (${table.forecastFrozenAt} IS NULL)`,
    ),
    check(
      'tracked_cases_awaiting_late_forecast_check',
      sql`NOT ${table.awaitingLateForecast} OR ${table.forecastState} IS NOT DISTINCT FROM 'none'`,
    ),
    check('tracked_cases_category_check', oneOf(table.category, CASE_CATEGORIES)),
    uniqueIndex('tracked_cases_case_uq').on(table.caseId),
    index('tracked_cases_unfrozen_idx')
      .on(table.id)
      .where(sql`${table.forecastState} IS NULL`),
    index('tracked_cases_late_idx')
      .on(table.id)
      .where(sql`${table.awaitingLateForecast}`),
  ],
);

/**
 * The forecast a tracked case would get from a given instant, one row per change,
 * recorded while the case waits for its measured game (SUI-08, SUI-09, CL-SUI-03).
 */
export const forecastVersions = pgTable(
  'forecast_versions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    trackedCaseId: integer('tracked_case_id')
      .notNull()
      .references(() => trackedCases.id, { onDelete: 'cascade' }),
    effectiveAt: timestamptz('effective_at').notNull(),
    source: text('source', { enum: FORECAST_SOURCES }).notNull(),
    level: text('level', { enum: FORECAST_LEVELS }),
    direction: text('direction', { enum: VERDICT_DIRECTIONS }),
    announcedMeanGap: doublePrecision('announced_mean_gap'),
    caseCount: integer('case_count'),
    profileConfidence: text('profile_confidence', { enum: PROFILE_CONFIDENCES }),
  },
  (table) => [
    check('forecast_versions_source_check', oneOf(table.source, FORECAST_SOURCES)),
    check('forecast_versions_level_check', oneOf(table.level, FORECAST_LEVELS)),
    check('forecast_versions_direction_check', oneOf(table.direction, VERDICT_DIRECTIONS)),
    check(
      'forecast_versions_profile_confidence_check',
      oneOf(table.profileConfidence, PROFILE_CONFIDENCES),
    ),
    check(
      'forecast_versions_forecast_check',
      forecastFields(table.source, [
        table.level,
        table.direction,
        table.announcedMeanGap,
        table.caseCount,
        table.profileConfidence,
      ]),
    ),
    uniqueIndex('forecast_versions_uq').on(table.trackedCaseId, table.effectiveAt),
  ],
);

/**
 * The history of a tracked case's category, each change with the gap that gave it
 * (SUI-15, SUI-21, SUI-22).
 */
export const caseCategoryChanges = pgTable(
  'case_category_changes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    trackedCaseId: integer('tracked_case_id')
      .notNull()
      .references(() => trackedCases.id, { onDelete: 'cascade' }),
    changedAt: timestamptz('changed_at').notNull(),
    category: text('category', { enum: CASE_CATEGORIES }),
    normalizedGap: doublePrecision('normalized_gap'),
    gapStatus: text('gap_status', { enum: GAP_STATUSES }),
  },
  (table) => [
    check('case_category_changes_category_check', oneOf(table.category, CASE_CATEGORIES)),
    check('case_category_changes_gap_status_check', oneOf(table.gapStatus, GAP_STATUSES)),
    index('case_category_changes_case_idx').on(table.trackedCaseId, table.changedAt),
  ],
);

/**
 * What file 10 transmitted about a tracked case, with its date and content: the
 * indicative result while the baseline builds, then the final one (SUI-19, SUI-20).
 */
export const trackedGameResults = pgTable(
  'tracked_game_results',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    trackedCaseId: integer('tracked_case_id')
      .notNull()
      .references(() => trackedCases.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: TRACKED_GAME_RESULT_KINDS }).notNull(),
    transmittedAt: timestamptz('transmitted_at').notNull(),
    content: jsonb('content').notNull(),
  },
  (table) => [
    check('tracked_game_results_kind_check', oneOf(table.kind, TRACKED_GAME_RESULT_KINDS)),
    index('tracked_game_results_case_idx').on(table.trackedCaseId, table.transmittedAt),
  ],
);

/**
 * An owner decision that made a tracked case leave the counts, enter them or change
 * its measured game, with its effect; whether it came after tip-off is derived
 * (SUI-17, H-SUI-07, CL-SUI-10, CL-DET-15).
 */
export const trackedCaseDecisions = pgTable(
  'tracked_case_decisions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    trackedCaseId: integer('tracked_case_id')
      .notNull()
      .references(() => trackedCases.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: DECISION_KINDS }).notNull(),
    effect: text('effect', { enum: DECISION_EFFECTS }).notNull(),
    playerEventId: integer('player_event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamptz('decided_at').notNull(),
  },
  (table) => [
    check('tracked_case_decisions_kind_check', oneOf(table.kind, DECISION_KINDS)),
    check('tracked_case_decisions_effect_check', oneOf(table.effect, DECISION_EFFECTS)),
    check(
      'tracked_case_decisions_case_decision_check',
      sql`${table.kind} NOT IN ('case_excluded', 'case_reinstated') OR ${table.playerEventId} IS NULL`,
    ),
    index('tracked_case_decisions_case_idx').on(table.trackedCaseId, table.decidedAt),
  ],
);

/**
 * What remains of a tracked case that a regrouping emptied, or a merge removed,
 * after its game's scheduled start, which keeps it counted among the cases now out
 * of the counts; written once and never recalculated (SUI-17, SUI-22, SUI-23,
 * SUI-28, SUI-30, CL-SUI-10, CL-SUI-16).
 */
export const regroupingExits = pgTable(
  'regrouping_exits',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerEventId: integer('player_event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'restrict' }),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    overallSubrow: text('overall_subrow', { enum: OVERALL_SUBROWS }),
    gapInForecastDirection: doublePrecision('gap_in_forecast_direction'),
  },
  (table) => [
    check('regrouping_exits_overall_subrow_check', oneOf(table.overallSubrow, OVERALL_SUBROWS)),
    check(
      'regrouping_exits_gap_check',
      sql`${table.gapInForecastDirection} IS NULL OR ${table.overallSubrow} IS NOT NULL`,
    ),
    index('regrouping_exits_pair_idx').on(table.playerId, table.eventTypeId),
    index('regrouping_exits_event_idx').on(table.playerEventId),
  ],
);

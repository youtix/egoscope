// The cases table of the sensitivity module (events-and-cases.md section 1.7): one
// measured game for one player and one type. The tables that hang off a case sit in
// sensitivity-case-children.ts, and the profiles, trends and jobs in
// sensitivity-profiles.ts, which references parameter_snapshots, whose table
// references the journal, which references the cases.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { games, seasonLabel } from './games';
import { followedPlayers } from './players';
import { eventTypes } from './taxonomy';

import type { AnyPgColumn, CheckBuilder } from 'drizzle-orm/pg-core';

// CaseOrigin (SEN-21, CL-VUE-13).
const CASE_ORIGINS = ['historical', 'tracked'] as const;
/** CaseStatus (SEN-07). */
export const CASE_STATUSES = ['awaiting_game', 'measured', 'excluded', 'not_measurable'] as const;
// The reasons of a case awaiting its game (CL-SEN-05).
const AWAITING_REASONS = [
  'game_not_played_yet',
  'statistics_pending',
  'mapping_not_established',
  'baseline_building',
  'precedence_to_verify',
  'dating_to_verify',
] as const;
/**
 * CaseStatusReason: the awaiting reasons, then those of a case not measurable (SEN-07,
 * SEN-47, CL-SEN-03, CL-SEN-05).
 */
export const CASE_STATUS_REASONS = [
  ...AWAITING_REASONS,
  'no_game_within_window',
  'box_score_incomplete',
  'box_score_suspect',
  'box_score_unavailable',
  'insufficient_baseline',
  'season_not_covered',
  'precedence_not_established',
  'derived_game_missed',
] as const;
type CaseStatusReason = (typeof CASE_STATUS_REASONS)[number];
// The reasons of a walk that reached no game, and of a case that has its game (CL-SEN-05).
const GAMELESS_REASONS = [
  'season_not_covered',
  'no_game_within_window',
  'precedence_not_established',
  'mapping_not_established',
  'precedence_to_verify',
  'dating_to_verify',
] as const satisfies readonly CaseStatusReason[];
const GAME_REASONS = [
  'box_score_incomplete',
  'box_score_suspect',
  'box_score_unavailable',
  'insufficient_baseline',
  'derived_game_missed',
  'baseline_building',
] as const satisfies readonly CaseStatusReason[];
// ReferenceInstantOrigin (SEN-01, SEN-02, SEN-44, CL-SEN-07).
const REFERENCE_INSTANT_ORIGINS = [
  'known_instant',
  'date_only',
  'known_in_advance',
  'uncertain_precedence_shift',
] as const;
// BaselinePhase (STA-16, STA-18, CL-STA-02).
const BASELINE_PHASES = ['regular_season', 'postseason'] as const;
// SeasonBaselineStatus (STA-19 to STA-22).
export const BASELINE_STATUSES = ['final', 'provisional', 'building', 'insufficient'] as const;
/** GapStatus (SEN-09). */
export const GAP_STATUSES = ['provisional', 'final'] as const;
/** VerdictChangeCause, the cause of a recalculation and of each change it records (SEN-37, CL-SEN-17). */
export const VERDICT_CHANGE_CAUSES = [
  'new_cases',
  'stats_correction',
  'baseline_updated',
  'manual_decision',
  'event_dismissed',
  'parameter_change',
  'recalculation',
  'event_corrected_or_removed',
  'event_reinstated',
  'taxonomy_changed',
] as const;

// The columns of cases that its row checks read.
type CaseColumns = Readonly<
  Record<
    | 'status'
    | 'statusReason'
    | 'referenceInstantAt'
    | 'referenceInstantOrigin'
    | 'measuredGameId'
    | 'performanceIndex'
    | 'baselineSeason'
    | 'baselinePhase'
    | 'baselineGameCount'
    | 'baselineMean'
    | 'baselineStandardDeviation'
    | 'baselineStatus'
    | 'baselineIsPartial'
    | 'normalizedGap'
    | 'gapStatus',
    AnyPgColumn
  >
>;

/**
 * The row checks of cases, each named after its rule: a waiting or unmeasurable case
 * has its reason, from its status's own list; a measured or excluded one its game, its
 * baseline and its gap; a reason its game or none; and only a type known in advance a
 * reference with no instant (SEN-07, CL-SEN-02, CL-SEN-05).
 */
function caseChecks(table: CaseColumns): CheckBuilder[] {
  return [
    check(
      'cases_reasoned_status_check',
      sql`(${table.status} IN ('awaiting_game', 'not_measurable')) = (${table.statusReason} IS NOT NULL)`,
    ),
    check(
      'cases_awaiting_reason_check',
      sql`${table.statusReason} IS NULL OR (${table.status} = 'awaiting_game') = (${oneOf(table.statusReason, AWAITING_REASONS)})`,
    ),
    check(
      'cases_measurement_check',
      sql`${table.status} NOT IN ('measured', 'excluded') OR (${table.measuredGameId}, ${table.performanceIndex}, ${table.baselineSeason}, ${table.baselinePhase}, ${table.baselineGameCount}, ${table.baselineMean}, ${table.baselineStandardDeviation}, ${table.baselineStatus}, ${table.baselineIsPartial}, ${table.normalizedGap}, ${table.gapStatus}) IS NOT NULL`,
    ),
    check(
      'cases_gameless_reason_check',
      sql`NOT (${oneOf(table.statusReason, GAMELESS_REASONS)}) OR ${table.measuredGameId} IS NULL`,
    ),
    check(
      'cases_game_reason_check',
      sql`NOT (${oneOf(table.statusReason, GAME_REASONS)}) OR ${table.measuredGameId} IS NOT NULL`,
    ),
    check(
      'cases_reference_instant_check',
      sql`(${table.referenceInstantOrigin} = 'known_in_advance') = (${table.referenceInstantAt} IS NULL)`,
    ),
  ];
}

/**
 * A case: one measured game for one player and one type, holding the events of that
 * type attached to that game, the unit of calculation; every column but its identity,
 * origin and creation instant is a result of its last recalculation (SEN-05, SEN-07,
 * CL-VUE-03, CL-SEN-05). Its key with its player and type is the target of the events'
 * reference, so that an event joins a case of its own player and type only.
 */
export const cases = pgTable(
  'cases',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    origin: text('origin', { enum: CASE_ORIGINS }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    status: text('status', { enum: CASE_STATUSES }).notNull(),
    statusReason: text('status_reason', { enum: CASE_STATUS_REASONS }),
    referenceInstantAt: timestamptz('reference_instant_at'),
    referenceInstantOrigin: text('reference_instant_origin', {
      enum: REFERENCE_INSTANT_ORIGINS,
    }).notNull(),
    measuredGameId: integer('measured_game_id').references(() => games.id, {
      onDelete: 'restrict',
    }),
    teamGamesMissedBefore: smallint('team_games_missed_before'),
    playingTimeThresholdMinutes: doublePrecision('playing_time_threshold_minutes'),
    measuredMinutes: doublePrecision('measured_minutes'),
    hasRoundedMinutes: boolean('has_rounded_minutes'),
    measuredGameScore: doublePrecision('measured_game_score'),
    performanceIndex: doublePrecision('performance_index'),
    baselineSeason: text('baseline_season'),
    baselinePhase: text('baseline_phase', { enum: BASELINE_PHASES }),
    baselineGameCount: smallint('baseline_game_count'),
    baselineMean: doublePrecision('baseline_mean'),
    baselineStandardDeviation: doublePrecision('baseline_standard_deviation'),
    baselineStatus: text('baseline_status', { enum: BASELINE_STATUSES }),
    baselineIsPartial: boolean('baseline_is_partial'),
    normalizedGap: doublePrecision('normalized_gap'),
    gapStatus: text('gap_status', { enum: GAP_STATUSES }),
    opponentStrengthNotEvaluable: boolean('opponent_strength_not_evaluable')
      .notNull()
      .default(false),
    stakesNotEvaluable: boolean('stakes_not_evaluable').notNull().default(false),
    computedAt: timestamptz('computed_at').notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check('cases_origin_check', oneOf(table.origin, CASE_ORIGINS)),
    check('cases_status_check', oneOf(table.status, CASE_STATUSES)),
    check('cases_status_reason_check', oneOf(table.statusReason, CASE_STATUS_REASONS)),
    check(
      'cases_reference_instant_origin_check',
      oneOf(table.referenceInstantOrigin, REFERENCE_INSTANT_ORIGINS),
    ),
    check('cases_baseline_season_check', seasonLabel(table.baselineSeason)),
    check('cases_baseline_phase_check', oneOf(table.baselinePhase, BASELINE_PHASES)),
    check('cases_baseline_status_check', oneOf(table.baselineStatus, BASELINE_STATUSES)),
    check('cases_gap_status_check', oneOf(table.gapStatus, GAP_STATUSES)),
    ...caseChecks(table),
    unique('cases_id_player_type_key').on(table.id, table.playerId, table.eventTypeId),
    uniqueIndex('cases_player_type_game_key')
      .on(table.playerId, table.eventTypeId, table.measuredGameId)
      .where(sql`${table.measuredGameId} IS NOT NULL`),
    index('cases_player_type_idx').on(table.playerId, table.eventTypeId),
    index('cases_type_status_idx').on(table.eventTypeId, table.status),
    index('cases_player_game_idx').on(table.playerId, table.measuredGameId),
    index('cases_player_baseline_season_idx').on(table.playerId, table.baselineSeason),
    index('cases_awaiting_idx')
      .on(table.statusReason)
      .where(sql`${table.status} = 'awaiting_game'`),
  ],
);

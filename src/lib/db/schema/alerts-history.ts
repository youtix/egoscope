// The tables of the alerts module that follow a sheet after its production
// (alert-sheets.md, Lot 2): its expected games, its caveats and its update journal.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { alertSheets, alertSheetSections } from './alerts';
import { oneOf, subsetOf, timestamptz } from './builders';
import { events } from './events';
import { games, teams } from './games';
import { eventTypes } from './taxonomy';

// ExpectedGameState, ExpectedGameUnknownReason and ExpectedGameChangeReason (ALE-15,
// ALE-21, ALE-23, STA-26, SUI-18).
const EXPECTED_GAME_STATES = ['current', 'superseded', 'unknown'] as const;
const EXPECTED_GAME_UNKNOWN_REASONS = [
  'offseason',
  'schedule_not_published',
  'stats_source_unavailable',
  'player_without_team',
] as const;
const EXPECTED_GAME_CHANGE_REASONS = [
  'postponed',
  'brought_forward',
  'canceled',
  'player_did_not_play',
  'reference_date_moved',
] as const;
// CaveatKind and KnownContextReason (ALE-16, ADR 0016, D-19).
const CAVEAT_KINDS = [
  'small_sample',
  'effect_direction',
  'known_context',
  'several_events',
  'confidence_near_threshold',
  'dating_to_verify',
  'incomplete_or_earlier_version',
  'late_sheet',
  'type_not_covered',
  'confounder_not_separable',
] as const;
const KNOWN_CONTEXT_REASONS = [
  'high_stakes',
  'injury_return_flagged',
  'opponent_strength',
] as const;
// AlertSheetUpdateKind (ALE-20 to ALE-31, CL-ALE-04, CL-ALE-07, CL-ALE-12, CL-ALE-13).
const UPDATE_KINDS = [
  'event_added',
  'source_added',
  'event_dismissed',
  'event_reinstated',
  'expected_game_changed',
  'late_mark_changed',
  'context_corrected',
  'attachment_corrected',
  'profile_values_entered',
  'profile_changed_since_issue',
  'caveats_changed',
  'status_changed',
  'outcome_recorded',
  'outcome_value_changed',
  'event_no_longer_applies',
] as const;

/**
 * The expected game a sheet shows, and every game it replaced, struck through with
 * the reason; one entry is live at a time (ALE-15, ALE-23, STA-27, CL-ALE-02).
 */
export const alertSheetExpectedGames = pgTable(
  'alert_sheet_expected_games',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alertSheetId: integer('alert_sheet_id')
      .notNull()
      .references(() => alertSheets.id, { onDelete: 'cascade' }),
    state: text('state', { enum: EXPECTED_GAME_STATES }).notNull(),
    gameId: integer('game_id').references(() => games.id, { onDelete: 'restrict' }),
    scheduledStartAt: timestamptz('scheduled_start_at'),
    opponentTeamId: integer('opponent_team_id').references(() => teams.id, {
      onDelete: 'restrict',
    }),
    isHome: boolean('is_home'),
    passedGameId: integer('passed_game_id').references(() => games.id, { onDelete: 'restrict' }),
    unknownReason: text('unknown_reason', { enum: EXPECTED_GAME_UNKNOWN_REASONS }),
    recordedAt: timestamptz('recorded_at').notNull(),
    supersededAt: timestamptz('superseded_at'),
    supersessionReason: text('supersession_reason', { enum: EXPECTED_GAME_CHANGE_REASONS }),
  },
  (table) => [
    check('alert_sheet_expected_games_state_check', oneOf(table.state, EXPECTED_GAME_STATES)),
    check(
      'alert_sheet_expected_games_game_check',
      sql`(${table.state} = 'unknown') = (${table.gameId} IS NULL)`,
    ),
    check(
      'alert_sheet_expected_games_unknown_reason_check',
      oneOf(table.unknownReason, EXPECTED_GAME_UNKNOWN_REASONS),
    ),
    check(
      'alert_sheet_expected_games_unknown_check',
      sql`(${table.state} = 'unknown') = (${table.unknownReason} IS NOT NULL)`,
    ),
    check(
      'alert_sheet_expected_games_superseded_check',
      sql`(${table.state} = 'superseded') = (${table.supersededAt} IS NOT NULL)`,
    ),
    check(
      'alert_sheet_expected_games_supersession_reason_check',
      oneOf(table.supersessionReason, EXPECTED_GAME_CHANGE_REASONS),
    ),
    check(
      'alert_sheet_expected_games_supersession_check',
      sql`(${table.state} = 'superseded') = (${table.supersessionReason} IS NOT NULL)`,
    ),
    uniqueIndex('alert_sheet_expected_games_live_uq')
      .on(table.alertSheetId)
      .where(sql`${table.state} IN ('current', 'unknown')`),
    index('alert_sheet_expected_games_game_idx')
      .on(table.gameId)
      .where(sql`${table.state} = 'current'`),
  ],
);

/**
 * One caveat a sheet shows, every applicable one and none hidden, recomputed until
 * the expected game starts and frozen afterwards (ALE-16, ALE-30, CL-ALE-03,
 * CL-ALE-07, ADR 0016).
 */
export const alertSheetCaveats = pgTable(
  'alert_sheet_caveats',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alertSheetId: integer('alert_sheet_id')
      .notNull()
      .references(() => alertSheets.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: CAVEAT_KINDS }).notNull(),
    eventTypeId: text('event_type_id').references(() => eventTypes.id, { onDelete: 'restrict' }),
    playerEventId: integer('player_event_id').references(() => events.id, {
      onDelete: 'restrict',
    }),
    knownContextReasons: text('known_context_reasons', { enum: KNOWN_CONTEXT_REASONS }).array(),
    computedAt: timestamptz('computed_at').notNull(),
  },
  (table) => [
    check('alert_sheet_caveats_kind_check', oneOf(table.kind, CAVEAT_KINDS)),
    check(
      'alert_sheet_caveats_known_context_reasons_check',
      subsetOf(table.knownContextReasons, KNOWN_CONTEXT_REASONS),
    ),
    check(
      'alert_sheet_caveats_known_context_check',
      sql`(${table.kind} = 'known_context') = (${table.knownContextReasons} IS NOT NULL)`,
    ),
    unique('alert_sheet_caveats_uq')
      .on(table.alertSheetId, table.kind, table.eventTypeId, table.playerEventId)
      .nullsNotDistinct(),
  ],
);

/**
 * The append-only update journal of a sheet: every dated change it records, which
 * names an event but never a case (ALE-20 to ALE-25, ALE-31, CL-ALE-07, CL-ALE-12).
 */
export const alertSheetUpdates = pgTable(
  'alert_sheet_updates',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alertSheetId: integer('alert_sheet_id')
      .notNull()
      .references(() => alertSheets.id, { onDelete: 'cascade' }),
    occurredAt: timestamptz('occurred_at').notNull(),
    kind: text('kind', { enum: UPDATE_KINDS }).notNull(),
    playerEventId: integer('player_event_id').references(() => events.id, {
      onDelete: 'restrict',
    }),
    alertSheetSectionId: integer('alert_sheet_section_id'),
    detail: jsonb('detail').notNull().default({}),
  },
  (table) => [
    foreignKey({
      name: 'alert_sheet_updates_alert_sheet_section_id_fk',
      columns: [table.alertSheetSectionId],
      foreignColumns: [alertSheetSections.id],
    }).onDelete('cascade'),
    check('alert_sheet_updates_kind_check', oneOf(table.kind, UPDATE_KINDS)),
    check(
      'alert_sheet_updates_outcome_event_check',
      sql`${table.kind} NOT IN ('outcome_recorded', 'outcome_value_changed') OR ${table.playerEventId} IS NOT NULL`,
    ),
    index('alert_sheet_updates_sheet_idx').on(table.alertSheetId, table.occurredAt),
    index('alert_sheet_updates_event_idx')
      .on(table.playerEventId)
      .where(sql`${table.playerEventId} IS NOT NULL`),
  ],
);

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { notBlank, oneOf, timestamptz } from './builders';
import { games, teams } from './games';

// PlayerStatus (JOU-15).
const PLAYER_STATUSES = ['active', 'paused', 'withdrawn'] as const;
// PlayerStatusChangeReason, optional on every change (JOU-15, H-JOU-06, CL-JOU-12).
const PLAYER_STATUS_CHANGE_REASONS = [
  'prolonged_absence',
  'end_of_career',
  'left_nba',
  'insufficient_exposure',
  'other',
] as const;
// Where the day and month of birth came from (CL-JOU-16).
const BIRTHDAY_ORIGINS = ['stats_source', 'owner'] as const;
// NameVariantKind (JOU-08).
const NAME_VARIANT_KINDS = ['spelling', 'nickname'] as const;
// TeamChangeOrigin (JOU-13).
const TEAM_CHANGE_ORIGINS = ['observed', 'entered'] as const;

/**
 * An NBA player on the follow list, whom every event concerns alone: a random
 * identifier never derived from his name, and of his birth the day and month only,
 * never a year (VUE-04, JOU-08, JOU-11, JOU-15, CL-JOU-09, CL-DSN-21). No row is
 * seeded (JOU-06).
 */
export const followedPlayers = pgTable(
  'followed_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: text('display_name').notNull(),
    displayNameNormalized: text('display_name_normalized').notNull(),
    currentTeamId: integer('current_team_id').references(() => teams.id, { onDelete: 'restrict' }),
    status: text('status', { enum: PLAYER_STATUSES }).notNull().default('active'),
    birthdayMonth: smallint('birthday_month'),
    birthdayDay: smallint('birthday_day'),
    birthdayOrigin: text('birthday_origin', { enum: BIRTHDAY_ORIGINS }),
    addedAt: timestamptz('added_at').notNull().defaultNow(),
    pauseSuggestionDeclinedAt: timestamptz('pause_suggestion_declined_at'),
    lastCalendarDerivationAt: timestamptz('last_calendar_derivation_at'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check('followed_players_display_name_check', notBlank(table.displayName)),
    check('followed_players_status_check', oneOf(table.status, PLAYER_STATUSES)),
    check('followed_players_birthday_month_check', sql`${table.birthdayMonth} BETWEEN 1 AND 12`),
    // The longest day of each month, 29 February included (CL-JOU-17).
    check(
      'followed_players_birthday_day_check',
      sql`${table.birthdayDay} BETWEEN 1 AND (ARRAY[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])[${table.birthdayMonth}]`,
    ),
    check('followed_players_birthday_origin_check', oneOf(table.birthdayOrigin, BIRTHDAY_ORIGINS)),
    check(
      'followed_players_birthday_check',
      sql`(${table.birthdayMonth} IS NULL) = (${table.birthdayDay} IS NULL)`,
    ),
    check(
      'followed_players_birthday_with_origin_check',
      sql`(${table.birthdayMonth} IS NULL) = (${table.birthdayOrigin} IS NULL)`,
    ),
    index('followed_players_display_name_normalized_idx').on(table.displayNameNormalized),
  ],
);

/**
 * A spelling variant or nickname of a player, searched by detection, once per player
 * after normalization (JOU-08, JOU-09, CL-JOU-13).
 */
export const playerNameVariants = pgTable(
  'player_name_variants',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: NAME_VARIANT_KINDS }).notNull(),
    text: text('text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    isAmbiguous: boolean('is_ambiguous').notNull().default(false),
  },
  (table) => [
    check('player_name_variants_kind_check', oneOf(table.kind, NAME_VARIANT_KINDS)),
    check('player_name_variants_text_check', notBlank(table.text)),
    unique('player_name_variants_player_normalized_key').on(table.playerId, table.normalizedText),
    index('player_name_variants_normalized_idx').on(table.normalizedText),
  ],
);

/**
 * The dated status history, each change one of the five transitions, with its
 * optional reason (JOU-15, CL-JOU-12).
 */
export const playerStatusChanges = pgTable(
  'player_status_changes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    fromStatus: text('from_status', { enum: PLAYER_STATUSES }).notNull(),
    toStatus: text('to_status', { enum: PLAYER_STATUSES }).notNull(),
    reason: text('reason', { enum: PLAYER_STATUS_CHANGE_REASONS }),
  },
  (table) => [
    check('player_status_changes_from_status_check', oneOf(table.fromStatus, PLAYER_STATUSES)),
    check('player_status_changes_to_status_check', oneOf(table.toStatus, PLAYER_STATUSES)),
    check('player_status_changes_reason_check', oneOf(table.reason, PLAYER_STATUS_CHANGE_REASONS)),
    check(
      'player_status_changes_transition_check',
      sql`(${table.fromStatus}, ${table.toStatus}) IN (('active', 'paused'), ('active', 'withdrawn'), ('paused', 'active'), ('paused', 'withdrawn'), ('withdrawn', 'active'))`,
    ),
    index('player_status_changes_player_changed_idx').on(table.playerId, table.changedAt),
  ],
);

/**
 * The team history from the day the player is followed: the team chosen at addition,
 * the changes observed and those entered with their confirming game, which also bound
 * his team memberships (JOU-13, CL-JOU-03, CL-STA-05).
 */
export const playerTeamChanges = pgTable(
  'player_team_changes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    changedAt: timestamptz('changed_at').notNull(),
    previousTeamId: integer('previous_team_id').references(() => teams.id, {
      onDelete: 'restrict',
    }),
    newTeamId: integer('new_team_id').references(() => teams.id, { onDelete: 'restrict' }),
    origin: text('origin', { enum: TEAM_CHANGE_ORIGINS }).notNull(),
    gameId: integer('game_id').references(() => games.id, { onDelete: 'restrict' }),
  },
  (table) => [
    check('player_team_changes_origin_check', oneOf(table.origin, TEAM_CHANGE_ORIGINS)),
    check(
      'player_team_changes_distinct_teams_check',
      sql`${table.previousTeamId} IS DISTINCT FROM ${table.newTeamId}`,
    ),
    index('player_team_changes_player_changed_idx').on(table.playerId, table.changedAt),
  ],
);

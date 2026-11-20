// The tables of the games module that concern one followed player each: his
// statistics-source mapping and its candidates, his box-score lines, their corrections
// and his indicators. They reference followed_players, whose own table references
// teams and games, so they live apart from games.ts, which players.ts imports.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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

import { oneOf, subsetOf, timestamptz } from './builders';
import { games, seasonLabel, STATS_SOURCES, teams } from './games';
import { followedPlayers } from './players';

// StatsSourceMappingStatus (JOU-10, STA-03).
const MAPPING_STATUSES = ['to_establish', 'established'] as const;
// BoxScoreStatus (STA-09, STA-10, STA-35).
const BOX_SCORE_STATUSES = ['complete', 'incomplete', 'suspect', 'unavailable'] as const;
// The STA-09 check a suspect line failed, kept on the line itself.
const FAILED_CHECKS = [
  'negative_value',
  'made_above_attempted',
  'points_mismatch',
  'minutes_above_game_length',
  'statistic_without_minutes',
] as const;
// The elements of a line that a statistics correction changes (STA-33).
const STAT_CORRECTION_ELEMENTS = [
  'team',
  'minutes',
  'seconds',
  'points',
  'field_goals_made',
  'field_goals_attempted',
  'three_pointers_made',
  'free_throws_made',
  'free_throws_attempted',
  'offensive_rebounds',
  'defensive_rebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'personal_fouls',
] as const;
// StatCorrectionOrigin (STA-33, STA-34).
const STAT_CORRECTION_ORIGINS = ['correction_window', 'manual_refetch'] as const;

/**
 * The owner-confirmed link between a followed player and his identity in one
 * statistics source, which gates every fetch for him; one per player and source, and
 * an identity linked to one followed player only (JOU-10, STA-03, CL-JOU-04, CL-JOU-21).
 */
export const statsSourceMappings = pgTable(
  'stats_source_mappings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    status: text('status', { enum: MAPPING_STATUSES }).notNull().default('to_establish'),
    sourcePlayerRef: text('source_player_ref'),
    establishedAt: timestamptz('established_at'),
    lastSearchedAt: timestamptz('last_searched_at'),
  },
  (table) => [
    check('stats_source_mappings_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    check('stats_source_mappings_status_check', oneOf(table.status, MAPPING_STATUSES)),
    check(
      'stats_source_mappings_established_check',
      sql`(${table.status} = 'established') = (${table.sourcePlayerRef} IS NOT NULL AND ${table.establishedAt} IS NOT NULL)`,
    ),
    unique('stats_source_mappings_player_source_key').on(table.playerId, table.statsSource),
    unique('stats_source_mappings_source_ref_key').on(table.statsSource, table.sourcePlayerRef),
  ],
);

/**
 * A source identity offered for confirmation while a mapping is to establish, found
 * in the stored directory, with what tells namesakes apart; at most one preselected
 * by a replacement source's crosswalk (JOU-10, STA-03, CL-TRV-14).
 */
export const mappingCandidates = pgTable(
  'mapping_candidates',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    mappingId: integer('mapping_id')
      .notNull()
      .references(() => statsSourceMappings.id, { onDelete: 'cascade' }),
    sourcePlayerRef: text('source_player_ref').notNull(),
    displayName: text('display_name').notNull(),
    currentTeamId: integer('current_team_id').references(() => teams.id, { onDelete: 'restrict' }),
    firstSeason: text('first_season'),
    lastSeason: text('last_season'),
    teamIds: integer('team_ids').array().notNull().default([]),
    foundAt: timestamptz('found_at').notNull().defaultNow(),
    isPreselected: boolean('is_preselected').notNull().default(false),
  },
  (table) => [
    check('mapping_candidates_first_season_check', seasonLabel(table.firstSeason)),
    check('mapping_candidates_last_season_check', seasonLabel(table.lastSeason)),
    unique('mapping_candidates_mapping_ref_key').on(table.mappingId, table.sourcePlayerRef),
    uniqueIndex('mapping_candidates_preselected_key')
      .on(table.mappingId)
      .where(sql`${table.isPreselected}`),
  ],
);

/**
 * A followed player's line for one official game he played, or the placeholder that
 * marks his sheet unavailable: a count the source does not give stays null, never
 * zero, and a suspect sheet keeps the checks it failed (STA-08 to STA-10, STA-35,
 * CL-STA-04, CL-STA-06).
 */
export const boxScores = pgTable(
  'box_scores',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    sourcePlayerRef: text('source_player_ref').notNull(),
    status: text('status', { enum: BOX_SCORE_STATUSES }).notNull(),
    teamId: integer('team_id').references(() => teams.id, { onDelete: 'restrict' }),
    minutes: smallint('minutes'),
    seconds: smallint('seconds'),
    hasRoundedMinutes: boolean('has_rounded_minutes').notNull(),
    points: smallint('points'),
    fieldGoalsMade: smallint('field_goals_made'),
    fieldGoalsAttempted: smallint('field_goals_attempted'),
    threePointersMade: smallint('three_pointers_made'),
    freeThrowsMade: smallint('free_throws_made'),
    freeThrowsAttempted: smallint('free_throws_attempted'),
    offensiveRebounds: smallint('offensive_rebounds'),
    defensiveRebounds: smallint('defensive_rebounds'),
    assists: smallint('assists'),
    steals: smallint('steals'),
    blocks: smallint('blocks'),
    turnovers: smallint('turnovers'),
    personalFouls: smallint('personal_fouls'),
    ejected: boolean('ejected'),
    failedChecks: text('failed_checks', { enum: FAILED_CHECKS }).array().notNull().default([]),
    fetchedAt: timestamptz('fetched_at').notNull(),
  },
  (table) => [
    check('box_scores_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    check('box_scores_status_check', oneOf(table.status, BOX_SCORE_STATUSES)),
    check('box_scores_failed_checks_check', subsetOf(table.failedChecks, FAILED_CHECKS)),
    // The placeholder of an unavailable sheet holds no team, time, element or failed check.
    check(
      'box_scores_placeholder_check',
      sql`${table.status} <> 'unavailable' OR ((${sql.join(
        [
          table.teamId,
          table.minutes,
          table.seconds,
          table.points,
          table.fieldGoalsMade,
          table.fieldGoalsAttempted,
          table.threePointersMade,
          table.freeThrowsMade,
          table.freeThrowsAttempted,
          table.offensiveRebounds,
          table.defensiveRebounds,
          table.assists,
          table.steals,
          table.blocks,
          table.turnovers,
          table.personalFouls,
        ],
        sql`, `,
      )}) IS NULL AND ${table.failedChecks} = '{}')`,
    ),
    check(
      'box_scores_team_check',
      sql`${table.status} = 'unavailable' OR ${table.teamId} IS NOT NULL`,
    ),
    check(
      'box_scores_suspect_check',
      sql`(${table.status} = 'suspect') = (${table.failedChecks} <> '{}')`,
    ),
    unique('box_scores_player_game_key').on(table.playerId, table.gameId),
    index('box_scores_game_idx').on(table.gameId),
  ],
);

/**
 * The statistics correction journal: every changed element with its old and new
 * values, which statistics may keep, tied to the player and the game so that it
 * outlives a removed line (STA-33, STA-34, CL-STA-26).
 */
export const statCorrections = pgTable(
  'stat_corrections',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
    element: text('element', { enum: STAT_CORRECTION_ELEMENTS }).notNull(),
    oldValue: integer('old_value'),
    newValue: integer('new_value'),
    correctedAt: timestamptz('corrected_at').notNull().defaultNow(),
    origin: text('origin', { enum: STAT_CORRECTION_ORIGINS }).notNull(),
  },
  (table) => [
    check('stat_corrections_element_check', oneOf(table.element, STAT_CORRECTION_ELEMENTS)),
    check('stat_corrections_origin_check', oneOf(table.origin, STAT_CORRECTION_ORIGINS)),
    index('stat_corrections_player_game_idx').on(table.playerId, table.gameId),
  ],
);

/**
 * The indicators of the player page, recomputed from his stored lines at each
 * statistics update, one row per followed player with an established mapping
 * (JOU-02, JOU-21, STA-46, STA-47, CL-STA-12, CL-STA-21).
 */
export const playerIndicators = pgTable('player_indicators', {
  playerId: uuid('player_id')
    .primaryKey()
    .references(() => followedPlayers.id, { onDelete: 'cascade' }),
  indicatorSeason: text('indicator_season').notNull(),
  gamesPlayedThisSeason: smallint('games_played_this_season').notNull(),
  averageMinutesThisSeason: doublePrecision('average_minutes_this_season'),
  lastGamePlayedId: integer('last_game_played_id').references(() => games.id, {
    onDelete: 'restrict',
  }),
  lastGamePlayedOn: date('last_game_played_on'),
  consecutiveTeamGamesMissed: smallint('consecutive_team_games_missed').notNull().default(0),
  firstNbaGameId: integer('first_nba_game_id').references(() => games.id, {
    onDelete: 'restrict',
  }),
  firstNbaGameOn: date('first_nba_game_on'),
  computedAt: timestamptz('computed_at').notNull(),
});

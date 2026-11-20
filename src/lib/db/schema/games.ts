import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { oneOf, subsetOf, timestamptz } from './builders';

import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * The statistics sources the application reads, by the key of the data model: the
 * SportsDataverse release of ESPN data (STA-02, ADR 0023); a replacement source
 * extends the list (CL-STA-23, CL-TRV-14).
 */
export const STATS_SOURCES = ['sportsdataverse_espn'] as const;
// GamePhase (STA-04, STA-05).
const GAME_PHASES = ['regular_season', 'play_in', 'playoffs'] as const;
// GameStatus (STA-05).
const GAME_STATUSES = ['scheduled', 'in_progress', 'final', 'postponed', 'canceled'] as const;
// The phases a series belongs to: the postseason of GamePhase (CL-STA-18).
const SERIES_PHASES = [
  'play_in',
  'playoffs',
] as const satisfies readonly (typeof GAME_PHASES)[number][];
// The round of a series, the evaluation's values (CL-STA-18).
const SERIES_ROUNDS = [
  'first_round',
  'conference_semifinals',
  'conference_finals',
  'finals',
  'play_in_7_vs_8',
  'play_in_9_vs_10',
  'play_in_8th_seed',
] as const;
/**
 * The condition that `column` holds a season label, written `2024-25` in data as on
 * screens (STA-48, CL-STA-28).
 */
export function seasonLabel(column: PgColumn): SQL {
  return sql`${column} ~ '^[0-9]{4}-[0-9]{2}$'`;
}

/**
 * An NBA franchise under the application's own identifier, which runs across
 * sources and seasons; its abbreviation and name are those of the latest season
 * stored (JOU-08, STA-26, CL-STA-23). Created by ingestion, never edited or deleted.
 */
export const teams = pgTable('teams', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  abbreviation: text('abbreviation').notNull().unique('teams_abbreviation_key'),
  name: text('name').notNull(),
});

/** Each source's identifier of a team, one application team per identifier (CL-STA-23, CL-TRV-14). */
export const teamSourceRefs = pgTable(
  'team_source_refs',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    sourceTeamRef: text('source_team_ref').notNull(),
  },
  (table) => [
    check('team_source_refs_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    primaryKey({ columns: [table.statsSource, table.sourceTeamRef] }),
  ],
);

/**
 * A season the source holds, with the source assigned to it and what its games say of
 * its coverage; pending until its games are first read (STA-45, CL-STA-22, CL-STA-23).
 */
export const seasons = pgTable(
  'seasons',
  {
    season: text('season').primaryKey(),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    phasesWithLines: text('phases_with_lines', { enum: GAME_PHASES }).array().notNull().default([]),
    gamesWithoutLines: integer('games_without_lines').notNull().default(0),
    coverageFetchedAt: timestamptz('coverage_fetched_at'),
  },
  (table) => [
    check('seasons_season_check', seasonLabel(table.season)),
    check('seasons_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    check('seasons_phases_with_lines_check', subsetOf(table.phasesWithLines, GAME_PHASES)),
  ],
);

/** A team's name, location and abbreviation in one season, as that season listed it (JOU-08, STA-26). */
export const teamSeasons = pgTable(
  'team_seasons',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    season: text('season')
      .notNull()
      .references(() => seasons.season, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    location: text('location').notNull(),
    abbreviation: text('abbreviation').notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.season] })],
);

/**
 * A play-in or playoff pairing of one season, rebuilt from the schedule; its team A is
 * the lower team id, and two teams meet at most once in a postseason (STA-05, CL-STA-18).
 */
export const series = pgTable(
  'series',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    season: text('season')
      .notNull()
      .references(() => seasons.season, { onDelete: 'restrict' }),
    phase: text('phase', { enum: SERIES_PHASES }).notNull(),
    round: text('round', { enum: SERIES_ROUNDS }),
    teamAId: integer('team_a_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    teamBId: integer('team_b_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    winsNeeded: smallint('wins_needed').notNull(),
    isRebuilt: boolean('is_rebuilt').notNull(),
  },
  (table) => [
    check('series_phase_check', oneOf(table.phase, SERIES_PHASES)),
    check('series_round_check', oneOf(table.round, SERIES_ROUNDS)),
    check('series_team_order_check', sql`${table.teamAId} < ${table.teamBId}`),
    check('series_wins_needed_check', sql`${table.winsNeeded} >= 1`),
    unique('series_season_teams_key').on(table.season, table.phase, table.teamAId, table.teamBId),
  ],
);

/**
 * An official game of the league schedule, stored once for every player: games that
 * never count are dropped before they get here, and no venue time zone or venue date
 * is kept, the game's day being its US Eastern date (STA-04, STA-05, STA-42,
 * CL-STA-16, CL-STA-17, CL-TRV-03).
 */
export const games = pgTable(
  'games',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    sourceGameRef: text('source_game_ref').notNull(),
    makeUpSourceGameRef: text('make_up_source_game_ref'),
    season: text('season')
      .notNull()
      .references(() => seasons.season, { onDelete: 'restrict' }),
    phase: text('phase', { enum: GAME_PHASES }).notNull(),
    status: text('status', { enum: GAME_STATUSES }).notNull(),
    scheduledStartAt: timestamptz('scheduled_start_at').notNull(),
    isStartTimeTbd: boolean('is_start_time_tbd').notNull().default(false),
    gameDayOn: date('game_day_on').notNull(),
    homeTeamId: integer('home_team_id').references(() => teams.id, { onDelete: 'restrict' }),
    awayTeamId: integer('away_team_id').references(() => teams.id, { onDelete: 'restrict' }),
    homeScore: smallint('home_score'),
    awayScore: smallint('away_score'),
    overtimeCount: smallint('overtime_count'),
    seriesId: integer('series_id').references(() => series.id, { onDelete: 'restrict' }),
    gameNumber: smallint('game_number'),
    homeSeriesWinsBefore: smallint('home_series_wins_before'),
    awaySeriesWinsBefore: smallint('away_series_wins_before'),
    isEliminationGame: boolean('is_elimination_game'),
    homeLinesPublished: boolean('home_lines_published').notNull().default(false),
    awayLinesPublished: boolean('away_lines_published').notNull().default(false),
    consolidatedAt: timestamptz('consolidated_at'),
    lastFetchedAt: timestamptz('last_fetched_at').notNull(),
    scheduleChangedAt: timestamptz('schedule_changed_at').notNull(),
  },
  (table) => [
    check('games_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    check('games_phase_check', oneOf(table.phase, GAME_PHASES)),
    check('games_status_check', oneOf(table.status, GAME_STATUSES)),
    check('games_overtime_count_check', sql`${table.overtimeCount} >= 0`),
    check('games_game_number_check', sql`${table.gameNumber} >= 1`),
    check('games_home_series_wins_before_check', sql`${table.homeSeriesWinsBefore} >= 0`),
    check('games_away_series_wins_before_check', sql`${table.awaySeriesWinsBefore} >= 0`),
    check(
      'games_regular_season_check',
      sql`${table.phase} <> 'regular_season' OR (${table.seriesId}, ${table.gameNumber}, ${table.homeSeriesWinsBefore}, ${table.awaySeriesWinsBefore}, ${table.isEliminationGame}) IS NULL`,
    ),
    check(
      'games_placeholder_check',
      sql`(${table.homeTeamId} IS NOT NULL AND ${table.awayTeamId} IS NOT NULL) OR ${table.status} = 'scheduled'`,
    ),
    check(
      'games_distinct_teams_check',
      sql`${table.homeTeamId} IS DISTINCT FROM ${table.awayTeamId} OR ${table.homeTeamId} IS NULL`,
    ),
    check(
      'games_final_score_check',
      sql`${table.status} <> 'final' OR (${table.homeScore} IS NOT NULL AND ${table.awayScore} IS NOT NULL)`,
    ),
    unique('games_source_ref_key').on(table.statsSource, table.sourceGameRef),
    uniqueIndex('games_make_up_ref_key')
      .on(table.statsSource, table.makeUpSourceGameRef)
      .where(sql`${table.makeUpSourceGameRef} IS NOT NULL`),
    index('games_home_team_start_idx').on(table.homeTeamId, table.scheduledStartAt),
    index('games_away_team_start_idx').on(table.awayTeamId, table.scheduledStartAt),
    index('games_season_phase_idx').on(table.season, table.phase),
    index('games_game_day_idx').on(table.gameDayOn),
    index('games_open_status_idx')
      .on(table.scheduledStartAt)
      .where(sql`${table.status} IN ('scheduled', 'in_progress', 'postponed')`),
    index('games_schedule_changed_idx').on(table.scheduleChangedAt),
  ],
);

/**
 * A player with a line in a season the source holds, the stored directory in which
 * the candidate search runs; public roster data, linked to no followed player
 * (JOU-10, STA-03).
 */
export const playerDirectoryEntries = pgTable(
  'player_directory_entries',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    season: text('season')
      .notNull()
      .references(() => seasons.season, { onDelete: 'restrict' }),
    sourcePlayerRef: text('source_player_ref').notNull(),
    displayName: text('display_name').notNull(),
    searchNames: text('search_names').array().notNull(),
    fetchedAt: timestamptz('fetched_at').notNull(),
  },
  (table) => [
    check('player_directory_entries_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    unique('player_directory_entries_key').on(
      table.statsSource,
      table.season,
      table.sourcePlayerRef,
    ),
    index('player_directory_entries_ref_idx').on(table.statsSource, table.sourcePlayerRef),
  ],
);

/** The teams of a directory entry's lines that season, with the US dates of his first and last (JOU-10). */
export const playerDirectoryTeams = pgTable(
  'player_directory_teams',
  {
    entryId: integer('entry_id')
      .notNull()
      .references(() => playerDirectoryEntries.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    firstGameOn: date('first_game_on').notNull(),
    lastGameOn: date('last_game_on').notNull(),
  },
  (table) => [primaryKey({ columns: [table.entryId, table.teamId] })],
);

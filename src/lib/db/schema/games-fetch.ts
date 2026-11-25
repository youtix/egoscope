// The tables of the games module that drive the reading of the statistics source: the
// fetch queue and the version of each answer read. They sit apart from games.ts only
// to keep each schema file and its tests within the size limits.
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
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { games, STATS_SOURCES } from './games';

// FetchUnitKind: the units of work of the fetch queue, each named after its port operation.
const FETCH_UNIT_KINDS = [
  'publication_probe',
  'season_games',
  'season_box_scores',
  'season_players',
  'player_records',
] as const;
// The units that read one season, and name it.
const SEASON_UNIT_KINDS = [
  'season_games',
  'season_box_scores',
  'season_players',
] as const satisfies readonly (typeof FETCH_UNIT_KINDS)[number][];
// FetchWaitReason (STA-36, STA-39).
const FETCH_WAIT_REASONS = ['outage', 'quota'] as const;
// The source resources whose last answer is recorded, each named after the port read.
const SOURCE_RESOURCES = [
  'publication',
  'season_games',
  'season_box_scores',
  'season_players',
  'player_records',
] as const;

/**
 * A pending source request, a resumable unit of work with its priority, attempts,
 * waiting reason, the start of its outages, the last change of its file's layout and its
 * lease; one per scope, deleted once done (STA-36, STA-37, STA-39, STA-40, TRV-30,
 * CL-STA-15).
 */
export const fetchQueueItems = pgTable(
  'fetch_queue_items',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    kind: text('kind', { enum: FETCH_UNIT_KINDS }).notNull(),
    season: text('season'),
    gameId: integer('game_id').references(() => games.id, { onDelete: 'cascade' }),
    isManualRefetch: boolean('is_manual_refetch').notNull().default(false),
    priority: smallint('priority').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    waitReason: text('wait_reason', { enum: FETCH_WAIT_REASONS }),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    cursor: text('cursor'),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    // The instant of the first failed attempt of the outages in a row that the unit waits
    // after (STA-37).
    failingSince: timestamptz('failing_since'),
    // The instant the unit's file last answered with a changed layout, or was missing when
    // due, until it reads again; an outage or a quota wait in between keeps it (CL-STA-15).
    schemaChangedAt: timestamptz('schema_changed_at'),
  },
  (table) => [
    check('fetch_queue_items_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    check('fetch_queue_items_kind_check', oneOf(table.kind, FETCH_UNIT_KINDS)),
    check('fetch_queue_items_priority_check', sql`${table.priority} BETWEEN 1 AND 5`),
    check('fetch_queue_items_wait_reason_check', oneOf(table.waitReason, FETCH_WAIT_REASONS)),
    check(
      'fetch_queue_items_failing_since_check',
      sql`(${table.waitReason} IS NOT DISTINCT FROM 'outage') = (${table.failingSince} IS NOT NULL)`,
    ),
    check(
      'fetch_queue_items_season_unit_check',
      sql`(${oneOf(table.kind, SEASON_UNIT_KINDS)}) = (${table.season} IS NOT NULL)`,
    ),
    check(
      'fetch_queue_items_refetch_game_check',
      sql`${table.gameId} IS NULL OR (${table.kind} = 'season_box_scores' AND ${table.isManualRefetch})`,
    ),
    unique('fetch_queue_items_scope_key')
      .on(table.statsSource, table.kind, table.season, table.gameId, table.isManualRefetch)
      .nullsNotDistinct(),
    index('fetch_queue_items_due_idx').on(table.priority, table.nextAttemptAt),
  ],
);

/**
 * The source version and fetch date of the last answer to each port read, so that
 * every request is conditional; a season's row records its file's first
 * publication (STA-42, CL-STA-15, CL-STA-30).
 */
export const statsSourceVersions = pgTable(
  'stats_source_versions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull(),
    resource: text('resource', { enum: SOURCE_RESOURCES }).notNull(),
    season: text('season'),
    version: text('version'),
    sourceRefreshedAt: timestamptz('source_refreshed_at'),
    fetchedAt: timestamptz('fetched_at').notNull(),
  },
  (table) => [
    check('stats_source_versions_stats_source_check', oneOf(table.statsSource, STATS_SOURCES)),
    check('stats_source_versions_resource_check', oneOf(table.resource, SOURCE_RESOURCES)),
    check(
      'stats_source_versions_publication_check',
      sql`(${table.resource} = 'publication') = (${table.season} IS NULL)`,
    ),
    check(
      'stats_source_versions_refreshed_check',
      sql`${table.sourceRefreshedAt} IS NULL OR ${table.resource} = 'publication'`,
    ),
    unique('stats_source_versions_key')
      .on(table.statsSource, table.resource, table.season)
      .nullsNotDistinct(),
  ],
);

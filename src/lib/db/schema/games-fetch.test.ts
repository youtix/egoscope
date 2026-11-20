import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { games, seasons, teams } from './games';
import { fetchQueueItems, statsSourceVersions } from './games-fetch';

import type { Database } from '../types';

// The tables of games-and-statistics.md that drive the reading of the source.
const TABLES = ['fetch_queue_items', 'stats_source_versions'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'fetch_queue_items.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'fetch_queue_items.stats_source text NOT NULL',
  'fetch_queue_items.kind text NOT NULL',
  'fetch_queue_items.season text',
  'fetch_queue_items.game_id integer',
  'fetch_queue_items.is_manual_refetch boolean NOT NULL DEFAULT false',
  'fetch_queue_items.priority smallint NOT NULL',
  'fetch_queue_items.attempts smallint NOT NULL DEFAULT 0',
  'fetch_queue_items.next_attempt_at timestamp with time zone NOT NULL DEFAULT now()',
  'fetch_queue_items.wait_reason text',
  'fetch_queue_items.lease_expires_at timestamp with time zone',
  'fetch_queue_items.cursor text',
  'fetch_queue_items.requested_at timestamp with time zone NOT NULL DEFAULT now()',
  'stats_source_versions.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'stats_source_versions.stats_source text NOT NULL',
  'stats_source_versions.resource text NOT NULL',
  'stats_source_versions.season text',
  'stats_source_versions.version text',
  'stats_source_versions.source_refreshed_at timestamp with time zone',
  'stats_source_versions.fetched_at timestamp with time zone NOT NULL',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX fetch_queue_items_due_idx ON public.fetch_queue_items USING btree (priority, next_attempt_at)',
  'CREATE UNIQUE INDEX fetch_queue_items_pkey ON public.fetch_queue_items USING btree (id)',
  'CREATE UNIQUE INDEX fetch_queue_items_scope_key ON public.fetch_queue_items USING btree (stats_source, kind, season, game_id, is_manual_refetch) NULLS NOT DISTINCT',
  'CREATE UNIQUE INDEX stats_source_versions_key ON public.stats_source_versions USING btree (stats_source, resource, season) NULLS NOT DISTINCT',
  'CREATE UNIQUE INDEX stats_source_versions_pkey ON public.stats_source_versions USING btree (id)',
];

// Their references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'fetch_queue_items FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE',
];

const SOURCE = { statsSource: 'sportsdataverse_espn' } as const;
const SEASON = { season: '2024-25', ...SOURCE } as const;
// The instant a unit of work read the source.
const FETCHED_AT = new Date(toEpochMs(Date.UTC(2025, 0, 15, 9)));
// A final regular-season game between two invented teams.
const GAME = {
  ...SEASON,
  sourceGameRef: '401700001',
  phase: 'regular_season',
  status: 'final',
  scheduledStartAt: new Date(toEpochMs(Date.UTC(2025, 0, 15, 0, 30))),
  gameDayOn: '2025-01-14',
  homeTeamId: 1,
  awayTeamId: 2,
  homeScore: 112,
  awayScore: 104,
  lastFetchedAt: FETCHED_AT,
  scheduleChangedAt: FETCHED_AT,
} as const;
// A unit of the fetch queue that reads one season's games.
const UNIT = { ...SEASON, kind: 'season_games', priority: 2 } as const;
// The last answer to the publication probe.
const ANSWER = { ...SOURCE, resource: 'publication', fetchedAt: FETCHED_AT } as const;
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** A season and the game of two invented teams. */
async function seedGame(db: Database): Promise<void> {
  await db.insert(seasons).values(SEASON);
  await db.insert(teams).values([
    { abbreviation: 'NPG', name: 'Northport Gulls' },
    { abbreviation: 'RWF', name: 'Redwater Foxes' },
  ]);
  await db.insert(games).values(GAME);
}

describe('the fetch tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that the model gives the fetch tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('queues a unit of work with the defaults of the data model', async () => {
    await db.insert(fetchQueueItems).values(UNIT);

    await expect(db.select().from(fetchQueueItems)).resolves.toStrictEqual([
      {
        id: 1,
        ...UNIT,
        gameId: null,
        isManualRefetch: false,
        attempts: 0,
        nextAttemptAt: ANY_INSTANT,
        waitReason: null,
        leaseExpiresAt: null,
        cursor: null,
        requestedAt: ANY_INSTANT,
      },
    ]);
  });

  it('queues a unit of each kind of the model, the season units with their season and the others without', async () => {
    const units = [
      { kind: 'publication_probe', season: null },
      { kind: 'season_games', season: '2024-25' },
      { kind: 'season_box_scores', season: '2024-25' },
      { kind: 'season_players', season: '2023-24' },
      { kind: 'player_records', season: null },
    ] as const;
    await db.insert(fetchQueueItems).values(units.map((unit) => ({ ...UNIT, ...unit })));

    const stored = await db
      .select({ kind: fetchQueueItems.kind, season: fetchQueueItems.season })
      .from(fetchQueueItems)
      .orderBy(fetchQueueItems.id);

    expect(stored).toStrictEqual(units);
  });

  it('[CL-STA-15] keeps a unit waiting after an outage or a quota answer, until its next attempt', async () => {
    // An hour after the outage, and the reset that the quota answer gives.
    const retryAt = new Date(toEpochMs(Date.UTC(2025, 0, 15, 10)));
    const resetAt = new Date(toEpochMs(Date.UTC(2025, 0, 16)));
    const waits = [
      { kind: 'season_games', attempts: 1, nextAttemptAt: retryAt, waitReason: 'outage' },
      { kind: 'season_box_scores', attempts: 0, nextAttemptAt: resetAt, waitReason: 'quota' },
    ] as const;
    await db.insert(fetchQueueItems).values(waits.map((wait) => ({ ...UNIT, ...wait })));

    const stored = await db
      .select({
        kind: fetchQueueItems.kind,
        attempts: fetchQueueItems.attempts,
        nextAttemptAt: fetchQueueItems.nextAttemptAt,
        waitReason: fetchQueueItems.waitReason,
      })
      .from(fetchQueueItems)
      .orderBy(fetchQueueItems.id);

    expect(stored).toStrictEqual(waits);
  });

  it('keeps one pending unit per scope, so that a new need raises its priority instead of adding a unit', async () => {
    const scope = [
      fetchQueueItems.statsSource,
      fetchQueueItems.kind,
      fetchQueueItems.season,
      fetchQueueItems.gameId,
      fetchQueueItems.isManualRefetch,
    ];
    const priority = sql`least(${fetchQueueItems.priority}, excluded.priority)`;
    for (const need of [
      { kind: 'publication_probe', season: null, priority: 3 },
      { kind: 'publication_probe', season: null, priority: 1 },
      { kind: 'season_box_scores', season: '2024-25', priority: 4 },
      { kind: 'season_box_scores', season: '2024-25', priority: 5 },
    ] as const) {
      await db
        .insert(fetchQueueItems)
        .values({ ...SOURCE, ...need })
        .onConflictDoUpdate({ target: scope, set: { priority } });
    }

    const units = await db
      .select({ kind: fetchQueueItems.kind, priority: fetchQueueItems.priority })
      .from(fetchQueueItems)
      .orderBy(fetchQueueItems.id);

    expect(units).toStrictEqual([
      { kind: 'publication_probe', priority: 1 },
      { kind: 'season_box_scores', priority: 4 },
    ]);
  });

  // Each unit breaks one clause: a season unit names its season, and no other unit does.
  it.each([
    { kind: 'season_games', season: null },
    { kind: 'season_box_scores', season: null },
    { kind: 'season_players', season: null },
    { kind: 'publication_probe', season: '2024-25' },
    { kind: 'player_records', season: '2024-25' },
  ] as const)('refuses a unit of kind $kind for the season $season', async (scope) => {
    const insert = db.insert(fetchQueueItems).values({ ...UNIT, ...scope });

    await expect(insert).rejects.toMatchObject(violationOf('fetch_queue_items_season_unit_check'));
  });

  it('narrows a manual refetch of box scores to one game, which no other unit names, and goes with it', async () => {
    await seedGame(db);
    const refetch = {
      ...UNIT,
      kind: 'season_box_scores',
      gameId: 1,
      isManualRefetch: true,
    } as const;
    await db.insert(fetchQueueItems).values(refetch);

    const schedule = db.insert(fetchQueueItems).values({ ...refetch, kind: 'season_games' });
    const daily = db.insert(fetchQueueItems).values({ ...refetch, isManualRefetch: false });

    await expect(schedule).rejects.toMatchObject(
      violationOf('fetch_queue_items_refetch_game_check'),
    );
    await expect(daily).rejects.toMatchObject(violationOf('fetch_queue_items_refetch_game_check'));
    await db.delete(games).where(eq(games.id, 1));
    await expect(db.select().from(fetchQueueItems)).resolves.toStrictEqual([]);
  });

  it.each([
    { unit: 'a priority above the first', change: { priority: 0 }, check: 'priority' },
    { unit: 'a priority below the fifth', change: { priority: 6 }, check: 'priority' },
    { unit: 'another wait', change: { waitReason: sql`'maintenance'` }, check: 'wait_reason' },
    { unit: 'another kind', change: { kind: sql`'teams'`, season: null }, check: 'kind' },
    { unit: 'another source', change: { statsSource: sql`'nba_stats'` }, check: 'stats_source' },
  ])('refuses a unit of work with $unit than the model allows', async ({ change, check }) => {
    const insert = db.insert(fetchQueueItems).values({ ...UNIT, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`fetch_queue_items_${check}_check`));
  });

  it('keeps the last answer to each read once, upserted on its key, the publication without a season', async () => {
    const key = [
      statsSourceVersions.statsSource,
      statsSourceVersions.resource,
      statsSourceVersions.season,
    ];
    for (const answer of [
      { resource: 'publication', season: null, version: 'v1' },
      { resource: 'publication', season: null, version: 'v2' },
      { resource: 'season_box_scores', season: '2024-25', version: 'etag-1' },
      { resource: 'season_box_scores', season: '2024-25', version: 'etag-2' },
    ] as const) {
      await db
        .insert(statsSourceVersions)
        .values({ ...ANSWER, ...answer })
        .onConflictDoUpdate({ target: key, set: { version: answer.version } });
    }

    const stored = await db
      .select({ resource: statsSourceVersions.resource, version: statsSourceVersions.version })
      .from(statsSourceVersions)
      .orderBy(statsSourceVersions.id);

    expect(stored).toStrictEqual([
      { resource: 'publication', version: 'v2' },
      { resource: 'season_box_scores', version: 'etag-2' },
    ]);
  });

  it('[CL-STA-23] records the last answer to each resource of the model, and refuses an answer of another source', async () => {
    // A season's files under their season, a past one's directory and the current
    // season's player file among them.
    const reads = [
      { resource: 'publication', season: null },
      { resource: 'season_games', season: '2024-25' },
      { resource: 'season_box_scores', season: '2024-25' },
      { resource: 'season_players', season: '2023-24' },
      { resource: 'player_records', season: '2024-25' },
    ] as const;
    await db.insert(statsSourceVersions).values(reads.map((read) => ({ ...ANSWER, ...read })));

    const nbaStats = db
      .insert(statsSourceVersions)
      .values({ ...ANSWER, statsSource: sql`'nba_stats'` });

    await expect(
      db
        .select({ resource: statsSourceVersions.resource, season: statsSourceVersions.season })
        .from(statsSourceVersions)
        .orderBy(statsSourceVersions.id),
    ).resolves.toStrictEqual(reads);
    await expect(nbaStats).rejects.toMatchObject(
      violationOf('stats_source_versions_stats_source_check'),
    );
  });

  // Each answer breaks one clause: only the publication is read for no season.
  it.each([
    { resource: 'publication', season: '2024-25' },
    { resource: 'season_games', season: null },
    { resource: 'season_box_scores', season: null },
    { resource: 'season_players', season: null },
    { resource: 'player_records', season: null },
  ] as const)('refuses the last answer to $resource for the season $season', async (read) => {
    const insert = db.insert(statsSourceVersions).values({ ...ANSWER, ...read });

    await expect(insert).rejects.toMatchObject(
      violationOf('stats_source_versions_publication_check'),
    );
  });

  it('keeps the refresh instant of the publication only, and refuses a resource the model lacks', async () => {
    const seasonRead = { ...ANSWER, resource: 'season_games', season: '2024-25' } as const;
    await db.insert(statsSourceVersions).values({ ...ANSWER, sourceRefreshedAt: FETCHED_AT });

    const refreshed = db
      .insert(statsSourceVersions)
      .values({ ...seasonRead, sourceRefreshedAt: FETCHED_AT });
    const teamsRead = db
      .insert(statsSourceVersions)
      .values({ ...seasonRead, resource: sql`'season_teams'` });

    await expect(refreshed).rejects.toMatchObject(
      violationOf('stats_source_versions_refreshed_check'),
    );
    await expect(teamsRead).rejects.toMatchObject(
      violationOf('stats_source_versions_resource_check'),
    );
  });
});

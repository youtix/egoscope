import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { games, seasons, teams } from './games';
import {
  boxScores,
  mappingCandidates,
  playerIndicators,
  statCorrections,
  statsSourceMappings,
} from './games-followed-players';
import { followedPlayers } from './players';

import type { Database } from '../types';

// The tables of games-and-statistics.md that concern one followed player each.
const TABLES = [
  'box_scores',
  'mapping_candidates',
  'player_indicators',
  'stat_corrections',
  'stats_source_mappings',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'box_scores.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'box_scores.player_id uuid NOT NULL',
  'box_scores.game_id integer NOT NULL',
  'box_scores.stats_source text NOT NULL',
  'box_scores.source_player_ref text NOT NULL',
  'box_scores.status text NOT NULL',
  'box_scores.team_id integer',
  'box_scores.minutes smallint',
  'box_scores.seconds smallint',
  'box_scores.has_rounded_minutes boolean NOT NULL',
  'box_scores.points smallint',
  'box_scores.field_goals_made smallint',
  'box_scores.field_goals_attempted smallint',
  'box_scores.three_pointers_made smallint',
  'box_scores.free_throws_made smallint',
  'box_scores.free_throws_attempted smallint',
  'box_scores.offensive_rebounds smallint',
  'box_scores.defensive_rebounds smallint',
  'box_scores.assists smallint',
  'box_scores.steals smallint',
  'box_scores.blocks smallint',
  'box_scores.turnovers smallint',
  'box_scores.personal_fouls smallint',
  'box_scores.ejected boolean',
  "box_scores.failed_checks text[] NOT NULL DEFAULT '{}'::text[]",
  'box_scores.fetched_at timestamp with time zone NOT NULL',
  'mapping_candidates.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'mapping_candidates.mapping_id integer NOT NULL',
  'mapping_candidates.source_player_ref text NOT NULL',
  'mapping_candidates.display_name text NOT NULL',
  'mapping_candidates.current_team_id integer',
  'mapping_candidates.first_season text',
  'mapping_candidates.last_season text',
  "mapping_candidates.team_ids integer[] NOT NULL DEFAULT '{}'::integer[]",
  'mapping_candidates.found_at timestamp with time zone NOT NULL DEFAULT now()',
  'mapping_candidates.is_preselected boolean NOT NULL DEFAULT false',
  'player_indicators.player_id uuid NOT NULL',
  'player_indicators.indicator_season text NOT NULL',
  'player_indicators.games_played_this_season smallint NOT NULL',
  'player_indicators.average_minutes_this_season double precision',
  'player_indicators.last_game_played_id integer',
  'player_indicators.last_game_played_on date',
  'player_indicators.consecutive_team_games_missed smallint NOT NULL DEFAULT 0',
  'player_indicators.first_nba_game_id integer',
  'player_indicators.first_nba_game_on date',
  'player_indicators.computed_at timestamp with time zone NOT NULL',
  'stat_corrections.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'stat_corrections.player_id uuid NOT NULL',
  'stat_corrections.game_id integer NOT NULL',
  'stat_corrections.element text NOT NULL',
  'stat_corrections.old_value integer',
  'stat_corrections.new_value integer',
  'stat_corrections.corrected_at timestamp with time zone NOT NULL DEFAULT now()',
  'stat_corrections.origin text NOT NULL',
  'stats_source_mappings.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'stats_source_mappings.player_id uuid NOT NULL',
  'stats_source_mappings.stats_source text NOT NULL',
  "stats_source_mappings.status text NOT NULL DEFAULT 'to_establish'::text",
  'stats_source_mappings.source_player_ref text',
  'stats_source_mappings.established_at timestamp with time zone',
  'stats_source_mappings.last_searched_at timestamp with time zone',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX box_scores_game_idx ON public.box_scores USING btree (game_id)',
  'CREATE UNIQUE INDEX box_scores_pkey ON public.box_scores USING btree (id)',
  'CREATE UNIQUE INDEX box_scores_player_game_key ON public.box_scores USING btree (player_id, game_id)',
  'CREATE UNIQUE INDEX mapping_candidates_mapping_ref_key ON public.mapping_candidates USING btree (mapping_id, source_player_ref)',
  'CREATE UNIQUE INDEX mapping_candidates_pkey ON public.mapping_candidates USING btree (id)',
  'CREATE UNIQUE INDEX mapping_candidates_preselected_key ON public.mapping_candidates USING btree (mapping_id) WHERE is_preselected',
  'CREATE UNIQUE INDEX player_indicators_pkey ON public.player_indicators USING btree (player_id)',
  'CREATE UNIQUE INDEX stat_corrections_pkey ON public.stat_corrections USING btree (id)',
  'CREATE INDEX stat_corrections_player_game_idx ON public.stat_corrections USING btree (player_id, game_id)',
  'CREATE UNIQUE INDEX stats_source_mappings_pkey ON public.stats_source_mappings USING btree (id)',
  'CREATE UNIQUE INDEX stats_source_mappings_player_source_key ON public.stats_source_mappings USING btree (player_id, stats_source)',
  'CREATE UNIQUE INDEX stats_source_mappings_source_ref_key ON public.stats_source_mappings USING btree (stats_source, source_player_ref)',
];

// Their references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'box_scores FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'box_scores FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'box_scores FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'mapping_candidates FOREIGN KEY (current_team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'mapping_candidates FOREIGN KEY (mapping_id) REFERENCES stats_source_mappings(id) ON DELETE CASCADE',
  'player_indicators FOREIGN KEY (first_nba_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'player_indicators FOREIGN KEY (last_game_played_id) REFERENCES games(id) ON DELETE RESTRICT',
  'player_indicators FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'stat_corrections FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'stat_corrections FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'stats_source_mappings FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
];

const SOURCE = { statsSource: 'sportsdataverse_espn' } as const;
// The tip-off of the game, 19:30 New York time on 14 January 2025.
const TIP_OFF = new Date(toEpochMs(Date.UTC(2025, 0, 15, 0, 30)));
// The instant ingestion wrote a line.
const FETCHED_AT = new Date(toEpochMs(Date.UTC(2025, 0, 15, 9)));
// Every element of a line, none of which the source has to give.
const NO_ELEMENT = {
  points: null,
  fieldGoalsMade: null,
  fieldGoalsAttempted: null,
  threePointersMade: null,
  freeThrowsMade: null,
  freeThrowsAttempted: null,
  offensiveRebounds: null,
  defensiveRebounds: null,
  assists: null,
  steals: null,
  blocks: null,
  turnovers: null,
  personalFouls: null,
} as const;
// The placeholder of a sheet that stayed unavailable (STA-35).
const PLACEHOLDER = {
  gameId: 1,
  ...SOURCE,
  sourcePlayerRef: '4433221',
  status: 'unavailable',
  hasRoundedMinutes: false,
  fetchedAt: FETCHED_AT,
} as const;
// A complete line of 34 whole minutes and 21 points for the home team.
const LINE = { ...PLACEHOLDER, status: 'complete', teamId: 1, minutes: 34, points: 21 } as const;
// A candidate of the player's mapping, found in the directory.
const CANDIDATE = {
  mappingId: 1,
  sourcePlayerRef: '4433221',
  displayName: 'Tobin Marlowe',
} as const;
// What the indicators say before his first game, and after it.
const UNPLAYED = { indicatorSeason: '2024-25', gamesPlayedThisSeason: 0, computedAt: FETCHED_AT };
const PLAYED = {
  gamesPlayedThisSeason: 1,
  averageMinutesThisSeason: 34,
  lastGamePlayedId: 1,
  lastGamePlayedOn: '2025-01-14',
} as const;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

/** Two invented teams, their final game and an invented followed player; his identifier. */
async function seed(db: Database): Promise<string> {
  await db.insert(seasons).values({ season: '2024-25', ...SOURCE });
  await db.insert(teams).values([
    { abbreviation: 'NPG', name: 'Northport Gulls' },
    { abbreviation: 'RWF', name: 'Redwater Foxes' },
  ]);
  await db.insert(games).values({
    ...SOURCE,
    sourceGameRef: '401700001',
    season: '2024-25',
    phase: 'regular_season',
    status: 'final',
    scheduledStartAt: TIP_OFF,
    gameDayOn: '2025-01-14',
    homeTeamId: 1,
    awayTeamId: 2,
    homeScore: 112,
    awayScore: 104,
    lastFetchedAt: FETCHED_AT,
    scheduleChangedAt: FETCHED_AT,
  });
  const [player] = await db
    .insert(followedPlayers)
    .values({ displayName: 'Tobin Marlowe', displayNameNormalized: 'tobin marlowe' })
    .returning();
  return player?.id ?? '';
}

describe('the tables of the followed players statistics', { timeout: 60_000 }, () => {
  let db: Database;
  let playerId: string;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    playerId = await seed(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that the model gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  // A line that lacks a count of the Game Score is incomplete (STA-10).
  it('[CL-STA-06] keeps a count that the source does not give as null, never as zero', async () => {
    const incomplete = { ...LINE, status: 'incomplete', hasRoundedMinutes: true } as const;
    await db.insert(boxScores).values({ ...incomplete, playerId });

    await expect(db.select().from(boxScores)).resolves.toStrictEqual([
      {
        id: 1,
        playerId,
        ...incomplete,
        seconds: null,
        ...NO_ELEMENT,
        points: 21,
        ejected: null,
        failedChecks: [],
      },
    ]);
  });

  // Each change breaks one clause: an unavailable placeholder holds no team, time or element.
  it.each([
    { teamId: 1 },
    { minutes: 0 },
    { seconds: 0 },
    { points: 0 },
    { fieldGoalsMade: 0 },
    { fieldGoalsAttempted: 0 },
    { threePointersMade: 0 },
    { freeThrowsMade: 0 },
    { freeThrowsAttempted: 0 },
    { offensiveRebounds: 0 },
    { defensiveRebounds: 0 },
    { assists: 0 },
    { steals: 0 },
    { blocks: 0 },
    { turnovers: 0 },
    { personalFouls: 0 },
  ])('[CL-STA-11] refuses an unavailable placeholder that holds %o', async (change) => {
    const insert = db.insert(boxScores).values({ ...PLACEHOLDER, playerId, ...change });

    await expect(insert).rejects.toMatchObject(violationOf('box_scores_placeholder_check'));
  });

  it('[CL-STA-11] keeps an unavailable placeholder that holds its status alone, and no failed check', async () => {
    const failed = db
      .insert(boxScores)
      .values({ ...PLACEHOLDER, playerId, failedChecks: ['negative_value'] });

    // The suspect check refuses it too: Postgres tests a row's checks in the order of
    // their names, so the placeholder check, which comes first, is the one reported.
    await expect(failed).rejects.toMatchObject(violationOf('box_scores_placeholder_check'));
    await db.insert(boxScores).values({ ...PLACEHOLDER, playerId });
    await expect(
      db.select({ status: boxScores.status, team: boxScores.teamId }).from(boxScores),
    ).resolves.toStrictEqual([{ status: 'unavailable', team: null }]);
  });

  it.each([
    { status: 'complete' as const, failedChecks: [] },
    { status: 'incomplete' as const, failedChecks: [] },
    { status: 'suspect' as const, failedChecks: ['points_mismatch' as const] },
  ])('refuses a $status line that names no team', async (line) => {
    const insert = db.insert(boxScores).values({ ...LINE, playerId, teamId: null, ...line });

    await expect(insert).rejects.toMatchObject(violationOf('box_scores_team_check'));
  });

  it('marks a line suspect exactly when it failed a check, and keeps every check of the model', async () => {
    const checks = [
      'negative_value',
      'made_above_attempted',
      'points_mismatch',
      'minutes_above_game_length',
      'statistic_without_minutes',
    ] as const;
    const suspect = { ...LINE, playerId, status: 'suspect' } as const;

    const unchecked = db.insert(boxScores).values(suspect);
    const checkedComplete = db
      .insert(boxScores)
      .values({ ...LINE, playerId, failedChecks: ['negative_value'] });
    const unknown = db
      .insert(boxScores)
      .values({ ...suspect, failedChecks: sql`ARRAY['rounding']` });

    await expect(unchecked).rejects.toMatchObject(violationOf('box_scores_suspect_check'));
    await expect(checkedComplete).rejects.toMatchObject(violationOf('box_scores_suspect_check'));
    await expect(unknown).rejects.toMatchObject(violationOf('box_scores_failed_checks_check'));
    await db.insert(boxScores).values({ ...suspect, failedChecks: [...checks] });
    await expect(
      db.select({ checks: boxScores.failedChecks }).from(boxScores),
    ).resolves.toStrictEqual([{ checks }]);
  });

  it('upserts a line on its player and game, so that reading it again changes only what changed', async () => {
    const read = async (points: number): Promise<void> => {
      await db
        .insert(boxScores)
        .values({ ...LINE, playerId, points })
        .onConflictDoUpdate({ target: [boxScores.playerId, boxScores.gameId], set: { points } });
    };
    await read(21);
    await read(21);
    await read(23);

    await expect(
      db.select({ id: boxScores.id, points: boxScores.points }).from(boxScores),
    ).resolves.toStrictEqual([{ id: 1, points: 23 }]);
  });

  it('refuses a line of another status or another source than the model lists', async () => {
    const dnp = db.insert(boxScores).values({ ...LINE, playerId, status: sql`'did_not_play'` });
    const source = db
      .insert(boxScores)
      .values({ ...LINE, playerId, statsSource: sql`'nba_stats'` });

    await expect(dnp).rejects.toMatchObject(violationOf('box_scores_status_check'));
    await expect(source).rejects.toMatchObject(violationOf('box_scores_stats_source_check'));
  });

  it('[CL-STA-26] traces a change of each element of a line, with its origin of the glossary', async () => {
    const elements = [
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
    const corrected = {
      playerId,
      gameId: 1,
      oldValue: null,
      newValue: 2,
      origin: 'correction_window',
    } as const;
    await db.insert(statCorrections).values(elements.map((element) => ({ ...corrected, element })));
    await db
      .insert(statCorrections)
      .values({ ...corrected, element: 'points', origin: 'manual_refetch' });

    const rebounds = db.insert(statCorrections).values({ ...corrected, element: sql`'rebounds'` });
    const fix = db
      .insert(statCorrections)
      .values({ ...corrected, element: 'points', origin: sql`'source_fix'` });

    await expect(db.select().from(statCorrections)).resolves.toHaveLength(17);
    await expect(rebounds).rejects.toMatchObject(violationOf('stat_corrections_element_check'));
    await expect(fix).rejects.toMatchObject(violationOf('stat_corrections_origin_check'));
  });

  it('keeps the indicators of a player in one row, upserted at each statistics update', async () => {
    await db.insert(playerIndicators).values({ playerId, ...UNPLAYED });
    await db
      .insert(playerIndicators)
      .values({ playerId, ...UNPLAYED, ...PLAYED })
      .onConflictDoUpdate({ target: playerIndicators.playerId, set: PLAYED });

    await expect(db.select().from(playerIndicators)).resolves.toStrictEqual([
      {
        playerId,
        ...UNPLAYED,
        ...PLAYED,
        consecutiveTeamGamesMissed: 0,
        firstNbaGameId: null,
        firstNbaGameOn: null,
      },
    ]);
  });

  it('[CL-JOU-21] starts a mapping to establish, one per player and source', async () => {
    await db.insert(statsSourceMappings).values({ playerId, ...SOURCE });

    const second = db.insert(statsSourceMappings).values({ playerId, ...SOURCE });

    await expect(db.select().from(statsSourceMappings)).resolves.toStrictEqual([
      {
        id: 1,
        playerId,
        ...SOURCE,
        status: 'to_establish',
        sourcePlayerRef: null,
        establishedAt: null,
        lastSearchedAt: null,
      },
    ]);
    await expect(second).rejects.toMatchObject(
      duplicateOf('stats_source_mappings_player_source_key'),
    );
  });

  it('refuses a mapping of another status or another source than the model lists', async () => {
    const confirmed = db
      .insert(statsSourceMappings)
      .values({ playerId, ...SOURCE, status: sql`'confirmed'` });
    const source = db
      .insert(statsSourceMappings)
      .values({ playerId, statsSource: sql`'nba_stats'` });

    await expect(confirmed).rejects.toMatchObject(
      violationOf('stats_source_mappings_status_check'),
    );
    await expect(source).rejects.toMatchObject(
      violationOf('stats_source_mappings_stats_source_check'),
    );
  });

  it('[CL-JOU-04] links a source identity to one followed player only, while mappings to establish never collide', async () => {
    const [other] = await db
      .insert(followedPlayers)
      .values({ displayName: 'Dace Wren', displayNameNormalized: 'dace wren' })
      .returning();
    await db.insert(statsSourceMappings).values([
      { playerId, ...SOURCE },
      { playerId: other?.id ?? '', ...SOURCE },
    ]);
    const confirmed = {
      status: 'established',
      sourcePlayerRef: '4433221',
      establishedAt: FETCHED_AT,
    } as const;
    await db.update(statsSourceMappings).set(confirmed).where(eq(statsSourceMappings.id, 1));

    const sameIdentity = db
      .update(statsSourceMappings)
      .set(confirmed)
      .where(eq(statsSourceMappings.id, 2));

    await expect(sameIdentity).rejects.toMatchObject(
      duplicateOf('stats_source_mappings_source_ref_key'),
    );
    await expect(
      db
        .select({ ref: statsSourceMappings.sourcePlayerRef })
        .from(statsSourceMappings)
        .orderBy(statsSourceMappings.id),
    ).resolves.toStrictEqual([{ ref: '4433221' }, { ref: null }]);
  });

  // Each mapping breaks one clause: established exactly with its identity and its date.
  it.each([
    {
      mapping: 'established without its identity',
      change: { status: 'established', establishedAt: FETCHED_AT },
    },
    {
      mapping: 'established without its date',
      change: { status: 'established', sourcePlayerRef: '4433221' },
    },
    {
      mapping: 'to establish with a confirmed identity',
      change: { sourcePlayerRef: '4433221', establishedAt: FETCHED_AT },
    },
  ] as const)('refuses a mapping $mapping', async ({ change }) => {
    const insert = db.insert(statsSourceMappings).values({ playerId, ...SOURCE, ...change });

    await expect(insert).rejects.toMatchObject(
      violationOf('stats_source_mappings_established_check'),
    );
  });

  it('[CL-TRV-14] offers each identity once per mapping, at most one of them preselected', async () => {
    await db.insert(statsSourceMappings).values({ playerId, ...SOURCE });
    await db.insert(mappingCandidates).values([
      {
        ...CANDIDATE,
        currentTeamId: 2,
        firstSeason: '2019-20',
        lastSeason: '2024-25',
        teamIds: [2, 1],
        isPreselected: true,
      },
      { ...CANDIDATE, sourcePlayerRef: '5544332' },
    ]);

    const again = db.insert(mappingCandidates).values(CANDIDATE);
    const secondChoice = db
      .insert(mappingCandidates)
      .values({ ...CANDIDATE, sourcePlayerRef: '6655443', isPreselected: true });

    await expect(
      db.select({ teams: mappingCandidates.teamIds }).from(mappingCandidates),
    ).resolves.toStrictEqual([{ teams: [2, 1] }, { teams: [] }]);
    await expect(again).rejects.toMatchObject(duplicateOf('mapping_candidates_mapping_ref_key'));
    await expect(secondChoice).rejects.toMatchObject(
      duplicateOf('mapping_candidates_preselected_key'),
    );
  });

  it('[CL-STA-28] refuses a candidate whose first or last season is not written 2024-25', async () => {
    await db.insert(statsSourceMappings).values({ playerId, ...SOURCE });

    const first = db.insert(mappingCandidates).values({ ...CANDIDATE, firstSeason: '2019-2020' });
    const last = db.insert(mappingCandidates).values({ ...CANDIDATE, lastSeason: '25' });

    await expect(first).rejects.toMatchObject(violationOf('mapping_candidates_first_season_check'));
    await expect(last).rejects.toMatchObject(violationOf('mapping_candidates_last_season_check'));
  });

  it('[CL-JOU-06] deletes the mapping, candidates, lines, corrections and indicators of a player with him', async () => {
    await db.insert(statsSourceMappings).values({ playerId, ...SOURCE });
    await db.insert(mappingCandidates).values(CANDIDATE);
    await db.insert(boxScores).values({ ...LINE, playerId });
    const correction = { gameId: 1, element: 'points', origin: 'correction_window' } as const;
    await db.insert(statCorrections).values({ playerId, ...correction, newValue: 21 });
    await db.insert(playerIndicators).values({ playerId, ...UNPLAYED });

    const tables = [
      statsSourceMappings,
      mappingCandidates,
      boxScores,
      statCorrections,
      playerIndicators,
    ] as const;

    await db.delete(followedPlayers).where(eq(followedPlayers.id, playerId));

    await expect(
      Promise.all(tables.map(async (table) => db.select().from(table))),
    ).resolves.toStrictEqual([[], [], [], [], []]);
  });
});

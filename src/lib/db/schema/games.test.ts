import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import {
  games,
  playerDirectoryEntries,
  playerDirectoryTeams,
  seasons,
  series,
  teams,
  teamSeasons,
  teamSourceRefs,
} from './games';

import type { Database } from '../types';

// The league tables of games-and-statistics.md: the schedule, its teams and seasons, and
// the player directory.
const TABLES = [
  'games',
  'player_directory_entries',
  'player_directory_teams',
  'seasons',
  'series',
  'team_seasons',
  'team_source_refs',
  'teams',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'games.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'games.stats_source text NOT NULL',
  'games.source_game_ref text NOT NULL',
  'games.make_up_source_game_ref text',
  'games.season text NOT NULL',
  'games.phase text NOT NULL',
  'games.status text NOT NULL',
  'games.scheduled_start_at timestamp with time zone NOT NULL',
  'games.is_start_time_tbd boolean NOT NULL DEFAULT false',
  'games.game_day_on date NOT NULL',
  'games.home_team_id integer',
  'games.away_team_id integer',
  'games.home_score smallint',
  'games.away_score smallint',
  'games.overtime_count smallint',
  'games.series_id integer',
  'games.game_number smallint',
  'games.home_series_wins_before smallint',
  'games.away_series_wins_before smallint',
  'games.is_elimination_game boolean',
  'games.home_lines_published boolean NOT NULL DEFAULT false',
  'games.away_lines_published boolean NOT NULL DEFAULT false',
  'games.consolidated_at timestamp with time zone',
  'games.last_fetched_at timestamp with time zone NOT NULL',
  'games.schedule_changed_at timestamp with time zone NOT NULL',
  'player_directory_entries.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'player_directory_entries.stats_source text NOT NULL',
  'player_directory_entries.season text NOT NULL',
  'player_directory_entries.source_player_ref text NOT NULL',
  'player_directory_entries.display_name text NOT NULL',
  'player_directory_entries.search_names text[] NOT NULL',
  'player_directory_entries.fetched_at timestamp with time zone NOT NULL',
  'player_directory_teams.entry_id integer NOT NULL',
  'player_directory_teams.team_id integer NOT NULL',
  'player_directory_teams.first_game_on date NOT NULL',
  'player_directory_teams.last_game_on date NOT NULL',
  'seasons.season text NOT NULL',
  'seasons.stats_source text NOT NULL',
  "seasons.phases_with_lines text[] NOT NULL DEFAULT '{}'::text[]",
  'seasons.games_without_lines integer NOT NULL DEFAULT 0',
  'seasons.coverage_fetched_at timestamp with time zone',
  'series.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'series.season text NOT NULL',
  'series.phase text NOT NULL',
  'series.round text',
  'series.team_a_id integer NOT NULL',
  'series.team_b_id integer NOT NULL',
  'series.wins_needed smallint NOT NULL',
  'series.is_rebuilt boolean NOT NULL',
  'team_seasons.team_id integer NOT NULL',
  'team_seasons.season text NOT NULL',
  'team_seasons.name text NOT NULL',
  'team_seasons.location text NOT NULL',
  'team_seasons.abbreviation text NOT NULL',
  'team_source_refs.team_id integer NOT NULL',
  'team_source_refs.stats_source text NOT NULL',
  'team_source_refs.source_team_ref text NOT NULL',
  'teams.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'teams.abbreviation text NOT NULL',
  'teams.name text NOT NULL',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX games_away_team_start_idx ON public.games USING btree (away_team_id, scheduled_start_at)',
  'CREATE INDEX games_game_day_idx ON public.games USING btree (game_day_on)',
  'CREATE INDEX games_home_team_start_idx ON public.games USING btree (home_team_id, scheduled_start_at)',
  'CREATE UNIQUE INDEX games_make_up_ref_key ON public.games USING btree (stats_source, make_up_source_game_ref) WHERE (make_up_source_game_ref IS NOT NULL)',
  "CREATE INDEX games_open_status_idx ON public.games USING btree (scheduled_start_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'postponed'::text]))",
  'CREATE UNIQUE INDEX games_pkey ON public.games USING btree (id)',
  'CREATE INDEX games_schedule_changed_idx ON public.games USING btree (schedule_changed_at)',
  'CREATE INDEX games_season_phase_idx ON public.games USING btree (season, phase)',
  'CREATE UNIQUE INDEX games_source_ref_key ON public.games USING btree (stats_source, source_game_ref)',
  'CREATE UNIQUE INDEX player_directory_entries_key ON public.player_directory_entries USING btree (stats_source, season, source_player_ref)',
  'CREATE UNIQUE INDEX player_directory_entries_pkey ON public.player_directory_entries USING btree (id)',
  'CREATE INDEX player_directory_entries_ref_idx ON public.player_directory_entries USING btree (stats_source, source_player_ref)',
  'CREATE UNIQUE INDEX player_directory_teams_entry_id_team_id_pk ON public.player_directory_teams USING btree (entry_id, team_id)',
  'CREATE UNIQUE INDEX seasons_pkey ON public.seasons USING btree (season)',
  'CREATE UNIQUE INDEX series_pkey ON public.series USING btree (id)',
  'CREATE UNIQUE INDEX series_season_teams_key ON public.series USING btree (season, phase, team_a_id, team_b_id)',
  'CREATE UNIQUE INDEX team_seasons_team_id_season_pk ON public.team_seasons USING btree (team_id, season)',
  'CREATE UNIQUE INDEX team_source_refs_stats_source_source_team_ref_pk ON public.team_source_refs USING btree (stats_source, source_team_ref)',
  'CREATE UNIQUE INDEX teams_abbreviation_key ON public.teams USING btree (abbreviation)',
  'CREATE UNIQUE INDEX teams_pkey ON public.teams USING btree (id)',
];

// Their references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'games FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'games FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'games FOREIGN KEY (season) REFERENCES seasons(season) ON DELETE RESTRICT',
  'games FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE RESTRICT',
  'player_directory_entries FOREIGN KEY (season) REFERENCES seasons(season) ON DELETE RESTRICT',
  'player_directory_teams FOREIGN KEY (entry_id) REFERENCES player_directory_entries(id) ON DELETE CASCADE',
  'player_directory_teams FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'series FOREIGN KEY (season) REFERENCES seasons(season) ON DELETE RESTRICT',
  'series FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'series FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'team_seasons FOREIGN KEY (season) REFERENCES seasons(season) ON DELETE RESTRICT',
  'team_seasons FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'team_source_refs FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT',
];

const SOURCE = { statsSource: 'sportsdataverse_espn' } as const;
const SEASON = { season: '2024-25', ...SOURCE } as const;
// A tip-off at 19:30 New York time on 14 January 2025, 00:30 UTC the next day: the
// game's day is its US Eastern date (CL-TRV-03).
const TIP_OFF = new Date(toEpochMs(Date.UTC(2025, 0, 15, 0, 30)));
// The instant ingestion read the schedule.
const FETCHED_AT = new Date(toEpochMs(Date.UTC(2025, 0, 15, 9)));
// A final regular-season game between the first two invented teams.
const GAME = {
  ...SEASON,
  sourceGameRef: '401700001',
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
} as const;
// The first game of the playoff series between them.
const PLAYOFF_GAME = {
  ...GAME,
  phase: 'playoffs',
  seriesId: 1,
  gameNumber: 1,
  homeSeriesWinsBefore: 0,
  awaySeriesWinsBefore: 0,
  isEliminationGame: false,
} as const;
// A first-round series between the first two teams, and one between the last two.
const PAIRING = { season: '2024-25', phase: 'playoffs', winsNeeded: 4, isRebuilt: true } as const;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

/** A season, three invented teams and a playoff series of the first two. */
async function seedLeague(db: Database): Promise<void> {
  await db.insert(seasons).values(SEASON);
  await db.insert(teams).values([
    { abbreviation: 'NPG', name: 'Northport Gulls' },
    { abbreviation: 'RWF', name: 'Redwater Foxes' },
    { abbreviation: 'CBO', name: 'Coldbrook Owls' },
  ]);
  await db.insert(series).values({ ...PAIRING, round: 'first_round', teamAId: 1, teamBId: 2 });
}

/**
 * What a read of the season's games writes, each row upserted on its key as ingestion
 * does: the season, two teams with their source identifiers and their names that
 * season, their series and their game, whose score the second read corrects.
 */
async function readSchedule(db: Database, homeScore: number): Promise<void> {
  await db
    .insert(seasons)
    .values({ ...SEASON, coverageFetchedAt: FETCHED_AT })
    .onConflictDoUpdate({ target: seasons.season, set: { coverageFetchedAt: FETCHED_AT } });
  for (const [ref, abbreviation, location] of [
    ['31', 'NPG', 'Northport'],
    ['32', 'RWF', 'Redwater'],
  ] as const) {
    const [team] = await db
      .insert(teams)
      .values({ abbreviation, name: `${location} team` })
      .onConflictDoUpdate({ target: teams.abbreviation, set: { name: `${location} team` } })
      .returning();
    const teamId = team?.id ?? 0;
    await db
      .insert(teamSourceRefs)
      .values({ teamId, ...SOURCE, sourceTeamRef: ref })
      .onConflictDoNothing({ target: [teamSourceRefs.statsSource, teamSourceRefs.sourceTeamRef] });
    await db
      .insert(teamSeasons)
      .values({ teamId, season: '2024-25', name: 'team', location, abbreviation })
      .onConflictDoUpdate({ target: [teamSeasons.teamId, teamSeasons.season], set: { location } });
  }
  await db
    .insert(series)
    .values({ ...PAIRING, teamAId: 1, teamBId: 2 })
    .onConflictDoUpdate({
      target: [series.season, series.phase, series.teamAId, series.teamBId],
      set: { isRebuilt: true },
    });
  await db
    .insert(games)
    .values({ ...GAME, homeScore })
    .onConflictDoUpdate({ target: [games.statsSource, games.sourceGameRef], set: { homeScore } });
}

describe('the league tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that the model gives the league tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('records a game with the defaults of the data model', async () => {
    await seedLeague(db);
    await db.insert(games).values(GAME);

    await expect(db.select().from(games)).resolves.toStrictEqual([
      {
        id: 1,
        ...GAME,
        makeUpSourceGameRef: null,
        isStartTimeTbd: false,
        overtimeCount: null,
        seriesId: null,
        gameNumber: null,
        homeSeriesWinsBefore: null,
        awaySeriesWinsBefore: null,
        isEliminationGame: null,
        homeLinesPublished: false,
        awayLinesPublished: false,
        consolidatedAt: null,
      },
    ]);
  });

  it('[CL-TRV-03] keeps the day of a game as its US Eastern date, with no venue zone or venue date', async () => {
    const columns = await describeColumns(db, ['games']);
    const names = columns.map((column) => column.slice(0, column.indexOf(' ')));

    expect(names.filter((name) => /zone|venue|local/u.test(name))).toStrictEqual([]);
    expect(columns.filter((column) => column.includes(' date '))).toStrictEqual([
      'games.game_day_on date NOT NULL',
    ]);
  });

  it('[CL-STA-16] stores a game in one of the three phases that count, and in no other', async () => {
    await seedLeague(db);
    await db
      .insert(games)
      .values([
        GAME,
        { ...GAME, sourceGameRef: '401700002', phase: 'play_in' },
        { ...PLAYOFF_GAME, sourceGameRef: '401700003' },
      ]);

    const allStar = db.insert(games).values({ ...GAME, phase: sql`'all_star'` });
    const preseason = db.insert(games).values({ ...GAME, phase: sql`'preseason'` });

    await expect(db.select().from(games)).resolves.toHaveLength(3);
    await expect(allStar).rejects.toMatchObject(violationOf('games_phase_check'));
    await expect(preseason).rejects.toMatchObject(violationOf('games_phase_check'));
  });

  it('accepts each game status of the glossary, and refuses another', async () => {
    await seedLeague(db);
    const statuses = ['scheduled', 'in_progress', 'postponed', 'canceled'] as const;
    await db
      .insert(games)
      .values([GAME, ...statuses.map((status) => ({ ...GAME, sourceGameRef: status, status }))]);

    const suspended = db.insert(games).values({ ...GAME, status: sql`'suspended'` });

    await expect(db.select().from(games)).resolves.toHaveLength(5);
    await expect(suspended).rejects.toMatchObject(violationOf('games_status_check'));
  });

  // Each change breaks one clause: a regular-season game belongs to no series.
  it.each([
    { seriesId: 1 },
    { gameNumber: 1 },
    { homeSeriesWinsBefore: 0 },
    { awaySeriesWinsBefore: 0 },
    { isEliminationGame: false },
  ])('[CL-STA-18] refuses a regular-season game that holds %o', async (change) => {
    await seedLeague(db);

    const insert = db.insert(games).values({ ...GAME, ...change });

    await expect(insert).rejects.toMatchObject(violationOf('games_regular_season_check'));
  });

  it('[CL-STA-14] keeps a game whose teams are still to be determined only while it is scheduled', async () => {
    await seedLeague(db);
    const unknownTeams = { homeTeamId: null, awayTeamId: null, homeScore: null, awayScore: null };
    await db.insert(games).values({ ...GAME, ...unknownTeams, status: 'scheduled' });

    const home = db.insert(games).values({ ...GAME, homeTeamId: null, status: 'postponed' });
    const away = db.insert(games).values({ ...GAME, awayTeamId: null, status: 'postponed' });

    await expect(db.select({ home: games.homeTeamId }).from(games)).resolves.toStrictEqual([
      { home: null },
    ]);
    await expect(home).rejects.toMatchObject(violationOf('games_placeholder_check'));
    await expect(away).rejects.toMatchObject(violationOf('games_placeholder_check'));
  });

  it.each([
    { game: 'a team against itself', change: { awayTeamId: 1 }, check: 'distinct_teams' },
    { game: 'a final without its home score', change: { homeScore: null }, check: 'final_score' },
    { game: 'a final without its away score', change: { awayScore: null }, check: 'final_score' },
    {
      game: 'a negative number of overtimes',
      change: { overtimeCount: -1 },
      check: 'overtime_count',
    },
  ])('refuses a game of $game', async ({ change, check }) => {
    await seedLeague(db);

    const insert = db.insert(games).values({ ...GAME, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`games_${check}_check`));
  });

  it.each([
    { change: { gameNumber: 0 }, check: 'games_game_number_check' },
    { change: { homeSeriesWinsBefore: -1 }, check: 'games_home_series_wins_before_check' },
    { change: { awaySeriesWinsBefore: -1 }, check: 'games_away_series_wins_before_check' },
  ])('[CL-STA-18] refuses a playoff game that holds $change', async ({ change, check }) => {
    await seedLeague(db);

    const insert = db.insert(games).values({ ...PLAYOFF_GAME, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(check));
  });

  it('[CL-STA-17] keeps one row per source game, with a make-up game folded into its original', async () => {
    await seedLeague(db);
    await db.insert(games).values([
      { ...GAME, status: 'postponed', makeUpSourceGameRef: '401709001' },
      { ...GAME, sourceGameRef: '401700002' },
      { ...GAME, sourceGameRef: '401700003' },
    ]);

    const sameGame = db.insert(games).values({ ...GAME, homeScore: 99 });
    const sameMakeUp = db
      .insert(games)
      .values({ ...GAME, sourceGameRef: '401700004', makeUpSourceGameRef: '401709001' });

    await expect(sameGame).rejects.toMatchObject(duplicateOf('games_source_ref_key'));
    await expect(sameMakeUp).rejects.toMatchObject(duplicateOf('games_make_up_ref_key'));
  });

  it('upserts each row of a schedule read on its key, so that reading it again changes only what changed', async () => {
    await readSchedule(db, 112);
    const tables = [seasons, teams, teamSourceRefs, teamSeasons, series] as const;
    const first = await Promise.all(tables.map(async (table) => db.select().from(table)));

    await readSchedule(db, 113);

    await expect(
      Promise.all(tables.map(async (table) => db.select().from(table))),
    ).resolves.toStrictEqual(first);
    await expect(
      db.select({ id: games.id, homeScore: games.homeScore }).from(games),
    ).resolves.toStrictEqual([{ id: 1, homeScore: 113 }]);
  });

  it('[CL-STA-18] pairs two teams once per postseason, the lower team id first', async () => {
    await seedLeague(db);
    await db.insert(series).values({ ...PAIRING, phase: 'play_in', teamAId: 1, teamBId: 2 });

    const again = db.insert(series).values({ ...PAIRING, teamAId: 1, teamBId: 2 });
    const reversed = db.insert(series).values({ ...PAIRING, teamAId: 3, teamBId: 2 });
    const alone = db.insert(series).values({ ...PAIRING, teamAId: 3, teamBId: 3 });

    await expect(again).rejects.toMatchObject(duplicateOf('series_season_teams_key'));
    await expect(reversed).rejects.toMatchObject(violationOf('series_team_order_check'));
    await expect(alone).rejects.toMatchObject(violationOf('series_team_order_check'));
  });

  it.each([
    { series: 'of the regular season', change: { phase: sql`'regular_season'` }, check: 'phase' },
    {
      series: 'of a round the model lacks',
      change: { round: sql`'quarterfinals'` },
      check: 'round',
    },
    { series: 'that no win decides', change: { winsNeeded: 0 }, check: 'wins_needed' },
  ])('[CL-STA-18] refuses a series $series', async ({ change, check }) => {
    await seedLeague(db);

    const insert = db.insert(series).values({ ...PAIRING, teamAId: 2, teamBId: 3, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`series_${check}_check`));
  });

  it('[CL-STA-22] records a season as pending until its games are read, then the phases with lines', async () => {
    const read = {
      phasesWithLines: ['regular_season', 'playoffs'],
      gamesWithoutLines: 3,
    } satisfies Partial<typeof seasons.$inferInsert>;
    await db.insert(seasons).values([
      { ...SOURCE, season: '1999-00' },
      { ...SEASON, ...read, coverageFetchedAt: FETCHED_AT },
    ]);

    const allStar = db
      .insert(seasons)
      .values({ ...SOURCE, season: '2023-24', phasesWithLines: sql`ARRAY['all_star']` });

    await expect(db.select().from(seasons)).resolves.toStrictEqual([
      {
        ...SOURCE,
        season: '1999-00',
        phasesWithLines: [],
        gamesWithoutLines: 0,
        coverageFetchedAt: null,
      },
      { ...SEASON, ...read, coverageFetchedAt: FETCHED_AT },
    ]);
    await expect(allStar).rejects.toMatchObject(violationOf('seasons_phases_with_lines_check'));
  });

  it.each(['2024-2025', '24-25', '2024/25', 'season 2024-25'])(
    '[CL-STA-28] refuses the season label %s, which is not written 2024-25',
    async (season) => {
      const insert = db.insert(seasons).values({ ...SOURCE, season });

      await expect(insert).rejects.toMatchObject(violationOf('seasons_season_check'));
    },
  );

  it('upserts a season directory on its keys, and drops the teams of an entry with it', async () => {
    await seedLeague(db);
    const entry = { ...SEASON, sourcePlayerRef: '4433221', displayName: 'Rafe Lindqvist' };
    const read = async (searchNames: string[]): Promise<void> => {
      await db
        .insert(playerDirectoryEntries)
        .values({ ...entry, searchNames, fetchedAt: FETCHED_AT })
        .onConflictDoUpdate({
          target: [
            playerDirectoryEntries.statsSource,
            playerDirectoryEntries.season,
            playerDirectoryEntries.sourcePlayerRef,
          ],
          set: { searchNames },
        });
      await db
        .insert(playerDirectoryTeams)
        .values({ entryId: 1, teamId: 2, firstGameOn: '2024-10-23', lastGameOn: '2025-04-13' })
        .onConflictDoNothing({
          target: [playerDirectoryTeams.entryId, playerDirectoryTeams.teamId],
        });
    };
    await read(['rafe lindqvist']);
    await read(['rafe lindqvist', 'r. lindqvist']);

    const stored = await db
      .select({ id: playerDirectoryEntries.id, names: playerDirectoryEntries.searchNames })
      .from(playerDirectoryEntries);
    const stints = await db.select().from(playerDirectoryTeams);
    await db.delete(playerDirectoryEntries).where(eq(playerDirectoryEntries.id, 1));

    expect(stored).toStrictEqual([{ id: 1, names: ['rafe lindqvist', 'r. lindqvist'] }]);
    expect(stints).toHaveLength(1);
    await expect(db.select().from(playerDirectoryTeams)).resolves.toStrictEqual([]);
  });

  it('[CL-STA-23] maps each source identifier to one team, under one abbreviation, from a listed source', async () => {
    await seedLeague(db);
    await db.insert(teamSourceRefs).values({ teamId: 1, ...SOURCE, sourceTeamRef: '31' });

    const mappedTwice = db
      .insert(teamSourceRefs)
      .values({ teamId: 2, ...SOURCE, sourceTeamRef: '31' });
    const unknownSource = db
      .insert(teamSourceRefs)
      .values({ teamId: 1, statsSource: sql`'nba_stats'`, sourceTeamRef: '31' });
    const sameAbbreviation = db
      .insert(teams)
      .values({ abbreviation: 'NPG', name: 'Northport Pikes' });

    await expect(mappedTwice).rejects.toMatchObject(
      duplicateOf('team_source_refs_stats_source_source_team_ref_pk'),
    );
    await expect(unknownSource).rejects.toMatchObject(
      violationOf('team_source_refs_stats_source_check'),
    );
    await expect(sameAbbreviation).rejects.toMatchObject(duplicateOf('teams_abbreviation_key'));
  });
});

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { games, seasons, teams } from './games';
import {
  followedPlayers,
  playerNameVariants,
  playerStatusChanges,
  playerTeamChanges,
} from './players';

import type { Database } from '../types';

// The tables of players.md.
const TABLES = [
  'followed_players',
  'player_name_variants',
  'player_status_changes',
  'player_team_changes',
];

// Their columns, table by table and each table's in the order of players.md, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'followed_players.id uuid NOT NULL DEFAULT gen_random_uuid()',
  'followed_players.display_name text NOT NULL',
  'followed_players.display_name_normalized text NOT NULL',
  'followed_players.current_team_id integer',
  "followed_players.status text NOT NULL DEFAULT 'active'::text",
  'followed_players.birthday_month smallint',
  'followed_players.birthday_day smallint',
  'followed_players.birthday_origin text',
  'followed_players.added_at timestamp with time zone NOT NULL DEFAULT now()',
  'followed_players.pause_suggestion_declined_at timestamp with time zone',
  'followed_players.last_calendar_derivation_at timestamp with time zone',
  'followed_players.row_version integer NOT NULL DEFAULT 1',
  'player_name_variants.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'player_name_variants.player_id uuid NOT NULL',
  'player_name_variants.kind text NOT NULL',
  'player_name_variants.text text NOT NULL',
  'player_name_variants.normalized_text text NOT NULL',
  'player_name_variants.is_ambiguous boolean NOT NULL DEFAULT false',
  'player_status_changes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'player_status_changes.player_id uuid NOT NULL',
  'player_status_changes.changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'player_status_changes.from_status text NOT NULL',
  'player_status_changes.to_status text NOT NULL',
  'player_status_changes.reason text',
  'player_team_changes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'player_team_changes.player_id uuid NOT NULL',
  'player_team_changes.changed_at timestamp with time zone NOT NULL',
  'player_team_changes.previous_team_id integer',
  'player_team_changes.new_team_id integer',
  'player_team_changes.origin text NOT NULL',
  'player_team_changes.game_id integer',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX followed_players_display_name_normalized_idx ON public.followed_players USING btree (display_name_normalized)',
  'CREATE UNIQUE INDEX followed_players_pkey ON public.followed_players USING btree (id)',
  'CREATE INDEX player_name_variants_normalized_idx ON public.player_name_variants USING btree (normalized_text)',
  'CREATE UNIQUE INDEX player_name_variants_pkey ON public.player_name_variants USING btree (id)',
  'CREATE UNIQUE INDEX player_name_variants_player_normalized_key ON public.player_name_variants USING btree (player_id, normalized_text)',
  'CREATE UNIQUE INDEX player_status_changes_pkey ON public.player_status_changes USING btree (id)',
  'CREATE INDEX player_status_changes_player_changed_idx ON public.player_status_changes USING btree (player_id, changed_at)',
  'CREATE UNIQUE INDEX player_team_changes_pkey ON public.player_team_changes USING btree (id)',
  'CREATE INDEX player_team_changes_player_changed_idx ON public.player_team_changes USING btree (player_id, changed_at)',
];

// Their references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'followed_players FOREIGN KEY (current_team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'player_name_variants FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'player_status_changes FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'player_team_changes FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'player_team_changes FOREIGN KEY (new_team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'player_team_changes FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'player_team_changes FOREIGN KEY (previous_team_id) REFERENCES teams(id) ON DELETE RESTRICT',
];

// An invented player, as the owner types him and as CL-JOU-13 normalizes him.
const PLAYER = { displayName: 'Tobin Marlowe', displayNameNormalized: 'tobin marlowe' } as const;
// A birthday the owner entered.
const BY_OWNER = { birthdayOrigin: 'owner' } as const;
// A random UUID: version 4, variant 1 (CL-JOU-09).
const A_RANDOM_UUID: unknown = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
);
// The instant of an entered team change, 2025-02-06 17:00 UTC.
const CHANGED_AT = new Date(toEpochMs(Date.UTC(2025, 1, 6, 17)));
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

/** Follows the invented player, and gives his identifier. */
async function followPlayer(db: Database): Promise<string> {
  const [player] = await db.insert(followedPlayers).values(PLAYER).returning();
  return player?.id ?? '';
}

/** Two invented teams and a game between them, for the team history. */
async function seedLeague(db: Database): Promise<void> {
  await db.insert(seasons).values({ season: '2024-25', statsSource: 'sportsdataverse_espn' });
  await db.insert(teams).values([
    { abbreviation: 'NPG', name: 'Northport Gulls' },
    { abbreviation: 'RWF', name: 'Redwater Foxes' },
  ]);
  await db.insert(games).values({
    statsSource: 'sportsdataverse_espn',
    sourceGameRef: '401700001',
    season: '2024-25',
    phase: 'regular_season',
    status: 'scheduled',
    scheduledStartAt: CHANGED_AT,
    gameDayOn: '2025-02-06',
    homeTeamId: 1,
    awayTeamId: 2,
    lastFetchedAt: CHANGED_AT,
    scheduleChangedAt: CHANGED_AT,
  });
}

describe('the players tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that players.md gives its tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('follows a player with the defaults of the data model, active and without a team', async () => {
    await db.insert(followedPlayers).values(PLAYER);

    await expect(db.select().from(followedPlayers)).resolves.toStrictEqual([
      {
        id: A_RANDOM_UUID,
        ...PLAYER,
        currentTeamId: null,
        status: 'active',
        birthdayMonth: null,
        birthdayDay: null,
        birthdayOrigin: null,
        addedAt: ANY_INSTANT,
        pauseSuggestionDeclinedAt: null,
        lastCalendarDerivationAt: null,
        rowVersion: 1,
      },
    ]);
  });

  it('[VUE-04] [CL-JOU-09] gives every followed player a random identifier of his own, so that namesakes stay two players', async () => {
    await db.insert(followedPlayers).values([PLAYER, PLAYER]);

    const ids = await db.select({ id: followedPlayers.id }).from(followedPlayers);

    expect(ids).toStrictEqual([{ id: A_RANDOM_UUID }, { id: A_RANDOM_UUID }]);
    expect(new Set(ids.map((row) => row.id)).size).toBe(2);
  });

  it('accepts each player status of the glossary, and refuses another or a blank name', async () => {
    const statuses = ['active', 'paused', 'withdrawn'] as const;
    await db.insert(followedPlayers).values(statuses.map((status) => ({ ...PLAYER, status })));

    const stored = await db.select({ status: followedPlayers.status }).from(followedPlayers);
    const retired = db.insert(followedPlayers).values({ ...PLAYER, status: sql`'retired'` });
    const blank = db.insert(followedPlayers).values({ ...PLAYER, displayName: ' '.repeat(3) });

    expect(stored.map((row) => row.status)).toStrictEqual(statuses);
    await expect(retired).rejects.toMatchObject(violationOf('followed_players_status_check'));
    await expect(blank).rejects.toMatchObject(violationOf('followed_players_display_name_check'));
  });

  it('[CL-JOU-16] [CL-JOU-17] [CL-DSN-21] stores the last day of every month as a birthday, 29 February included, and no year of birth', async () => {
    const lastDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    await db.insert(followedPlayers).values(
      lastDays.map((birthdayDay, index) => ({
        ...PLAYER,
        birthdayMonth: index + 1,
        birthdayDay,
        birthdayOrigin: 'stats_source' as const,
      })),
    );

    const stored = await db
      .select({ month: followedPlayers.birthdayMonth, day: followedPlayers.birthdayDay })
      .from(followedPlayers)
      .orderBy(followedPlayers.birthdayMonth);
    const birthColumns = await describeColumns(db, ['followed_players']);

    expect(stored.map((row) => row.day)).toStrictEqual(lastDays);
    expect(birthColumns.filter((column) => column.includes('birth'))).toStrictEqual([
      'followed_players.birthday_month smallint',
      'followed_players.birthday_day smallint',
      'followed_players.birthday_origin text',
    ]);
  });

  // Each birthday breaks one clause of one check: a month or a day out of range, or a
  // part of the birthday given without the other.
  it.each([
    {
      birthday: 'month 0',
      given: { birthdayMonth: 0, birthdayDay: 1, ...BY_OWNER },
      check: 'month',
    },
    {
      birthday: 'month 13',
      given: { birthdayMonth: 13, birthdayDay: 1, ...BY_OWNER },
      check: 'month',
    },
    { birthday: 'day 0', given: { birthdayMonth: 1, birthdayDay: 0, ...BY_OWNER }, check: 'day' },
    {
      birthday: '32 January',
      given: { birthdayMonth: 1, birthdayDay: 32, ...BY_OWNER },
      check: 'day',
    },
    {
      birthday: '30 February',
      given: { birthdayMonth: 2, birthdayDay: 30, ...BY_OWNER },
      check: 'day',
    },
    {
      birthday: '31 April',
      given: { birthdayMonth: 4, birthdayDay: 31, ...BY_OWNER },
      check: 'day',
    },
  ])('[CL-JOU-16] refuses a birthday of $birthday', async ({ given, check }) => {
    const insert = db.insert(followedPlayers).values({ ...PLAYER, ...given });

    await expect(insert).rejects.toMatchObject(
      violationOf(`followed_players_birthday_${check}_check`),
    );
  });

  it('[CL-JOU-16] keeps the day and the month of a birthday together', async () => {
    const monthAlone = db
      .insert(followedPlayers)
      .values({ ...PLAYER, birthdayMonth: 5, ...BY_OWNER });
    const dayAlone = db.insert(followedPlayers).values({ ...PLAYER, birthdayDay: 5 });

    await expect(monthAlone).rejects.toMatchObject(violationOf('followed_players_birthday_check'));
    await expect(dayAlone).rejects.toMatchObject(violationOf('followed_players_birthday_check'));
  });

  it('[CL-JOU-16] gives a birthday its origin, which the model lists, and an origin only to a birthday', async () => {
    const birthday = { birthdayMonth: 3, birthdayDay: 14 } as const;
    await db.insert(followedPlayers).values([
      { ...PLAYER, ...birthday, birthdayOrigin: 'stats_source' },
      { ...PLAYER, ...birthday, ...BY_OWNER },
    ]);

    const withoutOrigin = db.insert(followedPlayers).values({ ...PLAYER, ...birthday });
    const originAlone = db.insert(followedPlayers).values({ ...PLAYER, ...BY_OWNER });
    const guessed = db
      .insert(followedPlayers)
      .values({ ...PLAYER, ...birthday, birthdayOrigin: sql`'guess'` });

    await expect(withoutOrigin).rejects.toMatchObject(
      violationOf('followed_players_birthday_with_origin_check'),
    );
    await expect(originAlone).rejects.toMatchObject(
      violationOf('followed_players_birthday_with_origin_check'),
    );
    await expect(guessed).rejects.toMatchObject(
      violationOf('followed_players_birthday_origin_check'),
    );
    await expect(
      db
        .select({ origin: followedPlayers.birthdayOrigin })
        .from(followedPlayers)
        .orderBy(followedPlayers.birthdayOrigin),
    ).resolves.toStrictEqual([{ origin: 'owner' }, { origin: 'stats_source' }]);
  });

  it('[CL-JOU-13] keeps a name variant once per player after normalization, and lets another player share it', async () => {
    const playerId = await followPlayer(db);
    const [other] = await db
      .insert(followedPlayers)
      .values({ displayName: 'Dace Wren', displayNameNormalized: 'dace wren' })
      .returning();
    const variant = { kind: 'nickname', text: 'The Gull', normalizedText: 'the gull' } as const;
    await db.insert(playerNameVariants).values([
      { playerId, ...variant, isAmbiguous: true },
      { playerId, kind: 'spelling', text: 'Tobyn Marlowe', normalizedText: 'tobyn marlowe' },
      { playerId: other?.id ?? '', ...variant },
    ]);

    const again = db
      .insert(playerNameVariants)
      .values({ playerId, ...variant, kind: 'spelling', text: 'THE GULL' });

    await expect(again).rejects.toMatchObject(
      duplicateOf('player_name_variants_player_normalized_key'),
    );
    await expect(db.select().from(playerNameVariants)).resolves.toHaveLength(3);
  });

  it('refuses a variant of another kind than the glossary lists, or a blank one', async () => {
    const playerId = await followPlayer(db);
    const variant = {
      playerId,
      kind: 'spelling',
      text: 'Marlow',
      normalizedText: 'marlow',
    } as const;

    const alias = db.insert(playerNameVariants).values({ ...variant, kind: sql`'alias'` });
    const blank = db.insert(playerNameVariants).values({ ...variant, text: ' '.repeat(3) });

    await expect(alias).rejects.toMatchObject(violationOf('player_name_variants_kind_check'));
    await expect(blank).rejects.toMatchObject(violationOf('player_name_variants_text_check'));
  });

  it('[CL-JOU-12] records each of the five status transitions, each with any of the reasons', async () => {
    const playerId = await followPlayer(db);
    const transitions = [
      { fromStatus: 'active', toStatus: 'paused', reason: 'prolonged_absence' },
      { fromStatus: 'active', toStatus: 'withdrawn', reason: 'end_of_career' },
      { fromStatus: 'paused', toStatus: 'active', reason: 'left_nba' },
      { fromStatus: 'paused', toStatus: 'withdrawn', reason: 'insufficient_exposure' },
      { fromStatus: 'withdrawn', toStatus: 'active', reason: 'other' },
    ] as const;
    await db.insert(playerStatusChanges).values(transitions.map((row) => ({ playerId, ...row })));
    await db
      .insert(playerStatusChanges)
      .values({ playerId, fromStatus: 'active', toStatus: 'paused' });

    const unknown = db
      .insert(playerStatusChanges)
      .values({ playerId, fromStatus: 'active', toStatus: 'paused', reason: sql`'injury'` });

    await expect(db.select().from(playerStatusChanges)).resolves.toHaveLength(6);
    await expect(unknown).rejects.toMatchObject(violationOf('player_status_changes_reason_check'));
  });

  it.each([
    { fromStatus: 'withdrawn', toStatus: 'paused' },
    { fromStatus: 'active', toStatus: 'active' },
    { fromStatus: 'paused', toStatus: 'paused' },
    { fromStatus: 'withdrawn', toStatus: 'withdrawn' },
  ] as const)(
    'refuses a status change from $fromStatus to $toStatus, which is no transition',
    async (transition) => {
      const playerId = await followPlayer(db);

      const change = db.insert(playerStatusChanges).values({ playerId, ...transition });

      await expect(change).rejects.toMatchObject(
        violationOf('player_status_changes_transition_check'),
      );
    },
  );

  it('refuses a status change from or to a status that the glossary does not list', async () => {
    const playerId = await followPlayer(db);

    const from = db
      .insert(playerStatusChanges)
      .values({ playerId, fromStatus: sql`'deleted'`, toStatus: 'active' });
    const to = db
      .insert(playerStatusChanges)
      .values({ playerId, fromStatus: 'active', toStatus: sql`'deleted'` });

    await expect(from).rejects.toMatchObject(
      violationOf('player_status_changes_from_status_check'),
    );
    await expect(to).rejects.toMatchObject(violationOf('player_status_changes_to_status_check'));
  });

  it('[CL-JOU-03] [CL-JOU-20] records the team chosen at addition without a previous team, an observed trade and a release', async () => {
    await seedLeague(db);
    const playerId = await followPlayer(db);
    await db.insert(playerTeamChanges).values([
      { playerId, changedAt: CHANGED_AT, newTeamId: 1, origin: 'entered' },
      {
        playerId,
        changedAt: CHANGED_AT,
        previousTeamId: 1,
        newTeamId: 2,
        origin: 'observed',
        gameId: 1,
      },
      { playerId, changedAt: CHANGED_AT, previousTeamId: 2, origin: 'observed' },
    ]);

    const stored = await db
      .select({ from: playerTeamChanges.previousTeamId, to: playerTeamChanges.newTeamId })
      .from(playerTeamChanges)
      .orderBy(playerTeamChanges.id);

    expect(stored).toStrictEqual([
      { from: null, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: null },
    ]);
  });

  it.each([
    { change: 'keeps his team', pair: { previousTeamId: 1, newTeamId: 1 } },
    { change: 'leaves him without a team he already lacked', pair: {} },
  ])('refuses a team change that $change', async ({ pair }) => {
    await seedLeague(db);
    const playerId = await followPlayer(db);

    const insert = db
      .insert(playerTeamChanges)
      .values({ playerId, changedAt: CHANGED_AT, origin: 'entered', ...pair });

    await expect(insert).rejects.toMatchObject(
      violationOf('player_team_changes_distinct_teams_check'),
    );
  });

  it('refuses a team change of another origin than observed or entered', async () => {
    await seedLeague(db);
    const playerId = await followPlayer(db);

    const inferred = db
      .insert(playerTeamChanges)
      .values({ playerId, changedAt: CHANGED_AT, newTeamId: 1, origin: sql`'inferred'` });

    await expect(inferred).rejects.toMatchObject(violationOf('player_team_changes_origin_check'));
  });

  it('[CL-JOU-06] deletes his variants and his status and team histories with a player', async () => {
    await seedLeague(db);
    const playerId = await followPlayer(db);
    await db
      .insert(playerNameVariants)
      .values({ playerId, kind: 'nickname', text: 'Toby', normalizedText: 'toby' });
    await db
      .insert(playerStatusChanges)
      .values({ playerId, fromStatus: 'active', toStatus: 'withdrawn' });
    await db
      .insert(playerTeamChanges)
      .values({ playerId, changedAt: CHANGED_AT, newTeamId: 1, origin: 'entered' });

    await db.delete(followedPlayers).where(eq(followedPlayers.id, playerId));

    await expect(db.select().from(playerNameVariants)).resolves.toStrictEqual([]);
    await expect(db.select().from(playerStatusChanges)).resolves.toStrictEqual([]);
    await expect(db.select().from(playerTeamChanges)).resolves.toStrictEqual([]);
  });
});

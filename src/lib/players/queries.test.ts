import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  playerNameVariants,
  playerStatusChanges,
  playerTeamChanges,
  teams,
} from '@/lib/db';
import { setParam } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS, insertPlayer, noQueryDatabase } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import {
  activeCount,
  get,
  history,
  list,
  normalizeName,
  sharedVariants,
  variantsOfActivePlayers,
} from './queries';

import type { NameVariantKind, PlayerStatus } from './queries';
import type { Database } from '@/lib/db';
import type { LeaguePlayer } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
const DAY = 86_400_000;
const LEAGUE: readonly LeaguePlayer[] = [
  'p01',
  'p02',
  'p03',
  'p04',
  'p05',
  'p06',
  'p07',
  'p08',
  'p09',
  'p10',
];

/** The identifier of the `n`th invented player of a test. */
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('the players read API', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let followed = 0;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    followed = 0;
    const restoreClock = installFakeClock(fixedClock(START));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Follows an invented player named `displayName`, active unless `status` says otherwise. */
  async function follow(displayName: string, status: PlayerStatus = 'active') {
    followed += 1;
    return insertPlayer(db, { overrides: { id: idOf(followed), displayName, status } });
  }

  /** Gives `playerId` the variant `text`. */
  async function addVariant(
    playerId: string,
    text: string,
    {
      kind = 'spelling',
      isAmbiguous = false,
    }: { kind?: NameVariantKind; isAmbiguous?: boolean } = {},
  ) {
    const [variant] = await db
      .insert(playerNameVariants)
      .values({ playerId, kind, text, normalizedText: normalizeName(text), isAmbiguous })
      .returning({ id: playerNameVariants.id });
    return variant?.id;
  }

  /** Writes a team of the directory. */
  async function insertTeam(abbreviation: string, name: string) {
    const [team] = await db.insert(teams).values({ abbreviation, name }).returning();
    return team?.id ?? 0;
  }

  it('[CL-JOU-13] [JOU-09] normalizes a name by NFC, trim, collapsed spaces and case folding, accents kept', () => {
    expect(normalizeName('  Josué   Malo\t')).toBe('josué malo');
    expect(normalizeName('José MALO')).toBe('josé malo');
    expect(normalizeName('Josué Malo')).not.toBe(normalizeName('Josue Malo'));
    expect(normalizeName(' \n ')).toBe('');
  });

  it('[CL-JOU-13] normalizes once for all: a normalized name is its own normal form', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (name) => {
        const once = normalizeName(name);
        expect(normalizeName(once)).toBe(once);
        expect(once).toBe(once.trim());
        expect(once).not.toMatch(/\s{2}/u);
      }),
    );
  });

  it('[CL-JOU-13] gives the normalized display name that the test factory writes for every invented player', async () => {
    const players = await Promise.all(LEAGUE.map(async (source) => insertPlayer(db, { source })));
    const odd = await insertPlayer(db, {
      source: 'p01',
      overrides: { id: idOf(99), displayName: '  Ána  ÉLLÁ ' },
    });

    for (const player of [...players, odd]) {
      expect(normalizeName(player.displayName)).toBe(player.displayNameNormalized);
    }
  });

  it('[JOU-04] counts the active players only, never the paused or withdrawn ones', async () => {
    await follow('Ansel Varga');
    await follow('Corwin Ashgrove');
    await follow('Ilias Brenner', 'paused');
    await follow('Teodor Quill', 'withdrawn');

    expect(await activeCount(db)).toBe(2);
  });

  it('[JOU-28] lists the active players by default, in name order, and filters by status', async () => {
    const corwin = await follow('Corwin Ashgrove');
    const ansel = await follow('Ansel Varga');
    const ilias = await follow('Ilias Brenner', 'paused');
    await follow('Teodor Quill', 'withdrawn');

    expect(await list(db)).toStrictEqual({
      players: [
        { id: ansel.id, displayName: 'Ansel Varga', currentTeamId: null, status: 'active' },
        { id: corwin.id, displayName: 'Corwin Ashgrove', currentTeamId: null, status: 'active' },
      ],
      page: 1,
      hasNextPage: false,
    });
    const paused = await list(db, { status: 'paused' });
    expect(paused.players.map(({ id }) => id)).toStrictEqual([ilias.id]);
  });

  it('[JOU-28] [CL-JOU-13] searches the normalized display names and variants, accents kept', async () => {
    const josue = await follow('Josué Malo');
    const bram = await follow('Bram Heller');
    await follow('Elio Marsh', 'paused');
    await addVariant(bram.id, 'The  Hammer', { kind: 'nickname' });

    const searches = ['  MALO ', 'josué', 'josue', 'the hammer', 'marsh', ' '.repeat(3)];
    const found = [];
    for (const search of searches) {
      const page = await list(db, { search });
      found.push(page.players.map(({ id }) => id));
    }

    expect(found).toStrictEqual([[josue.id], [josue.id], [], [bram.id], [], [bram.id, josue.id]]);
  });

  it('[IHM-18] [JOU-28] pages the list by display.listPageSize', async () => {
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'display.listPageSize', value: 10, expectedVersion: 0 }),
    );
    const names = Array.from({ length: 11 }, (_, n) => `Player ${String(n).padStart(2, '0')}`);
    for (const name of names) {
      await follow(name);
    }

    const first = await list(db);
    const second = await list(db, { page: 2 });

    expect(first.players.map(({ displayName }) => displayName)).toStrictEqual(names.slice(0, 10));
    expect(first.hasNextPage).toBe(true);
    expect(second).toMatchObject({ page: 2, hasNextPage: false });
    expect(second.players.map(({ displayName }) => displayName)).toStrictEqual(['Player 10']);
  });

  it('[IHM-18] gives the first page for a page number that is not a whole number of at least 1', async () => {
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'display.listPageSize', value: 10, expectedVersion: 0 }),
    );
    const names = Array.from({ length: 11 }, (_, n) => `Player ${String(n)}`);
    for (const name of names) {
      await follow(name);
    }
    const first = await list(db);

    const pages = await Promise.all(
      [0, -1, 1.5, NaN, Infinity].map(async (page) => list(db, { page })),
    );

    expect(pages).toStrictEqual(Array.from({ length: 5 }, () => first));
    expect(first).toMatchObject({ page: 1, hasNextPage: true });
  });

  it('[JOU-08] [CL-IHM-18] gets a player with his identity, variants, team, birthday, declined suggestion and version', async () => {
    const team = await insertTeam('HBG', 'Harbor Gulls');
    const declinedAt = START - DAY;
    const ansel = await insertPlayer(db, {
      source: 'p01',
      overrides: {
        currentTeamId: team,
        pauseSuggestionDeclinedAt: new Date(declinedAt),
        rowVersion: 3,
      },
    });
    const spelling = await addVariant(ansel.id, 'Ansel Várga');
    const nickname = await addVariant(ansel.id, 'Big Vee', { kind: 'nickname', isAmbiguous: true });

    const detail = await get(db, ansel.id);

    expect(detail).toStrictEqual({
      id: ansel.id,
      displayName: 'Ansel Varga',
      currentTeamId: team,
      status: 'active',
      birthday: { month: 10, day: 26 },
      birthdayOrigin: 'stats_source',
      addedAt: START,
      pauseSuggestionDeclinedAt: declinedAt,
      rowVersion: 3,
      variants: [
        { id: spelling, kind: 'spelling', text: 'Ansel Várga', isAmbiguous: false },
        { id: nickname, kind: 'nickname', text: 'Big Vee', isAmbiguous: true },
      ],
    });
  });

  it('[JOU-08] [CL-JOU-16] gets a player without birthday or declined suggestion, and no one for an unknown identifier', async () => {
    const rafe = await insertPlayer(db, { source: 'p07' });

    expect(await get(db, rafe.id)).toMatchObject({
      birthday: null,
      birthdayOrigin: null,
      pauseSuggestionDeclinedAt: null,
      variants: [],
    });
    expect(await get(db, idOf(42))).toBeNull();
    expect(await get(db, 'not-a-player')).toBeNull();
  });

  it('[JOU-13] [JOU-15] gives the status and team changes in date order, a status change first on a tie', async () => {
    const harbor = await insertTeam('HBG', 'Harbor Gulls');
    const ridge = await insertTeam('RDG', 'Ridge Owls');
    const ansel = await follow('Ansel Varga');
    await db.insert(playerTeamChanges).values([
      {
        playerId: ansel.id,
        changedAt: new Date(START + 2 * DAY),
        previousTeamId: harbor,
        newTeamId: ridge,
        origin: 'observed',
        gameId: null,
      },
      {
        playerId: ansel.id,
        changedAt: new Date(START),
        previousTeamId: null,
        newTeamId: harbor,
        origin: 'entered',
        gameId: null,
      },
    ]);
    await db.insert(playerStatusChanges).values([
      {
        playerId: ansel.id,
        changedAt: new Date(START + 2 * DAY),
        fromStatus: 'paused',
        toStatus: 'active',
        reason: null,
      },
      {
        playerId: ansel.id,
        changedAt: new Date(START + DAY),
        fromStatus: 'active',
        toStatus: 'paused',
        reason: 'prolonged_absence',
      },
    ]);

    expect(await history(db, ansel.id)).toStrictEqual([
      {
        kind: 'team',
        changedAt: START,
        previousTeamId: null,
        newTeamId: harbor,
        origin: 'entered',
        gameId: null,
      },
      {
        kind: 'status',
        changedAt: START + DAY,
        fromStatus: 'active',
        toStatus: 'paused',
        reason: 'prolonged_absence',
      },
      {
        kind: 'status',
        changedAt: START + 2 * DAY,
        fromStatus: 'paused',
        toStatus: 'active',
        reason: null,
      },
      {
        kind: 'team',
        changedAt: START + 2 * DAY,
        previousTeamId: harbor,
        newTeamId: ridge,
        origin: 'observed',
        gameId: null,
      },
    ]);
    expect(await history(db, idOf(42))).toStrictEqual([]);
    expect(await history(db, 'not-a-player')).toStrictEqual([]);
  });

  it('[JOU-09] [CA-JOU-06] [CL-JOU-04] finds the other players, whatever their status, who share a name typed', async () => {
    const dario = await follow('Dario Castell');
    const other = await follow('Dario  CASTELL', 'withdrawn');
    const elio = await follow('Elio Marsh', 'paused');
    const editing = await follow('Bram Heller');
    await addVariant(elio.id, 'The Comet', { kind: 'nickname' });
    await addVariant(other.id, 'dario castell');
    await addVariant(editing.id, 'The Comet', { kind: 'nickname' });

    const shared = await sharedVariants(
      db,
      [' the  comet', 'Dario Castell', '', 'Nobody'],
      editing.id,
    );

    expect(shared).toStrictEqual([
      { text: ' the  comet', playerId: elio.id, displayName: 'Elio Marsh' },
      { text: 'Dario Castell', playerId: dario.id, displayName: 'Dario Castell' },
      { text: 'Dario Castell', playerId: other.id, displayName: 'Dario  CASTELL' },
    ]);
    expect(await sharedVariants(db, ['The Comet'])).toHaveLength(2);
  });

  it('[JOU-09] reads nothing when no name is typed', async () => {
    const stub = noQueryDatabase();

    expect(await sharedVariants(stub.db, ['', '  '])).toStrictEqual([]);
    expect(stub.attempts()).toStrictEqual([]);
  });

  it('[JOU-09] gives the names of the active players only, with their ambiguous marks', async () => {
    const ansel = await follow('Ansel Varga');
    const bram = await follow('Bram Heller');
    const elio = await follow('Elio Marsh', 'paused');
    await addVariant(bram.id, 'Bram Hëller');
    await addVariant(bram.id, 'The Hammer', { kind: 'nickname', isAmbiguous: true });
    await addVariant(elio.id, 'The Comet', { kind: 'nickname' });

    expect(await variantsOfActivePlayers(db)).toStrictEqual([
      {
        playerId: ansel.id,
        displayName: 'Ansel Varga',
        displayNameNormalized: 'ansel varga',
        variants: [],
      },
      {
        playerId: bram.id,
        displayName: 'Bram Heller',
        displayNameNormalized: 'bram heller',
        variants: [
          {
            kind: 'spelling',
            text: 'Bram Hëller',
            normalizedText: 'bram hëller',
            isAmbiguous: false,
          },
          { kind: 'nickname', text: 'The Hammer', normalizedText: 'the hammer', isAmbiguous: true },
        ],
      },
    ]);
  });
});

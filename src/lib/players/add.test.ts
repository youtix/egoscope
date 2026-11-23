import { eq, ne, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  backtestRequests,
  createTestDatabase,
  followedPlayers,
  journalEntries,
  playerNameVariants,
  playerStatusChanges,
  playerTeamChanges,
  teams,
} from '@/lib/db';
import { list as journalList } from '@/lib/journal';
import { setParam } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS, insertPlayer } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { add, lockActivePlayers } from './add';
import { activeCount, get } from './queries';

import type { NewPlayer } from './add';
import type { PlayerStatus } from './queries';
import type { Database, Transaction } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
// A random UUID, version 4, as Postgres generates them.
const RANDOM_UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;
const FULL_LIST = {
  ok: false,
  error: {
    kind: 'maximum_reached',
    maxActive: 30,
    waysOut: ['pause_active_player', 'withdraw_active_player', 'raise_maximum'],
  },
};

/** The identifier of the `n`th invented player of a test. */
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const tableName = z.object({ name: z.string() });
const tableCount = z.object({ name: z.string(), count: z.number() });
const tableNames = z.object({ rows: z.array(tableName) });
const tableCounts = z.object({ rows: z.array(tableCount) });
const heldLock = z.object({ classid: z.string(), objid: z.string(), objsubid: z.number() });
const heldLocks = z.object({ rows: z.array(heldLock) });

describe('the addition of a followed player', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let harbor: number;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    const [team] = await db
      .insert(teams)
      .values({ abbreviation: 'HBG', name: 'Harbor Gulls' })
      .returning();
    harbor = team?.id ?? 0;
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** An addition of `displayName` with the team Harbor Gulls, `changes` replacing any field. */
  function newPlayer(displayName: string, changes: Partial<NewPlayer> = {}): NewPlayer {
    return { displayName, currentTeamId: harbor, variants: [], ...changes };
  }

  /** Adds `player` in a transaction of its own. */
  async function addPlayer(player: NewPlayer) {
    return db.transaction(async (tx) => add(tx, player));
  }

  /** Adds `player`, and gives his identifier: the addition must succeed. */
  async function addedId(player: NewPlayer): Promise<string> {
    const added = await addPlayer(player);
    if (!added.ok) {
      throw new Error(`The addition was refused: ${JSON.stringify(added.error)}.`);
    }
    return added.value.playerId;
  }

  /** Follows `count` invented players with `status` through the test factory. */
  async function followMany(count: number, status: PlayerStatus, from = 0) {
    for (let n = from; n < from + count; n += 1) {
      await insertPlayer(db, {
        overrides: { id: idOf(n), displayName: `Player ${String(n)}`, status },
      });
    }
  }

  /** The number of rows of every table of the application, by table. */
  async function rowCounts(): Promise<ReadonlyMap<string, number>> {
    const listed = await db.execute(
      sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const names = tableNames.parse(listed).rows;
    const counted = await db.execute(
      sql.join(
        names.map(
          ({ name }) =>
            sql`select ${name}::text as name, count(*)::int as count from ${sql.identifier(name)}`,
        ),
        sql` union all `,
      ),
    );
    return new Map(tableCounts.parse(counted).rows.map(({ name, count }) => [name, count]));
  }

  /** The advisory locks that the session holds, by key. */
  async function advisoryLocks(reader: Database | Transaction) {
    return heldLocks.parse(
      await reader.execute(
        sql`select classid::text as classid, objid::text as objid, objsubid::int as objsubid from pg_locks where locktype = 'advisory' order by 1, 2, 3`,
      ),
    ).rows;
  }

  it('[JOU-05] holds the lock of the active count until the caller commits, the same one that lockActivePlayers takes, a refused addition too', async () => {
    const shared = await db.transaction(async (tx) => {
      await lockActivePlayers(tx);
      return advisoryLocks(tx);
    });
    const afterAdded = await db.transaction(async (tx) => {
      await add(tx, newPlayer('Ansel Varga'));
      return advisoryLocks(tx);
    });
    const afterCommit = await advisoryLocks(db);
    const afterInvalid = await db.transaction(async (tx) => {
      await add(tx, newPlayer(' '));
      return advisoryLocks(tx);
    });
    await followMany(29, 'active');
    const afterFull = await db.transaction(async (tx) => {
      const refused = await add(tx, newPlayer('Bram Okafor'));
      return { refused, locks: await advisoryLocks(tx) };
    });

    expect(shared).toHaveLength(1);
    expect([afterAdded, afterCommit, afterInvalid]).toStrictEqual([shared, [], shared]);
    expect(afterFull).toStrictEqual({ refused: FULL_LIST, locks: shared });
    expect(await advisoryLocks(db)).toStrictEqual([]);
  });

  it('[JOU-04] [JOU-05] [CA-JOU-02] refuses a 31st active player with the maximum in force and the three ways out', async () => {
    await followMany(30, 'active');

    expect(await addPlayer(newPlayer('Ansel Varga'))).toStrictEqual(FULL_LIST);
    expect(await activeCount(db)).toBe(30);
    expect(await db.select().from(journalEntries)).toStrictEqual([]);
  });

  it('[JOU-04] [CA-JOU-03] accepts the addition once one of 30 active players is paused, paused and withdrawn players not counted', async () => {
    await followMany(29, 'active');
    await followMany(1, 'paused', 29);
    await followMany(3, 'withdrawn', 30);

    const added = await addPlayer(newPlayer('Ansel Varga'));

    expect(added.ok).toBe(true);
    expect(await activeCount(db)).toBe(30);
  });

  it('[JOU-05] reads the maximum in force: once raised to 31, a 31st active player is added, a 32nd refused with 31', async () => {
    await followMany(30, 'active');
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'players.maxActive', value: 31, expectedVersion: 0 }),
    );

    const added = await addPlayer(newPlayer('Ansel Varga'));

    expect(added.ok).toBe(true);
    expect(await addPlayer(newPlayer('Bram Heller'))).toStrictEqual({
      ...FULL_LIST,
      error: { ...FULL_LIST.error, maxActive: 31 },
    });
  });

  /** An addition of Josué Malo with a spelling variant and an ambiguous nickname. */
  const josue = () =>
    newPlayer(' Josué  Malo ', {
      variants: [
        { kind: 'spelling', text: 'Josue Malo', isAmbiguous: false },
        { kind: 'nickname', text: 'The  Comet', isAmbiguous: true },
      ],
    });

  it('[JOU-08] [JOU-09] stores the identity and the variants, active at added_at, under a random identifier', async () => {
    const playerId = await addedId(josue());

    const detail = await get(db, playerId);
    const [player] = await db.select().from(followedPlayers);
    const variants = await db
      .select({
        kind: playerNameVariants.kind,
        text: playerNameVariants.text,
        normalizedText: playerNameVariants.normalizedText,
        isAmbiguous: playerNameVariants.isAmbiguous,
      })
      .from(playerNameVariants)
      .orderBy(playerNameVariants.id);

    expect(playerId).toMatch(RANDOM_UUID);
    expect(detail).toMatchObject({
      id: playerId,
      displayName: 'Josué  Malo',
      currentTeamId: harbor,
      status: 'active',
      addedAt: START,
      rowVersion: 1,
    });
    expect(player?.displayNameNormalized).toBe('josué malo');
    expect(variants).toStrictEqual([
      { kind: 'spelling', text: 'Josue Malo', normalizedText: 'josue malo', isAmbiguous: false },
      { kind: 'nickname', text: 'The  Comet', normalizedText: 'the comet', isAmbiguous: true },
    ]);
  });

  it('[JOU-08] [CL-JOU-02] [CL-JOU-03] [CL-STA-05] writes the team chosen as an entered first row of his team history, and no status change', async () => {
    const playerId = await addedId(josue());

    const changes = await db
      .select({
        playerId: playerTeamChanges.playerId,
        changedAt: playerTeamChanges.changedAt,
        previousTeamId: playerTeamChanges.previousTeamId,
        newTeamId: playerTeamChanges.newTeamId,
        origin: playerTeamChanges.origin,
        gameId: playerTeamChanges.gameId,
      })
      .from(playerTeamChanges);

    expect(changes).toStrictEqual([
      {
        playerId,
        changedAt: new Date(START),
        previousTeamId: null,
        newTeamId: harbor,
        origin: 'entered',
        gameId: null,
      },
    ]);
    expect(await db.select().from(playerStatusChanges)).toStrictEqual([]);
  });

  it('[JOU-08] [CL-JOU-09] gives two additions of the same name two different random identifiers', async () => {
    const first = await addedId(newPlayer('Dario Castell'));
    const second = await addedId(newPlayer('Dario Castell'));

    expect(first).toMatch(RANDOM_UUID);
    expect(second).toMatch(RANDOM_UUID);
    expect(first).not.toBe(second);
  });

  it('[JOU-08] [CL-JOU-20] refuses an empty display name and a missing team field by field, and writes nothing', async () => {
    const refused = await addPlayer(newPlayer('  ', { currentTeamId: null }));

    expect(refused).toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_fields',
        fields: { displayName: 'required', currentTeamId: 'required' },
      },
    });
    expect(await db.select().from(followedPlayers)).toStrictEqual([]);
    expect(await db.select().from(journalEntries)).toStrictEqual([]);
  });

  it('[JOU-08] [CL-JOU-20] refuses a team that is not in the team directory', async () => {
    const refused = await addPlayer(newPlayer('Ansel Varga', { currentTeamId: harbor + 1 }));

    expect(refused).toStrictEqual({
      ok: false,
      error: { kind: 'invalid_fields', fields: { currentTeamId: 'unknown' } },
    });
  });

  it('[JOU-09] [CL-JOU-13] refuses a variant that repeats one of his names after normalization, accents kept, and an empty one', async () => {
    const refused = await addPlayer(
      newPlayer('Josué Malo', {
        variants: [
          { kind: 'spelling', text: ' JOSUÉ   malo', isAmbiguous: false },
          { kind: 'spelling', text: 'Josue Malo', isAmbiguous: false },
          { kind: 'nickname', text: 'josue  MALO', isAmbiguous: true },
          { kind: 'nickname', text: '  ', isAmbiguous: false },
          { kind: 'nickname', text: 'The Comet', isAmbiguous: false },
        ],
      }),
    );

    expect(refused).toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_fields',
        fields: {
          variants: [
            { index: 0, problem: 'duplicate' },
            { index: 2, problem: 'duplicate' },
            { index: 3, problem: 'required' },
          ],
        },
      },
    });
    expect(await db.select().from(playerNameVariants)).toStrictEqual([]);
  });

  it('[JOU-09] [CA-JOU-06] accepts a variant of another followed player with a warning naming him, and stores its kind and ambiguous mark', async () => {
    const elio = await addedId(
      newPlayer('Elio Marsh', {
        variants: [{ kind: 'nickname', text: 'The Comet', isAmbiguous: false }],
      }),
    );

    const added = await addPlayer(
      newPlayer('Bram Heller', {
        variants: [{ kind: 'nickname', text: 'the  comet', isAmbiguous: true }],
      }),
    );

    expect(added).toMatchObject({
      ok: true,
      value: {
        sharedVariants: [{ text: 'the  comet', playerId: elio, displayName: 'Elio Marsh' }],
      },
    });
    const variants = await db
      .select({ kind: playerNameVariants.kind, isAmbiguous: playerNameVariants.isAmbiguous })
      .from(playerNameVariants)
      .where(ne(playerNameVariants.playerId, elio));
    expect(variants).toStrictEqual([{ kind: 'nickname', isAmbiguous: true }]);
  });

  it('[JOU-09] [CL-JOU-04] warns when the display name typed is the name or a variant of another followed player', async () => {
    const dario = await addedId(
      newPlayer('Dario Castell', {
        variants: [{ kind: 'spelling', text: 'Darío Castell', isAmbiguous: false }],
      }),
    );

    const twin = await addPlayer(newPlayer('DARIO CASTELL'));
    const accented = await addPlayer(newPlayer('Darío  Castell'));

    const warned = { playerId: dario, displayName: 'Dario Castell' };
    expect(twin).toMatchObject({
      value: { sharedVariants: [{ text: 'DARIO CASTELL', ...warned }] },
    });
    expect(accented).toMatchObject({
      value: { sharedVariants: [{ text: 'Darío  Castell', ...warned }] },
    });
  });

  it('[JOU-07] [CA-JOU-05] writes no backtest request, one journal entry about the player, and nothing in another module', async () => {
    const before = await rowCounts();

    const playerId = await addedId(
      newPlayer('Ansel Varga', {
        variants: [{ kind: 'nickname', text: 'Big Vee', isAmbiguous: false }],
      }),
    );

    const after = await rowCounts();
    const grown = [...after]
      .filter(([name, count]) => count !== before.get(name))
      .toSorted(([left], [right]) => (left < right ? -1 : 1));
    expect(grown).toStrictEqual([
      ['followed_players', 1],
      ['journal_entries', 1],
      ['player_name_variants', 1],
      ['player_team_changes', 1],
    ]);
    expect(
      await db.select().from(backtestRequests).where(eq(backtestRequests.playerId, playerId)),
    ).toStrictEqual([]);
    const journal = await journalList(db, { timeZone: 'UTC', pageSize: 10 });
    expect(journal.entries).toMatchObject([
      { messageKey: 'player_added', objectRef: { kind: 'player', id: playerId } },
    ]);
  });

  it('[JOU-07] writes the journal entry in the transaction of the addition: a rollback leaves neither', async () => {
    const rolledBack = db.transaction(async (tx) => {
      await add(tx, newPlayer('Ansel Varga'));
      tx.rollback();
    });

    await expect(rolledBack).rejects.toThrow('Rollback');
    expect(await db.select().from(followedPlayers)).toStrictEqual([]);
    expect(await db.select().from(journalEntries)).toStrictEqual([]);
  });
});

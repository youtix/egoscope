import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestDatabase, followedPlayers, journalEntries, playerStatusChanges } from '@/lib/db';
import { setParam } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS, insertPlayer, profiledPlayer } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { get, history } from './queries';
import { declinePauseSuggestion, pause, reactivate, recordDerivationRun, withdraw } from './status';

import type { PlayerStatus } from './queries';
import type { StatusChange } from './status';
import type { Database, Transaction } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

const START = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
const HOUR = 3_600_000;
const ARDEN = '00000000-0000-4000-8000-000000000101';
const BRAM = '00000000-0000-4000-8000-000000000102';
const NOBODY = '00000000-0000-4000-8000-000000000999';
// The default of `players.maxActive`.
const DEFAULT_MAX_ACTIVE = 30;
const FULL_LIST = {
  ok: false,
  error: {
    kind: 'maximum_reached',
    maxActive: DEFAULT_MAX_ACTIVE,
    waysOut: ['pause_active_player', 'withdraw_active_player', 'raise_maximum'],
  },
};
const DONE = { ok: true, value: undefined };

/** The identifier of the `n`th invented player of a filled list. */
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const tableName = z.object({ name: z.string() });
const tableCount = z.object({ name: z.string(), count: z.number() });
const tableNames = z.object({ rows: z.array(tableName) });
const tableCounts = z.object({ rows: z.array(tableCount) });

// The owner's operations of each status reached.
const OPERATIONS = { active: reactivate, paused: pause, withdrawn: withdraw } as const;

/** The refusal of a stale write to `playerId`, who now stands at `status` and `rowVersion`. */
function current(playerId: string, status: PlayerStatus, rowVersion: number) {
  return {
    ok: false,
    error: { kind: 'changed_elsewhere', current: { id: playerId, status, rowVersion } },
  };
}

/** The history line of a status change `hours` after the start. */
function line(
  hours: number,
  [fromStatus, toStatus]: readonly [string, string],
  reason: string | null,
) {
  return { kind: 'status', changedAt: START + hours * HOUR, fromStatus, toStatus, reason };
}

/** The tables whose row count differs between `before` and `after`, with the difference, by name. */
function grown(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>) {
  return [...after]
    .map(([name, count]) => [name, count - (before.get(name) ?? 0)] as const)
    .filter(([, difference]) => difference !== 0)
    .toSorted(([left], [right]) => (left < right ? -1 : 1));
}

describe('the status of a followed player', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  type Operation = (
    tx: Transaction,
    playerId: string,
    change: StatusChange,
  ) => Promise<Readonly<{ ok: boolean }>>;

  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(START);
    const restoreClock = installFakeClock(clock);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Follows `playerId` with `status` through the test factory. */
  async function follow(playerId: string, status: PlayerStatus, rowVersion = 1) {
    await insertPlayer(db, {
      overrides: { id: playerId, displayName: `Player ${playerId.slice(-3)}`, status, rowVersion },
    });
  }

  /** Follows as many active invented players as the default maximum allows. */
  async function followFullList() {
    for (let n = 0; n < DEFAULT_MAX_ACTIVE; n += 1) {
      await follow(idOf(n), 'active');
    }
  }

  /** Runs `operation` on `playerId` in a transaction of its own. */
  async function run(operation: Operation, playerId: string, change: StatusChange) {
    return db.transaction(async (tx) => operation(tx, playerId, change));
  }

  /** The status and row version of `playerId`. */
  async function stateOf(playerId: string) {
    const [row] = await db
      .select({ status: followedPlayers.status, rowVersion: followedPlayers.rowVersion })
      .from(followedPlayers)
      .where(eq(followedPlayers.id, playerId));
    return row;
  }

  /** Notes a derivation run of `playerId` at `at`. */
  async function ranAt(playerId: string, at: number) {
    return db.transaction(async (tx) => recordDerivationRun(tx, playerId, toEpochMs(at)));
  }

  /** The stored instant of Arden's last derivation, with his row version. */
  async function ardensDerivation() {
    const [row] = await db
      .select({
        at: followedPlayers.lastCalendarDerivationAt,
        rowVersion: followedPlayers.rowVersion,
      })
      .from(followedPlayers)
      .where(eq(followedPlayers.id, ARDEN));
    return { at: row?.at?.getTime() ?? null, rowVersion: row?.rowVersion };
  }

  /** The journal entries, oldest first. */
  async function journal() {
    return db
      .select({ messageKey: journalEntries.messageKey, playerId: journalEntries.playerId })
      .from(journalEntries)
      .orderBy(asc(journalEntries.id));
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

  it('[JOU-15] [CL-JOU-12] [H-JOU-06] allows the five transitions, each dated with its optional reason, the reason of a reactivation shown in its history line', async () => {
    await follow(ARDEN, 'active');
    const steps = [
      [pause, { expectedVersion: 1, reason: 'prolonged_absence' }],
      [reactivate, { expectedVersion: 2 }],
      [withdraw, { expectedVersion: 3, reason: 'end_of_career' }],
      [reactivate, { expectedVersion: 4, reason: 'other' }],
      [pause, { expectedVersion: 5 }],
      [withdraw, { expectedVersion: 6, reason: 'insufficient_exposure' }],
    ] as const;

    const outcomes = [];
    for (const [operation, change] of steps) {
      clock.advance(HOUR);
      outcomes.push(await run(operation, ARDEN, change));
    }

    expect(outcomes).toStrictEqual(steps.map(() => DONE));
    expect(await history(db, ARDEN)).toStrictEqual([
      line(1, ['active', 'paused'], 'prolonged_absence'),
      line(2, ['paused', 'active'], null),
      line(3, ['active', 'withdrawn'], 'end_of_career'),
      line(4, ['withdrawn', 'active'], 'other'),
      line(5, ['active', 'paused'], null),
      line(6, ['paused', 'withdrawn'], 'insufficient_exposure'),
    ]);
    const entries = await journal();
    expect(entries.map((entry) => entry.messageKey)).toStrictEqual([
      'player_paused',
      'player_reactivated',
      'player_withdrawn',
      'player_reactivated',
      'player_paused',
      'player_withdrawn',
    ]);
    expect(await stateOf(ARDEN)).toStrictEqual({ status: 'withdrawn', rowVersion: 7 });
  });

  it('[JOU-15] refuses every other transition, withdrawn to paused included, and writes nothing', async () => {
    const refused: readonly (readonly [PlayerStatus, PlayerStatus])[] = [
      ['active', 'active'],
      ['paused', 'paused'],
      ['withdrawn', 'paused'],
      ['withdrawn', 'withdrawn'],
    ];

    const outcomes = [];
    for (const [index, [from, to]] of refused.entries()) {
      const playerId = idOf(index);
      await follow(playerId, from);
      outcomes.push(await run(OPERATIONS[to], playerId, { expectedVersion: 1, reason: 'other' }));
    }

    expect(outcomes).toStrictEqual(
      refused.map(([from, to]) => ({
        ok: false,
        error: { kind: 'transition_not_allowed', from, to },
      })),
    );
    expect(await db.select().from(followedPlayers).orderBy(asc(followedPlayers.id))).toMatchObject(
      refused.map(([from]) => ({ status: from, rowVersion: 1 })),
    );
    expect(await db.select().from(playerStatusChanges)).toStrictEqual([]);
    expect(await journal()).toStrictEqual([]);
  });

  it('[JOU-20] [JOU-05] refuses a reactivation while players.maxActive players are active, with the same maximum and ways out, and reads the maximum in force', async () => {
    await followFullList();
    await follow(ARDEN, 'paused');
    await follow(BRAM, 'withdrawn');

    const fromPause = await run(reactivate, ARDEN, { expectedVersion: 1 });
    const fromWithdrawal = await run(reactivate, BRAM, { expectedVersion: 1 });
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'players.maxActive', value: 31, expectedVersion: 0 }),
    );
    const raised = await run(reactivate, ARDEN, { expectedVersion: 1 });
    const fullAgain = await run(reactivate, BRAM, { expectedVersion: 1 });

    expect([fromPause, fromWithdrawal]).toStrictEqual([FULL_LIST, FULL_LIST]);
    expect(raised).toStrictEqual(DONE);
    expect(fullAgain).toStrictEqual({ ...FULL_LIST, error: { ...FULL_LIST.error, maxActive: 31 } });
    expect([await stateOf(ARDEN), await stateOf(BRAM)]).toStrictEqual([
      { status: 'active', rowVersion: 2 },
      { status: 'withdrawn', rowVersion: 1 },
    ]);
    expect(await journal()).toStrictEqual([
      { messageKey: 'parameter_changed', playerId: null },
      { messageKey: 'player_reactivated', playerId: ARDEN },
    ]);
  });

  it('[JOU-20] [JOU-05] counts the active players only once it holds the lock that additions take', async () => {
    await followFullList();
    await follow(ARDEN, 'paused');
    // A role under a policy that hides the active players from any statement run before the
    // transaction holds an advisory lock: a count made before the lock would find none.
    await db.execute(sql`create role lock_watcher`);
    await db.execute(sql`grant usage on schema public to lock_watcher`);
    await db.execute(sql`grant all on all tables in schema public to lock_watcher`);
    await db.execute(sql`grant all on all sequences in schema public to lock_watcher`);
    await db.execute(sql`alter table followed_players enable row level security`);
    await db.execute(
      sql`create policy active_rows_under_lock on followed_players using (status <> 'active' or exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted))`,
    );

    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role lock_watcher`);
      const before = await tx.$count(followedPlayers);
      return { before, reactivated: await reactivate(tx, ARDEN, { expectedVersion: 1 }) };
    });

    expect(outcome).toStrictEqual({ before: 1, reactivated: FULL_LIST });
  });

  it('[JOU-20] [CL-IHM-18] checks the version again once it holds the lock: a reactivation of his that filled the list meanwhile is a change made elsewhere', async () => {
    await followFullList();
    await db
      .update(followedPlayers)
      .set({ status: 'paused' })
      .where(eq(followedPlayers.id, idOf(0)));
    await follow(ARDEN, 'paused');
    // The other reactivation of Arden commits between this one's first check and its lock:
    // a policy plays it at the first read made under the lock, that of the maximum.
    await db.execute(sql`create role lock_watcher`);
    await db.execute(sql`grant usage on schema public to lock_watcher`);
    await db.execute(sql`grant all on all tables in schema public to lock_watcher`);
    await db.execute(sql`grant all on all sequences in schema public to lock_watcher`);
    await db.execute(
      sql.raw(`create function reactivate_arden_elsewhere() returns boolean language plpgsql as $$
        begin
          update followed_players set status = 'active', row_version = row_version + 1
            where id = '${ARDEN}' and status = 'paused';
          return true;
        end $$`),
    );
    await db.execute(
      sql`insert into parameter_overrides (parameter_key, value) values ('players.maxActive', ${String(DEFAULT_MAX_ACTIVE)}::jsonb)`,
    );
    await db.execute(sql`alter table parameter_overrides enable row level security`);
    await db.execute(
      sql`create policy reactivated_elsewhere on parameter_overrides using (reactivate_arden_elsewhere())`,
    );

    const reactivated = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role lock_watcher`);
      return reactivate(tx, ARDEN, { expectedVersion: 1 });
    });

    expect(reactivated).toMatchObject(current(ARDEN, 'active', 2));
    expect(await journal()).toStrictEqual([]);
  });

  it('[JOU-20] [JOU-15] creates no backtest request and no derivation request: a reactivation writes its status change and journal entry only', async () => {
    await follow(ARDEN, 'withdrawn');
    const before = await rowCounts();

    const outcome = await run(reactivate, ARDEN, { expectedVersion: 1 });

    expect(outcome).toStrictEqual(DONE);
    expect(grown(before, await rowCounts())).toStrictEqual([
      ['journal_entries', 1],
      ['player_status_changes', 1],
    ]);
  });

  it('[JOU-19] [JOU-23] withdraws with the reason end of career or left the NBA, keeping every row of the player: identity, events, cases and requests', async () => {
    const profiled = await profiledPlayer(db);
    await follow(BRAM, 'paused');
    const before = await rowCounts();

    const endOfCareer = await run(withdraw, profiled.player.id, {
      expectedVersion: profiled.player.rowVersion,
      reason: 'end_of_career',
    });
    const leftNba = await run(withdraw, BRAM, { expectedVersion: 1, reason: 'left_nba' });

    expect([endOfCareer, leftNba]).toStrictEqual([DONE, DONE]);
    expect(grown(before, await rowCounts())).toStrictEqual([
      ['journal_entries', 2],
      ['player_status_changes', 2],
    ]);
    expect(
      await db
        .select({
          playerId: playerStatusChanges.playerId,
          toStatus: playerStatusChanges.toStatus,
          reason: playerStatusChanges.reason,
        })
        .from(playerStatusChanges)
        .orderBy(asc(playerStatusChanges.id)),
    ).toStrictEqual([
      { playerId: profiled.player.id, toStatus: 'withdrawn', reason: 'end_of_career' },
      { playerId: BRAM, toStatus: 'withdrawn', reason: 'left_nba' },
    ]);
    expect(await get(db, profiled.player.id)).toMatchObject({
      displayName: profiled.player.displayName,
      status: 'withdrawn',
    });
  });

  it('[CL-IHM-18] [CL-IHM-19] refuses every write sent with a stale version, with the player as he now stands, and one for a player gone', async () => {
    await follow(ARDEN, 'active', 4);
    await follow(BRAM, 'paused', 2);

    const stale = [
      await run(pause, ARDEN, { expectedVersion: 3 }),
      await run(withdraw, ARDEN, { expectedVersion: 3 }),
      await run(reactivate, BRAM, { expectedVersion: 1 }),
      await db.transaction(async (tx) => declinePauseSuggestion(tx, ARDEN, 3)),
    ];
    const gone = [
      await run(pause, NOBODY, { expectedVersion: 1 }),
      await run(reactivate, 'not-a-player', { expectedVersion: 1 }),
      await db.transaction(async (tx) => declinePauseSuggestion(tx, NOBODY, 1)),
    ];

    expect(stale).toMatchObject([
      current(ARDEN, 'active', 4),
      current(ARDEN, 'active', 4),
      current(BRAM, 'paused', 2),
      current(ARDEN, 'active', 4),
    ]);
    expect(gone).toStrictEqual(
      gone.map(() => ({ ok: false, error: { kind: 'no_longer_exists' } })),
    );
    expect([await stateOf(ARDEN), await stateOf(BRAM)]).toStrictEqual([
      { status: 'active', rowVersion: 4 },
      { status: 'paused', rowVersion: 2 },
    ]);
    expect(await journal()).toStrictEqual([]);
  });

  it('[JOU-15] writes in the caller’s transaction: a rollback leaves neither the status, its history line nor its journal entry', async () => {
    await follow(ARDEN, 'active');
    const rollback = new Error('The caller rolls back.');

    const outcome = db.transaction(async (tx) => {
      await pause(tx, ARDEN, { expectedVersion: 1 });
      throw rollback;
    });

    await expect(outcome).rejects.toBe(rollback);
    expect(await stateOf(ARDEN)).toStrictEqual({ status: 'active', rowVersion: 1 });
    expect(await db.select().from(playerStatusChanges)).toStrictEqual([]);
    expect(await journal()).toStrictEqual([]);
  });

  it('[JOU-22] records the declined pause suggestion now, moves the version on and journals it, the status unchanged', async () => {
    await follow(ARDEN, 'active');
    clock.advance(HOUR);

    const declined = await db.transaction(async (tx) => declinePauseSuggestion(tx, ARDEN, 1));

    expect(declined).toStrictEqual(DONE);
    expect(await get(db, ARDEN)).toMatchObject({
      status: 'active',
      pauseSuggestionDeclinedAt: START + HOUR,
      rowVersion: 2,
    });
    expect(await journal()).toStrictEqual([
      { messageKey: 'pause_suggestion_declined', playerId: ARDEN },
    ]);
    expect(await db.select().from(playerStatusChanges)).toStrictEqual([]);
  });

  it('[JOU-22] [CL-JOU-05] refuses to decline the pause suggestion of a paused or a withdrawn player, whose status has none, writing nothing', async () => {
    await follow(ARDEN, 'paused');
    await follow(BRAM, 'withdrawn');

    const outcomes = [
      await db.transaction(async (tx) => declinePauseSuggestion(tx, ARDEN, 1)),
      await db.transaction(async (tx) => declinePauseSuggestion(tx, BRAM, 1)),
    ];

    expect(outcomes).toStrictEqual([
      { ok: false, error: { kind: 'transition_not_allowed', from: 'paused', to: 'paused' } },
      { ok: false, error: { kind: 'transition_not_allowed', from: 'withdrawn', to: 'paused' } },
    ]);
    expect(await get(db, ARDEN)).toMatchObject({ pauseSuggestionDeclinedAt: null, rowVersion: 1 });
    expect(await get(db, BRAM)).toMatchObject({ pauseSuggestionDeclinedAt: null, rowVersion: 1 });
    expect(await journal()).toStrictEqual([]);
  });

  describe('the instant of the previous calendar derivation', () => {
    it('[CL-JOU-05] [CL-TAX-19] notes the run of a paused player and refuses a withdrawn one, whose derivation is off, writing nothing for him', async () => {
      await follow(ARDEN, 'paused');
      await follow(BRAM, 'withdrawn');

      const paused = await ranAt(ARDEN, START);
      const withdrawn = await ranAt(BRAM, START);

      expect(paused).toStrictEqual(DONE);
      expect(withdrawn).toStrictEqual({
        ok: false,
        error: { kind: 'transition_not_allowed', from: 'withdrawn', to: 'withdrawn' },
      });
      expect(await ardensDerivation()).toStrictEqual({ at: START, rowVersion: 1 });
      const [bram] = await db
        .select({ at: followedPlayers.lastCalendarDerivationAt })
        .from(followedPlayers)
        .where(eq(followedPlayers.id, BRAM));
      expect(bram).toStrictEqual({ at: null });
    });

    it('[CL-TAX-19] [CL-JOU-05] sets the instant of a run, never moves it back, and leaves the row version', async () => {
      await follow(ARDEN, 'active');
      const empty = await ardensDerivation();

      const first = await ranAt(ARDEN, START);
      const later = await ranAt(ARDEN, START + 2 * HOUR);
      const earlier = await ranAt(ARDEN, START + HOUR);

      expect(empty).toStrictEqual({ at: null, rowVersion: 1 });
      expect([first, later, earlier]).toStrictEqual([DONE, DONE, DONE]);
      expect(await ardensDerivation()).toStrictEqual({ at: START + 2 * HOUR, rowVersion: 1 });
    });

    it('[CL-TAX-19] [CL-JOU-05] keeps the instant of the last run through a withdrawal and a reactivation, so that the next run covers the gap', async () => {
      await follow(ARDEN, 'active');
      await ranAt(ARDEN, START);

      await run(withdraw, ARDEN, { expectedVersion: 1 });
      await run(reactivate, ARDEN, { expectedVersion: 2 });

      expect(await ardensDerivation()).toStrictEqual({ at: START, rowVersion: 3 });
    });

    it('[CL-TAX-19] answers player_not_found for an unknown player', async () => {
      expect(await ranAt(NOBODY, START)).toStrictEqual({ ok: false, error: 'player_not_found' });
    });
  });

  it('[JOU-22] [JOU-23] never changes a status by itself: no module of src/lib and no route handler calls pause, withdraw or reactivate', () => {
    const root = path.join(import.meta.dirname, '..', '..');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (file) =>
        /\.tsx?$/u.test(file) &&
        !/\.test\.tsx?$/u.test(file) &&
        (file.startsWith('lib') || /(?:^|\/)route\.ts$/u.test(file)),
    );
    const callers = files.filter((file) => {
      const source = readFileSync(path.join(root, file), 'utf8');
      const imported = /import\s*\{([^}]*)\}\s*from\s*'@\/lib\/players'/u.exec(source)?.[1] ?? '';
      return /\b(?:pause|withdraw|reactivate)\b/u.test(imported);
    });

    expect(files.length).toBeGreaterThan(0);
    expect(callers).toStrictEqual([]);
  });
});

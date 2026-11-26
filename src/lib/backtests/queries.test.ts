import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { backtestRequests, createTestDatabase } from '@/lib/db';
import { setParam, setUiSetting } from '@/lib/params';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertPlayer,
  insertRequest,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { inProgress, list, requestsOfPlayer, requestsToDo } from './queries';

import type { Database } from '@/lib/db';
import type { LeaguePlayer, RequestFactoryOptions, RequestRow } from '@/lib/testing';

// Sunday 8 November 2026, noon in New York.
const NOW = toEpochMs(Date.UTC(2026, 10, 8, 17, 0));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LONG_AGO = 400 * DAY;
const VERY_LONG_AGO = 4000 * DAY;
const PAGE_SIZE = 10;

const ago = (ms: number) => new Date(NOW - ms);

/** A request of the player as `requestsOfPlayer` reads it, an initial request asked by hand. */
const playerRequest = (row: RequestRow, status: RequestRow['status'], ageMs: number) => ({
  id: row.id,
  reference: row.reference,
  kind: 'initial',
  trigger: 'manual_action',
  origin: 'manual',
  status,
  createdAt: NOW - ageMs,
});

/** The identifiers of a read's requests, in its order. */
const idsOf = (requests: readonly Readonly<{ id: number }>[]) => requests.map(({ id }) => id);

describe('the lists of backtest requests', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    const restoreClock = installFakeClock(fixedClock(NOW));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  type Overrides = RequestFactoryOptions['overrides'];

  /** Writes a request to do of the invented player, created `ageMs` before now unless `overrides` say otherwise. */
  async function request(
    source: LeaguePlayer,
    ageMs: number,
    overrides: Overrides = {},
  ): Promise<RequestRow> {
    await insertPlayer(db, { source });
    return insertRequest(db, {
      playerId: leaguePlayerId(source),
      overrides: { createdAt: ago(ageMs), ...overrides },
    });
  }

  /** Writes an imported request of the invented player. */
  async function imported(source: LeaguePlayer, ageMs: number) {
    return request(source, ageMs, { status: 'imported', importedAt: ago(ageMs - HOUR) });
  }

  /** Records a copy of the request's prompt at `at`. */
  async function copy(requestId: number, at: number) {
    await db
      .update(backtestRequests)
      .set({ lastCopiedAt: new Date(at) })
      .where(eq(backtestRequests.id, requestId));
  }

  /** The display name of the invented player, who is followed. */
  async function nameOf(source: LeaguePlayer) {
    const { displayName } = await insertPlayer(db, { source });
    return displayName;
  }

  describe('the to-do list', () => {
    it('[BKT-17] [CL-IHM-16] returns the requests to do oldest first, with their ranks, and leaves the others out', async () => {
      const middle = await request('p01', 5 * DAY);
      const newest = await request('p02', 2 * DAY);
      const oldest = await request('p03', 9 * DAY);
      await imported('p04', 20 * DAY);
      await request('p05', 30 * DAY, { status: 'canceled', canceledAt: ago(29 * DAY) });

      const todo = await requestsToDo(db, NOW);

      expect(idsOf(todo)).toStrictEqual([oldest.id, middle.id, newest.id]);
      expect(todo.map(({ rank }) => rank)).toStrictEqual([1, 2, 3]);
      expect(todo.map(({ status }) => status)).toStrictEqual(['to_do', 'to_do', 'to_do']);
    });

    it('[BKT-17] orders the requests created at one instant by their identifiers', async () => {
      const first = await request('p02', DAY);
      const second = await request('p01', DAY);
      const third = await request('p03', DAY);
      // A saved row moves to the end of its table: the identifiers, not the storage, break the tie.
      await copy(first.id, NOW - HOUR);

      const todo = await requestsToDo(db, NOW);

      expect(idsOf(todo)).toStrictEqual([first.id, second.id, third.id]);
    });

    it('[BKT-19] [CL-BKT-21] [CA-VUE-07] [VUE-07] leaves a request to do alone at any age: it stays to do, keeps its rank and launches nothing', async () => {
      const ancient = await request('p01', LONG_AGO);
      await request('p02', DAY);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      onTestFinished(() => {
        fetchSpy.mockRestore();
      });
      const stored = await db.select().from(backtestRequests);

      const reads = [
        await requestsToDo(db, NOW),
        await requestsToDo(db, toEpochMs(NOW + LONG_AGO)),
        await requestsToDo(db, toEpochMs(NOW + VERY_LONG_AGO)),
      ];

      expect(await db.select().from(backtestRequests)).toStrictEqual(stored);
      for (const read of reads) {
        expect(read).toMatchObject([
          { id: ancient.id, status: 'to_do', rank: 1 },
          { status: 'to_do', rank: 2 },
        ]);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('the list by status', () => {
    it('[BKT-17] lists the requests to do by default, with their player, trigger, origin, rank and copy state', async () => {
      await request('p02', 8 * DAY);
      const todo = await request('p01', 3 * DAY, { promptProducedAt: ago(2 * DAY) });
      await imported('p03', 12 * DAY);
      await copy(todo.id, NOW - HOUR);

      const page = await list(db, NOW);

      expect(page).toMatchObject({ page: 1, hasNextPage: false });
      expect(page.requests).toMatchObject([
        {
          id: todo.id,
          reference: todo.reference,
          player: { id: leaguePlayerId('p01'), displayName: await nameOf('p01') },
          kind: 'initial',
          trigger: 'manual_action',
          origin: 'manual',
          status: 'to_do',
          createdAt: todo.createdAt.getTime(),
          rank: 2,
          lastCopiedAt: NOW - HOUR,
          isCopiedTextStale: false,
        },
        { rank: 1 },
      ]);
    });

    it('[BKT-17] lists the requests of one status, newest first, with no rank once they are not to do', async () => {
      const done = await imported('p01', 30 * DAY);
      await request('p01', 3 * DAY);
      const other = await imported('p02', 12 * DAY);
      const last = await imported('p01', 5 * DAY);
      await request('p03', 7 * DAY, { status: 'canceled', canceledAt: ago(6 * DAY) });

      const imports = await list(db, NOW, { status: 'imported' });

      expect(idsOf(imports.requests)).toStrictEqual([last.id, other.id, done.id]);
      expect(imports.requests.map(({ rank }) => rank)).toStrictEqual([null, null, null]);
    });

    it('[IHM-18] pages the requests by display.listPageSize and gives the first page for an invalid page number', async () => {
      await db.transaction(async (tx) =>
        setParam(tx, { key: 'display.listPageSize', value: PAGE_SIZE, expectedVersion: 0 }),
      );
      const written: RequestRow[] = [];
      for (let age = 1; age <= PAGE_SIZE + 1; age += 1) {
        written.push(await imported('p01', age * DAY));
      }
      const newestFirst = idsOf(written);

      const first = await list(db, NOW, { status: 'imported' });
      const second = await list(db, NOW, { status: 'imported', page: 2 });
      const invalid = await Promise.all(
        [0, -1, 1.5, NaN, Infinity].map(async (page) =>
          list(db, NOW, { status: 'imported', page }),
        ),
      );

      expect(idsOf(first.requests)).toStrictEqual(newestFirst.slice(0, PAGE_SIZE));
      expect(first).toMatchObject({ page: 1, hasNextPage: true });
      expect(idsOf(second.requests)).toStrictEqual(newestFirst.slice(PAGE_SIZE));
      expect(second).toMatchObject({ page: 2, hasNextPage: false });
      expect(invalid).toStrictEqual(Array.from({ length: 5 }, () => first));
    });
  });

  describe('the request in progress', () => {
    it('[IHM-40] [CL-IHM-13] gives the request to do copied most recently with the number of the other copied ones', async () => {
      const first = await request('p01', 9 * DAY);
      const latest = await request('p02', 8 * DAY);
      const third = await request('p03', 7 * DAY);
      await request('p04', 6 * DAY);
      const done = await imported('p05', 5 * DAY);
      await copy(first.id, NOW - 3 * DAY);
      await copy(latest.id, NOW - HOUR);
      await copy(third.id, NOW - 2 * DAY);
      await copy(done.id, NOW - DAY);

      const banner = await inProgress(db);

      expect(banner).toStrictEqual({
        id: latest.id,
        reference: latest.reference,
        player: { id: leaguePlayerId('p02'), displayName: await nameOf('p02') },
        lastCopiedAt: NOW - HOUR,
        otherCount: 2,
      });
    });

    it('[IHM-40] gives nothing while no request to do was copied, and breaks a tie of copy times by the identifier', async () => {
      const first = await request('p01', 3 * DAY);
      const second = await request('p02', 2 * DAY);
      const done = await imported('p03', 4 * DAY);
      await copy(done.id, NOW - HOUR);

      expect(await inProgress(db)).toBeNull();

      await copy(first.id, NOW - HOUR);
      await copy(second.id, NOW - HOUR);
      await expect(inProgress(db)).resolves.toMatchObject({ id: second.id, otherCount: 1 });
    });

    it('[IHM-40] [CL-IHM-13] shows nothing once hidden, until a prompt is copied after the owner hid it', async () => {
      const first = await request('p01', 3 * DAY);
      const second = await request('p02', 2 * DAY);
      await copy(first.id, NOW - 2 * HOUR);
      const hiddenAt = toEpochMs(NOW - HOUR);
      await db.transaction(async (tx) =>
        setUiSetting(tx, { key: 'inProgressBannerHiddenAt', value: hiddenAt, expectedVersion: 0 }),
      );

      expect(await inProgress(db)).toBeNull();

      await copy(second.id, hiddenAt);
      expect(await inProgress(db)).toBeNull();

      await copy(second.id, hiddenAt + 1);
      await expect(inProgress(db)).resolves.toMatchObject({ id: second.id, otherCount: 1 });
    });
  });

  describe('the requests of a player', () => {
    it('[BKT-12] gives every request of the player, whatever its status, newest first, and no other player’s', async () => {
      const todo = await request('p01', 2 * DAY);
      const done = await imported('p01', 20 * DAY);
      const canceled = await request('p01', 10 * DAY, {
        status: 'canceled',
        canceledAt: ago(9 * DAY),
      });
      await request('p02', DAY);

      const requests = await requestsOfPlayer(db, leaguePlayerId('p01'));

      expect(requests).toStrictEqual([
        playerRequest(todo, 'to_do', 2 * DAY),
        playerRequest(canceled, 'canceled', 10 * DAY),
        playerRequest(done, 'imported', 20 * DAY),
      ]);
    });

    it('[BKT-12] [BKT-17] breaks a tie of creation instants by the newest identifier first, in the list and in the requests of a player', async () => {
      const first = await imported('p01', 5 * DAY);
      const second = await imported('p01', 5 * DAY);

      const requests = await requestsOfPlayer(db, leaguePlayerId('p01'));
      const imports = await list(db, NOW, { status: 'imported' });

      expect(idsOf(requests)).toStrictEqual([second.id, first.id]);
      expect(idsOf(imports.requests)).toStrictEqual([second.id, first.id]);
    });

    it('[BKT-12] gives nothing for a player without a request, for an unknown player and for a malformed identifier', async () => {
      await insertPlayer(db);

      await expect(requestsOfPlayer(db, leaguePlayerId('p01'))).resolves.toStrictEqual([]);
      await expect(requestsOfPlayer(db, leaguePlayerId('p05'))).resolves.toStrictEqual([]);
      await expect(requestsOfPlayer(db, 'not-a-player')).resolves.toStrictEqual([]);
    });

    it('[BKT-01] derives the origin from the trigger and the kind', async () => {
      await insertPlayer(db);
      const cases = [
        ['detection', 'initial', 'from_detection'],
        ['detection', 'supplement', 'from_detection'],
        ['manual_action', 'initial', 'manual'],
        ['manual_action', 'full_redo', 'manual'],
        ['detection', 'full_redo', 'manual'],
        ['manual_action', 'supplement', 'supplementary'],
        ['type_validated', 'supplement', 'supplementary'],
        ['incomplete_import', 'supplement', 'supplementary'],
      ] as const;
      for (const [index, [trigger, kind]] of cases.entries()) {
        await insertRequest(db, {
          playerId: leaguePlayerId('p01'),
          overrides: {
            trigger,
            kind,
            status: 'imported',
            importedAt: ago(HOUR),
            createdAt: ago((index + 1) * DAY),
            triggerEventTypeId: trigger === 'type_validated' ? MEDIA_STORM : null,
          },
        });
      }

      const requests = await requestsOfPlayer(db, leaguePlayerId('p01'));

      expect(requests.map(({ trigger, kind, origin }) => [trigger, kind, origin])).toStrictEqual(
        cases,
      );
    });
  });
});

import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  followedPlayers,
  games,
  journalEntries,
  playerTeamChanges,
  teams,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, insertLeagueSeason, insertPlayer } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { enterTeamChange, recordTeamChange } from './teams';

import type { TeamEvidence } from './teams';
import type { Database } from '@/lib/db';

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2026, 10, 1);
const day = (offset: number) => toEpochMs(START_MS + offset * DAY_MS);
const UNKNOWN_PLAYER = '00000000-0000-4000-8000-000000000000';
const NOTHING_RECORDED = { ok: true, value: { changed: false, judgment: null } };
const CHANGE_RECORDED = { ok: true, value: { changed: true, judgment: null } };
const VERIFIED = { ok: true, value: { changed: true, judgment: 'verified' } };
// The review's story: his last game is for X; the file reports Y on day 1; the owner enters Z on day 2.
const REVIEW_STORY = '0 ->X observed, 1 X>Y observed, 2 Y>Z entered';

describe('the team changes of a followed player', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let clock: ReturnType<typeof fixedClock>;
  // Four teams of the invented league, and two of its games.
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 0;
  let firstGame = 0;
  let secondGame = 0;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(day(0));
    const restoreClock = installFakeClock(clock);
    await insertLeagueSeason(db, '2024-25');
    const teamRows = await db.select({ id: teams.id }).from(teams).orderBy(asc(teams.id));
    [x = 0, y = 0, z = 0, w = 0] = teamRows.map((team) => team.id);
    const gameRows = await db.select({ id: games.id }).from(games).orderBy(asc(games.id)).limit(2);
    [firstGame = 0, secondGame = 0] = gameRows.map((game) => game.id);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Follows the player on day 0 with `team`, written as the addition does: an entered or an observed row. */
  async function follow(team: number, origin: 'entered' | 'observed' = 'entered') {
    const player = await insertPlayer(db, {
      overrides: { currentTeamId: team, addedAt: new Date(day(0)) },
    });
    playerId = player.id;
    await db.insert(playerTeamChanges).values({
      playerId,
      changedAt: new Date(day(0)),
      previousTeamId: null,
      newTeamId: team,
      origin,
    });
  }

  /** The evidence as a test writes it, whose membership at the entry defaults to none. */
  type EvidenceOfTest = TeamEvidence extends infer E
    ? E extends unknown
      ? Omit<E, 'membershipAtEntry'> & { membershipAtEntry?: number | null }
      : never
    : never;

  /** Records the evidence; `membershipAtEntry` is none unless the test gives it, as for a player who has played no game. */
  async function record(evidence: EvidenceOfTest) {
    return db.transaction(async (tx) =>
      recordTeamChange(tx, playerId, { membershipAtEntry: null, ...evidence }),
    );
  }

  /** The owner enters `team` on day `entryDay`. */
  async function enter(entryDay: number, team: number | null) {
    clock.advance(day(entryDay) - clock.now());
    return db.transaction(async (tx) => enterTeamChange(tx, playerId, team));
  }

  async function history() {
    const rows = await db
      .select()
      .from(playerTeamChanges)
      .where(eq(playerTeamChanges.playerId, playerId))
      .orderBy(asc(playerTeamChanges.changedAt), asc(playerTeamChanges.id));
    return rows.map((row) => ({
      at: row.changedAt.getTime(),
      from: row.previousTeamId,
      to: row.newTeamId,
      origin: row.origin,
      gameId: row.gameId,
    }));
  }

  async function changeAt(index: number) {
    const rows = await history();
    return rows[index];
  }

  async function column(name: 'to' | 'gameId') {
    const rows = await history();
    return rows.map((row) => row[name]);
  }

  async function currentTeam() {
    const [player] = await db
      .select()
      .from(followedPlayers)
      .where(eq(followedPlayers.id, playerId));
    return player?.currentTeamId;
  }

  /** The letter of a team in a story, `-` for none. */
  const letter = (id: number | null) =>
    id === null ? '-' : 'XYZW'.charAt([x, y, z, w].indexOf(id));

  /** A row of a story: `day from>to origin`, then `g1` or `g2` for the game that wrote or judged it. */
  function storyRow(row: Awaited<ReturnType<typeof history>>[number]) {
    const game =
      row.gameId === null
        ? ''
        : ' g'.concat(String([firstGame, secondGame].indexOf(row.gameId) + 1));
    const onDay = String((row.at - START_MS) / DAY_MS);
    return `${onDay} ${letter(row.from)}>${letter(row.to)} ${row.origin}${game}`;
  }

  /** His team history as `day from>to origin`, with the game that wrote or judged a row, then his current team. */
  async function story() {
    const rows = await history();
    const current = letter((await currentTeam()) ?? null);
    return [...rows.map((row) => storyRow(row)), `now ${current}`].join(', ');
  }

  /** The review's story: his last game is for X; the file reports Y on day 1; the owner enters Z on day 2. */
  async function reviewStory() {
    await follow(x, 'observed');
    await record({ teamId: y, at: day(1), membershipAtEntry: x });
    await enter(2, z);
  }

  /** A read of the player file on day `on` that gives `team`, after his last game, for X. */
  async function readFile(on: number, team: number | null) {
    return record({ teamId: team, at: day(on), membershipAtEntry: x });
  }

  describe('observed from a game or from the player file', () => {
    it('[JOU-13] sets the current team and writes an observed change dated by the game, with the previous team', async () => {
      await follow(x, 'observed');

      const result = await record({ teamId: y, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: null } });
      expect(await currentTeam()).toBe(y);
      expect(await story()).toBe('0 ->X observed, 5 X>Y observed g1, now Y');
    });

    it('[CL-JOU-02] records nothing for a game of the current team', async () => {
      await follow(x, 'observed');

      const result = await record({ teamId: x, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await history()).toHaveLength(1);
    });

    it('[CL-JOU-02] lets an older game change nothing, whatever the order the games arrive in', async () => {
      await follow(x, 'observed');
      await record({ teamId: y, at: day(6), gameId: secondGame });

      const older = await record({ teamId: z, at: day(3), gameId: firstGame });
      const sameInstant = await record({ teamId: w, at: day(6), gameId: firstGame });

      expect(older).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(sameInstant).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await currentTeam()).toBe(y);
      expect(await history()).toHaveLength(2);
    });

    it('[JOU-13] writes the same final team when the games arrive from the latest to the oldest', async () => {
      await follow(x, 'observed');

      await record({ teamId: y, at: day(8), gameId: secondGame });
      await record({ teamId: z, at: day(4), gameId: firstGame });
      await record({ teamId: w, at: day(2), gameId: firstGame });

      expect(await currentTeam()).toBe(y);
      expect(await column('to')).toStrictEqual([x, y]);
    });

    it('[JOU-13] dates a change read from the player file by the read instant, with no game', async () => {
      await follow(x, 'observed');

      await record({ teamId: y, at: day(4) });

      expect(await story()).toBe('0 ->X observed, 4 X>Y observed, now Y');
    });

    it('[CL-JOU-20] sets "without team" for a release, and a game after it records a change from none', async () => {
      await follow(x, 'observed');

      await record({ teamId: null, at: day(4) });
      expect(await currentTeam()).toBeNull();
      await record({ teamId: z, at: day(9), gameId: firstGame });

      expect(await currentTeam()).toBe(z);
      expect(await story()).toBe('0 ->X observed, 4 X>- observed, 9 ->Z observed g1, now Z');
    });

    it('[JOU-13] writes the first row of a team history that holds none yet', async () => {
      const player = await insertPlayer(db, { overrides: { currentTeamId: x } });
      playerId = player.id;

      await record({ teamId: y, at: day(5), gameId: firstGame });

      expect(await story()).toBe('5 X>Y observed g1, now Y');
    });

    it('[JOU-13] refuses a player who is not followed', async () => {
      await follow(x, 'observed');

      const result = await db.transaction(async (tx) =>
        recordTeamChange(tx, UNKNOWN_PLAYER, { teamId: y, at: day(5), membershipAtEntry: null }),
      );

      expect(result).toStrictEqual({ ok: false, error: 'player_not_found' });
    });
  });

  describe('the choice made at the addition', () => {
    it('[CL-STA-05] turns the row of the addition observed when a player-file read gives the same team', async () => {
      await follow(x);

      const result = await record({ teamId: x, at: day(2) });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: null } });
      expect(await story()).toBe('0 ->X observed, now X');
    });

    it('[CL-STA-05] leaves the row of the addition entered once a game has judged it', async () => {
      await follow(x);
      await record({ teamId: x, at: day(2), gameId: firstGame });

      await record({ teamId: x, at: day(4) });

      expect(await changeAt(0)).toMatchObject({ origin: 'entered', gameId: firstGame });
    });

    it('[CL-JOU-03] applies a file that gives another team than the choice, then leaves the row entered', async () => {
      await follow(x);

      await record({ teamId: y, at: day(2), membershipAtEntry: z });

      expect(await currentTeam()).toBe(y);
      expect(await story()).toBe('0 ->X entered, 2 X>Y observed, now Y');
    });

    it('[CL-STA-27] records nothing when the file still gives the team of his last game before the addition', async () => {
      await follow(x);

      const result = await record({ teamId: z, at: day(2), membershipAtEntry: z });

      expect(result).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await currentTeam()).toBe(x);
      expect(await history()).toHaveLength(1);
    });

    it('[CL-JOU-03] makes the choice void when his first game is for the team his box scores gave, which is not the choice', async () => {
      await follow(x);

      const result = await record({
        teamId: z,
        at: day(3),
        gameId: firstGame,
        membershipAtEntry: z,
      });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'void' } });
      expect(await currentTeam()).toBe(z);
      expect(await story()).toBe('0 ->X entered, 3 X>Z observed g1, now Z');
    });

    it('[CL-JOU-03] verifies the choice with no change back when the team of his box scores is the choice itself', async () => {
      await follow(x);

      const result = await record({
        teamId: x,
        at: day(3),
        gameId: firstGame,
        membershipAtEntry: x,
      });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'verified' } });
      expect(await story()).toBe('0 ->X entered g1, now X');
    });

    it('[CL-JOU-03] compares a first game with none when he had played no game before the addition', async () => {
      await follow(x);

      const result = await record({ teamId: y, at: day(3), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'unconfirmed' } });
      expect(await currentTeam()).toBe(y);
    });

    it('[CL-JOU-03] ends the choice unconfirmed when his first game is for a third team', async () => {
      await follow(x);

      const result = await record({
        teamId: y,
        at: day(3),
        gameId: firstGame,
        membershipAtEntry: z,
      });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'unconfirmed' } });
      expect(await changeAt(0)).toMatchObject({ origin: 'entered', gameId: null });
    });
  });

  describe('entered by the owner', () => {
    beforeEach(async () => {
      await follow(x, 'observed');
    });

    it('[JOU-13] writes an entered change dated at the entry, with the previous and the new team, not yet verified, and sets the current team', async () => {
      const result = await enter(2, y);

      expect(result).toStrictEqual({ ok: true, value: undefined });
      expect(await currentTeam()).toBe(y);
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, now Y');
    });

    it('[JOU-13] writes one journal entry that names the player, at the entry instant', async () => {
      await enter(2, y);

      const entries = await db.select().from(journalEntries);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        messageKey: 'player_team_change_entered',
        category: 'user_action',
        playerId,
        occurredAt: new Date(day(2)),
      });
    });

    it('[CL-JOU-20] enters a release, which sets "without team" and has no new team', async () => {
      await enter(2, null);

      expect(await currentTeam()).toBeNull();
      expect(await changeAt(1)).toMatchObject({ from: x, to: null, origin: 'entered' });
    });

    it('[JOU-13] refuses the team he already has and an unknown player, writing nothing', async () => {
      const same = await enter(2, x);
      const unknown = await db.transaction(async (tx) => enterTeamChange(tx, UNKNOWN_PLAYER, y));

      expect(same).toStrictEqual({ ok: false, error: 'team_unchanged' });
      expect(unknown).toStrictEqual({ ok: false, error: 'player_not_found' });
      expect(await history()).toHaveLength(1);
      expect(await db.select().from(journalEntries)).toHaveLength(0);
    });

    it('[JOU-13] moves the row version on, so that an open edit screen sees the change', async () => {
      await enter(2, y);

      const [player] = await db
        .select()
        .from(followedPlayers)
        .where(eq(followedPlayers.id, playerId));
      expect(player?.rowVersion).toBe(2);
    });
  });

  describe('judged by the first game after the entry', () => {
    beforeEach(async () => {
      await follow(x, 'observed');
      await enter(2, y);
    });

    it('[CL-JOU-03] shows the change verified by a game for the entered team, with no change back', async () => {
      const result = await record({ teamId: y, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'verified' } });
      expect(await currentTeam()).toBe(y);
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered g1, now Y');
    });

    it('[CL-JOU-03] voids the entry for a game of the team he left: current team back, an observed change back dated by the game', async () => {
      const result = await record({ teamId: x, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'void' } });
      expect(await currentTeam()).toBe(x);
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, 5 Y>X observed g1, now X');
    });

    it('[CL-JOU-03] ends the membership unconfirmed for a game of any other team, and records an observed change to it', async () => {
      const result = await record({ teamId: z, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'unconfirmed' } });
      expect(await currentTeam()).toBe(z);
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, 5 Y>Z observed g1, now Z');
    });

    it('[CL-JOU-03] judges nothing for a game that precedes the entry', async () => {
      const result = await record({ teamId: x, at: day(1), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await currentTeam()).toBe(y);
    });

    it('[CL-JOU-03] judges the change once: a later game for another team is an ordinary change', async () => {
      await record({ teamId: y, at: day(5), gameId: firstGame });

      const result = await record({ teamId: z, at: day(9), gameId: secondGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: null } });
      expect(await changeAt(1)).toMatchObject({ origin: 'entered', gameId: firstGame });
    });

    it('[CL-JOU-03] applies a player-file change first, then compares the game with the team the file gives', async () => {
      await record({ teamId: z, at: day(3) });
      const sameAsFile = await record({ teamId: z, at: day(5), gameId: firstGame });

      expect(sameAsFile).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, 3 Y>Z observed, now Z');
    });

    it('[CL-JOU-03] records a change when the game is not for the team the file gave, the entry staying not yet verified', async () => {
      await record({ teamId: z, at: day(3) });

      const result = await record({ teamId: y, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: null } });
      expect(await currentTeam()).toBe(y);
      expect(await changeAt(1)).toMatchObject({ origin: 'entered', gameId: null });
    });

    it('[CL-STA-27] records nothing when the file still gives the team he left, so it never takes the entry back', async () => {
      const result = await record({ teamId: x, at: day(4), membershipAtEntry: x });

      expect(result).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await currentTeam()).toBe(y);
    });
  });

  describe('releases entered and entries that follow each other', () => {
    it('[CL-JOU-03] voids an entered release for a first game of the team he left', async () => {
      await follow(x, 'observed');
      await enter(2, null);

      const result = await record({ teamId: x, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'void' } });
      expect(await currentTeam()).toBe(x);
      expect(await story()).toBe('0 ->X observed, 2 X>- entered, 5 ->X observed g1, now X');
    });

    it('[CL-JOU-03] records the team of his first game after an entered release, which ends nothing the entry started', async () => {
      await follow(x, 'observed');
      await enter(2, null);

      const result = await record({ teamId: z, at: day(5), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'unconfirmed' } });
      expect(await currentTeam()).toBe(z);
    });

    it('[CL-JOU-03] judges only his latest entered row: the earlier one stays not yet verified', async () => {
      await follow(x, 'observed');
      await enter(2, y);
      await enter(4, z);

      const result = await record({ teamId: z, at: day(6), gameId: firstGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: true, judgment: 'verified' } });
      expect(await column('gameId')).toStrictEqual([null, null, firstGame]);
    });

    it('[CL-STA-27] never lets a file that still gives his last team before the entries take back the second of two entries', async () => {
      await follow(x, 'observed');
      await enter(2, y);
      await enter(4, z);

      const result = await record({ teamId: x, at: day(5), membershipAtEntry: x });

      expect(result).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await currentTeam()).toBe(z);
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, 4 Y>Z entered, now Z');
    });

    it('[CL-STA-05] turns only the row of the addition observed on a same-team file read: an ordinary entered change stays entered', async () => {
      await follow(x, 'observed');
      await enter(2, y);

      const result = await record({ teamId: y, at: day(4), membershipAtEntry: x });

      expect(result).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, now Y');
    });

    it('[CL-JOU-02] ignores a game older than the one that verified the entry, whatever the order they arrive in', async () => {
      await follow(x, 'observed');
      await enter(2, y);
      await db
        .update(games)
        .set({ scheduledStartAt: new Date(day(5)) })
        .where(eq(games.id, firstGame));
      await record({ teamId: y, at: day(5), gameId: firstGame });

      const result = await record({ teamId: z, at: day(4), gameId: secondGame });

      expect(result).toStrictEqual({ ok: true, value: { changed: false, judgment: null } });
      expect(await currentTeam()).toBe(y);
      expect(await history()).toHaveLength(2);
    });
  });

  describe('a stale player file after an entered change', () => {
    it('[CL-JOU-25] [CL-STA-27] [CL-JOU-02] [CL-JOU-03] records nothing for the team of the previous read, and lets his first game judge the entry', async () => {
      await reviewStory();

      expect(await readFile(3, y)).toStrictEqual(NOTHING_RECORDED);
      expect(await story()).toBe(`${REVIEW_STORY}, now Z`);
      expect(
        await record({ teamId: z, at: day(5), gameId: firstGame, membershipAtEntry: x }),
      ).toStrictEqual(VERIFIED);
      expect(await story()).toBe('0 ->X observed, 1 X>Y observed, 2 Y>Z entered g1, now Z');
    });

    it('[CL-JOU-25] [JOU-13] [STA-25] records W, which he has not had since his last game, after which Y again is news', async () => {
      await reviewStory();

      expect([await readFile(3, w), await readFile(4, y)]).toStrictEqual([
        CHANGE_RECORDED,
        CHANGE_RECORDED,
      ]);
      expect(await story()).toBe(`${REVIEW_STORY}, 3 Z>W observed, 4 W>Y observed, now Y`);
    });

    it('[CL-JOU-25] [CL-JOU-20] records a release that no change since his last game gives', async () => {
      await reviewStory();

      expect(await readFile(3, null)).toStrictEqual(CHANGE_RECORDED);
      expect(await story()).toBe(`${REVIEW_STORY}, 3 Z>- observed, now -`);
    });

    it('[CL-JOU-25] [CL-JOU-20] records nothing for a release that an observed release since his last game gave', async () => {
      await follow(x, 'observed');
      await readFile(1, null);
      await enter(2, z);

      expect(await readFile(3, null)).toStrictEqual(NOTHING_RECORDED);
      expect(await story()).toBe('0 ->X observed, 1 X>- observed, 2 ->Z entered, now Z');
    });

    it('[CL-JOU-25] [CL-JOU-20] records a release for a player who has played no game, after an entered change', async () => {
      await follow(x, 'observed');
      await enter(2, y);

      expect(await record({ teamId: null, at: day(3) })).toStrictEqual(CHANGE_RECORDED);
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, 3 Y>- observed, now -');
    });

    it('[CL-JOU-25] [CL-STA-27] records nothing for the team that the first of two entries in a row gave', async () => {
      await follow(x, 'observed');
      await enter(2, y);
      await enter(4, z);

      expect(await readFile(5, y)).toStrictEqual(NOTHING_RECORDED);
      expect(await story()).toBe('0 ->X observed, 2 X>Y entered, 4 Y>Z entered, now Z');
    });

    it('[CL-JOU-25] counts no team older than the change that his last game wrote', async () => {
      await follow(x, 'observed');
      await record({ teamId: w, at: day(1) });
      await record({ teamId: y, at: day(2), gameId: firstGame });
      await enter(3, z);

      expect(await record({ teamId: x, at: day(4), membershipAtEntry: y })).toStrictEqual(
        CHANGE_RECORDED,
      );
      expect(await story()).toBe(
        '0 ->X observed, 1 X>W observed, 2 W>Y observed g1, 3 Y>Z entered, 4 Z>X observed, now X',
      );
    });

    it('[TRV-41] [CL-STA-05] [CL-JOU-02] journals no row written: the addition turned observed, a stale file, a verification, an older game, the same team', async () => {
      await follow(x);
      await record({ teamId: x, at: day(1) });
      await enter(2, y);
      await readFile(3, x);
      await record({ teamId: y, at: day(4), gameId: firstGame });
      await record({ teamId: z, at: day(1), gameId: secondGame });
      await record({ teamId: y, at: day(6) });

      expect(await story()).toBe('0 ->X observed, 2 X>Y entered g1, now Y');
      expect(
        await db.select({ key: journalEntries.messageKey }).from(journalEntries),
      ).toStrictEqual([{ key: 'player_team_change_entered' }]);
    });
  });

  it('[TRV-41] [TRV-42] [JOU-13] journals each observed row, of a player file, a game or a release, naming the player, at the instant the application learns it', async () => {
    await follow(x, 'observed');
    await record({ teamId: y, at: day(1) });
    await record({ teamId: z, at: day(2), gameId: firstGame });
    await record({ teamId: null, at: day(3) });
    const entry = {
      messageKey: 'player_team_change_observed',
      playerId,
      level: 'info',
      category: 'task_pass',
      messageParams: {},
      occurredAt: new Date(day(0)),
    };

    expect(await db.select().from(journalEntries)).toMatchObject([entry, entry, entry]);
  });
});

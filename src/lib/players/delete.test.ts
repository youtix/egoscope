import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  followedPlayers,
  mappingCandidates,
  playerNameVariants,
  playerStatusChanges,
  playerTeamChanges,
  statsSourceMappings,
  teams,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, insertPlayer, profiledPlayer } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { deleteRows } from './delete';
import { withdraw } from './status';

import type { PlayerStatus } from './queries';
import type { Database } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
const ARDEN = '00000000-0000-4000-8000-000000000101';
const BRAM = '00000000-0000-4000-8000-000000000102';
const NOBODY = '00000000-0000-4000-8000-000000000999';

describe('the deletion of a withdrawn player’s rows', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Follows `playerId` with `status` and `rowVersion`, his mapping established. */
  async function follow(playerId: string, status: PlayerStatus, rowVersion = 1) {
    await insertPlayer(db, {
      overrides: { id: playerId, displayName: `Player ${playerId.slice(-3)}`, status, rowVersion },
    });
  }

  /** Deletes the rows of `playerId` in a transaction of its own. */
  async function deleteOf(playerId: string, expectedVersion: number) {
    return db.transaction(async (tx) => deleteRows(tx, playerId, expectedVersion));
  }

  /** Whether `playerId` is still followed. */
  async function isFollowed(playerId: string): Promise<boolean> {
    const rows = await db
      .select({ id: followedPlayers.id })
      .from(followedPlayers)
      .where(eq(followedPlayers.id, playerId));
    return rows.length > 0;
  }

  /** The rows of Arden in each table that his row cascades to. */
  async function cascadedRows() {
    const mappings = await db
      .select({ id: statsSourceMappings.id })
      .from(statsSourceMappings)
      .where(eq(statsSourceMappings.ARDEN, ARDEN));
    const candidates = await db
      .select({ id: mappingCandidates.id })
      .from(mappingCandidates)
      .innerJoin(statsSourceMappings, eq(mappingCandidates.mappingId, statsSourceMappings.id))
      .where(eq(statsSourceMappings.ARDEN, ARDEN));
    return {
      variants: await db.$count(playerNameVariants, eq(playerNameVariants.ARDEN, ARDEN)),
      statusChanges: await db.$count(playerStatusChanges, eq(playerStatusChanges.ARDEN, ARDEN)),
      teamChanges: await db.$count(playerTeamChanges, eq(playerTeamChanges.ARDEN, ARDEN)),
      mappings: mappings.length,
      candidates: candidates.length,
    };
  }

  it('[CA-JOU-15] [JOU-24] refuses the deletion of an active or a paused player with the invitation to withdraw him first, and deletes nothing', async () => {
    await follow(ARDEN, 'active');
    await follow(BRAM, 'paused', 3);

    const outcomes = [await deleteOf(ARDEN, 1), await deleteOf(BRAM, 3)];

    expect(outcomes).toStrictEqual([
      { ok: false, error: { kind: 'not_withdrawn', status: 'active', wayOut: 'withdraw_player' } },
      { ok: false, error: { kind: 'not_withdrawn', status: 'paused', wayOut: 'withdraw_player' } },
    ]);
    expect([await isFollowed(ARDEN), await isFollowed(BRAM)]).toStrictEqual([true, true]);
  });

  it('[JOU-24] [CL-JOU-06] deletes a withdrawn player’s row, whose cascades remove his variants, histories, mapping and candidates, and no other player’s', async () => {
    await follow(ARDEN, 'active');
    await follow(BRAM, 'active');
    const [team] = await db
      .insert(teams)
      .values({ abbreviation: 'HBG', name: 'Harbor Gulls' })
      .returning({ id: teams.id });
    const [mapping] = await db
      .select({ id: statsSourceMappings.id })
      .from(statsSourceMappings)
      .where(eq(statsSourceMappings.playerId, ARDEN));
    await db.insert(playerNameVariants).values({
      playerId: ARDEN,
      kind: 'nickname',
      text: 'The Lantern',
      normalizedText: 'the lantern',
    });
    await db.insert(playerTeamChanges).values({
      playerId: ARDEN,
      changedAt: new Date(START),
      newTeamId: team?.id ?? null,
      origin: 'entered',
    });
    await db.insert(mappingCandidates).values({
      mappingId: mapping?.id ?? 0,
      sourcePlayerRef: 'p09',
      displayName: 'Player 101',
    });
    await db.transaction(async (tx) => withdraw(tx, ARDEN, { expectedVersion: 1 }));
    const before = await cascadedRows();

    const deleted = await deleteOf(ARDEN, 2);

    expect(before).toStrictEqual({
      variants: 1,
      statusChanges: 1,
      teamChanges: 1,
      mappings: 1,
      candidates: 1,
    });
    expect(deleted).toStrictEqual({ ok: true, value: undefined });
    expect(await isFollowed(ARDEN)).toBe(false);
    expect(await cascadedRows()).toStrictEqual({
      variants: 0,
      statusChanges: 0,
      teamChanges: 0,
      mappings: 0,
      candidates: 0,
    });
    expect(await isFollowed(BRAM)).toBe(true);
  });

  it('[JOU-24] fails while an event of his remains, the caller’s transaction rolled back with his row kept', async () => {
    const { player } = await profiledPlayer(db);
    await db.transaction(async (tx) =>
      withdraw(tx, player.id, { expectedVersion: player.rowVersion }),
    );

    const outcome = deleteOf(player.id, player.rowVersion + 1);

    await expect(outcome).rejects.toMatchObject({
      cause: { code: '23001', constraint: 'events_player_id_followed_players_id_fk' },
    });
    expect(await isFollowed(player.id)).toBe(true);
  });

  it('[CL-IHM-18] [CL-IHM-19] refuses a deletion sent with a stale version, with the player as he now stands, and one for a player gone', async () => {
    await follow(ARDEN, 'withdrawn', 4);

    const stale = await deleteOf(ARDEN, 3);
    const gone = await deleteOf(NOBODY, 1);

    expect(stale).toMatchObject({
      ok: false,
      error: {
        kind: 'changed_elsewhere',
        current: { id: ARDEN, status: 'withdrawn', rowVersion: 4 },
      },
    });
    expect(gone).toStrictEqual({ ok: false, error: { kind: 'no_longer_exists' } });
    expect(await isFollowed(ARDEN)).toBe(true);
  });
});

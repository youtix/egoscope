import 'server-only';

import { and, eq } from 'drizzle-orm';

import { followedPlayers } from '@/lib/db';
import { err, ok } from '@/lib/result';

import { get } from './queries';
import { staleRefusal } from './status';

import type { PlayerStatus } from './queries';
import type { StaleRefusal } from './status';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

/** The deletion of an active or paused player's data, refused: withdraw him first (JOU-24, CA-JOU-15). */
export type NotWithdrawn = Readonly<{
  kind: 'not_withdrawn';
  status: PlayerStatus;
  wayOut: 'withdraw_player';
}>;

/** Why the deletion of a player's rows is refused. */
export type DeleteRowsRefusal = NotWithdrawn | StaleRefusal;

/**
 * Deletes the `followed_players` row of the withdrawn player `playerId` in the caller's
 * transaction `tx`, whose cascades remove his variants, status and team histories, mappings
 * and candidates and the other rows that hang on him (JOU-24, CL-JOU-06): the last step of
 * `withdrawal.deletePlayerData`, which erases every event of his first; while one remains,
 * its restrict key makes the delete fail. Refused for an active or paused player, with the
 * invitation to withdraw him first (CA-JOU-15), and when the screen showed an older version
 * (CL-IHM-18). The deletion's journal entry is the caller's, without his name.
 */
export async function deleteRows(
  tx: Transaction,
  playerId: string,
  expectedVersion: number,
): Promise<Result<undefined, DeleteRowsRefusal>> {
  // One statement decides and deletes; a refusal then reads why, his version first.
  const deleted = await tx
    .delete(followedPlayers)
    .where(
      and(
        eq(followedPlayers.id, playerId),
        eq(followedPlayers.rowVersion, expectedVersion),
        eq(followedPlayers.status, 'withdrawn'),
      ),
    )
    .returning({ id: followedPlayers.id });
  if (deleted.length > 0) {
    return ok(undefined);
  }
  const player = await get(tx, playerId);
  return err(
    player?.rowVersion === expectedVersion
      ? { kind: 'not_withdrawn', status: player.status, wayOut: 'withdraw_player' }
      : staleRefusal(player),
  );
}

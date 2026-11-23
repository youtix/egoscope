import { desc, eq, sql } from 'drizzle-orm';

import { followedPlayers, games, playerTeamChanges } from '@/lib/db';
import { record } from '@/lib/journal';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import type { FollowedPlayerRow, PlayerTeamChangeRow } from './types';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

/** What the source gives of a player's team, and when it gave it. */
type EvidenceBase = Readonly<{
  /**
   * His membership at the entry instant as his box scores give it: the team of his last
   * game played before the latest entry, none if he has played none. Players never reads
   * box scores, so games passes it, always. A player file that still gives it never takes
   * the entry back (CL-STA-27), and a first game for it, for the row written at the
   * addition, which has no previous team of its own, voids that row (CL-JOU-03).
   */
  membershipAtEntry: number | null;
}>;

/** The team of a game he played, dated by that game's scheduled start (CL-JOU-02). */
export type GameEvidence = EvidenceBase & Readonly<{ teamId: number; at: EpochMs; gameId: number }>;

/** The team of the source's current-season player file (none for a release), dated by the read instant. */
export type PlayerFileEvidence = EvidenceBase &
  Readonly<{ teamId: number | null; at: EpochMs; gameId?: undefined }>;

/** What the statistics ingestion of games observed of a player's team (CL-STA-27). */
export type TeamEvidence = GameEvidence | PlayerFileEvidence;

/** What a game judged of the entered change that was waiting for it (CL-JOU-03). */
export type TeamJudgment = 'verified' | 'void' | 'unconfirmed';

/** What `recordTeamChange` did: whether the history moved, and the judgment of the entered change, if any. */
export type TeamChangeOutcome = Readonly<{ changed: boolean; judgment: TeamJudgment | null }>;

/** No player is followed under that identifier. */
export type PlayerNotFound = 'player_not_found';

/** The owner entered the team the player already has. */
export type TeamUnchanged = 'team_unchanged';

const UNCHANGED: TeamChangeOutcome = { changed: false, judgment: null };

async function findPlayer(
  tx: Transaction,
  playerId: string,
): Promise<FollowedPlayerRow | undefined> {
  // Locked, so that a games unit and the edit screen never both read a team before either writes.
  const [player] = await tx
    .select()
    .from(followedPlayers)
    .where(eq(followedPlayers.id, playerId))
    .for('update');
  return player;
}

async function latestChange(
  tx: Transaction,
  playerId: string,
): Promise<PlayerTeamChangeRow | undefined> {
  const [latest] = await tx
    .select()
    .from(playerTeamChanges)
    .where(eq(playerTeamChanges.playerId, playerId))
    .orderBy(desc(playerTeamChanges.changedAt), desc(playerTeamChanges.id))
    .limit(1);
  return latest;
}

/**
 * The instant after which evidence counts as recent: the latest change's, or the scheduled
 * start of the game that verified it if later, since a verification leaves `changed_at` at
 * the entry (CL-JOU-02).
 */
async function recencyInstant(tx: Transaction, latest: PlayerTeamChangeRow): Promise<number> {
  const verifying =
    latest.gameId === null
      ? []
      : await tx
          .select({ start: games.scheduledStartAt })
          .from(games)
          .where(eq(games.id, latest.gameId));
  return Math.max(latest.changedAt.getTime(), ...verifying.map((game) => game.start.getTime()));
}

/** Sets his current team; the row's version moves on, so that an open edit screen sees the change (CL-IHM-18). */
async function setCurrentTeam(tx: Transaction, playerId: string, teamId: number | null) {
  await tx
    .update(followedPlayers)
    .set({ currentTeamId: teamId, rowVersion: sql`${followedPlayers.rowVersion} + 1` })
    .where(eq(followedPlayers.id, playerId));
}

/** Writes an observed change from his current team to `teamId` and makes it his current team. */
async function observe(
  tx: Transaction,
  player: FollowedPlayerRow,
  evidence: TeamEvidence,
): Promise<void> {
  await tx.insert(playerTeamChanges).values({
    playerId: player.id,
    changedAt: new Date(evidence.at),
    previousTeamId: player.currentTeamId,
    newTeamId: evidence.teamId,
    origin: 'observed',
    gameId: evidence.gameId ?? null,
  });
  await setCurrentTeam(tx, player.id, evidence.teamId);
}

/** Says whether `row` is an entered change that no game has judged yet and that no later row follows (CL-JOU-03). */
function isWaitingForGame(row: PlayerTeamChangeRow): boolean {
  return row.origin === 'entered' && row.gameId === null;
}

/** An entered change that waits for his first game, and the player it belongs to. */
type WaitingChange = Readonly<{ player: FollowedPlayerRow; entered: PlayerTeamChangeRow }>;

/** Says whether `row` is the one written at the addition, dated `added_at` (CL-STA-05). */
function isAdditionRow(row: PlayerTeamChangeRow, player: FollowedPlayerRow): boolean {
  return row.changedAt.getTime() === player.addedAt.getTime();
}

/**
 * Applies the evidence to the entered change that waits for its first game: a game
 * verifies it, voids it or ends its membership unconfirmed; the player file turns the
 * addition's row observed when it gives the same team, and records nothing when it
 * still gives the team he left (CL-JOU-03, CL-STA-05, CL-STA-27). Gives nothing when
 * the ordinary rule applies.
 */
async function judge(
  tx: Transaction,
  { player, entered }: WaitingChange,
  evidence: TeamEvidence,
): Promise<TeamChangeOutcome | undefined> {
  const isAddition = isAdditionRow(entered, player);
  if (evidence.gameId === undefined) {
    if (isAddition && evidence.teamId === entered.newTeamId) {
      await tx
        .update(playerTeamChanges)
        .set({ origin: 'observed' })
        .where(eq(playerTeamChanges.id, entered.id));
      return { changed: true, judgment: null };
    }
    // A file never takes an entry back: it still gives the team of his last game before it.
    return evidence.teamId === evidence.membershipAtEntry ? UNCHANGED : undefined;
  }
  if (evidence.teamId === entered.newTeamId) {
    await tx
      .update(playerTeamChanges)
      .set({ gameId: evidence.gameId })
      .where(eq(playerTeamChanges.id, entered.id));
    return { changed: true, judgment: 'verified' };
  }
  // The team he left: for the row of the addition his membership then, else its previous team.
  const left = isAddition ? evidence.membershipAtEntry : entered.previousTeamId;
  await observe(tx, player, evidence);
  return { changed: true, judgment: evidence.teamId === left ? 'void' : 'unconfirmed' };
}

/**
 * Records what the statistics ingestion observed of a player's team, in the caller's
 * transaction `tx` (JOU-13, CL-JOU-02, CL-JOU-03, CL-STA-05, CL-STA-27). The current
 * team is set, and an observed change written (date of the first game with the new
 * team or the read instant, previous team, new team), only when the evidence is more
 * recent than the latest recorded change and the team differs, so an older game changes
 * nothing whatever the order seasons are fetched in. The first game after an entered
 * change judges it, as the result says, so that games requests the calendar derivation
 * when it is `void` or `unconfirmed`; a player file that gives
 * `membershipAtEntry` records nothing, and the row written at the addition is judged
 * against it. The module writes player tables only (JOU-14), and the closed
 * list of the journal holds no message for an observed change, so it writes no entry.
 */
export async function recordTeamChange(
  tx: Transaction,
  playerId: string,
  evidence: TeamEvidence,
): Promise<Result<TeamChangeOutcome, PlayerNotFound>> {
  const player = await findPlayer(tx, playerId);
  if (player === undefined) {
    return err('player_not_found');
  }
  const latest = await latestChange(tx, playerId);
  if (latest !== undefined && evidence.at <= (await recencyInstant(tx, latest))) {
    return ok(UNCHANGED);
  }
  const judged =
    latest !== undefined && isWaitingForGame(latest)
      ? await judge(tx, { player, entered: latest }, evidence)
      : undefined;
  if (judged !== undefined) {
    return ok(judged);
  }
  if (evidence.teamId === player.currentTeamId) {
    return ok(UNCHANGED);
  }
  await observe(tx, player, evidence);
  return ok({ changed: true, judgment: null });
}

/**
 * Records a team change that the owner enters, in the caller's transaction `tx`
 * (JOU-13, CL-JOU-03, CL-JOU-20): dated at the entry instant, with the previous team,
 * the new team (none for a release) and the mark "not yet verified" (no game), and sets
 * the current team, "without team" for a release. The first official game he plays
 * after it judges it, in `recordTeamChange`. One journal entry names the change; the
 * caller requests the calendar derivation with the cause `team_change_entered` in the
 * same transaction (CL-TAX-19). Entering his current team changes nothing and is refused.
 */
export async function enterTeamChange(
  tx: Transaction,
  playerId: string,
  teamId: number | null,
): Promise<Result<undefined, PlayerNotFound | TeamUnchanged>> {
  const player = await findPlayer(tx, playerId);
  if (player === undefined) {
    return err('player_not_found');
  }
  if (player.currentTeamId === teamId) {
    return err('team_unchanged');
  }
  const entryInstant = now();
  await tx.insert(playerTeamChanges).values({
    playerId,
    changedAt: new Date(entryInstant),
    previousTeamId: player.currentTeamId,
    newTeamId: teamId,
    origin: 'entered',
  });
  await setCurrentTeam(tx, playerId, teamId);
  await record(tx, {
    messageKey: 'player_team_change_entered',
    playerId,
    occurredAt: entryInstant,
  });
  return ok(undefined);
}

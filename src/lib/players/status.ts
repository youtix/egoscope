import 'server-only';

import { and, eq, isNull, lt, or } from 'drizzle-orm';

import { followedPlayers, playerStatusChanges, updateVersioned } from '@/lib/db';
import { record } from '@/lib/journal';
import { changedElsewhere, err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { fullListUnderLock } from './add';
import { get, statusGates } from './queries';

import type { MaximumReached } from './add';
import type { PlayerDetail, PlayerStatus } from './queries';
import type { PlayerNotFound } from './teams';
import type { PlayerStatusChangeRow } from './types';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

/** The optional reason of a status change, one list for every change (JOU-15, H-JOU-06, CL-JOU-12). */
export type PlayerStatusChangeReason = NonNullable<PlayerStatusChangeRow['reason']>;

/** A status change as the owner confirms it on the player page. */
export type StatusChange = Readonly<{
  /** The `row_version` that the screen showed (CL-IHM-18). */
  expectedVersion: number;
  /** None is required (CL-JOU-12). */
  reason?: PlayerStatusChangeReason;
}>;

/** A change that JOU-15 does not allow from the player's status, withdrawn to paused say. */
export type TransitionNotAllowed = Readonly<{
  kind: 'transition_not_allowed';
  from: PlayerStatus;
  to: PlayerStatus;
}>;

/** Why an owner's write to a player is refused: changed elsewhere, or gone (CL-IHM-18, CL-IHM-19). */
export type StaleRefusal = ChangedElsewhere<PlayerDetail> | NoLongerExists;

/** Why a pause or a withdrawal is refused. */
export type StatusRefusal = TransitionNotAllowed | StaleRefusal;

/** Why a reactivation is refused: as a pause, or a full list, as for an addition (JOU-20). */
export type ReactivationRefusal = StatusRefusal | MaximumReached;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };

// The statuses that each status can be reached from, by the owner alone (JOU-15, JOU-22):
// the five transitions, withdrawn to paused not among them.
const REACHABLE_FROM = {
  active: ['paused', 'withdrawn'],
  paused: ['active'],
  withdrawn: ['active', 'paused'],
} as const satisfies Readonly<Record<PlayerStatus, readonly PlayerStatus[]>>;

// The journal entry of each status reached.
const STATUS_MESSAGES = {
  active: 'player_reactivated',
  paused: 'player_paused',
  withdrawn: 'player_withdrawn',
} as const satisfies Readonly<Record<PlayerStatus, string>>;

/**
 * The refusal of an owner's write to a player who is gone, or whose version is not the one
 * the screen showed: the player as he now stands (CL-IHM-18, CL-IHM-19).
 */
export function staleRefusal(current: PlayerDetail | null): StaleRefusal {
  return current === null ? NO_LONGER_EXISTS : changedElsewhere(current);
}

/** Whether JOU-15 allows a change from `from` to `to`. */
function isAllowed(from: PlayerStatus, to: PlayerStatus): boolean {
  const sources: readonly PlayerStatus[] = REACHABLE_FROM[to];
  return sources.includes(from);
}

/**
 * The player `playerId` if the screen showed his current version and JOU-15 allows his
 * change to `to`: the stale refusal first, so that the screen shows where he now stands.
 */
async function allowedChange(
  tx: Transaction,
  playerId: string,
  { to, expectedVersion }: Readonly<{ to: PlayerStatus; expectedVersion: number }>,
): Promise<Result<PlayerDetail, StatusRefusal>> {
  const player = await get(tx, playerId);
  if (player?.rowVersion !== expectedVersion) {
    return err(staleRefusal(player));
  }
  return isAllowed(player.status, to)
    ? ok(player)
    : err({ kind: 'transition_not_allowed', from: player.status, to });
}

/** Writes the status `to` of `before`, its dated history row and its journal entry. */
async function writeStatus(
  tx: Transaction,
  before: PlayerDetail,
  { to, change }: Readonly<{ to: PlayerStatus; change: StatusChange }>,
): Promise<Result<undefined, StaleRefusal>> {
  const saved = await updateVersioned(tx, followedPlayers, {
    where: eq(followedPlayers.id, before.id),
    expectedVersion: change.expectedVersion,
    set: { status: to },
  });
  if (!saved.ok) {
    // Saved elsewhere between the read and the write: the player as he now stands.
    return err(staleRefusal(await get(tx, before.id)));
  }
  await tx.insert(playerStatusChanges).values({
    playerId: before.id,
    changedAt: new Date(now()),
    fromStatus: before.status,
    toStatus: to,
    reason: change.reason ?? null,
  });
  await record(tx, { messageKey: STATUS_MESSAGES[to], playerId: before.id });
  return ok(undefined);
}

/** Moves `playerId` to `to` if the screen showed his current version and JOU-15 allows it. */
async function changeStatus(
  tx: Transaction,
  playerId: string,
  { to, change }: Readonly<{ to: PlayerStatus; change: StatusChange }>,
): Promise<Result<undefined, StatusRefusal>> {
  const before = await allowedChange(tx, playerId, { to, expectedVersion: change.expectedVersion });
  return before.ok ? writeStatus(tx, before.value, { to, change }) : err(before.error);
}

/**
 * Pauses the active player `playerId` in the caller's transaction `tx` (JOU-15, JOU-17):
 * a dated status change with its optional reason, and a journal entry. Refused from any
 * other status, or when the screen showed an older version (CL-IHM-18). What a paused
 * player keeps is `statusGates('paused')`.
 */
export async function pause(
  tx: Transaction,
  playerId: string,
  change: StatusChange,
): Promise<Result<undefined, StatusRefusal>> {
  return changeStatus(tx, playerId, { to: 'paused', change });
}

/**
 * Withdraws the active or paused player `playerId` in the caller's transaction `tx`
 * (JOU-15, JOU-19, JOU-23): a dated status change with its optional reason, "end of
 * career" and "left the NBA" among them, and a journal entry. Every row of his stays:
 * identity, events, cases, profiles and past requests. Refused from withdrawn, or when the
 * screen showed an older version (CL-IHM-18). The withdraw action cancels his requests to
 * do itself (BKT-14), since backtests sits above players.
 */
export async function withdraw(
  tx: Transaction,
  playerId: string,
  change: StatusChange,
): Promise<Result<undefined, StatusRefusal>> {
  return changeStatus(tx, playerId, { to: 'withdrawn', change });
}

/**
 * Reactivates the paused or withdrawn player `playerId` in the caller's transaction `tx`
 * (JOU-15, JOU-20, CL-JOU-12): refused like an addition while `players.maxActive` players
 * are active, with the same maximum and ways out (JOU-05), under the same lock; otherwise
 * a dated status change with its optional reason, and a journal entry. No backtest request
 * and no derivation request: the next regular derivation covers the gap from his
 * `last_calendar_derivation_at` (CL-TAX-19). Refused from active, or when the screen showed
 * an older version (CL-IHM-18), its version checked again once the lock is held, so that of
 * two reactivations of his at once the second sees the first as a change made elsewhere.
 */
export async function reactivate(
  tx: Transaction,
  playerId: string,
  change: StatusChange,
): Promise<Result<undefined, ReactivationRefusal>> {
  const to = 'active';
  const before = await allowedChange(tx, playerId, { to, expectedVersion: change.expectedVersion });
  if (!before.ok) {
    return err(before.error);
  }
  const full = await fullListUnderLock(tx);
  // Checked again under the lock: another reactivation of his may have filled the list meanwhile.
  const locked = await get(tx, playerId);
  if (locked?.rowVersion !== change.expectedVersion) {
    return err(staleRefusal(locked));
  }
  return full === undefined ? writeStatus(tx, locked, { to, change }) : err(full);
}

/**
 * Records that the owner declined the suggestion to pause `playerId`, now, in the caller's
 * transaction `tx` (JOU-22): the to-do list shows it again only after a new game played and
 * a new prolonged absence. Journals it. Refused when the screen showed an older version
 * (CL-IHM-18), and, as a transition not allowed to paused, for a player whose status has no
 * pause suggestion, a paused or a withdrawn one (`statusGates`, CL-JOU-05).
 */
export async function declinePauseSuggestion(
  tx: Transaction,
  playerId: string,
  expectedVersion: number,
): Promise<Result<undefined, StatusRefusal>> {
  const player = await get(tx, playerId);
  if (player?.rowVersion !== expectedVersion) {
    return err(staleRefusal(player));
  }
  if (!statusGates(player.status).pauseSuggestion) {
    return err({ kind: 'transition_not_allowed', from: player.status, to: 'paused' });
  }
  const saved = await updateVersioned(tx, followedPlayers, {
    where: eq(followedPlayers.id, playerId),
    expectedVersion,
    set: { pauseSuggestionDeclinedAt: new Date(now()) },
  });
  if (!saved.ok) {
    return err(staleRefusal(await get(tx, playerId)));
  }
  await record(tx, { messageKey: 'pause_suggestion_declined', playerId });
  return ok(undefined);
}

/**
 * Notes, in the caller's transaction `tx`, the instant `at` of a regular calendar derivation
 * run of `playerId`, which `calendar-events` calls at the end of each run of an active or
 * paused player (CL-JOU-05, CL-TAX-19): `last_calendar_derivation_at` never moves back, so
 * that after a withdrawal and a reactivation the next run covers the gap. A scheduled write
 * the owner does not edit: his row version stays. A withdrawn player, whose
 * `calendarDerivation` gate is false, is refused as a transition not allowed, from and to
 * his status since a run moves none, and nothing is written: `calendar-events` then
 * abandons his run.
 */
export async function recordDerivationRun(
  tx: Transaction,
  playerId: string,
  at: EpochMs,
): Promise<Result<undefined, PlayerNotFound | TransitionNotAllowed>> {
  // Locked, so that a withdrawal waits for the run that it would stop.
  const [player] = await tx
    .select({ status: followedPlayers.status })
    .from(followedPlayers)
    .where(eq(followedPlayers.id, playerId))
    .for('update');
  if (player === undefined) {
    return err('player_not_found');
  }
  if (!statusGates(player.status).calendarDerivation) {
    return err({ kind: 'transition_not_allowed', from: player.status, to: player.status });
  }
  const ranAt = new Date(at);
  const column = followedPlayers.lastCalendarDerivationAt;
  const earlierOrNone = or(isNull(column), lt(column, ranAt));
  await tx
    .update(followedPlayers)
    .set({ lastCalendarDerivationAt: ranAt })
    .where(and(eq(followedPlayers.id, playerId), earlierOrNone));
  return ok(undefined);
}

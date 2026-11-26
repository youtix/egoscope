import 'server-only';

import { and, arrayContained, arrayContains, asc, eq, lt, sql } from 'drizzle-orm';

import {
  caseHistoryEntries,
  caseReviewFlags,
  cases,
  events,
  games,
  recalculationJobs,
} from '@/lib/db';

import type { CaseRow } from './types';
import type { Transaction } from '@/lib/db';
import type { CaseId } from '@/lib/stats-engine';

/**
 * The operation that erases an event with a withdrawal's scope (sensitive-data.md section 2.1):
 * a withdrawal, an erasure by requalification or split, a player-data deletion, or a
 * restore's re-application of the ledger.
 */
export type ErasureCause =
  | 'withdrawal'
  | 'requalification_erasure'
  | 'split_erasure'
  | 'player_deletion'
  | 'restore_reapplication';

/**
 * The causes whose erasure rebuilds a case that keeps other events: every one but a
 * player-data deletion, which erases every case of the player (CL-SUI-17). A restore's
 * re-application withdraws an event again, or deletes a player again, whose last event then
 * takes the case.
 */
const REBUILDING_CAUSES: ReadonlySet<ErasureCause> = new Set([
  'withdrawal',
  'requalification_erasure',
  'split_erasure',
  'restore_reapplication',
]);

/** The earliest-recorded event of the case, with what its case's origin depends on. */
async function earliestEventOf(tx: Transaction, caseId: CaseId) {
  const [earliest] = await tx
    .select({
      id: events.id,
      origin: events.origin,
      // Compared in the database, whose instants are finer than a JavaScript date.
      isBeforeDerivedGame: sql<boolean>`coalesce(${events.createdAt} < ${games.scheduledStartAt}, false)`,
    })
    .from(events)
    .leftJoin(games, eq(games.id, events.derivedGameId))
    .where(eq(events.caseId, caseId))
    .orderBy(asc(events.createdAt), asc(events.id))
    .limit(1);
  return earliest;
}

type EarliestEvent = NonNullable<Awaited<ReturnType<typeof earliestEventOf>>>;

/**
 * The origin that a case takes from its first-recorded event (SUI-05, SUI-07, CL-VUE-13):
 * tracked for a detected event, and for a calendar-derived one created before its game's
 * scheduled start; historical otherwise.
 */
function caseOriginOf({ origin, isBeforeDerivedGame }: EarliestEvent): CaseRow['origin'] {
  const isTracked = origin === 'detected' || (origin === 'calendar' && isBeforeDerivedGame);
  return isTracked ? 'tracked' : 'historical';
}

/**
 * Rebuilds the case as if the erased event had never been recorded (CL-SUI-17): the origin
 * and creation instant of its earliest-recorded remaining event, and none of its history
 * rows or review flags from before that instant. Its manual decisions stay, and it writes no
 * history row: the recalculation that follows records any change.
 */
async function rebuild(tx: Transaction, caseId: CaseId, earliest: EarliestEvent): Promise<void> {
  await tx
    .update(cases)
    .set({
      origin: caseOriginOf(earliest),
      createdAt: sql`(select ${events.createdAt} from ${events} where ${events.id} = ${earliest.id})`,
    })
    .where(eq(cases.id, caseId));
  const createdAt = sql`(select ${cases.createdAt} from ${cases} where ${cases.id} = ${caseId})`;
  await tx
    .delete(caseHistoryEntries)
    .where(
      and(eq(caseHistoryEntries.caseId, caseId), lt(caseHistoryEntries.recordedAt, createdAt)),
    );
  await tx
    .delete(caseReviewFlags)
    .where(and(eq(caseReviewFlags.caseId, caseId), lt(caseReviewFlags.raisedAt, createdAt)));
}

/**
 * The sensitivity step of an event's erasure (sensitive-data.md section 2.1, step 9), in
 * the caller's transaction `tx`, once `events.eraseEvent` has deleted the event and given
 * its case `caseId`, null when it had none. It locks the case row first, and does nothing
 * more when the case is already gone; otherwise the case, when no event is left in it, is
 * deleted with its criteria, flags, decisions and history (DSN-27, JOU-24); otherwise,
 * unless `cause` is a player-data deletion, it is rebuilt from its remaining events
 * (CL-SUI-17). No sensitivity row names an event, so none designates it afterwards
 * (CL-TRV-10); the recalculation that follows is the caller's.
 */
export async function eraseEventData(
  tx: Transaction,
  caseId: CaseId | null,
  cause: ErasureCause,
): Promise<void> {
  if (caseId === null) {
    return;
  }
  // The transaction has locked its event row by deleting it (`events.eraseEvent`, step 8 of
  // sensitive-data.md section 2.1) and locks the case row now (step 9). Two transactions that
  // each erase one event take the two in that order, so neither waits for the other: a second
  // erasure in the case waits here for the first to commit, then reads the events left, so
  // the last one deletes it. A transaction that erases several events (a player-data deletion,
  // section 2.2 step 1, a requalification or split, a restore's re-application) must lock all
  // its event rows, in ascending id, before its first case lock: erasing them one by one would
  // hold a case row while it waits for an event row that a one-event erasure in the same case
  // holds, and the one-event erasure then waits for that case row, a deadlock.
  const [locked] = await tx
    .select({ id: cases.id })
    .from(cases)
    .where(eq(cases.id, caseId))
    .for('update');
  if (locked === undefined) {
    return;
  }
  const earliest = await earliestEventOf(tx, caseId);
  if (earliest === undefined) {
    // No event names the case any more, so its events' restrict key lets it go.
    await tx.delete(cases).where(eq(cases.id, caseId));
  } else if (REBUILDING_CAUSES.has(cause)) {
    await rebuild(tx, caseId, earliest);
  }
}

/**
 * Takes the deleted player `playerId` out of the pending and running recalculation jobs,
 * a job running between two of its chunks included, in the caller's transaction `tx`, and
 * deletes a job left with no player, so that no job keeps his identifier (JOU-24,
 * CL-JOU-06; sensitive-data.md section 2.2, step 4). A full job names no player.
 */
export async function erasePlayerJobs(tx: Transaction, playerId: string): Promise<void> {
  const namesHim = arrayContains(recalculationJobs.playerIds, [playerId]);
  await tx
    .delete(recalculationJobs)
    .where(and(namesHim, arrayContained(recalculationJobs.playerIds, [playerId])));
  await tx
    .update(recalculationJobs)
    .set({ playerIds: sql`array_remove(${recalculationJobs.playerIds}, ${playerId}::uuid)` })
    .where(namesHim);
}

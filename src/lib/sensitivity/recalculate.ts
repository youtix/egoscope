import { sql } from 'drizzle-orm';

import { recalculationJobs } from '@/lib/db';
import { now } from '@/lib/time';
import { wakeAt } from '@/lib/wake-plan';

import type { NewRecalculationJobRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { StatisticsUpdateScope } from '@/lib/games';

type Reader = Database | Transaction;

/** One of the causes of CL-SEN-17: the one cause that a job, and each verdict change it records, carries. */
export type RecalculationCause = NewRecalculationJobRow['cause'];

/** A recalculation of the whole base: every case, profile and trend (SEN-34, item d). */
export type FullScope = Readonly<{ kind: 'full' }>;

/**
 * A recalculation of the cases of some players: an import (SEN-34, item a) or a change of an
 * event or a case (item c). With no `eventTypeIds`, it concerns every type of those players.
 */
export type PlayersScope = Readonly<{
  kind: 'import' | 'event_or_case_change';
  playerIds: readonly string[];
  eventTypeIds?: readonly string[];
}>;

/** What a recalculation job concerns, as one of the scopes of SEN-34, items a to d. */
export type RecalculationScope = FullScope | PlayersScope | StatisticsUpdateScope;

// The task that processes the jobs (module map section 1.9).
const RECALCULATION_TASK = 'recalculation';

function jobOf(scope: RecalculationScope, cause: RecalculationCause): NewRecalculationJobRow {
  if (scope.kind === 'full') {
    return { scope: 'full', cause };
  }
  if (scope.kind === 'statistics_update') {
    return {
      scope: 'statistics_update',
      cause,
      playerIds: [...scope.playerIds],
      gameIds: [...scope.gameIds],
    };
  }
  return {
    scope: scope.kind,
    cause,
    playerIds: [...scope.playerIds],
    eventTypeIds: scope.eventTypeIds === undefined ? null : [...scope.eventTypeIds],
  };
}

/**
 * Records a pending recalculation job in the caller's transaction `tx`, the one of the
 * change that calls for it, with its scope (import, statistics update, event or case
 * change, or full: SEN-34, items a to d), its players, types and games, and its one cause
 * (SEN-37, CL-SEN-16, CL-SEN-17). Jobs run one at a time in the order recorded, and jobs
 * are never merged, since a verdict-history entry carries exactly one cause. A scope that
 * names no player concerns no case, so it records nothing. A rollback of `tx` leaves no
 * job; the wake of the recalculation task, a write to the wake plan outside the
 * transaction that `wakeAt` gives no way to join, may outlive it, and then a tick finds no
 * job due. A wake that the cache loses delays the job until the hourly check at most
 * (TRV-31), so its outcome is no failure of the request. Nothing recalculates inline:
 * a caller that wants its job run at once calls `scheduler.requestRun("recalculation")`
 * once `tx` has committed.
 */
export async function requestRecalculation(
  tx: Transaction,
  scope: RecalculationScope,
  cause: RecalculationCause,
): Promise<void> {
  if (scope.kind !== 'full' && scope.playerIds.length === 0) {
    return;
  }
  await tx.insert(recalculationJobs).values(jobOf(scope, cause));
  await wakeAt(now(), RECALCULATION_TASK);
}

/**
 * Whether a pending or running job covers a player's profile of an event type, or the
 * general trend of that type: a full job covers everything, a job of explicit types covers
 * the trend of each, and a job of players covers their profiles of those types, or of every
 * type when it names none. While it does, the screens show "recalculation in progress"
 * next to the last values (SEN-36, CL-SEN-16). A job ends by being deleted, so every
 * recorded job counts.
 */
export async function isRecalculating(
  db: Reader,
  playerId: string,
  eventTypeId: string,
): Promise<boolean> {
  const [covering] = await db
    .select({ id: recalculationJobs.id })
    .from(recalculationJobs)
    .where(
      sql`${recalculationJobs.scope} = 'full'
        OR ${eventTypeId} = ANY(${recalculationJobs.eventTypeIds})
        OR (${recalculationJobs.eventTypeIds} IS NULL AND ${playerId} = ANY(${recalculationJobs.playerIds}))`,
    )
    .limit(1);
  return covering !== undefined;
}

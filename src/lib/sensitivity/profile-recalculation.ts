// Whether a recalculation job covers a player's profile of a type, the notice of the
// profile alone (domain model 2.2, CL-SEN-16); the trend's is `isRecalculating`'s.
import { sql } from 'drizzle-orm';

import { recalculationJobs } from '@/lib/db';

import type { Database, Transaction } from '@/lib/db';

type Reader = Database | Transaction;

/**
 * Whether a pending or running job covers the player's profile of the type (SEN-36,
 * CL-SEN-16, domain model 2.2): a full job, or a job naming the player that names no
 * type, or names this one among its types. A job of other players covers the trends of
 * their types, never this profile. A job ends by being deleted, so every recorded job
 * counts.
 */
export async function isProfileRecalculating(
  db: Reader,
  { playerId, eventTypeId }: Readonly<{ playerId: string; eventTypeId: string }>,
): Promise<boolean> {
  const [covering] = await db
    .select({ id: recalculationJobs.id })
    .from(recalculationJobs)
    .where(
      sql`${recalculationJobs.scope} = 'full'
        OR (${playerId} = ANY(${recalculationJobs.playerIds}) AND (
          ${recalculationJobs.eventTypeIds} IS NULL
          OR ${eventTypeId} = ANY(${recalculationJobs.eventTypeIds})
        ))`,
    )
    .limit(1);
  return covering !== undefined;
}

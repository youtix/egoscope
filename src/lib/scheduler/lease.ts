// The pass lease, the one `scheduler_lease` row that every pass takes, scheduled, on demand
// or at opening, so that two passes never run side by side (TRV-28, CL-TRV-07). It is a
// row and not a lock: the pooled connection keeps no session, and a lock held in one
// transaction would not span the several transactions of a pass.
import { eq, isNull, lte, sql } from 'drizzle-orm';

import { schedulerLease } from '@/lib/db';

import { STALE_AFTER_MS } from './limits';

import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/** The lease taken by a pass, or held by another one that has not expired. */
export type LeaseTaking = Readonly<{ ok: true }> | Readonly<{ ok: false; error: LeaseHeld }>;

/** Why a pass did not run: another pass holds the lease. */
export type LeaseHeld = Readonly<{ kind: 'lease_held' }>;

const LEASE_ID = 1;

const HELD: LeaseTaking = { ok: false, error: { kind: 'lease_held' } };

/**
 * Takes the lease for pass `passId` at `at` when it is free or has expired, a lease older
 * than its timeout being taken over (TRV-28, CL-TRV-07).
 */
export async function takeLease(db: Database, passId: string, at: EpochMs): Promise<LeaseTaking> {
  const free = isNull(schedulerLease.expiresAt);
  const expired = lte(schedulerLease.expiresAt, new Date(at));
  const freeOrExpired = sql`(${free} or ${expired})`;
  const taken = await db
    .insert(schedulerLease)
    .values({ id: LEASE_ID, passId, expiresAt: new Date(at + STALE_AFTER_MS) })
    .onConflictDoUpdate({
      target: schedulerLease.id,
      set: { passId, expiresAt: new Date(at + STALE_AFTER_MS) },
      setWhere: freeOrExpired,
    })
    .returning({ passId: schedulerLease.passId });
  return taken.length > 0 ? { ok: true } : HELD;
}

/** Frees the lease, if pass `passId` still holds it (TRV-28). */
export async function releaseLease(db: Database, passId: string): Promise<void> {
  await db
    .update(schedulerLease)
    .set({ passId: null, expiresAt: null })
    .where(eq(schedulerLease.passId, passId));
}

import { outboxFacts } from '@/lib/db';
import { activeLot } from '@/lib/env';
import { now } from '@/lib/time';
import { wakeAt } from '@/lib/wake-plan';

import type { OutboxFact } from './facts';
import type { Transaction } from '@/lib/db';

// The lot whose notification dispatch consumes the facts (TEL-02, ADR 0001).
const DISPATCH_LOT = 2;

/**
 * Records `fact` in the caller's transaction `tx`, the one of the change it reports, with
 * the pass `passId` that produced it, or none for an owner's action outside a pass
 * (TEL-02, TEL-19). The same fact, by kind and subject, is recorded once: a rerun of the
 * step changes nothing, so it never yields a second message (TRV-29, TEL-17). While Lot 2
 * is active, a new fact pulls the wake plan to now, so that `notification-dispatch` runs at
 * the next tick (module map §1.9); a wake the cache loses delays it until the hourly check
 * at most (TRV-31), so its outcome is no failure of the fact. In Lot 1 nothing consumes and
 * nothing wakes.
 */
export async function emit(tx: Transaction, fact: OutboxFact, passId?: string): Promise<void> {
  const at = now();
  const inserted = await tx
    .insert(outboxFacts)
    .values({ ...fact, passId, createdAt: new Date(at) })
    .onConflictDoNothing()
    .returning({ id: outboxFacts.id });
  if (inserted.length > 0 && activeLot() === DISPATCH_LOT) {
    await wakeAt(at, 'notification-dispatch');
  }
}

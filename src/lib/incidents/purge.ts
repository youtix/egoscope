import { and, eq, lt } from 'drizzle-orm';

import { incidents } from '@/lib/db';

import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const MS_PER_DAY = 86_400_000;

/**
 * Deletes, in the purge's transaction `tx`, the incidents closed for longer than the
 * retention, `journal.retentionDays` before `now`, with their outbox facts; an open
 * incident stays, however old (module map §4; TRV-45, TRV-48). Returns the number
 * deleted, which the purge journals.
 */
export async function purgeExpired(
  tx: Transaction,
  retention: Readonly<{ now: EpochMs; retentionDays: number }>,
): Promise<number> {
  const cutoff = new Date(retention.now - retention.retentionDays * MS_PER_DAY);
  const deleted = await tx
    .delete(incidents)
    .where(and(eq(incidents.status, 'closed'), lt(incidents.closedAt, cutoff)))
    .returning({ id: incidents.id });
  return deleted.length;
}

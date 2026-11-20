import { and, eq, lt, notExists } from 'drizzle-orm';

import { incidents, journalEntries } from '@/lib/db';

import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const MS_PER_DAY = 86_400_000;

/**
 * Deletes, in the purge's transaction `tx`, the journal entries older than the
 * retention, `journal.retentionDays` before `now`, with their technical details, and
 * keeps those tied to an incident still open, until it closes (TRV-48, H-TRV-08).
 * Returns the number of entries deleted, which the purge journals.
 */
export async function purgeExpired(
  tx: Transaction,
  retention: Readonly<{ now: EpochMs; retentionDays: number }>,
): Promise<number> {
  const cutoff = new Date(retention.now - retention.retentionDays * MS_PER_DAY);
  const tiedToOpenIncident = tx
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.id, journalEntries.incidentId), eq(incidents.status, 'open')));
  const deleted = await tx
    .delete(journalEntries)
    .where(and(lt(journalEntries.occurredAt, cutoff), notExists(tiedToOpenIncident)))
    .returning({ id: journalEntries.id });
  return deleted.length;
}

import { and, eq, isNotNull, lt, or } from 'drizzle-orm';

import { outboxFacts } from '@/lib/db';

import type { Lot2Fact } from './facts';
import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const MS_PER_DAY = 86_400_000;

/**
 * Deletes, in the purge's transaction `tx`, the facts consumed, and those older than the
 * retention, `journal.retentionDays` before `now`, consumed or not: in Lot 1 nothing
 * consumes them, and the dispatch would drop them as stale (operations.md §1.15; TEL-23).
 * Returns the number deleted, which the purge journals.
 */
export async function purgeConsumed(
  tx: Transaction,
  retention: Readonly<{ now: EpochMs; retentionDays: number }>,
): Promise<number> {
  const cutoff = new Date(retention.now - retention.retentionDays * MS_PER_DAY);
  const deleted = await tx
    .delete(outboxFacts)
    .where(or(isNotNull(outboxFacts.consumedAt), lt(outboxFacts.createdAt, cutoff)))
    .returning({ id: outboxFacts.id });
  return deleted.length;
}

/**
 * Deletes, in the caller's transaction `tx`, the fact of the Lot 2 object `subject`,
 * consumed or not: a Lot 2 eraser deletes the facts of the objects it erases, and the
 * re-initialization of an alert sheet whose initial section waits for its profile values
 * deletes its `alert_sheet_produced` fact, emitted again once the values enter
 * (operations.md §1.15; CL-DSN-16, CL-ALE-16). Returns the number deleted.
 */
export async function deleteFactsOf(tx: Transaction, subject: Lot2Fact): Promise<number> {
  const deleted = await tx
    .delete(outboxFacts)
    .where(
      and(eq(outboxFacts.kind, subject.kind), eq(outboxFacts.lot2SubjectId, subject.lot2SubjectId)),
    )
    .returning({ id: outboxFacts.id });
  return deleted.length;
}

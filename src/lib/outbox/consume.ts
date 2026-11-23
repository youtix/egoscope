import { and, asc, getTableColumns, inArray, isNull } from 'drizzle-orm';

import { outboxFacts } from '@/lib/db';
import { now, toEpochMs } from '@/lib/time';

import type { OutboxFactKind } from './facts';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/**
 * A fact not consumed yet, as the dispatch reads it: its kind, the subject columns that
 * its kind sets (the others are null), the pass that produced it and when (operations.md
 * §1.15).
 */
export type PendingFact = Readonly<{
  id: number;
  kind: OutboxFactKind;
  backtestRequestId: number | null;
  deadlineGameId: number | null;
  playerEventId: number | null;
  eventTypeId: string | null;
  incidentId: number | null;
  lot2SubjectId: number | null;
  passId: string | null;
  createdAt: EpochMs;
}>;

/**
 * The facts not consumed yet, oldest first, which the Lot 2 dispatch groups by pass
 * (TEL-02, TEL-17, TEL-19).
 */
export async function pending(db: Database | Transaction): Promise<readonly PendingFact[]> {
  const { consumedAt, ...columns } = getTableColumns(outboxFacts);
  const rows = await db
    .select(columns)
    .from(outboxFacts)
    .where(isNull(consumedAt))
    .orderBy(asc(columns.createdAt), asc(columns.id));
  return rows.map((row) => ({ ...row, createdAt: toEpochMs(row.createdAt.getTime()) }));
}

/**
 * Marks the facts `ids` consumed in the dispatch's transaction `tx`, once their messages
 * are composed, so that none is announced twice (TEL-17). A fact already consumed keeps
 * its instant. Returns the number marked.
 */
export async function markConsumed(tx: Transaction, ids: readonly number[]): Promise<number> {
  const marked = await tx
    .update(outboxFacts)
    .set({ consumedAt: new Date(now()) })
    .where(and(inArray(outboxFacts.id, [...ids]), isNull(outboxFacts.consumedAt)))
    .returning({ id: outboxFacts.id });
  return marked.length;
}

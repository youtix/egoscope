import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { sequenceCounters } from './schema';

import type { Transaction } from './transaction';

/**
 * A counter of `sequence_counters`: the import numbers (IMP-31), and the request
 * references of one year, `request_reference_2026` (BKT-12, CL-BKT-11).
 */
export type SequenceName = 'import_sequence' | `request_reference_${number}`;

// A counter that has issued nothing yet; its first number is the one after it.
const NOTHING_ISSUED = 0;

/**
 * The next number of the counter `name`, drawn in the caller's transaction `tx`, which
 * then uses it (IMP-31, BKT-12, CL-BKT-11). The increment locks the counter's row until
 * that transaction ends: a concurrent caller waits, then draws the number after it, or
 * the same one if `tx` rolled back, so no number is ever issued twice and a rolled-back
 * transaction leaves no gap. A counter's first draw creates its row, at nothing issued,
 * then increments it like any other; the counters outlive the rows they numbered.
 */
export async function nextValue(tx: Transaction, name: SequenceName): Promise<number> {
  // Two turns at most: a counter's first draw finds no row, creates it, then increments it.
  for (;;) {
    const [counter] = await tx
      .update(sequenceCounters)
      .set({ lastValue: sql`${sequenceCounters.lastValue} + 1` })
      .where(eq(sequenceCounters.name, name))
      .returning({ value: sequenceCounters.lastValue });
    if (counter !== undefined) {
      return counter.value;
    }
    // A concurrent first draw makes this insert wait for its transaction, then do nothing.
    await tx
      .insert(sequenceCounters)
      .values({ name, lastValue: NOTHING_ISSUED })
      .onConflictDoNothing({ target: sequenceCounters.name });
  }
}

import 'server-only';

import { sql } from 'drizzle-orm';

import { sequenceCounters } from './schema';

import type { Transaction } from './transaction';

/**
 * A counter of `sequence_counters`: the import numbers (IMP-31), and the request
 * references of one year, `request_reference_2026` (BKT-12, CL-BKT-11).
 */
export type SequenceName = 'import_sequence' | `request_reference_${number}`;

// The first number a counter issues.
const FIRST_VALUE = 1;

/**
 * The next number of the counter `name`, drawn in the caller's transaction `tx`, which
 * then uses it (IMP-31, BKT-12, CL-BKT-11). The increment locks the counter's row until
 * that transaction ends: a concurrent caller waits, then draws the number after it, or
 * the same one if `tx` rolled back, so no number is ever issued twice and a rolled-back
 * transaction leaves no gap. The counters outlive the rows they numbered.
 */
export async function nextValue(tx: Transaction, name: SequenceName): Promise<number> {
  const [counter] = await tx
    .insert(sequenceCounters)
    .values({ name, lastValue: FIRST_VALUE })
    .onConflictDoUpdate({
      target: sequenceCounters.name,
      set: { lastValue: sql`${sequenceCounters.lastValue} + 1` },
    })
    .returning({ value: sequenceCounters.lastValue });
  if (counter === undefined) {
    throw new Error(`The counter ${name} returned no row from its increment.`);
  }
  return counter.value;
}

import { and, eq, inArray } from 'drizzle-orm';

import { journalEntries, journalTechnicalDetails } from '@/lib/db';

import type { Lot2ObjectKind } from './entries';
import type { Transaction } from '@/lib/db';
import type { SQL } from 'drizzle-orm';

/**
 * An item that an erasure removes: an event, a player, or a Lot 2 object by its kind
 * and identifier (CL-TRV-10).
 */
export type ErasedItem =
  | Readonly<{ playerEventId: number }>
  | Readonly<{ playerId: string }>
  | Readonly<{ lot2Object: Readonly<{ kind: Lot2ObjectKind; id: number }> }>;

type Nulled = Partial<typeof journalEntries.$inferInsert>;

const NO_LOT2_OBJECT = { lot2ObjectKind: null, lot2ObjectId: null } as const satisfies Nulled;

/** The entries that name `item`, and the references an erasure of it nulls in them. */
function scrubbing(item: ErasedItem): Readonly<{ naming: SQL | undefined; nulled: Nulled }> {
  if ('playerEventId' in item) {
    // An entry about an event names it alone, or beside a Lot 2 object, such as an
    // alert sheet that keeps other events: both go (sensitive-data.md section 2.1 step 7).
    return {
      naming: eq(journalEntries.playerEventId, item.playerEventId),
      nulled: { playerEventId: null, ...NO_LOT2_OBJECT },
    };
  }
  if ('playerId' in item) {
    return { naming: eq(journalEntries.playerId, item.playerId), nulled: { playerId: null } };
  }
  return {
    naming: and(
      eq(journalEntries.lot2ObjectKind, item.lot2Object.kind),
      eq(journalEntries.lot2ObjectId, item.lot2Object.id),
    ),
    nulled: NO_LOT2_OBJECT,
  };
}

/** Says whether a scrubbed entry names nothing any more, so its details concerned only the erased item. */
const hasNoReferenceLeft = (entry: typeof journalEntries.$inferSelect): boolean =>
  [
    entry.playerId,
    entry.playerEventId,
    entry.eventTypeId,
    entry.backtestRequestId,
    entry.importId,
    entry.caseId,
    entry.incidentId,
    entry.taskRunId,
    entry.lot2ObjectKind,
  ].every((reference) => reference === null);

/**
 * Removes an erased item from the journal, in the erasure's transaction `tx`: its
 * references become null in every entry, which then reads "an item that no longer
 * exists" or "a deleted player", and an entry about an event loses as well the Lot 2
 * object it names beside it; the technical details of the entries that concerned only
 * that item are deleted (CL-TRV-10, DSN-29; sensitive-data.md section 2.1 step 7 and
 * section 2.2 step 5). Every kind of erasure calls it: a withdrawal, a deletion, a
 * requalification, a dropped derivation, a player's data, a Lot 2 object. The entries
 * stay, with their messages.
 */
export async function eraseDetailsAbout(tx: Transaction, item: ErasedItem): Promise<void> {
  const { naming, nulled } = scrubbing(item);
  const scrubbed = await tx.update(journalEntries).set(nulled).where(naming).returning();
  const concernedOnlyIt = scrubbed
    .filter((entry) => hasNoReferenceLeft(entry))
    .map((entry) => entry.id);
  if (concernedOnlyIt.length > 0) {
    await tx
      .delete(journalTechnicalDetails)
      .where(inArray(journalTechnicalDetails.journalEntryId, concernedOnlyIt));
  }
}

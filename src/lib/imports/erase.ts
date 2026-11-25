import 'server-only';

import { eq, or } from 'drizzle-orm';

import { importEventOutcomes, importPossibleDuplicates } from '@/lib/db';

import type { Transaction } from '@/lib/db';

/**
 * The import step of a withdrawal, in its transaction and before the event's row goes:
 * deletes the outcome rows that designate the event, whether it was added or matched by a
 * duplicate, and the owner's answers on possible duplicates that name it as the existing
 * event or as the result event, so that no import trace keeps anything designating it and
 * its counts, derived from those rows, shrink with it, the events recovered from a cut
 * result included; no stored count needs adjusting (IMP-37, DSN-27).
 */
export async function eraseEventData(tx: Transaction, eventId: number): Promise<void> {
  await tx.delete(importEventOutcomes).where(eq(importEventOutcomes.playerEventId, eventId));
  await tx
    .delete(importPossibleDuplicates)
    .where(
      or(
        eq(importPossibleDuplicates.existingPlayerEventId, eventId),
        eq(importPossibleDuplicates.resultPlayerEventId, eventId),
      ),
    );
}

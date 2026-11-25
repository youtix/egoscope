import 'server-only';

import { and, eq, or, sql } from 'drizzle-orm';

import { eventCorrections, events, tallyExits } from '@/lib/db';
import { err, ok } from '@/lib/result';

import type { EventRow, NewTallyExitRow } from './types';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

/**
 * Why an event row goes, which decides the tally exit its erasure writes (SEN-33,
 * CL-SEN-25, sensitive-data.md section 2.1): a replacement names its replacing import.
 */
export type ErasureVariant =
  | Readonly<{
      kind:
        | 'withdrawal'
        | 'player_deletion'
        | 'restore_reapplication'
        | 'upcoming_derivation_drop'
        | 'requalification_erasure'
        | 'split_erasure'
        | 'no_longer_derived'
        | 'merged';
    }>
  | Readonly<{ kind: 'replaced_at_import'; importId: number }>;

/** The player, type and case of a removed event, which its caller's next steps need. */
export type ErasedEvent = Readonly<Pick<EventRow, 'playerId' | 'eventTypeId' | 'caseId'>>;

type ExitReason = NewTallyExitRow['exitReason'];

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };

// The tally exit of the variants that leave one; a withdrawal, in any of its forms, and
// the drop of an upcoming calendar-derived event leave none (SEN-33, DSN-29, CL-SEN-25).
const EXIT_OF_VARIANT: ReadonlyMap<ErasureVariant['kind'], ExitReason> = new Map([
  ['requalification_erasure', 'erased'],
  ['split_erasure', 'erased'],
  ['no_longer_derived', 'no_longer_derived'],
  ['merged', 'merged'],
  ['replaced_at_import', 'replaced_at_import'],
]);

/**
 * Deletes, in the caller's transaction `tx`, the row of event `eventId`, its sources,
 * warnings, marks, status changes and corrections going with it by the schema's
 * cascades, and the import and journal references to it becoming null: the removal
 * that a manual deletion and the erasure step share (DSN-27, IMP-33). The removed row,
 * or none when the event is gone already.
 */
export async function deleteEventRow(tx: Transaction, eventId: number): Promise<EventRow | null> {
  const [removed] = await tx.delete(events).where(eq(events.id, eventId)).returning();
  return removed ?? null;
}

/**
 * The events module's part of every erasure of event `eventId`, in the caller's
 * transaction `tx`: deletes its row with its cascades, then writes the tally exit of
 * `variant` as a count alone, with no date, game or public date: `erased` for a
 * requalification or split erasure, `replaced_at_import` with its import, `no_longer_derived`
 * for a calendar-derived event dropped after its game started, `merged` for a merge of
 * detected events, and none for a withdrawal, a player-data deletion, a restore's
 * re-application or the drop of an upcoming calendar-derived event (SEN-33, DSN-27,
 * DSN-29, CL-SEN-25, CL-TAX-09, sensitive-data.md section 2.1). Gives the player, type
 * and case of the removed event; the rest of the erasure step is its caller's.
 */
export async function eraseEvent(
  tx: Transaction,
  eventId: number,
  variant: ErasureVariant,
): Promise<Result<ErasedEvent, NoLongerExists>> {
  const removed = await deleteEventRow(tx, eventId);
  if (removed === null) {
    return err(NO_LONGER_EXISTS);
  }
  const exitReason = EXIT_OF_VARIANT.get(variant.kind);
  if (exitReason !== undefined) {
    await tx.insert(tallyExits).values({
      playerId: removed.playerId,
      eventTypeId: removed.eventTypeId,
      exitReason,
      importId: variant.kind === 'replaced_at_import' ? variant.importId : null,
    });
  }
  return ok({
    playerId: removed.playerId,
    eventTypeId: removed.eventTypeId,
    caseId: removed.caseId,
  });
}

/** The value `column` keeps once the identifier `playerId` is taken out of it. */
function withoutPlayer(
  column: typeof eventCorrections.beforeValue | typeof eventCorrections.afterValue,
  playerId: string,
) {
  return sql`CASE WHEN ${column} = ${playerId} THEN NULL ELSE ${column} END`;
}

/**
 * Sets to null, in the caller's transaction `tx`, every value before or after a player
 * correction that holds the identifier of the deleted player `playerId`, the corrections
 * of other players' events keeping their instant and field (JOU-24, CL-JOU-06,
 * sensitive-data.md section 2.2 step 4). Gives the number of corrections changed.
 */
export async function scrubPlayerFromCorrections(
  tx: Transaction,
  playerId: string,
): Promise<number> {
  const holdsPlayer = or(
    eq(eventCorrections.beforeValue, playerId),
    eq(eventCorrections.afterValue, playerId),
  );
  const scrubbed = await tx
    .update(eventCorrections)
    .set({
      beforeValue: withoutPlayer(eventCorrections.beforeValue, playerId),
      afterValue: withoutPlayer(eventCorrections.afterValue, playerId),
    })
    .where(and(eq(eventCorrections.field, 'player'), holdsPlayer))
    .returning({ id: eventCorrections.id });
  return scrubbed.length;
}

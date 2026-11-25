import 'server-only';

import { eq } from 'drizzle-orm';

import { checkText } from '@/lib/ai-exchange';
import { events, tallyExits } from '@/lib/db';
import { getParam } from '@/lib/params';
import { changedElsewhere, err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { deleteEventRow } from './erase';

import type { ErasedEvent } from './erase';
import type { EventRow, NewTallyExitRow } from './types';
import type { TextRuleBreach } from '@/lib/ai-exchange';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';

/** A reason of the closed list of IMP-33 (`HistoricalEventDeletionReason`). */
export type DeletionReason = NonNullable<NewTallyExitRow['deletionReason']>;

/** The owner's deletion of a historical event, as the event page sends it (IMP-33, CL-IHM-18). */
export type HistoricalDeletion = Readonly<{
  /** The reason he chose, checked against the IMP-33 list. */
  reason: string;
  /** The short precision that `other` requires, and that no other reason keeps. */
  detail: string | null;
  /** The `row_version` that the page showed (CL-IHM-18). */
  expectedVersion: number;
}>;

/** Why a deletion is refused. */
export type DeletionRefusal =
  | Readonly<{ kind: 'invalid_reason' }>
  | Readonly<{ kind: 'detail_required' }>
  | Readonly<{ kind: 'invalid_detail'; breaches: readonly TextRuleBreach[] }>
  | Readonly<{ kind: 'not_historical' }>
  | ChangedElsewhere<EventRow>
  | NoLongerExists;

// HistoricalEventDeletionReason (IMP-33).
const DELETION_REASONS: readonly string[] = [
  'inaccurate_fact_or_false_source',
  'outside_type_criteria',
  'duplicate',
  'other',
] satisfies readonly DeletionReason[];
const OTHER: DeletionReason = 'other';
const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };

/** Whether `reason` is one of the IMP-33 list. */
function isDeletionReason(reason: string): reason is DeletionReason {
  return DELETION_REASONS.includes(reason);
}

/**
 * The reason and precision that `deletion` gives, `other` with a precision that the
 * wording rules accept (IMP-33, DSN-10, DSN-20, DSN-21), or why they are refused.
 */
async function checkedReason(
  tx: Transaction,
  deletion: HistoricalDeletion,
): Promise<Result<Pick<NewTallyExitRow, 'deletionReason' | 'deletionDetail'>, DeletionRefusal>> {
  const { reason } = deletion;
  if (!isDeletionReason(reason)) {
    return err({ kind: 'invalid_reason' });
  }
  if (reason !== OTHER) {
    return ok({ deletionReason: reason, deletionDetail: null });
  }
  const detail = deletion.detail?.trim() ?? '';
  if (detail === '') {
    return err({ kind: 'detail_required' });
  }
  const breaches = checkText(detail, await getParam(tx, 'events.maxDescriptionLength'));
  return breaches.length > 0
    ? err({ kind: 'invalid_detail', breaches })
    : ok({ deletionReason: reason, deletionDetail: detail });
}

/** The refusal of a deletion of `event`, changed since the page showed it or not historical, if any. */
function stateRefusal(event: EventRow, expectedVersion: number): DeletionRefusal | null {
  if (event.rowVersion !== expectedVersion) {
    return changedElsewhere(event);
  }
  return event.origin === 'historical' ? null : { kind: 'not_historical' };
}

/**
 * Deletes the historical event `eventId` by the owner's hand, in the caller's transaction
 * `tx`, for a reason of the IMP-33 list, `other` with its short precision: refused for
 * another reason, an `other` without precision, an event of another origin, or a version
 * other than the one the page showed (CL-IHM-18). Keeps the deletion trace, the tally exit
 * `deleted` with the deletion date, the reason, the type and the event's public date,
 * then removes the event with its sources, warnings and corrections (IMP-33, SEN-33,
 * DSN-10, sensitive-data.md section 2.1). Gives the player, type and case of the removed
 * event, for the recalculation its caller requests.
 */
export async function deleteHistorical(
  tx: Transaction,
  eventId: number,
  deletion: HistoricalDeletion,
): Promise<Result<ErasedEvent, DeletionRefusal>> {
  const reason = await checkedReason(tx, deletion);
  if (!reason.ok) {
    return reason;
  }
  const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
  if (event === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  const refusal = stateRefusal(event, deletion.expectedVersion);
  if (refusal !== null) {
    return err(refusal);
  }
  await tx.insert(tallyExits).values({
    playerId: event.playerId,
    eventTypeId: event.eventTypeId,
    exitReason: 'deleted',
    exitedAt: new Date(now()),
    ...reason.value,
    publicDateOn: event.referenceDateOn,
    publicAt: event.referenceAt,
  });
  await deleteEventRow(tx, eventId);
  return ok({ playerId: event.playerId, eventTypeId: event.eventTypeId, caseId: event.caseId });
}

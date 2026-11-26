// The owner's review of the events that a change of their type left to settle: the
// requalification of an event after a narrowing, "both" or a merge that does not cover the
// union, and the distribution of an event of a split type (TAX-25, TAX-26, TAX-29). The
// events change through the events module alone; the erasure of an event that fits no
// type is the review screen's, composed with the withdrawal module (module map §1.7).
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { events, eventTypes, typeSheetVersions } from '@/lib/db';
import { clearTypeLink, reassignType, restampSheetVersion } from '@/lib/events';
import { record } from '@/lib/journal';
import { changedElsewhere, err, ok } from '@/lib/result';
import { requestRecalculation } from '@/lib/sensitivity';

import { resolveTypeId } from './queries';

import type { NoLongerExists, Transaction } from '@/lib/db';
import type { EventRow, TypeNotValidated } from '@/lib/events';
import type { ChangedElsewhere, Result } from '@/lib/result';

/** The owner's choice for an event to requalify, in the glossary's values (TAX-25, CL-TAX-07). */
export type RequalificationChoice =
  | Readonly<{ kind: 'conforms' }>
  | Readonly<{ kind: 'reassigned'; eventTypeId: string }>
  | Readonly<{ kind: 'non_conforming' }>;

/** The owner's choice for an event of a split type: one of the split's types, or none (TAX-29). */
export type DistributionChoice =
  Readonly<{ kind: 'distributed'; eventTypeId: string }> | Readonly<{ kind: 'fits_none' }>;

/** An event that the choice kept, its type and sheet version settled and its mark cleared. */
export type EventSettled = Readonly<{ kind: 'settled'; eventId: number }>;

/**
 * An event that the choice found fitting no type: the erasure, with a withdrawal's scope,
 * that the review screen performs in the same transaction (CL-TAX-09).
 */
export type EventToErase = Readonly<{
  kind: 'erasure';
  eventId: number;
  cause: 'requalification_erasure' | 'split_erasure';
}>;

/** A requalification as the review screen sends it, with the `row_version` it showed (CL-IHM-18). */
export type Requalification = Readonly<{ expectedVersion: number; choice: RequalificationChoice }>;

/** A distribution as the review screen sends it, with the `row_version` it showed (CL-IHM-18). */
export type Distribution = Readonly<{ expectedVersion: number; choice: DistributionChoice }>;

/** What a review choice did to its event. */
export type ReviewOutcome = EventSettled | EventToErase;

/** Why a review choice is refused. */
export type ReviewRefusal =
  | NoLongerExists
  | ChangedElsewhere<EventRow>
  | Readonly<{ kind: 'not_marked' }>
  | Readonly<{ kind: 'own_type' }>
  | Readonly<{ kind: 'not_among_split_types' }>
  | TypeNotValidated;

type LinkMark = NonNullable<EventRow['typeLinkMark']>;

const NO_LONGER_EXISTS: ReviewRefusal = { kind: 'no_longer_exists' };
const NOT_MARKED: ReviewRefusal = { kind: 'not_marked' };
const OWN_TYPE: ReviewRefusal = { kind: 'own_type' };
const NOT_AMONG_SPLIT_TYPES: ReviewRefusal = { kind: 'not_among_split_types' };

// The cause of the recalculation that every kept event records (CL-SEN-17).
const EVENT_CHANGED = 'event_corrected_or_removed';

// The counts of a sheet version that the review increments, never decrements (TAX-26).
const INCREMENTS = {
  conforming: {
    requalifiedConformingCount: sql`${typeSheetVersions.requalifiedConformingCount} + 1`,
  },
  reassigned: { reassignedCount: sql`${typeSheetVersions.reassignedCount} + 1` },
  erased: { erasedCount: sql`${typeSheetVersions.erasedCount} + 1` },
} as const;

type VersionCount = keyof typeof INCREMENTS;

/** The event `eventId`, locked for the choice, if it still holds `mark` at `expectedVersion`. */
async function reviewable(
  tx: Transaction,
  eventId: number,
  { expectedVersion, mark }: Readonly<{ expectedVersion: number; mark: LinkMark }>,
): Promise<Result<EventRow, ReviewRefusal>> {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
  if (event === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  if (event.rowVersion !== expectedVersion) {
    return err(changedElsewhere(event));
  }
  return event.typeLinkMark === mark ? ok(event) : err(NOT_MARKED);
}

/**
 * Adds one to `count` on the current version of `eventTypeId`: the new version for a
 * requalification, the last version of a split type, withdrawn since (TAX-26, CL-TAX-09).
 */
async function countOnCurrentVersion(
  tx: Transaction,
  eventTypeId: string,
  count: VersionCount,
): Promise<void> {
  await tx
    .update(typeSheetVersions)
    .set(INCREMENTS[count])
    .where(
      and(
        eq(typeSheetVersions.eventTypeId, eventTypeId),
        eq(
          typeSheetVersions.versionNumber,
          sql`(SELECT ${eventTypes.currentVersionNumber} FROM ${eventTypes} WHERE ${eventTypes.id} = ${eventTypeId})`,
        ),
      ),
    );
}

/** Clears the mark of a kept event and records the recalculation of the player's types touched. */
async function settle(
  tx: Transaction,
  event: EventRow,
  eventTypeIds: readonly string[],
): Promise<Result<ReviewOutcome, ReviewRefusal>> {
  await clearTypeLink(tx, [event.id]);
  await requestRecalculation(
    tx,
    { kind: 'event_or_case_change', playerIds: [event.playerId], eventTypeIds },
    EVENT_CHANGED,
  );
  return ok({ kind: 'settled', eventId: event.id });
}

/** A move of an event to another type: its target, the count it adds, its journal message. */
type Move = Readonly<{
  target: string;
  count: VersionCount | null;
  messageKey: 'event_requalified' | 'event_distributed';
}>;

/** Moves `event` to the validated type `move.target` at its version in force (CL-TAX-22). */
async function moveTo(
  tx: Transaction,
  event: EventRow,
  { target, count, messageKey }: Move,
): Promise<Result<ReviewOutcome, ReviewRefusal>> {
  const moved = await reassignType(tx, [event.id], target);
  if (!moved.ok) {
    return err(moved.error);
  }
  if (count !== null) {
    await countOnCurrentVersion(tx, event.eventTypeId, count);
  }
  await record(tx, { messageKey, playerEventId: event.id });
  return settle(tx, event, [event.eventTypeId, target]);
}

/**
 * Consumes the choice by clearing the mark, which moves `row_version`, so that a second
 * choice is refused and the erasure counts once; counts it on the type's current version
 * and hands it to the screen, whose erasure removes the event in the same transaction.
 */
async function toErase(
  tx: Transaction,
  event: EventRow,
  cause: EventToErase['cause'],
): Promise<Result<ReviewOutcome, ReviewRefusal>> {
  await clearTypeLink(tx, [event.id]);
  await countOnCurrentVersion(tx, event.eventTypeId, 'erased');
  return ok({ kind: 'erasure', eventId: event.id, cause });
}

/**
 * Settles the event `eventId`, marked "to requalify", by the owner's `choice`, in the
 * caller's transaction `tx`, only if its version is still `expectedVersion` (TAX-25,
 * TAX-26, CL-IHM-18). Conforms: the event takes its type's current version. Reassigned:
 * it takes another validated type and that type's current version (CL-TAX-07,
 * CL-TAX-22). Both clear the mark, add one to the conforming or reassigned count of the
 * type's current version, and record the recalculation of the player's types touched,
 * cause "event corrected or removed" (CL-SEN-16, CL-SEN-17); a reassignment is journaled
 * by the event's reference alone (CL-TRV-10). Does not conform: the mark is cleared, one is
 * added to the erased count of that version, and the event comes back as the erasure that
 * the caller performs with a withdrawal's scope, which records its own recalculation
 * (CL-TAX-09). Until its choice the event keeps its type, version and case, and so keeps
 * counting. Every choice moves `row_version`, so a second one is refused (CL-IHM-18), as
 * is an event without the mark.
 */
export async function requalifyEvent(
  tx: Transaction,
  eventId: number,
  { expectedVersion, choice }: Requalification,
): Promise<Result<ReviewOutcome, ReviewRefusal>> {
  const checked = await reviewable(tx, eventId, { expectedVersion, mark: 'to_requalify' });
  if (!checked.ok) {
    return err(checked.error);
  }
  const event = checked.value;
  if (choice.kind === 'non_conforming') {
    return toErase(tx, event, 'requalification_erasure');
  }
  if (choice.kind === 'conforms') {
    await restampSheetVersion(tx, [event.id]);
    await countOnCurrentVersion(tx, event.eventTypeId, 'conforming');
    return settle(tx, event, [event.eventTypeId]);
  }
  if (choice.eventTypeId === event.eventTypeId) {
    return err(OWN_TYPE);
  }
  return moveTo(tx, event, {
    target: choice.eventTypeId,
    count: 'reassigned',
    messageKey: 'event_requalified',
  });
}

/** Whether `target` is among the validated types that the split of `splitTypeId` gives (TAX-29). */
async function isAmongSplitTypes(
  tx: Transaction,
  splitTypeId: string,
  target: string,
): Promise<boolean> {
  const resolution = await resolveTypeId(tx, splitTypeId);
  return resolution.kind === 'split' && resolution.into.some((type) => type.id === target);
}

/**
 * Settles the event `eventId` of a split type, marked "to distribute", by the owner's
 * `choice`, in the caller's transaction `tx`, only if its version is still
 * `expectedVersion` (TAX-29, CL-IHM-18). Distributed: the event takes one of the split's
 * validated types, followed through the merges and splits made since, at that type's
 * version in force (CL-TAX-22); the mark is cleared, the recalculation of the player's two
 * types recorded, cause "event corrected or removed" (CL-SEN-17), and the distribution
 * journaled by the event's reference alone (CL-TRV-10). Fits none: the mark is cleared,
 * one is added to the erased count of the split type's last version, and the event comes
 * back as the erasure that the caller performs with a withdrawal's scope (TAX-26,
 * CL-TAX-09). Every choice moves `row_version`, so a second one is refused (CL-IHM-18), as
 * is an event without the mark, or a type that is not among the split's.
 */
export async function distributeEvent(
  tx: Transaction,
  eventId: number,
  { expectedVersion, choice }: Distribution,
): Promise<Result<ReviewOutcome, ReviewRefusal>> {
  const checked = await reviewable(tx, eventId, { expectedVersion, mark: 'to_distribute' });
  if (!checked.ok) {
    return err(checked.error);
  }
  const event = checked.value;
  if (choice.kind === 'fits_none') {
    return toErase(tx, event, 'split_erasure');
  }
  if (!(await isAmongSplitTypes(tx, event.eventTypeId, choice.eventTypeId))) {
    return err(NOT_AMONG_SPLIT_TYPES);
  }
  return moveTo(tx, event, {
    target: choice.eventTypeId,
    count: null,
    messageKey: 'event_distributed',
  });
}

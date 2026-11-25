// The links of events to their type, sheet version and case, which taxonomy and the
// recalculation change in bulk (TAX-23, TAX-25, TAX-29, CL-TAX-22, CL-IMP-17; module map,
// rule 7). They sit apart from corrections.ts only to keep each file within the size limits.
import 'server-only';

import { and, inArray, or, sql } from 'drizzle-orm';

import { events, eventTypes } from '@/lib/db';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { versionInForce } from './correction-fields';

import type { EventRow, NewEventRow } from './types';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { SQL } from 'drizzle-orm';

/** A type that holds no validated sheet version to stamp (TAX-23). */
export type TypeNotValidated = Readonly<{ kind: 'type_not_validated' }>;

/** The case of an event at a recalculation and, for a historical one, its precedence (CL-IMP-17). */
export type CaseLink = Readonly<{
  eventId: number;
  caseId: number | null;
  precedence?: NonNullable<EventRow['precedence']>;
}>;

/** The columns an update sets, each to a value or to an SQL expression of the row. */
type EventSet = { [Column in keyof NewEventRow]?: NewEventRow[Column] | SQL };

/** Changes the events that `where` selects, each save moving its version on (CL-IHM-18): the number changed. */
async function updateEvents(
  tx: Transaction,
  where: SQL | undefined,
  set: EventSet,
): Promise<number> {
  const updated = await tx
    .update(events)
    .set({ ...set, rowVersion: sql`${events.rowVersion} + 1`, updatedAt: new Date(now()) })
    .where(where)
    .returning({ id: events.id });
  return updated.length;
}

/**
 * Moves the events `eventIds` to the validated type `eventTypeId`, stamped with its sheet
 * version in force, each leaving its case for the recalculation to re-derive: a
 * reassignment at a requalification, the attached events of a merge whose sheet covers
 * the union, or a distribution after a split (TAX-23, TAX-25, TAX-29, CL-TAX-08,
 * CL-TAX-22). Refused for a type without a validated version. Gives the number moved.
 */
export async function reassignType(
  tx: Transaction,
  eventIds: readonly number[],
  eventTypeId: string,
): Promise<Result<number, TypeNotValidated>> {
  const version = await versionInForce(tx, eventTypeId);
  if (version === null) {
    return err({ kind: 'type_not_validated' });
  }
  return ok(
    await updateEvents(tx, inArray(events.id, [...eventIds]), {
      eventTypeId,
      sheetEventTypeId: eventTypeId,
      sheetVersionNumber: version,
      caseId: null,
    }),
  );
}

/**
 * Sets the mark `to_requalify` or `to_distribute` on the events `eventIds`, which the
 * to-do list shows until the owner settles each (TAX-25, TAX-29, CL-TAX-08). Gives the
 * number marked.
 */
export async function markTypeLink(
  tx: Transaction,
  eventIds: readonly number[],
  mark: NonNullable<EventRow['typeLinkMark']>,
): Promise<number> {
  return updateEvents(tx, inArray(events.id, [...eventIds]), { typeLinkMark: mark });
}

/** Clears the requalification or distribution mark of the events `eventIds` (TAX-25, TAX-29): the number changed. */
export async function clearTypeLink(tx: Transaction, eventIds: readonly number[]): Promise<number> {
  return updateEvents(tx, inArray(events.id, [...eventIds]), { typeLinkMark: null });
}

/**
 * Moves the events `eventIds` to the sheet version in force of their own type: an event
 * found to conform at a requalification, or every event of a merge whose sheet covers the
 * union (TAX-25, CL-TAX-08, CL-TAX-22). Gives the number moved.
 */
export async function restampSheetVersion(
  tx: Transaction,
  eventIds: readonly number[],
): Promise<number> {
  return updateEvents(tx, inArray(events.id, [...eventIds]), {
    sheetEventTypeId: sql`${events.eventTypeId}`,
    sheetVersionNumber: sql`(SELECT ${eventTypes.currentVersionNumber} FROM ${eventTypes} WHERE ${eventTypes.id} = ${events.eventTypeId})`,
  });
}

/** The condition that an event's case, and its precedence when `link` gives one, differ from `link`'s. */
function differsFrom({ caseId, precedence }: CaseLink): SQL | undefined {
  const caseDiffers = sql`${events.caseId} IS DISTINCT FROM ${caseId}`;
  return precedence === undefined
    ? caseDiffers
    : or(caseDiffers, sql`${events.precedence} IS DISTINCT FROM ${precedence}`);
}

/**
 * Writes, in the recalculation's transaction `tx`, the case of each event that `links`
 * names and, for a historical event, its precedence, changing only the events whose links
 * differ: the one way the recalculation writes the events table (SEN-05, IMP-18,
 * CL-IMP-17; module map, rule 7). Gives the number of events changed.
 */
export async function recordCaseLinks(
  tx: Transaction,
  links: readonly CaseLink[],
): Promise<number> {
  const groups = new Map<string, { link: CaseLink; eventIds: number[] }>();
  for (const link of links) {
    const key = `${String(link.caseId)}|${link.precedence ?? ''}`;
    const group = groups.get(key) ?? { link, eventIds: [] };
    group.eventIds.push(link.eventId);
    groups.set(key, group);
  }
  let changed = 0;
  for (const { link, eventIds } of groups.values()) {
    const { caseId, precedence } = link;
    changed += await updateEvents(tx, and(inArray(events.id, eventIds), differsFrom(link)), {
      caseId,
      ...(precedence !== undefined && { precedence }),
    });
  }
  return changed;
}

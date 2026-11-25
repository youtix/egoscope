import 'server-only';

import { asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  eventImportWarnings,
  eventMarks,
  events,
  eventSources,
  eventStatusChanges,
} from '@/lib/db';

import { calendarEventOf, detectedEventOf, historicalEventOf } from './views';

import type {
  EventImportWarningRow,
  EventMarkRow,
  EventRow,
  EventSourceRow,
  EventStatusChangeRow,
} from './types';
import type { PlayerEvent } from './views';
import type { Database, Transaction } from '@/lib/db';
import type { SQL } from 'drizzle-orm';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

/** A source whose link was never checked (CL-IMP-25). */
export type UncheckedSource = Readonly<{ sourceId: number; url: string }>;

/** The rows that hang off events, by event, each list in its order. */
type Attachments = Readonly<{
  sources: ReadonlyMap<number, readonly EventSourceRow[]>;
  warnings: ReadonlyMap<number, readonly EventImportWarningRow[]>;
  marks: ReadonlyMap<number, readonly EventMarkRow[]>;
  statusChanges: ReadonlyMap<number, readonly EventStatusChangeRow[]>;
}>;

/** The rows that `read` gives for the events `ids`, by event; no read for no event. */
async function byEvent<R extends Readonly<{ playerEventId: number }>>(
  ids: readonly number[],
  read: (ids: readonly number[]) => Promise<R[]>,
): Promise<ReadonlyMap<number, readonly R[]>> {
  return ids.length === 0 ? new Map() : Map.groupBy(await read(ids), (row) => row.playerEventId);
}

/** The identifiers of the rows of `origin`. */
function idsOf(rows: readonly EventRow[], origin: EventRow['origin']): readonly number[] {
  return rows.filter((row) => row.origin === origin).map((row) => row.id);
}

/**
 * What hangs off `rows`: the sources of the historical and detected events, the import
 * warnings of the historical ones, the marks and status changes of the detected ones;
 * a calendar-derived event has none of them (CL-DSN-20).
 */
async function attachmentsOf(db: Reader, rows: readonly EventRow[]): Promise<Attachments> {
  const historicalIds = idsOf(rows, 'historical');
  const detectedIds = idsOf(rows, 'detected');
  return {
    sources: await byEvent([...historicalIds, ...detectedIds], async (ids) =>
      db
        .select()
        .from(eventSources)
        .where(inArray(eventSources.playerEventId, ids))
        .orderBy(asc(eventSources.position)),
    ),
    warnings: await byEvent(historicalIds, async (ids) =>
      db
        .select()
        .from(eventImportWarnings)
        .where(inArray(eventImportWarnings.playerEventId, ids))
        .orderBy(asc(eventImportWarnings.id)),
    ),
    marks: await byEvent(detectedIds, async (ids) =>
      db
        .select()
        .from(eventMarks)
        .where(inArray(eventMarks.playerEventId, ids))
        .orderBy(asc(eventMarks.id)),
    ),
    statusChanges: await byEvent(detectedIds, async (ids) =>
      db
        .select()
        .from(eventStatusChanges)
        .where(inArray(eventStatusChanges.playerEventId, ids))
        .orderBy(asc(eventStatusChanges.id)),
    ),
  };
}

/** The view of an event's row of any origin, with what hangs off it. */
function playerEventOf(row: EventRow, attached: Attachments): PlayerEvent {
  const sources = attached.sources.get(row.id) ?? [];
  if (row.origin === 'calendar') {
    return calendarEventOf(row);
  }
  return row.origin === 'historical'
    ? historicalEventOf(row, sources, attached.warnings.get(row.id) ?? [])
    : detectedEventOf(row, {
        sources,
        marks: attached.marks.get(row.id) ?? [],
        statusChanges: attached.statusChanges.get(row.id) ?? [],
      });
}

/** The events that `condition` selects, oldest first, each with what its origin holds. */
async function playerEventsWhere(db: Reader, condition: SQL): Promise<readonly PlayerEvent[]> {
  const rows = await db.select().from(events).where(condition).orderBy(asc(events.id));
  const attached = await attachmentsOf(db, rows);
  return rows.map((row) => playerEventOf(row, attached));
}

/**
 * The event `playerEventId` as recorded, with exactly the DSN-06 items that its origin
 * holds, or null when there is none (DSN-06, DSN-07, DSN-08, CL-DSN-20).
 */
export async function getEvent(db: Reader, playerEventId: number): Promise<PlayerEvent | null> {
  const [playerEvent] = await playerEventsWhere(db, eq(events.id, playerEventId));
  return playerEvent ?? null;
}

/** The events of a followed player, of every origin, in the order recorded (DSN-06, VUE-04). */
export async function eventsOfPlayer(
  db: Reader,
  playerId: string,
): Promise<readonly PlayerEvent[]> {
  return playerEventsWhere(db, eq(events.playerId, playerId));
}

/**
 * The sources whose link was never checked, oldest first, at most `limit`, for the
 * link-check job, which checks each new or corrected link once (IMP-17, CL-IMP-25).
 */
export async function uncheckedSources(
  db: Reader,
  limit: number,
): Promise<readonly UncheckedSource[]> {
  return db
    .select({ sourceId: eventSources.id, url: eventSources.url })
    .from(eventSources)
    .where(isNull(eventSources.linkCheckedAt))
    .orderBy(asc(eventSources.id))
    .limit(limit);
}

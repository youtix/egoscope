import 'server-only';

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { backtestRequests, events, eventSources, importEventOutcomes, imports } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import type { ImportEventOutcomeRow, ImportRow } from './types';
import type { ImportRefusal } from '@/lib/ai-exchange';
import type { Database, Transaction } from '@/lib/db';
import type { EventSourceRow } from '@/lib/events';
import type { EpochMs } from '@/lib/time';
import type { SQLWrapper } from 'drizzle-orm';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

/** The outcome of a result event as a row stores it (IMP-19). */
type StoredOutcome = ImportEventOutcomeRow['outcome'];

/**
 * What an import did, derived from its outcome rows, from the sources it attached to
 * events it did not bring, and from its stored deletion counts: `added` counts the events
 * added with a warning too, as the preview announces them (IMP-22, IMP-31, IMP-37).
 */
export type ImportTally = Readonly<{
  added: number;
  addedWithWarning: number;
  duplicatesNotAdded: number;
  sourcesAttached: number;
  ignored: number;
  refused: number;
  deletedByReplacement: number;
}>;

/** One saved import of the player's import history (IMP-31, CL-IMP-18). */
export type ImportHistoryEntry = Readonly<{
  importId: number;
  sequenceNumber: number;
  importedAt: EpochMs;
  backtestRequestId: number;
  requestReference: string;
  mode: ImportRow['mode'];
  tally: ImportTally;
  truncationRecovered: boolean;
  /** The events recovered from a cut result, its outcome rows; null without a recovery. */
  recoveredEventCount: number | null;
}>;

/**
 * An event refused at the request's last import: its rank in the result, its type and its
 * date as read, null when they had no slug or date shape, and its reason (IMP-24, CL-IMP-02).
 */
export type RemainingRefusal = Readonly<{
  position: number;
  eventTypeAsRead: string | null;
  dateAsRead: string | null;
  reason: ImportRefusal['reason'];
}>;

/** A source of an event with the marks that the import's checks left on it (IMP-17, IMP-23). */
export type TracedSource = Readonly<{
  sourceId: number;
  position: number;
  linkStatus: EventSourceRow['linkStatus'];
  spotCheckVerdict: EventSourceRow['spotCheckVerdict'];
}>;

/** What the import traces keep of one event (IMP-31). */
export type EventTrace = Readonly<{
  /** The number of the import that brought the event; null for an event no import brought. */
  originImportNumber: number | null;
  /** The numbers of the other imports that added sources to it, in their order. */
  sourceImportNumbers: readonly number[];
  sources: readonly TracedSource[];
}>;

/** The number of an import's outcome rows that hold one of `outcomes`. */
function outcomeCount(...outcomes: StoredOutcome[]) {
  return sql<number>`count(*) filter (where ${inArray(importEventOutcomes.outcome, outcomes)})`.mapWith(
    Number,
  );
}

/** The counts of an import's outcome rows that its tally shows, and the number of those rows. */
type OutcomeCounts = Readonly<
  Pick<ImportTally, 'added' | 'addedWithWarning' | 'duplicatesNotAdded' | 'ignored' | 'refused'> & {
    rows: number;
  }
>;

// The counts of an import that has no outcome row, an import of no event.
const NO_OUTCOME: OutcomeCounts = {
  added: 0,
  addedWithWarning: 0,
  duplicatesNotAdded: 0,
  ignored: 0,
  refused: 0,
  rows: 0,
};

/** The outcome counts of each import of the player that has outcome rows. */
async function outcomeCountsOfPlayer(
  db: Reader,
  playerId: string,
): Promise<ReadonlyMap<number, OutcomeCounts>> {
  const rows = await db
    .select({
      importId: importEventOutcomes.importId,
      added: outcomeCount('added', 'added_with_warning'),
      addedWithWarning: outcomeCount('added_with_warning'),
      duplicatesNotAdded: outcomeCount('duplicate_not_added'),
      ignored: outcomeCount('ignored'),
      refused: outcomeCount('refused'),
      rows: count(),
    })
    .from(importEventOutcomes)
    .innerJoin(imports, eq(imports.id, importEventOutcomes.importId))
    .where(eq(imports.playerId, playerId))
    .groupBy(importEventOutcomes.importId);
  return new Map(rows.map(({ importId, ...counts }) => [importId, counts]));
}

/**
 * The number of sources that each import of the player attached to events it did not
 * bring, the existing events of its duplicates (IMP-22): a source goes with its event.
 */
async function sourcesAttachedByPlayer(
  db: Reader,
  playerId: string,
): Promise<ReadonlyMap<number, number>> {
  const rows = await db
    .select({ importId: imports.id, attached: count() })
    .from(eventSources)
    .innerJoin(imports, eq(imports.id, eventSources.addedByImportId))
    .innerJoin(events, eq(events.id, eventSources.playerEventId))
    .where(
      and(
        eq(imports.playerId, playerId),
        sql`${events.originImportId} IS DISTINCT FROM ${imports.id}`,
      ),
    )
    .groupBy(imports.id);
  return new Map(rows.map((row) => [row.importId, row.attached]));
}

/**
 * The player's import history, newest first: each saved import with its number, its date,
 * its request's reference, its mode, its tally derived from its outcome rows and its
 * recovery of a cut result, whose number of events is that of its outcome rows, so that a
 * withdrawal lowers both. An attempt refused in full saved no import and is not listed
 * (IMP-31, IMP-37, CL-IMP-18, CL-IMP-33).
 */
export async function history(
  db: Reader,
  playerId: string,
): Promise<readonly ImportHistoryEntry[]> {
  const saved = await db
    .select({ row: imports, requestReference: backtestRequests.reference })
    .from(imports)
    .innerJoin(backtestRequests, eq(backtestRequests.id, imports.backtestRequestId))
    .where(eq(imports.playerId, playerId))
    .orderBy(desc(imports.importedAt), desc(imports.sequenceNumber));
  const outcomes = await outcomeCountsOfPlayer(db, playerId);
  const attached = await sourcesAttachedByPlayer(db, playerId);
  return saved.map(({ row, requestReference }) => {
    const { rows, ...counts } = outcomes.get(row.id) ?? NO_OUTCOME;
    return {
      importId: row.id,
      sequenceNumber: row.sequenceNumber,
      importedAt: toEpochMs(row.importedAt.getTime()),
      backtestRequestId: row.backtestRequestId,
      requestReference,
      mode: row.mode,
      tally: {
        ...counts,
        sourcesAttached: attached.get(row.id) ?? 0,
        deletedByReplacement: row.deletedByReplacementCount,
      },
      truncationRecovered: row.truncationRecovered,
      recoveredEventCount: row.truncationRecovered ? rows : null,
    };
  });
}

/** The refused outcome rows of the imports that `importIds` selects. */
function refusedOf(importIds: SQLWrapper) {
  return and(
    inArray(importEventOutcomes.importId, importIds),
    eq(importEventOutcomes.outcome, 'refused'),
  );
}

/**
 * The remaining refusals of a request: the refused events of its last saved import only,
 * by their rank, so that a later import into the same request replaces them and an import
 * into another request leaves them (IMP-24, H-IMP-12, CL-IMP-24).
 */
export async function remainingRefusals(
  db: Reader,
  backtestRequestId: number,
): Promise<readonly RemainingRefusal[]> {
  const lastImport = db
    .select({ id: imports.id })
    .from(imports)
    .where(eq(imports.backtestRequestId, backtestRequestId))
    .orderBy(desc(imports.importedAt), desc(imports.sequenceNumber))
    .limit(1);
  // A refused row always has its rank and a refusal reason (import_event_outcomes checks).
  return db
    .select({
      position: sql<number>`${importEventOutcomes.position}`,
      eventTypeAsRead: importEventOutcomes.eventTypeAsRead,
      dateAsRead: importEventOutcomes.dateAsRead,
      reason: sql<ImportRefusal['reason']>`${importEventOutcomes.reason}`,
    })
    .from(importEventOutcomes)
    .where(refusedOf(lastImport))
    .orderBy(asc(importEventOutcomes.position));
}

/**
 * The sum, over every request of the player, of its remaining refusals, those of its last
 * saved import, which each of his profiles shows (IMP-24, CL-IMP-24, CL-SEN-22).
 */
export async function remainingRefusalSum(db: Reader, playerId: string): Promise<number> {
  const lastImports = db
    .selectDistinctOn([imports.backtestRequestId], { id: imports.id })
    .from(imports)
    .where(eq(imports.playerId, playerId))
    .orderBy(imports.backtestRequestId, desc(imports.importedAt), desc(imports.sequenceNumber));
  const [row] = await db
    .select({ refused: count() })
    .from(importEventOutcomes)
    .where(refusedOf(lastImports));
  return row?.refused ?? 0;
}

/**
 * What the import traces keep of an event: the number of the import that brought it, the
 * numbers of the other imports that added sources to it, and each source, by its rank,
 * with its "not found" mark and its spot-check verdict; null when no such event exists
 * (IMP-17, IMP-23, IMP-31).
 */
export async function eventTrace(db: Reader, eventId: number): Promise<EventTrace | null> {
  const [event] = await db
    .select({ originImportNumber: imports.sequenceNumber })
    .from(events)
    .leftJoin(imports, eq(imports.id, events.originImportId))
    .where(eq(events.id, eventId));
  if (event === undefined) {
    return null;
  }
  const sources = await db
    .select({
      sourceId: eventSources.id,
      position: eventSources.position,
      linkStatus: eventSources.linkStatus,
      spotCheckVerdict: eventSources.spotCheckVerdict,
      addedByImportNumber: imports.sequenceNumber,
    })
    .from(eventSources)
    .leftJoin(imports, eq(imports.id, eventSources.addedByImportId))
    .where(eq(eventSources.playerEventId, eventId))
    .orderBy(asc(eventSources.position));
  const sourceImportNumbers = new Set(
    sources
      .map((source) => source.addedByImportNumber)
      .filter((number): number is number => number !== null && number !== event.originImportNumber),
  );
  return {
    originImportNumber: event.originImportNumber,
    sourceImportNumbers: [...sourceImportNumbers].toSorted((first, second) => first - second),
    sources: sources.map(({ sourceId, position, linkStatus, spotCheckVerdict }) => ({
      sourceId,
      position,
      linkStatus,
      spotCheckVerdict,
    })),
  };
}

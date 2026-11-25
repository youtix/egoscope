import 'server-only';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { eventImportWarnings, events, eventSources } from '@/lib/db';
import { toEpochMs, toIsoDate } from '@/lib/time';

import type { DateOrInstant, LinkStatus, SpotCheckVerdict } from './sources';
import type { EventImportWarningRow, EventRow, EventSourceRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs, IsoDate } from '@/lib/time';
import type { SQL } from 'drizzle-orm';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

/** Where a context indication comes from (SEN-18, H-09). */
export type ContextIndicationOrigin = NonNullable<EventRow['injuryReturnOrigin']>;

/** One context indication: a closed value, never a narrative, and its origin, null while unknown (DSN-07). */
export type ContextIndication<V extends string> = Readonly<{
  value: V;
  origin: ContextIndicationOrigin | null;
}>;

/** The context indications of an event, return from injury and game stakes (DSN-07, SEN-13, SEN-14). */
export type ContextIndications = Readonly<{
  injuryReturn: ContextIndication<EventRow['injuryReturn']>;
  gameStakes: ContextIndication<EventRow['gameStakes']>;
}>;

/** A source of an event as recorded, with what the import's checks found of it (DSN-06, DSN-08, IMP-17, IMP-23). */
export type PlayerEventSource = Readonly<{
  sourceId: number;
  position: number;
  url: string;
  cleanedUrl: string;
  outlet: string | null;
  title: string | null;
  publicationDate: DateOrInstant;
  addedByImportId: number | null;
  addedAt: EpochMs;
  linkStatus: LinkStatus | null;
  linkCheckedAt: EpochMs | null;
  spotCheckVerdict: SpotCheckVerdict | null;
}>;

/** A warning an import left on an event, naming another event by reference only (IMP-19, IMP-37). */
export type ImportWarning = Readonly<{
  importId: number | null;
  kind: EventImportWarningRow['kind'];
  field: string | null;
  sourceDropCause: EventImportWarningRow['sourceDropCause'];
  relatedPosition: number | null;
  relatedPlayerEventId: number | null;
}>;

/** What every event holds (DSN-06): its player, its type and sheet version, its description, its context and its management data. */
type EventBase = Readonly<{
  playerEventId: number;
  playerId: string;
  eventTypeId: string;
  sheetEventTypeId: string;
  sheetVersionNumber: number;
  description: string;
  context: ContextIndications;
  caseId: number | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  rowVersion: number;
}>;

/** An event saved by an import, dated by its public date, with its sources and import warnings (DSN-06, IMP-12 to IMP-19). */
export type HistoricalEvent = EventBase &
  Readonly<{
    origin: 'historical';
    typeLinkMark: EventRow['typeLinkMark'];
    referenceDate: DateOrInstant;
    researchConfidence: NonNullable<EventRow['researchConfidence']>;
    unverifiedNote: string | null;
    precedence: NonNullable<EventRow['precedence']>;
    originImportId: number;
    sources: readonly PlayerEventSource[];
    importWarnings: readonly ImportWarning[];
  }>;

/**
 * An event derived from the schedule, dated by its game's US Eastern day, whose game
 * stands for its sources: no source, no confidence, no precedence, no mark (CL-DSN-20,
 * CL-TRV-03, ADR 0015).
 */
export type CalendarDerivedEvent = EventBase &
  Readonly<{ origin: 'calendar'; referenceDate: IsoDate; derivedGameId: number }>;

/**
 * An event, discriminated by its origin (domain model README §2). The detected origin
 * joins it with `createDetected` (Lot 2); until then the reads give Lot 1 events only.
 */
export type PlayerEvent = HistoricalEvent | CalendarDerivedEvent;

/** A source whose link was never checked (CL-IMP-25). */
export type UncheckedSource = Readonly<{ sourceId: number; url: string }>;

// The origins whose events the reads give.
const LOT_1_ORIGINS = ['historical', 'calendar'] as const;

/** The instant of a `timestamptz` read back. */
const instant = (date: Date): EpochMs => toEpochMs(date.getTime());

/** A column that the row checks of its origin hold set (DSN-06): its absence is a bug. */
function present<T>(value: T | null, column: string): T {
  if (value === null) {
    throw new Error(`An event row holds no ${column}, which its origin requires.`);
  }
  return value;
}

/** A date as written, and its instant and offset when it had a time (CL-IMP-09). */
function dateOrInstant(on: string, at: Date | null, offsetMinutes: number | null): DateOrInstant {
  return at === null
    ? { on: toIsoDate(on), at: null }
    : { on: toIsoDate(on), at: instant(at), offsetMinutes: present(offsetMinutes, 'offset') };
}

/** What every event holds, from its row. */
function baseOf(row: EventRow): EventBase {
  return {
    playerEventId: row.id,
    playerId: row.playerId,
    eventTypeId: row.eventTypeId,
    sheetEventTypeId: row.sheetEventTypeId,
    sheetVersionNumber: row.sheetVersionNumber,
    description: row.description,
    context: {
      injuryReturn: { value: row.injuryReturn, origin: row.injuryReturnOrigin },
      gameStakes: { value: row.gameStakes, origin: row.gameStakesOrigin },
    },
    caseId: row.caseId,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    rowVersion: row.rowVersion,
  };
}

/** The view of a calendar-derived event's row (CL-DSN-20). */
export function calendarEventOf(row: EventRow): CalendarDerivedEvent {
  return {
    ...baseOf(row),
    origin: 'calendar',
    referenceDate: toIsoDate(present(row.referenceDateOn, 'reference date')),
    derivedGameId: present(row.derivedGameId, 'derived game'),
  };
}

/** The view of a source's row. */
function sourceOf(row: EventSourceRow): PlayerEventSource {
  return {
    sourceId: row.id,
    position: row.position,
    url: row.url,
    cleanedUrl: row.cleanedUrl,
    outlet: row.outlet,
    title: row.title,
    publicationDate: dateOrInstant(
      row.publicationDateOn,
      row.publicationAt,
      row.publicationOffsetMinutes,
    ),
    addedByImportId: row.addedByImportId,
    addedAt: instant(row.addedAt),
    linkStatus: row.linkStatus,
    linkCheckedAt: row.linkCheckedAt === null ? null : instant(row.linkCheckedAt),
    spotCheckVerdict: row.spotCheckVerdict,
  };
}

/** The view of an import warning's row. */
function warningOf(row: EventImportWarningRow): ImportWarning {
  return {
    importId: row.importId,
    kind: row.kind,
    field: row.field,
    sourceDropCause: row.sourceDropCause,
    relatedPosition: row.relatedPosition,
    relatedPlayerEventId: row.relatedPlayerEventId,
  };
}

/** The sources and import warnings of events, by event, each list in its order. */
type Attachments = Readonly<{
  sources: ReadonlyMap<number, readonly EventSourceRow[]>;
  warnings: ReadonlyMap<number, readonly EventImportWarningRow[]>;
}>;

/** The sources and import warnings of the events `ids`, in two reads, none for no event. */
async function attachmentsOf(db: Reader, ids: readonly number[]): Promise<Attachments> {
  if (ids.length === 0) {
    return { sources: new Map(), warnings: new Map() };
  }
  const sources = await db
    .select()
    .from(eventSources)
    .where(inArray(eventSources.playerEventId, ids))
    .orderBy(asc(eventSources.position));
  const warnings = await db
    .select()
    .from(eventImportWarnings)
    .where(inArray(eventImportWarnings.playerEventId, ids))
    .orderBy(asc(eventImportWarnings.id));
  return {
    sources: Map.groupBy(sources, (source) => source.playerEventId),
    warnings: Map.groupBy(warnings, (warning) => warning.playerEventId),
  };
}

/** The view of a historical event's row, with its sources and warnings (DSN-06). */
function historicalEventOf(
  row: EventRow,
  sources: readonly EventSourceRow[],
  warnings: readonly EventImportWarningRow[],
): HistoricalEvent {
  return {
    ...baseOf(row),
    origin: 'historical',
    typeLinkMark: row.typeLinkMark,
    referenceDate: dateOrInstant(
      present(row.referenceDateOn, 'reference date'),
      row.referenceAt,
      row.referenceOffsetMinutes,
    ),
    researchConfidence: present(row.researchConfidence, 'research confidence'),
    unverifiedNote: row.unverifiedNote,
    precedence: present(row.precedence, 'precedence'),
    originImportId: present(row.originImportId, 'origin import'),
    sources: sources.map((source) => sourceOf(source)),
    importWarnings: warnings.map((warning) => warningOf(warning)),
  };
}

/** The events that `condition` selects, oldest first, each with what its origin holds. */
async function playerEventsWhere(db: Reader, condition: SQL): Promise<readonly PlayerEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(condition, inArray(events.origin, LOT_1_ORIGINS)))
    .orderBy(asc(events.id));
  // Only a historical event has sources and import warnings.
  const historicalIds = rows.filter((row) => row.origin === 'historical').map((row) => row.id);
  const { sources, warnings } = await attachmentsOf(db, historicalIds);
  return rows.map((row) =>
    row.origin === 'calendar'
      ? calendarEventOf(row)
      : historicalEventOf(row, sources.get(row.id) ?? [], warnings.get(row.id) ?? []),
  );
}

/**
 * The event `playerEventId` as recorded, with exactly the DSN-06 items that its origin
 * holds, or null when there is none (DSN-06, DSN-07, DSN-08, CL-DSN-20).
 */
export async function getEvent(db: Reader, playerEventId: number): Promise<PlayerEvent | null> {
  const [playerEvent] = await playerEventsWhere(db, eq(events.id, playerEventId));
  return playerEvent ?? null;
}

/** The events of a followed player, of every Lot 1 origin, in the order recorded (DSN-06, VUE-04). */
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

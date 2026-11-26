// The views of the event record that its reads give, one per origin, and how each is
// built from its rows (module map, section 2.4). They sit apart from queries.ts only to
// keep each file within the size limits.
import 'server-only';

import { toEpochMs, toIsoDate } from '@/lib/time';

import type { DateOrInstant, LinkStatus, SpotCheckVerdict } from './sources';
import type {
  EventImportWarningRow,
  EventMarkRow,
  EventRow,
  EventSourceRow,
  EventStatusChangeRow,
} from './types';
import type { EpochMs, IsoDate } from '@/lib/time';

/** Where a context indication comes from (SEN-18, H-09). */
export type ContextIndicationOrigin = NonNullable<EventRow['injuryReturnOrigin']>;

/**
 * One context indication: a closed value, never a narrative, and its origin, which only
 * an unknown value may lack, as the row checks of `events` hold (DSN-07, H-09).
 */
export type ContextIndication<V extends string> =
  | Readonly<{ value: Extract<V, 'unknown'>; origin: ContextIndicationOrigin | null }>
  | Readonly<{ value: Exclude<V, 'unknown'>; origin: ContextIndicationOrigin }>;

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

/** How a detected event's reference date is computed, set at its creation (DET-30, CL-DET-27). */
export type ReferenceDateRule = NonNullable<EventRow['referenceDateRule']>;

/**
 * A detected event's reference date: an instant, always, with the precision of the
 * article or source that gives it, and the rule that computes it (DET-30, DET-31, CL-DET-27).
 */
export type DetectedReference = Readonly<{
  at: EpochMs;
  precision: NonNullable<EventRow['referenceDatePrecision']>;
  rule: ReferenceDateRule;
}>;

/** Where a detected event's classification comes from (DET-13, DET-49, CL-DET-07). */
export type ClassificationOrigin = NonNullable<EventRow['classificationOrigin']>;

/** Why the owner dismissed a detected event (DET-43). */
export type DismissalReason = NonNullable<EventRow['dismissalReason']>;

/** A stored mark of a detected event; "detected after tip-off" is derived instead (CL-DET-16). */
export type StoredEventMark = EventMarkRow['mark'];

/** A detected event's status, and the reason, comment and instant of its dismissal (DET-43, DET-46). */
export type DetectedState =
  | Readonly<{ detectedStatus: 'detected'; dismissal: null }>
  | Readonly<{
      detectedStatus: 'dismissed';
      dismissal: Readonly<{ reason: DismissalReason; comment: string | null; at: EpochMs }>;
    }>;

/** A mark of a detected event, with the instant it was set and the instant it was lifted (DET-32, CL-DET-06). */
export type DetectedEventMark = Readonly<{
  mark: StoredEventMark;
  status: EventMarkRow['status'];
  setAt: EpochMs;
  liftedAt: EpochMs | null;
}>;

/** A dismissal or a reinstatement, with its instant, and the reason and comment of a dismissal (DET-52). */
export type DetectedStatusRecord = Readonly<{
  changedAt: EpochMs;
  toStatus: DetectedState['detectedStatus'];
  dismissalReason: DismissalReason | null;
  dismissalComment: string | null;
}>;

/**
 * A dated public source that the owner added to a detected event: always timed, its
 * offset none when he gave no zone, and its precision (DET-48, CL-DET-26). An import
 * never changes a detected event (IMP-27), so it has no other source.
 */
export type OwnerAddedSource = Omit<PlayerEventSource, 'publicationDate' | 'addedByImportId'> &
  Readonly<{
    publicationDate: Readonly<{ on: IsoDate; at: EpochMs; offsetMinutes: number | null }>;
    publicationPrecision: NonNullable<EventSourceRow['publicationPrecision']>;
  }>;

/**
 * An event detected in the press (Lot 2), dated by its reference instant, with its
 * status, its detection confidence, its classification origin, its marks, its dismissals
 * and reinstatements, and the sources the owner added; its articles are detection's
 * (DSN-06, DET-30, DET-43 to DET-48, CL-DET-07).
 */
export type DetectedEvent = EventBase &
  DetectedState &
  Readonly<{
    origin: 'detected';
    typeLinkMark: EventRow['typeLinkMark'];
    referenceDate: DetectedReference;
    detectionConfidence: number | null;
    classificationOrigin: ClassificationOrigin;
    marks: readonly DetectedEventMark[];
    statusChanges: readonly DetectedStatusRecord[];
    sources: readonly OwnerAddedSource[];
  }>;

/** An event, discriminated by its origin (domain model README §2). */
export type PlayerEvent = HistoricalEvent | DetectedEvent | CalendarDerivedEvent;

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

/** The context indications of a row, a known value always with its origin (DSN-07, H-09). */
function contextOf(row: EventRow): ContextIndications {
  return {
    injuryReturn:
      row.injuryReturn === 'unknown'
        ? { value: row.injuryReturn, origin: row.injuryReturnOrigin }
        : { value: row.injuryReturn, origin: present(row.injuryReturnOrigin, 'context origin') },
    gameStakes:
      row.gameStakes === 'unknown'
        ? { value: row.gameStakes, origin: row.gameStakesOrigin }
        : { value: row.gameStakes, origin: present(row.gameStakesOrigin, 'context origin') },
  };
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
    context: contextOf(row),
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

/** What every source holds, from its row: all but its publication date and who added it. */
function sourceBaseOf(row: EventSourceRow) {
  return {
    sourceId: row.id,
    position: row.position,
    url: row.url,
    cleanedUrl: row.cleanedUrl,
    outlet: row.outlet,
    title: row.title,
    addedAt: instant(row.addedAt),
    linkStatus: row.linkStatus,
    linkCheckedAt: row.linkCheckedAt === null ? null : instant(row.linkCheckedAt),
    spotCheckVerdict: row.spotCheckVerdict,
  };
}

/** The view of a historical event's source. */
function sourceOf(row: EventSourceRow): PlayerEventSource {
  return {
    ...sourceBaseOf(row),
    publicationDate: dateOrInstant(
      row.publicationDateOn,
      row.publicationAt,
      row.publicationOffsetMinutes,
    ),
    addedByImportId: row.addedByImportId,
  };
}

/** The view of a source the owner added to a detected event (DET-48, CL-DET-26). */
function ownerSourceOf(row: EventSourceRow): OwnerAddedSource {
  return {
    ...sourceBaseOf(row),
    publicationDate: {
      on: toIsoDate(row.publicationDateOn),
      at: instant(present(row.publicationAt, 'publication instant')),
      offsetMinutes: row.publicationOffsetMinutes,
    },
    publicationPrecision: present(row.publicationPrecision, 'publication precision'),
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

/** The view of a historical event's row, with its sources and warnings (DSN-06). */
export function historicalEventOf(
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

/** A detected event's status and dismissal, from its row (DET-43, DET-46). */
function detectedStateOf(row: EventRow): DetectedState {
  return row.detectedStatus === 'dismissed'
    ? {
        detectedStatus: 'dismissed',
        dismissal: {
          reason: present(row.dismissalReason, 'dismissal reason'),
          comment: row.dismissalComment,
          at: instant(present(row.dismissedAt, 'dismissal instant')),
        },
      }
    : { detectedStatus: 'detected', dismissal: null };
}

/** The view of a mark's row. */
function markOf(row: EventMarkRow): DetectedEventMark {
  return {
    mark: row.mark,
    status: row.status,
    setAt: instant(row.setAt),
    liftedAt: row.resolvedAt === null ? null : instant(row.resolvedAt),
  };
}

/** The view of a status change's row. */
function statusChangeOf(row: EventStatusChangeRow): DetectedStatusRecord {
  return {
    changedAt: instant(row.changedAt),
    toStatus: row.toStatus,
    dismissalReason: row.dismissalReason,
    dismissalComment: row.dismissalComment,
  };
}

/** What hangs off a detected event, of which a new one has nothing yet. */
type DetectedAttachments = Readonly<{
  sources: readonly EventSourceRow[];
  marks: readonly EventMarkRow[];
  statusChanges: readonly EventStatusChangeRow[];
}>;

/** The view of a detected event's row, with its marks, status changes and owner-added sources (DSN-06). */
export function detectedEventOf(row: EventRow, attached: DetectedAttachments): DetectedEvent {
  return {
    ...baseOf(row),
    ...detectedStateOf(row),
    origin: 'detected',
    typeLinkMark: row.typeLinkMark,
    referenceDate: {
      at: instant(present(row.referenceAt, 'reference instant')),
      precision: present(row.referenceDatePrecision, 'reference precision'),
      rule: present(row.referenceDateRule, 'reference date rule'),
    },
    detectionConfidence: row.detectionConfidence,
    classificationOrigin: present(row.classificationOrigin, 'classification origin'),
    marks: attached.marks.map((mark) => markOf(mark)),
    statusChanges: attached.statusChanges.map((change) => statusChangeOf(change)),
    sources: attached.sources.map((source) => ownerSourceOf(source)),
  };
}

// The fields of a correction (IMP-32, DSN-20, DSN-21, CL-DSN-15): what the owner may
// correct of each origin, the checks of the texts and of the type, and the columns that
// each field changes. They sit apart from corrections.ts only to keep each file within
// the size limits.
import 'server-only';

import { and, eq, ne } from 'drizzle-orm';

import { checkText } from '@/lib/ai-exchange';
import { events, eventTypes } from '@/lib/db';
import { getParam } from '@/lib/params';

import { dateColumns, isSameDate } from './correction-sources';

import type { CorrectedSource, PublicDate } from './correction-sources';
import type { EventRow, NewEventCorrectionRow, NewEventRow } from './types';
import type { ClassificationOrigin, DetectedReference } from './views';
import type { TextRuleBreach } from '@/lib/ai-exchange';
import type { Transaction } from '@/lib/db';

/**
 * What a correction changes of an event: each field given is set to its value. A
 * detected event's reference date, detection confidence and classification origin are
 * the ones detection recomputes from its articles; a detached article and a merged
 * event are the detection actions that DET-52 traces (DET-30, DET-31, DET-47, CL-DET-07).
 */
export type EventChanges = Readonly<{
  playerId?: string;
  eventTypeId?: string;
  publicDate?: PublicDate;
  reference?: DetectedReference;
  description?: string;
  /** Every source the event keeps, in order: one left out is removed. */
  sources?: readonly CorrectedSource[];
  injuryReturn?: EventRow['injuryReturn'];
  gameStakes?: EventRow['gameStakes'];
  researchConfidence?: NonNullable<EventRow['researchConfidence']>;
  /** None to remove it. */
  unverifiedNote?: string | null;
  /** None once every result of the event is the owner's (CL-DET-07). */
  detectionConfidence?: number | null;
  classificationOrigin?: ClassificationOrigin;
  /** The article detached from the event: only its reference article lets the date move later (DET-31). */
  detachedArticle?: 'reference_article' | 'other_article';
  /** The detected event of the same player merged into this one, which the merge then erases (DET-47). */
  mergedEventId?: number;
}>;

/**
 * A field that a correction changes: one of `event_corrections.field`, or a value that
 * detection maintains on a detected event and that no entry traces (CL-DET-07).
 */
export type CorrectedField =
  NewEventCorrectionRow['field'] | 'detection_confidence' | 'classification_origin';

/** What is wrong with a free text: empty where one is required, or against the wording rules. */
export type TextProblem = 'required' | readonly TextRuleBreach[];

/**
 * The fields to fix, each with what is wrong with it: of a detected event, a reference
 * date later than its own without its reference article detached (DET-31), and a merged
 * event that is not another detected event of its player (DET-47).
 */
export type CorrectionFieldErrors = Readonly<{
  eventTypeId?: 'not_validated';
  description?: TextProblem;
  unverifiedNote?: TextProblem;
  reference?: 'later_without_detachment';
  mergedEventId?: 'not_a_detected_event_of_the_player';
}>;

/** A change of the event's own columns, for one field. */
export type FieldChange = Readonly<{ field: CorrectedField; set: Partial<NewEventRow> }>;

/** The checked changes: what is wrong, and the version in force of a new type. */
type CheckedChanges = Readonly<{ fields: CorrectionFieldErrors; version: number | null }>;

/** The columns that a field changes on `event`, none when it keeps its value. */
type Planner = (
  event: EventRow,
  changes: EventChanges,
  version: number | null,
) => Partial<NewEventRow> | null;

type ChangeKey = keyof EventChanges;

// Each key of a correction, and the field that it changes.
const FIELD_OF_KEY = [
  ['playerId', 'player'],
  ['eventTypeId', 'event_type'],
  ['publicDate', 'reference_date'],
  ['reference', 'reference_date'],
  ['description', 'description'],
  ['sources', 'sources'],
  ['injuryReturn', 'injury_return'],
  ['gameStakes', 'game_stakes'],
  ['researchConfidence', 'research_confidence'],
  ['unverifiedNote', 'unverified_note'],
  ['detectionConfidence', 'detection_confidence'],
  ['classificationOrigin', 'classification_origin'],
  ['detachedArticle', 'article_detached'],
  ['mergedEventId', 'event_merged_in'],
] as const satisfies readonly (readonly [ChangeKey, CorrectedField])[];
const CONTEXT_KEYS: readonly ChangeKey[] = ['injuryReturn', 'gameStakes'];
const OWNER = 'user';

/**
 * What a correction may change of each origin: of a calendar-derived event, its context
 * alone, its type, player and date being derived (CL-IHM-21, CL-DSN-20, ADR 0015); of a
 * detected event, its type, player, reference date, description and context, and what
 * detection recomputes or traces of its articles (DET-31, DET-47, CL-DET-07).
 */
const CORRECTABLE: Readonly<Record<EventRow['origin'], readonly ChangeKey[]>> = {
  historical: [
    'eventTypeId',
    'publicDate',
    'description',
    'sources',
    ...CONTEXT_KEYS,
    'researchConfidence',
    'unverifiedNote',
  ],
  calendar: CONTEXT_KEYS,
  detected: [
    'playerId',
    'eventTypeId',
    'reference',
    'description',
    ...CONTEXT_KEYS,
    'detectionConfidence',
    'classificationOrigin',
    'detachedArticle',
    'mergedEventId',
  ],
};

/**
 * The fields that `changes` gives and that an event of `origin` cannot take, in the
 * order of `event_corrections.field` (CL-IHM-21, CL-DSN-20).
 */
export function refusedFields(
  changes: EventChanges,
  origin: EventRow['origin'],
): readonly CorrectedField[] {
  const allowed = CORRECTABLE[origin];
  const refused = FIELD_OF_KEY.filter(
    ([key]) => changes[key] !== undefined && !allowed.includes(key),
  ).map(([, field]) => field);
  // A public date and a detected event's reference both change the reference date.
  return [...new Set(refused)];
}

/** The trimmed text of a free text, none for an empty one (DSN-10, CL-IMP-26). */
export function trimmed(text: string | null): string | null {
  const kept = text?.trim() ?? '';
  return kept === '' ? null : kept;
}

/** What is wrong with a free text of a correction, if anything (DSN-10, DSN-20, DSN-21, CL-IMP-26). */
export function textProblem(
  text: string | null | undefined,
  maxLength: number,
  isRequired: boolean,
): TextProblem | undefined {
  const kept = text === undefined ? undefined : trimmed(text);
  if (kept === null) {
    return isRequired ? 'required' : undefined;
  }
  const breaches = kept === undefined ? [] : checkText(kept, maxLength);
  return breaches.length > 0 ? breaches : undefined;
}

/** The sheet version in force of `eventTypeId` when it is validated, else none (TAX-23, CL-TAX-22). */
export async function versionInForce(tx: Transaction, eventTypeId: string): Promise<number | null> {
  const [type] = await tx
    .select({ status: eventTypes.status, version: eventTypes.currentVersionNumber })
    .from(eventTypes)
    .where(eq(eventTypes.id, eventTypeId));
  return type?.status === 'validated' ? type.version : null;
}

/**
 * Checks `changes` as at the event's creation: a validated type, a description and an
 * unverified note under the length and quotation-mark rules (DSN-20, DSN-21, CL-IMP-26).
 */
export async function checkChanges(
  tx: Transaction,
  changes: EventChanges,
): Promise<CheckedChanges> {
  const maxLength = await getParam(tx, 'events.maxDescriptionLength');
  const version =
    changes.eventTypeId === undefined ? null : await versionInForce(tx, changes.eventTypeId);
  const description = textProblem(changes.description, maxLength, true);
  const unverifiedNote = textProblem(changes.unverifiedNote, maxLength, false);
  const isTypeRefused = changes.eventTypeId !== undefined && version === null;
  return {
    fields: {
      ...(isTypeRefused && { eventTypeId: 'not_validated' }),
      ...(description !== undefined && { description }),
      ...(unverifiedNote !== undefined && { unverifiedNote }),
    },
    version,
  };
}

/** Whether `mergedEventId` is another detected event of the player of `event` (DET-47). */
async function isMergeable(
  tx: Transaction,
  event: EventRow,
  mergedEventId: number,
): Promise<boolean> {
  const [absorbed] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, mergedEventId),
        ne(events.id, event.id),
        eq(events.origin, 'detected'),
        eq(events.playerId, event.playerId),
      ),
    );
  return absorbed !== undefined;
}

/**
 * Checks the detected-event changes of `changes` on `event`: its reference date moves
 * later only when its reference article is detached (DET-31, DET-48, CL-DET-27), and only
 * another detected event of its player merges into it (DET-47). Nothing to fix for a key
 * that `changes` leaves out.
 */
export async function checkDetectedChanges(
  tx: Transaction,
  event: EventRow,
  { reference, detachedArticle, mergedEventId }: EventChanges,
): Promise<CorrectionFieldErrors> {
  const isLater =
    reference !== undefined &&
    event.referenceAt !== null &&
    reference.at > event.referenceAt.getTime();
  const isRefusedLater = isLater && detachedArticle !== 'reference_article';
  const isRefusedMerge =
    mergedEventId !== undefined && !(await isMergeable(tx, event, mergedEventId));
  return {
    ...(isRefusedLater && { reference: 'later_without_detachment' }),
    ...(isRefusedMerge && { mergedEventId: 'not_a_detected_event_of_the_player' }),
  };
}

// The columns each field changes, when its value differs from the stored one.
const PLANNERS: readonly (readonly [CorrectedField, Planner])[] = [
  [
    'event_type',
    (event, { eventTypeId }, version) =>
      eventTypeId === undefined || version === null || eventTypeId === event.eventTypeId
        ? null
        : { eventTypeId, sheetEventTypeId: eventTypeId, sheetVersionNumber: version, caseId: null },
  ],
  [
    'reference_date',
    (event, { publicDate }) => {
      const date = publicDate === undefined ? null : dateColumns(publicDate);
      const stored = {
        on: event.referenceDateOn,
        at: event.referenceAt,
        offset: event.referenceOffsetMinutes,
      };
      return date === null || isSameDate(stored, date)
        ? null
        : {
            referenceDateOn: date.on,
            referenceAt: date.at,
            referenceOffsetMinutes: date.offset,
            referenceDatePrecision: date.precision,
          };
    },
  ],
  [
    'description',
    (event, changes) => {
      const description = trimmed(changes.description ?? null);
      return description === null || description === event.description ? null : { description };
    },
  ],
  [
    'injury_return',
    (event, { injuryReturn }) =>
      injuryReturn === undefined || injuryReturn === event.injuryReturn
        ? null
        : { injuryReturn, injuryReturnOrigin: OWNER },
  ],
  [
    'game_stakes',
    (event, { gameStakes }) =>
      gameStakes === undefined || gameStakes === event.gameStakes
        ? null
        : { gameStakes, gameStakesOrigin: OWNER },
  ],
  [
    'research_confidence',
    (event, { researchConfidence }) =>
      researchConfidence === undefined || researchConfidence === event.researchConfidence
        ? null
        : { researchConfidence },
  ],
  [
    'unverified_note',
    (event, changes) => {
      const unverifiedNote =
        changes.unverifiedNote === undefined ? undefined : trimmed(changes.unverifiedNote);
      return unverifiedNote === undefined || unverifiedNote === event.unverifiedNote
        ? null
        : { unverifiedNote };
    },
  ],
];

/**
 * The changes of the event's own columns that `changes` makes, one per field whose value
 * differs: a new type with its sheet version in force, its case left for the
 * recalculation to re-derive (CL-TAX-22), and a context indication set by the owner (H-09).
 */
export function columnChanges(
  event: EventRow,
  changes: EventChanges,
  version: number | null,
): readonly FieldChange[] {
  const planned: FieldChange[] = [];
  for (const [field, planner] of PLANNERS) {
    const set = planner(event, changes, version);
    if (set !== null) {
      planned.push({ field, set });
    }
  }
  return planned;
}

// The stored value of each structured field that a correction traces (CL-DSN-15).
const VALUE_OF_FIELD: ReadonlyMap<CorrectedField, (event: EventRow) => string | null> = new Map([
  ['player', (event: EventRow) => event.playerId],
  ['event_type', (event: EventRow) => event.eventTypeId],
  ['reference_date', (event: EventRow) => event.referenceAt?.toISOString() ?? null],
  ['injury_return', (event: EventRow) => event.injuryReturn],
  ['game_stakes', (event: EventRow) => event.gameStakes],
]);

// The values that detection maintains on a detected event and that no entry traces.
const UNTRACED: ReadonlySet<CorrectedField> = new Set([
  'detection_confidence',
  'classification_origin',
]);

/**
 * Whether a changed field gets its entry in the correction history: every field but the
 * detection confidence and the classification origin, which follow the articles that the
 * traced action changed (DET-52, CL-DET-07).
 */
export function isTraced(field: CorrectedField): field is NewEventCorrectionRow['field'] {
  return !UNTRACED.has(field);
}

/**
 * The stored value of a structured field — player, type, reference instant in ISO 8601,
 * context indication — that the corrections of a detected event and the context
 * corrections of a calendar-derived one keep; none for a free text, the sources or an
 * action (DET-52, CA-DET-27, CL-DSN-15, CL-DSN-20).
 */
export function structuredValue(event: EventRow, field: CorrectedField): string | null {
  return VALUE_OF_FIELD.get(field)?.(event) ?? null;
}

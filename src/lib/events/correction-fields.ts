// The fields of a correction (IMP-32, DSN-20, DSN-21, CL-DSN-15): what the owner may
// correct of each origin, the checks of the texts and of the type, and the columns that
// each field changes. They sit apart from corrections.ts only to keep each file within
// the size limits.
import 'server-only';

import { eq } from 'drizzle-orm';

import { checkText } from '@/lib/ai-exchange';
import { eventTypes } from '@/lib/db';
import { getParam } from '@/lib/params';

import { dateColumns, isSameDate } from './correction-sources';

import type { CorrectedSource, PublicDate } from './correction-sources';
import type { EventRow, NewEventCorrectionRow, NewEventRow } from './types';
import type { TextRuleBreach } from '@/lib/ai-exchange';
import type { Transaction } from '@/lib/db';

/** What the owner corrects of an event: each field given is set to its value. */
export type EventChanges = Readonly<{
  playerId?: string;
  eventTypeId?: string;
  publicDate?: PublicDate;
  description?: string;
  /** Every source the event keeps, in order: one left out is removed. */
  sources?: readonly CorrectedSource[];
  injuryReturn?: EventRow['injuryReturn'];
  gameStakes?: EventRow['gameStakes'];
  researchConfidence?: NonNullable<EventRow['researchConfidence']>;
  /** None to remove it. */
  unverifiedNote?: string | null;
}>;

/** A field that a correction changes (`event_corrections.field`). */
export type CorrectedField = (typeof FIELD_OF_KEY)[number][1];

/** What is wrong with a free text: empty where one is required, or against the wording rules. */
export type TextProblem = 'required' | readonly TextRuleBreach[];

/** The fields to fix, each with what is wrong with it. */
export type CorrectionFieldErrors = Readonly<{
  eventTypeId?: 'not_validated';
  description?: TextProblem;
  unverifiedNote?: TextProblem;
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

// Each key of a correction, and the field of `event_corrections` that it changes.
const FIELD_OF_KEY = [
  ['playerId', 'player'],
  ['eventTypeId', 'event_type'],
  ['publicDate', 'reference_date'],
  ['description', 'description'],
  ['sources', 'sources'],
  ['injuryReturn', 'injury_return'],
  ['gameStakes', 'game_stakes'],
  ['researchConfidence', 'research_confidence'],
  ['unverifiedNote', 'unverified_note'],
] as const satisfies readonly (readonly [keyof EventChanges, NewEventCorrectionRow['field']])[];
const CONTEXT_FIELDS: readonly CorrectedField[] = ['injury_return', 'game_stakes'];
const OWNER = 'user';

/**
 * What the owner may correct of each origin: of a calendar-derived event, its context
 * alone, its type, player and date being derived (CL-IHM-21, CL-DSN-20, ADR 0015).
 */
export const CORRECTABLE: Readonly<Record<EventRow['origin'], readonly CorrectedField[]>> = {
  historical: [
    'event_type',
    'reference_date',
    'description',
    'sources',
    ...CONTEXT_FIELDS,
    'research_confidence',
    'unverified_note',
  ],
  calendar: CONTEXT_FIELDS,
  // The detected branch, with the values before and after of its structured fields
  // (DET-52), is the one that the detected-event task fills. It changes three places: this
  // entry; `correctionRows` in corrections.ts, which keeps values before and after only
  // for a calendar-derived event; and `PLANNERS` below, which has no planner for `player`,
  // so that an allowed `playerId` would otherwise change nothing and answer no change.
  detected: [],
};

/** The fields that `changes` gives, in the order of `event_corrections.field`. */
export function givenFields(changes: EventChanges): readonly CorrectedField[] {
  return FIELD_OF_KEY.filter(([key]) => changes[key] !== undefined).map(([, field]) => field);
}

/** The trimmed text of a free text, none for an empty one. */
function trimmed(text: string | null): string | null {
  const kept = text?.trim() ?? '';
  return kept === '' ? null : kept;
}

/** What is wrong with a free text of a correction, if anything (DSN-20, DSN-21, CL-IMP-26). */
function textProblem(
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

/** The stored value of a context field, which a calendar-derived event's corrections keep (CL-DSN-20). */
export function contextValue(event: EventRow, field: CorrectedField): string | null {
  if (!CONTEXT_FIELDS.includes(field)) {
    return null;
  }
  return field === 'injury_return' ? event.injuryReturn : event.gameStakes;
}

// The Lot 2 part of the event record (module map, section 2.4): the creation of a
// detected event, its status with its dismissals and reinstatements, its marks, and the
// detected branch of a correction, which detection writes only through these (rule 7).
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { eventMarks, events, eventStatusChanges } from '@/lib/db';
import { getParam } from '@/lib/params';
import { changedElsewhere, err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { textProblem, trimmed } from './correction-fields';
import { contextColumns, refusalOf } from './create';
import { detectedEventOf } from './views';

import type { CorrectedField, EventChanges, FieldChange, TextProblem } from './correction-fields';
import type { TextRefusal } from './create';
import type { EventRow, NewEventRow } from './types';
import type {
  ClassificationOrigin,
  ContextIndications,
  DetectedEvent,
  DetectedReference,
  DetectedState,
  DismissalReason,
  StoredEventMark,
} from './views';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';

/**
 * A detected event to create, with exactly the DSN-06 items of its origin: its player,
 * its type under the sheet version in force (DET-53, CL-DET-17), its reference date, its
 * description, its context from the creating fact, of origin `classification`, or
 * unknown for the owner's classification, its detection confidence, none for the
 * owner's, and its classification origin (DSN-06, DET-30, CL-DET-07).
 */
export type NewDetectedEvent = Readonly<{
  playerId: string;
  eventTypeId: string;
  sheetVersionNumber: number;
  reference: DetectedReference;
  description: string;
  context: ContextIndications;
  detectionConfidence: number | null;
  classificationOrigin: ClassificationOrigin;
}>;

/** A dismissal: its reason and, for `other`, the comment it requires (DET-43). */
export type NewDismissal =
  | Readonly<{ reason: Exclude<DismissalReason, 'other'> }>
  | Readonly<{ reason: 'other'; comment: string }>;

/**
 * A change of a detected event's status, or the setting or lifting of one of its marks,
 * sent with the `row_version` that the screen or the caller read (CL-IHM-18).
 */
export type DetectedStatusChange = Readonly<{ expectedVersion: number }> &
  (
    | Readonly<{ kind: 'dismiss'; dismissal: NewDismissal }>
    | Readonly<{ kind: 'reinstate' }>
    | Readonly<{ kind: 'set_mark' | 'lift_mark'; mark: StoredEventMark }>
  );

/** Why a status or mark change is refused. */
export type DetectedStatusRefusal =
  | Readonly<{ kind: 'not_detected' }>
  | Readonly<{ kind: 'status_unchanged'; detectedStatus: DetectedState['detectedStatus'] }>
  | Readonly<{ kind: 'invalid_comment'; problem: TextProblem }>
  | ChangedElsewhere<EventRow>
  | NoLongerExists;

/** A status or mark change: the event as it now stands, and whether the change did anything. */
export type StatusSaved = Readonly<{ event: EventRow; changed: boolean }>;

/** The status columns of a detected event, its dismissal instant aside. */
type StatusColumns = Readonly<{
  detectedStatus: DetectedState['detectedStatus'];
  dismissalReason: DismissalReason | null;
  dismissalComment: string | null;
}>;

/** The columns that a detected-event change sets, when its value differs from the stored one. */
type DetectedPlanner = (event: EventRow, changes: EventChanges) => Partial<NewEventRow> | null;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };
const NOT_DETECTED: DetectedStatusRefusal = { kind: 'not_detected' };
const NOTHING_ATTACHED = { sources: [], marks: [], statusChanges: [] } as const;

/**
 * Creates a detected event, the only way any module writes one (module map §1.2 rule 7),
 * with exactly the DSN-06 items of its origin and the status `detected`: its reference
 * instant with its precision and rule, its detection confidence and its classification
 * origin, and no mark until detection sets one (DSN-06, DET-30, CL-DET-07, CL-DET-27). A
 * description longer than `events.maxDescriptionLength`, read at this call, or holding a
 * quotation mark of CL-DSN-03 is refused, and nothing is written (DSN-20, DSN-21).
 */
export async function createDetected(
  tx: Transaction,
  event: NewDetectedEvent,
): Promise<Result<DetectedEvent, TextRefusal>> {
  const maxLength = await getParam(tx, 'events.maxDescriptionLength');
  const refusal = refusalOf(event.description, 'description', maxLength);
  if (refusal !== null) {
    return err(refusal);
  }
  const createdAt = new Date(now());
  const [created] = await tx
    .insert(events)
    .values({
      createdAt,
      updatedAt: createdAt,
      playerId: event.playerId,
      eventTypeId: event.eventTypeId,
      sheetEventTypeId: event.eventTypeId,
      sheetVersionNumber: event.sheetVersionNumber,
      origin: 'detected',
      referenceAt: new Date(event.reference.at),
      referenceDatePrecision: event.reference.precision,
      referenceDateRule: event.reference.rule,
      description: event.description,
      ...contextColumns(event.context),
      detectedStatus: 'detected',
      detectionConfidence: event.detectionConfidence,
      classificationOrigin: event.classificationOrigin,
    })
    .returning();
  if (created === undefined) {
    throw new Error('The detected event just written is not readable.');
  }
  return ok(detectedEventOf(created, NOTHING_ATTACHED));
}

/** Saves `set` on the locked event at `at`, moving its version on by one (CL-IHM-18). */
async function saved(
  tx: Transaction,
  event: EventRow,
  { set, at }: Readonly<{ set: Partial<NewEventRow>; at: Date }>,
): Promise<StatusSaved> {
  const [updated] = await tx
    .update(events)
    .set({ ...set, updatedAt: at, rowVersion: sql`${events.rowVersion} + 1` })
    .where(eq(events.id, event.id))
    .returning();
  if (updated === undefined) {
    throw new Error('The detected event locked for its change is not readable.');
  }
  return { event: updated, changed: true };
}

/** Moves the event to `status` now, and traces the move with its instant and reason (DET-46, DET-52). */
async function moveTo(
  tx: Transaction,
  event: EventRow,
  status: StatusColumns,
): Promise<StatusSaved> {
  const at = new Date(now());
  const dismissedAt = status.detectedStatus === 'dismissed' ? at : null;
  const outcome = await saved(tx, event, { set: { ...status, dismissedAt }, at });
  await tx.insert(eventStatusChanges).values({
    playerEventId: event.id,
    changedAt: at,
    toStatus: status.detectedStatus,
    dismissalReason: status.dismissalReason,
    dismissalComment: status.dismissalComment,
  });
  return outcome;
}

/** The comment of a dismissal, trimmed: required for `other` under the wording rules, else none (DET-43, DSN-10). */
async function commentOf(
  tx: Transaction,
  dismissal: NewDismissal,
): Promise<Result<string | null, DetectedStatusRefusal>> {
  if (dismissal.reason !== 'other') {
    return ok(null);
  }
  const maxLength = await getParam(tx, 'events.maxDescriptionLength');
  const problem = textProblem(dismissal.comment, maxLength, true);
  return problem === undefined
    ? ok(trimmed(dismissal.comment))
    : err({ kind: 'invalid_comment', problem });
}

/** Dismisses a detected event with its reason and comment (DET-43, DET-46). */
async function dismiss(
  tx: Transaction,
  event: EventRow,
  dismissal: NewDismissal,
): Promise<Result<StatusSaved, DetectedStatusRefusal>> {
  if (event.detectedStatus === 'dismissed') {
    return err({ kind: 'status_unchanged', detectedStatus: 'dismissed' });
  }
  const comment = await commentOf(tx, dismissal);
  if (!comment.ok) {
    return comment;
  }
  return ok(
    await moveTo(tx, event, {
      detectedStatus: 'dismissed',
      dismissalReason: dismissal.reason,
      dismissalComment: comment.value,
    }),
  );
}

/** Reinstates a dismissed event, its earlier dismissals kept in its history (DET-45). */
async function reinstate(
  tx: Transaction,
  event: EventRow,
): Promise<Result<StatusSaved, DetectedStatusRefusal>> {
  if (event.detectedStatus !== 'dismissed') {
    return err({ kind: 'status_unchanged', detectedStatus: 'detected' });
  }
  return ok(
    await moveTo(tx, event, {
      detectedStatus: 'detected',
      dismissalReason: null,
      dismissalComment: null,
    }),
  );
}

/**
 * Sets a mark never set on the event, or lifts a set one, each with its instant: a mark
 * that was lifted is never set again, nor its row rewritten (CL-DET-06, CL-DET-10).
 */
async function changeMark(
  tx: Transaction,
  event: EventRow,
  { kind, mark }: Readonly<{ kind: 'set_mark' | 'lift_mark'; mark: StoredEventMark }>,
): Promise<StatusSaved> {
  const at = new Date(now());
  const written =
    kind === 'set_mark'
      ? await tx
          .insert(eventMarks)
          .values({ playerEventId: event.id, mark, setAt: at })
          .onConflictDoNothing({ target: [eventMarks.playerEventId, eventMarks.mark] })
          .returning({ id: eventMarks.id })
      : await tx
          .update(eventMarks)
          .set({ status: 'lifted', resolvedAt: at })
          .where(
            and(
              eq(eventMarks.playerEventId, event.id),
              eq(eventMarks.mark, mark),
              eq(eventMarks.status, 'set'),
            ),
          )
          .returning({ id: eventMarks.id });
  return written.length === 0 ? { event, changed: false } : saved(tx, event, { set: {}, at });
}

/**
 * Changes, in the caller's transaction `tx`, the status or a mark of the detected event
 * `eventId`, if its version is still the one read (CL-IHM-18). A dismissal takes one
 * reason of DET-43 and, for `other`, a comment under the wording rules (DSN-10, DSN-20,
 * DSN-21); a reinstatement makes the event `detected` again (DET-45). Each writes a
 * status change with its instant, reason and comment, so that nothing of the history is
 * erased (DET-46, DET-52). A mark is set with its instant, once, and lifted with its
 * instant: a lifted mark is never set again, "dating to verify" above all (CL-DET-06),
 * and "possible duplicate of a historical event" is lifted when the owner states that it
 * is not the same fact (CL-DET-10). A change that does nothing leaves the version as it is.
 */
export async function setDetectedStatus(
  tx: Transaction,
  eventId: number,
  change: DetectedStatusChange,
): Promise<Result<StatusSaved, DetectedStatusRefusal>> {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
  if (event === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  if (event.rowVersion !== change.expectedVersion) {
    return err(changedElsewhere(event));
  }
  if (event.origin !== 'detected') {
    return err(NOT_DETECTED);
  }
  if (change.kind === 'dismiss') {
    return dismiss(tx, event, change.dismissal);
  }
  return change.kind === 'reinstate'
    ? reinstate(tx, event)
    : ok(await changeMark(tx, event, change));
}

/** Whether `reference` is the reference date, precision and rule that `event` holds. */
function isSameReference(event: EventRow, reference: DetectedReference): boolean {
  return (
    event.referenceAt?.getTime() === reference.at &&
    event.referenceDatePrecision === reference.precision &&
    event.referenceDateRule === reference.rule
  );
}

// The columns that each detected-event change sets; an action is traced whenever it is
// given, though it changes no column of its own (DET-52).
const DETECTED_PLANNERS: readonly (readonly [CorrectedField, DetectedPlanner])[] = [
  [
    'player',
    (event, { playerId }) =>
      playerId === undefined || playerId === event.playerId ? null : { playerId, caseId: null },
  ],
  [
    'reference_date',
    (event, { reference }) =>
      reference === undefined || isSameReference(event, reference)
        ? null
        : {
            referenceAt: new Date(reference.at),
            referenceDatePrecision: reference.precision,
            referenceDateRule: reference.rule,
          },
  ],
  [
    'detection_confidence',
    (event, { detectionConfidence }) =>
      detectionConfidence === undefined || detectionConfidence === event.detectionConfidence
        ? null
        : { detectionConfidence },
  ],
  [
    'classification_origin',
    (event, { classificationOrigin }) =>
      classificationOrigin === undefined || classificationOrigin === event.classificationOrigin
        ? null
        : { classificationOrigin },
  ],
  [
    'article_detached',
    (_event, { detachedArticle }) => (detachedArticle === undefined ? null : {}),
  ],
  ['event_merged_in', (_event, { mergedEventId }) => (mergedEventId === undefined ? null : {})],
];

/**
 * The changes of a detected event's own columns that `changes` makes, one per field whose
 * value differs: a new player, the case left for the recalculation to re-derive; the
 * reference instant with its precision and rule (DET-30, DET-31, CL-DET-27); the
 * detection confidence and classification origin (CL-DET-07); and the detached article
 * or merged event that DET-52 traces (DET-47). Nothing for a key that `changes` leaves out.
 */
export function detectedColumnChanges(
  event: EventRow,
  changes: EventChanges,
): readonly FieldChange[] {
  return DETECTED_PLANNERS.flatMap<FieldChange>(([field, planner]) => {
    const set = planner(event, changes);
    return set === null ? [] : { field, set };
  });
}

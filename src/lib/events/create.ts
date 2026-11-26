import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { checkText } from '@/lib/ai-exchange';
import { eventImportWarnings, events, games } from '@/lib/db';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';
import { sentence } from '@/lib/wording';

import { insertSourceRows, putInSourceOrder, sourceRows, timeColumns } from './sources';
import { calendarEventOf } from './views';

import type { DateOrInstant, NewSource, SourceAddition } from './sources';
import type {
  EventImportWarningRow,
  EventRow,
  NewEventImportWarningRow,
  NewEventRow,
} from './types';
import type { CalendarDerivedEvent, ContextIndications } from './views';
import type { TextRuleBreach } from '@/lib/ai-exchange';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

/** The free texts of an event that the wording rules check (DSN-20, DSN-21, CL-IMP-05). */
type CheckedText = 'description' | 'unverified_note';

/**
 * A text refused by the wording rules, with every rule it breaks: too long, naming the
 * maximum, or holding a quotation mark, naming it (DSN-20, DSN-21, CL-DSN-03).
 */
export type TextRefusal = Readonly<{
  kind: 'text_refused';
  field: CheckedText;
  breaches: readonly TextRuleBreach[];
}>;

/** A refused historical event: its text refusal and its index in the import's events. */
export type HistoricalRefusal = TextRefusal & Readonly<{ eventIndex: number }>;

type WarningKind = EventImportWarningRow['kind'];

/**
 * A warning that the import leaves on an event (IMP-19), named by its kind with, as the
 * kind requires, the format key of the text, the cause of a dropped source and the
 * position of the source concerned. A shared link names the other event that cites it,
 * recorded before or saved by the same import, by its index there; it is stored once
 * every event is, as a reference to that event, never as its rank (IMP-17, IMP-37).
 */
export type NewImportWarning =
  | Readonly<{
      kind: Exclude<WarningKind, 'shared_link'>;
      field?: string;
      sourceDropCause?: NonNullable<EventImportWarningRow['sourceDropCause']>;
      relatedPosition?: number;
    }>
  | Readonly<{
      kind: 'shared_link';
      sharedWith: Readonly<{ playerEventId: number }> | Readonly<{ eventIndex: number }>;
    }>;

/**
 * A historical event to save, with exactly the DSN-06 items of its origin: its player,
 * its type and the sheet version it was qualified under, its public date, its
 * description, its context as indicators only, with no field for a narrative or for
 * the result's precision (DSN-07), its research confidence, its unverified note, its
 * precedence, its sources and its import warnings.
 */
export type NewHistoricalEvent = Readonly<{
  playerId: string;
  eventTypeId: string;
  sheetEventTypeId: string;
  sheetVersionNumber: number;
  referenceDate: DateOrInstant;
  description: string;
  context: ContextIndications;
  researchConfidence: NonNullable<EventRow['researchConfidence']>;
  unverifiedNote: string | null;
  precedence: NonNullable<EventRow['precedence']>;
  sources: readonly NewSource[];
  warnings: readonly NewImportWarning[];
}>;

/** The events that one import saves, in its order. */
export type HistoricalImport = Readonly<{
  importId: number;
  events: readonly NewHistoricalEvent[];
}>;

/** A saved historical event, and the identifiers of its sources in the order given. */
export type CreatedHistorical = Readonly<{ playerEventId: number; sourceIds: readonly number[] }>;

/**
 * The template of a calendar-derived event's description, naming only the player and,
 * for a former-team event, that team (CL-DSN-20).
 */
export type CalendarDescription =
  | Readonly<{ template: 'birthday'; player: string }>
  | Readonly<{ template: 'former_team'; player: string; team: string }>;

/** A calendar-derived event to create: its player, type, the type's sheet version and its game (CL-DSN-20). */
export type NewCalendarDerivedEvent = Readonly<{
  playerId: string;
  eventTypeId: string;
  sheetVersionNumber: number;
  derivedGameId: number;
  description: CalendarDescription;
}>;

/** A calendar-derived event, and whether this call created it or found it recorded. */
export type CalendarCreation = Readonly<{ playerEvent: CalendarDerivedEvent; created: boolean }>;

/** The refusal of `text` by the wording rules under `maxLength`, or null when it passes (DSN-20, DSN-21, CL-DSN-03). */
export function refusalOf(
  text: string | null,
  field: CheckedText,
  maxLength: number,
): TextRefusal | null {
  const breaches = text === null ? [] : checkText(text, maxLength);
  return breaches.length === 0 ? null : { kind: 'text_refused', field, breaches };
}

/** The first refused text of the events, description before unverified note (DSN-20, DSN-21). */
function firstRefusal(
  batch: readonly NewHistoricalEvent[],
  maxLength: number,
): HistoricalRefusal | null {
  for (const [eventIndex, event] of batch.entries()) {
    const refusal =
      refusalOf(event.description, 'description', maxLength) ??
      refusalOf(event.unverifiedNote, 'unverified_note', maxLength);
    if (refusal !== null) {
      return { ...refusal, eventIndex };
    }
  }
  return null;
}

/** The columns of the context indications, each with its origin (DSN-07, H-09). */
export function contextColumns({
  injuryReturn,
  gameStakes,
}: ContextIndications): Pick<
  NewEventRow,
  'injuryReturn' | 'injuryReturnOrigin' | 'gameStakes' | 'gameStakesOrigin'
> {
  return {
    injuryReturn: injuryReturn.value,
    injuryReturnOrigin: injuryReturn.origin,
    gameStakes: gameStakes.value,
    gameStakesOrigin: gameStakes.origin,
  };
}

/** The row of a historical event saved at `savedAt`, dated as written, `approximate` unless timed (IMP-12, CL-IMP-09). */
function historicalRow(importId: number, event: NewHistoricalEvent, savedAt: Date): NewEventRow {
  const { at, offsetMinutes } = timeColumns(event.referenceDate);
  return {
    createdAt: savedAt,
    updatedAt: savedAt,
    playerId: event.playerId,
    eventTypeId: event.eventTypeId,
    sheetEventTypeId: event.sheetEventTypeId,
    sheetVersionNumber: event.sheetVersionNumber,
    origin: 'historical',
    referenceDateOn: event.referenceDate.on,
    referenceAt: at,
    referenceOffsetMinutes: offsetMinutes,
    referenceDatePrecision: at === null ? 'approximate' : 'exact',
    description: event.description,
    ...contextColumns(event.context),
    researchConfidence: event.researchConfidence,
    unverifiedNote: event.unverifiedNote,
    precedence: event.precedence,
    originImportId: importId,
  };
}

/** The identifier of the import's event at `index`: an index outside the import is a bug of the caller. */
function savedIdAt(savedIds: readonly number[], index: number): number {
  const id = savedIds[index];
  if (id === undefined) {
    throw new RangeError(`No event of the import has the index ${String(index)}.`);
  }
  return id;
}

/** The row of a warning on the event `playerEventId`, a shared link resolved to the other event's identifier. */
function warningRow(
  warning: NewImportWarning,
  playerEventId: number,
  saved: Readonly<{ importId: number; savedIds: readonly number[] }>,
): NewEventImportWarningRow {
  if (warning.kind !== 'shared_link') {
    return { ...warning, playerEventId, importId: saved.importId };
  }
  const { sharedWith } = warning;
  return {
    playerEventId,
    importId: saved.importId,
    kind: 'shared_link',
    relatedPlayerEventId:
      'playerEventId' in sharedWith
        ? sharedWith.playerEventId
        : savedIdAt(saved.savedIds, sharedWith.eventIndex),
  };
}

/** Writes the import warnings of the saved events, once every event of the import is saved (IMP-19, IMP-37). */
async function writeWarnings(
  tx: Transaction,
  batch: readonly NewHistoricalEvent[],
  saved: Readonly<{ importId: number; savedIds: readonly number[] }>,
): Promise<void> {
  const rows = batch.flatMap((event, index) =>
    event.warnings.map((warning) => warningRow(warning, savedIdAt(saved.savedIds, index), saved)),
  );
  if (rows.length > 0) {
    await tx.insert(eventImportWarnings).values(rows);
  }
}

/** Each saved event with the identifiers of its sources, cut from `sourceIds` in the order written. */
function withSourceIds(
  additions: readonly SourceAddition[],
  sourceIds: readonly number[],
): readonly CreatedHistorical[] {
  let end = 0;
  return additions.map(({ playerEventId, sources }) => {
    end += sources.length;
    return { playerEventId, sourceIds: sourceIds.slice(end - sources.length, end) };
  });
}

/**
 * Refuses, as a bug of the caller, an event without a source: DSN-06 gives every event
 * one source or more, and the import refuses a sourceless one at validation (IMP-14).
 */
function requireSources(batch: readonly NewHistoricalEvent[]): void {
  const sourceless = batch.findIndex((event) => event.sources.length === 0);
  if (sourceless !== -1) {
    throw new RangeError(
      `The event of the import at the index ${String(sourceless)} has no source, which DSN-06 requires.`,
    );
  }
}

/**
 * Saves the events of an import, the only way any module writes a historical event
 * (module map §1.2 rule 7), with exactly the DSN-06 items of its origin (DSN-06,
 * DSN-07, CA-DSN-02): each event, its sources with each link and title as given (DSN-08)
 * in the order of CL-IMP-16, then its import warnings, after every event so that a
 * shared link names the other event by reference (IMP-17, IMP-37). A description or an
 * unverified note longer than `events.maxDescriptionLength`, read at this call, or
 * holding a quotation mark of CL-DSN-03 is refused, and nothing is written (DSN-20,
 * DSN-21). An event without a source is a bug of the caller, which throws (DSN-06,
 * IMP-14). Gives each saved event and its sources, in the order of the import.
 */
export async function createHistorical(
  tx: Transaction,
  { importId, events: batch }: HistoricalImport,
): Promise<Result<readonly CreatedHistorical[], HistoricalRefusal>> {
  requireSources(batch);
  const refusal = firstRefusal(batch, await getParam(tx, 'events.maxDescriptionLength'));
  if (refusal !== null) {
    return err(refusal);
  }
  if (batch.length === 0) {
    return ok([]);
  }
  const savedAt = new Date(now());
  const written = await tx
    .insert(events)
    .values(batch.map((event) => historicalRow(importId, event, savedAt)))
    .returning({ id: events.id });
  // An identity grows row by row through one statement: ascending is the order written.
  const savedIds = written.map(({ id }) => id).toSorted((left, right) => left - right);
  const additions = batch.map((event, index) => ({
    playerEventId: savedIdAt(savedIds, index),
    importId,
    sources: event.sources,
  }));
  const sourceIds = await insertSourceRows(
    tx,
    additions.flatMap((addition) => sourceRows(addition, 1)),
  );
  await putInSourceOrder(tx, savedIds);
  await writeWarnings(tx, batch, { importId, savedIds });
  return ok(withSourceIds(additions, sourceIds));
}

/** The description that the application writes from its fixed template (CL-DSN-20, CL-DSN-02). */
function templateDescription(description: CalendarDescription): string {
  return description.template === 'birthday'
    ? sentence('sensitiveData.birthdayDescription', { player: description.player })
    : sentence('sensitiveData.formerTeamDescription', {
        player: description.player,
        team: description.team,
      });
}

/** The calendar-derived event of the player, type and game of `event`, if one is recorded (CL-TAX-18). */
async function recordedCalendarEvent(
  tx: Transaction,
  event: NewCalendarDerivedEvent,
): Promise<EventRow | undefined> {
  const [recorded] = await tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.playerId, event.playerId),
        eq(events.eventTypeId, event.eventTypeId),
        eq(events.derivedGameId, event.derivedGameId),
        eq(events.origin, 'calendar'),
      ),
    );
  return recorded;
}

/**
 * Creates the calendar-derived event of a player, type and game, the only way any
 * module writes one (module map §1.2 rule 7), holding only what CL-DSN-20 lists: its
 * player, its type under the sheet version given, its game, dated by the game's US
 * Eastern day (CL-TRV-03), the application's template description, under the wording
 * rules like every description (DSN-20, DSN-21, CL-DSN-03), and its context unknown
 * until the owner sets it (H-09); no source, confidence, precedence or mark (DSN-06).
 * Idempotent: the event of a player, type and game already recorded is given back as
 * it is, whatever its description would now be (CL-TAX-18); only a new one is checked.
 */
export async function createCalendarDerived(
  tx: Transaction,
  event: NewCalendarDerivedEvent,
): Promise<Result<CalendarCreation, TextRefusal>> {
  const recorded = await recordedCalendarEvent(tx, event);
  if (recorded !== undefined) {
    return ok({ playerEvent: calendarEventOf(recorded), created: false });
  }
  const description = templateDescription(event.description);
  const maxLength = await getParam(tx, 'events.maxDescriptionLength');
  const refusal = refusalOf(description, 'description', maxLength);
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
      origin: 'calendar',
      referenceDateOn: sql`(SELECT ${games.gameDayOn} FROM ${games} WHERE ${games.id} = ${event.derivedGameId})`,
      description,
      derivedGameId: event.derivedGameId,
    })
    .onConflictDoNothing({
      target: [events.playerId, events.eventTypeId, events.derivedGameId],
      where: sql`origin = 'calendar'`,
    })
    .returning();
  // Another transaction may have recorded it since the read: that one is given back.
  const playerEvent = created ?? (await recordedCalendarEvent(tx, event));
  if (playerEvent === undefined) {
    throw new Error('The calendar-derived event that blocked the insert is not readable.');
  }
  return ok({ playerEvent: calendarEventOf(playerEvent), created: created !== undefined });
}

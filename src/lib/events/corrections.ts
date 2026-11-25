import 'server-only';

import { eq } from 'drizzle-orm';

import { eventCorrections, events, updateVersioned } from '@/lib/db';
import { changedElsewhere, err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import {
  checkChanges,
  columnChanges,
  contextValue,
  CORRECTABLE,
  givenFields,
} from './correction-fields';
import { plannedSources, saveSources } from './correction-sources';

import type { CorrectedField, CorrectionFieldErrors, EventChanges } from './correction-fields';
import type { EventRow, NewEventRow } from './types';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';

/** A correction as the edit screen sends it, with the `row_version` it showed (CL-IHM-18). */
export type EventCorrection = EventChanges & Readonly<{ expectedVersion: number }>;

/** Why a correction is refused. */
export type CorrectionRefusal =
  | Readonly<{ kind: 'not_correctable'; fields: readonly CorrectedField[] }>
  | Readonly<{ kind: 'invalid_fields'; fields: CorrectionFieldErrors }>
  | ChangedElsewhere<EventRow>
  | NoLongerExists;

/** A saved correction: the event as it now stands, and the fields it changed. */
export type Corrected = Readonly<{ event: EventRow; changed: readonly CorrectedField[] }>;

type EventSet = Partial<NewEventRow>;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };

/**
 * The correction rows of `fields` at `at`: values before and after only for a
 * calendar-derived event's context, never for a historical event nor a free text (IMP-32,
 * CL-DSN-15, CL-DSN-20).
 */
function correctionRows(
  before: EventRow,
  after: EventRow,
  fields: readonly CorrectedField[],
): (typeof eventCorrections.$inferInsert)[] {
  const isKeepingValues = before.origin === 'calendar';
  return fields.map((field) => ({
    playerEventId: before.id,
    correctedAt: after.updatedAt,
    field,
    beforeValue: isKeepingValues ? contextValue(before, field) : null,
    afterValue: isKeepingValues ? contextValue(after, field) : null,
  }));
}

/** The columns that `changes` set together, with the instant of the change. */
function mergedSet(changes: readonly Readonly<{ set: EventSet }>[], at: Date): EventSet {
  const set: EventSet = { updatedAt: at };
  for (const change of changes) {
    Object.assign(set, change.set);
  }
  return set;
}

/** Saves the changes, the sources and one correction row per field changed, if the version is still the one shown. */
async function save(
  tx: Transaction,
  event: EventRow,
  checked: Readonly<{ correction: EventCorrection; version: number | null }>,
): Promise<Result<Corrected, CorrectionRefusal>> {
  const { correction, version } = checked;
  const sources = await plannedSources(tx, event.id, correction.sources);
  const changes = [
    ...columnChanges(event, correction, version),
    ...(sources === null ? [] : [{ field: 'sources' as const, set: {} }]),
  ];
  if (changes.length === 0) {
    return ok({ event, changed: [] });
  }
  const at = new Date(now());
  const updated = await updateVersioned(tx, events, {
    where: eq(events.id, event.id),
    expectedVersion: correction.expectedVersion,
    set: mergedSet(changes, at),
  });
  if (!updated.ok) {
    return updated;
  }
  if (sources !== null) {
    await saveSources(tx, sources, { eventId: event.id, at });
  }
  const fields = changes.map((change) => change.field);
  await tx.insert(eventCorrections).values(correctionRows(event, updated.value, fields));
  return ok({ event: updated.value, changed: fields });
}

/**
 * Corrects event `eventId` in the caller's transaction `tx` with the fields that
 * `correction` gives, if its version is still the one the screen showed (CL-IHM-18). A
 * historical event takes a validated type, stamped with its sheet version in force and
 * leaving its case for the recalculation to re-derive (CL-TAX-22), a public date, a
 * description and an unverified note under the length and quotation-mark rules of their
 * creation (DSN-20, DSN-21), sources whose corrected or added links lose their check
 * (CL-IMP-25), its context and its research confidence; a calendar-derived event its
 * context alone, never its type, player or date (ADR 0015, CL-IHM-21). Writes one
 * correction row per field changed with its instant, keeping values before and after only
 * of a calendar-derived event's context, never of a historical event nor a free text
 * (IMP-32, CL-DSN-15, CL-DSN-20). A detected event is refused until its own branch, with
 * the values of DET-52, exists.
 */
export async function applyCorrection(
  tx: Transaction,
  eventId: number,
  correction: EventCorrection,
): Promise<Result<Corrected, CorrectionRefusal>> {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (event === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  if (event.rowVersion !== correction.expectedVersion) {
    return err(changedElsewhere(event));
  }
  const allowed = CORRECTABLE[event.origin];
  const refused = givenFields(correction).filter((field) => !allowed.includes(field));
  if (refused.length > 0) {
    return err({ kind: 'not_correctable', fields: refused });
  }
  const { fields, version } = await checkChanges(tx, correction);
  return Object.keys(fields).length > 0
    ? err({ kind: 'invalid_fields', fields })
    : save(tx, event, { correction, version });
}

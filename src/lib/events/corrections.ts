import 'server-only';

import { eq } from 'drizzle-orm';

import { eventCorrections, events, followedPlayers, isUuid, updateVersioned } from '@/lib/db';
import { changedElsewhere, err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import {
  checkChanges,
  checkDetectedChanges,
  columnChanges,
  isTraced,
  refusedFields,
  structuredValue,
} from './correction-fields';
import { plannedSources, saveSources } from './correction-sources';
import { detectedColumnChanges } from './status';

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
  | Readonly<{ kind: 'player_not_followed' }>
  | ChangedElsewhere<EventRow>
  | NoLongerExists;

/** A saved correction: the event as it now stands, and the fields it changed. */
export type Corrected = Readonly<{ event: EventRow; changed: readonly CorrectedField[] }>;

type EventSet = Partial<NewEventRow>;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };
const PLAYER_NOT_FOLLOWED: CorrectionRefusal = { kind: 'player_not_followed' };

/** Whether `playerId` names a followed player, in any of his states (DET-47, JOU-15). */
async function isFollowed(tx: Transaction, playerId: string): Promise<boolean> {
  // A followed player's id is a random uuid, which Postgres refuses to compare with other text.
  if (!isUuid(playerId)) {
    return false;
  }
  const [player] = await tx
    .select({ id: followedPlayers.id })
    .from(followedPlayers)
    .where(eq(followedPlayers.id, playerId))
    // A deletion that commits after this check then waits, instead of reaching the foreign key.
    .for('key share');
  return player !== undefined;
}

/** The refusal of a correction that moves `event` to a player who is not followed (DET-47). */
async function refusedPlayer(
  tx: Transaction,
  event: EventRow,
  { playerId }: EventCorrection,
): Promise<CorrectionRefusal | null> {
  const isMoved = playerId !== undefined && playerId !== event.playerId;
  return isMoved && !(await isFollowed(tx, playerId)) ? PLAYER_NOT_FOLLOWED : null;
}

/**
 * Writes the correction rows of the traced `fields`: values before and after only for the
 * structured fields of a detected or calendar-derived event, never for a historical event,
 * a free text, the sources or an action (IMP-32, DET-52, CL-DSN-15, CL-DSN-20).
 */
async function writeCorrections(
  tx: Transaction,
  states: Readonly<{ before: EventRow; after: EventRow }>,
  fields: readonly CorrectedField[],
): Promise<void> {
  const { before, after } = states;
  const isKeepingValues = before.origin !== 'historical';
  const rows = fields
    .filter((field) => isTraced(field))
    .map((field) => ({
      playerEventId: before.id,
      correctedAt: after.updatedAt,
      field,
      beforeValue: isKeepingValues ? structuredValue(before, field) : null,
      afterValue: isKeepingValues ? structuredValue(after, field) : null,
    }));
  if (rows.length > 0) {
    await tx.insert(eventCorrections).values(rows);
  }
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
    ...detectedColumnChanges(event, correction),
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
  await writeCorrections(tx, { before: event, after: updated.value }, fields);
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
 * context alone, never its type, player or date (ADR 0015, CL-IHM-21); a detected event
 * its type, its player, its description and context, its reference instant, precision
 * and rule, later only once its reference article is detached, its detection confidence
 * and classification origin, and the detached article or merged event it traces (DET-31,
 * DET-47, DET-53, CL-DET-07, CL-DET-27). A detected event moves only to a followed player,
 * in any of the three states of JOU-15, active, paused or withdrawn, since what detection,
 * alerts and requests do for a paused or withdrawn player is decided elsewhere (JOU-18,
 * JOU-19, CL-JOU-05): any other id, a malformed one included, is refused before the field
 * checks and writes nothing (DET-47). Writes one correction row per traced field
 * changed with its instant, keeping values before and after only of the structured fields
 * of a detected or calendar-derived event, never of a historical event, a free text, the
 * sources or an action (IMP-32, DET-52, CL-DSN-15, CL-DSN-20).
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
  const refused = refusedFields(correction, event.origin);
  if (refused.length > 0) {
    return err({ kind: 'not_correctable', fields: refused });
  }
  const player = await refusedPlayer(tx, event, correction);
  if (player !== null) {
    return err(player);
  }
  const checked = await checkChanges(tx, correction);
  const fields = { ...checked.fields, ...(await checkDetectedChanges(tx, event, correction)) };
  return Object.keys(fields).length > 0
    ? err({ kind: 'invalid_fields', fields })
    : save(tx, event, { correction, version: checked.version });
}

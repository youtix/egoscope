// The owner's corrections and deletions of events (IMP-32, IMP-33, ADR 0015): the checks
// of historical-checks.ts, the writes through `events`, the recalculation through
// `sensitivity`, the link check of the corrected links, and the journal entry of each.
import 'server-only';

import { applyCorrection, deleteHistorical as deleteHistoricalEvent, getEvent } from '@/lib/events';
import { record } from '@/lib/journal';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { requestRecalculation } from '@/lib/sensitivity';
import { now } from '@/lib/time';
import { wakeAt } from '@/lib/wake-plan';

import { checkedCorrection } from './historical-checks';

import type { FailedChecks, HistoricalCorrection } from './historical-checks';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type {
  Corrected,
  CorrectedField,
  CorrectionRefusal,
  DeletionRefusal,
  ErasedEvent,
  EventCorrection,
  HistoricalDeletion,
  PlayerEvent,
} from '@/lib/events';
import type { Result } from '@/lib/result';

/**
 * Why a correction is refused: by `events.applyCorrection`, by the import's checks, or for
 * a detected event, which `detection` corrects (Lot 2).
 */
export type HistoricalCorrectionRefusal =
  CorrectionRefusal | FailedChecks | Readonly<{ kind: 'detected_event' }>;

type Planned = Result<EventCorrection, HistoricalCorrectionRefusal>;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };
const DETECTED_EVENT: HistoricalCorrectionRefusal = { kind: 'detected_event' };
const CAUSE = 'event_corrected_or_removed';
const LINK_CHECK_TASK = 'link-check';

// What a calendar-derived event keeps, its context alone being correctable (ADR 0015, CL-IHM-21).
const CALENDAR_FIXED = [
  ['playerId', 'player'],
  ['eventTypeId', 'event_type'],
  ['publicDate', 'reference_date'],
  ['description', 'description'],
  ['sources', 'sources'],
  ['researchConfidence', 'research_confidence'],
  ['unverifiedNote', 'unverified_note'],
] as const satisfies readonly (readonly [keyof HistoricalCorrection, CorrectedField])[];

/**
 * The correction of a calendar-derived event: its two context indications alone, any
 * other field refused before its value is read (ADR 0015, CL-IHM-21, CL-DSN-20).
 */
function calendarCorrection(correction: HistoricalCorrection): Planned {
  const fields = CALENDAR_FIXED.filter(([key]) => correction[key] !== undefined).map(
    ([, field]) => field,
  );
  if (fields.length > 0) {
    return err({ kind: 'not_correctable', fields });
  }
  const { expectedVersion, injuryReturn, gameStakes } = correction;
  return ok({
    expectedVersion,
    ...(injuryReturn !== undefined && { injuryReturn }),
    ...(gameStakes !== undefined && { gameStakes }),
  });
}

/** The correction that `events` applies to `event`, or why it is refused. */
async function plannedCorrection(
  tx: Transaction,
  event: PlayerEvent,
  correction: HistoricalCorrection,
): Promise<Planned> {
  switch (event.origin) {
    case 'historical': {
      return checkedCorrection(tx, event, correction);
    }
    case 'calendar': {
      return calendarCorrection(correction);
    }
    case 'detected': {
      return err(DETECTED_EVENT);
    }
  }
}

/** Requests the recalculation of the player's profiles of the types a change touched (SEN-34, CL-SEN-17). */
async function recalculate(
  tx: Transaction,
  playerId: string,
  eventTypeIds: readonly string[],
): Promise<void> {
  const scope = { kind: 'event_or_case_change', playerIds: [playerId], eventTypeIds } as const;
  await requestRecalculation(tx, scope, CAUSE);
}

/**
 * What follows a saved correction of `before`: its journal entry, the recalculation of
 * its old and new types, which classifies its precedence again before any calculation
 * (CL-IMP-17), and the wake of the link check when its sources changed (CL-IMP-25).
 */
async function followCorrection(
  tx: Transaction,
  before: PlayerEvent,
  corrected: Corrected,
): Promise<void> {
  await record(tx, {
    messageKey: 'historical_event_corrected',
    playerEventId: before.playerEventId,
  });
  const types = new Set([before.eventTypeId, corrected.event.eventTypeId]);
  await recalculate(tx, before.playerId, [...types]);
  if (corrected.changed.includes('sources') && (await getParam(tx, 'imports.linkCheckEnabled'))) {
    await wakeAt(now(), LINK_CHECK_TASK);
  }
}

/**
 * Corrects event `eventId` in the caller's transaction `tx`, if its version is still the
 * one the screen showed (CL-IHM-18). A historical event takes a validated type, a public
 * date and time, a description, sources (at least one), its context, its research
 * confidence and its unverified note, once the event it would leave passes the import's
 * checks of IMP-11 to IMP-14 against the player's NBA career up to the day of the
 * correction: a correction that would make the import refuse or ignore it, or drop one of
 * its sources, is refused with the import's codes (IMP-32, CL-IMP-31). A typed time,
 * 00:00 included, is read in its zone, the owner's by default. A calendar-derived event
 * takes its two context indications alone (ADR 0015, CL-IHM-21); a detected event is
 * `detection`'s. `events.applyCorrection` writes the change, traced with its date and
 * fields and never an old value of a historical event, and clears the check of a
 * corrected link (CL-IMP-25). A change is journaled, recalculates the player's profiles of
 * its types, and wakes the link check when its sources changed and the check is on (IMP-17).
 */
export async function correctHistorical(
  tx: Transaction,
  eventId: number,
  correction: HistoricalCorrection,
): Promise<Result<Corrected, HistoricalCorrectionRefusal>> {
  const event = await getEvent(tx, eventId);
  if (event === null) {
    return err(NO_LONGER_EXISTS);
  }
  if (event.rowVersion !== correction.expectedVersion) {
    // `applyCorrection` refuses a stale version before it reads any change (CL-IHM-18).
    return applyCorrection(tx, eventId, { expectedVersion: correction.expectedVersion });
  }
  const planned = await plannedCorrection(tx, event, correction);
  if (!planned.ok) {
    return planned;
  }
  const corrected = await applyCorrection(tx, eventId, planned.value);
  if (corrected.ok && corrected.value.changed.length > 0) {
    await followCorrection(tx, event, corrected.value);
  }
  return corrected;
}

/**
 * Deletes the historical event `eventId` by the owner's hand, in the caller's transaction
 * `tx`, for one of the closed reasons of IMP-33, `other` with its short precision, if its
 * version is still the one the page showed (CL-IHM-18): `events.deleteHistorical` refuses
 * any other reason, a detected or calendar-derived event and a stale version, and keeps
 * the trace of the deletion date, the reason, the type and the public date. A deletion is
 * journaled and recalculates the player's profiles of its type (IMP-33, CL-SEN-17).
 */
export async function deleteHistorical(
  tx: Transaction,
  eventId: number,
  deletion: HistoricalDeletion,
): Promise<Result<ErasedEvent, DeletionRefusal>> {
  const deleted = await deleteHistoricalEvent(tx, eventId, deletion);
  if (deleted.ok) {
    await record(tx, { messageKey: 'historical_event_deleted' });
    await recalculate(tx, deleted.value.playerId, [deleted.value.eventTypeId]);
  }
  return deleted;
}

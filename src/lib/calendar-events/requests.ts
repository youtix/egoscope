import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { calendarDerivationRequests, eventTypes } from '@/lib/db';
import { err, ok } from '@/lib/result';
import { now, toEpochMs } from '@/lib/time';
import { wakeAt } from '@/lib/wake-plan';

import type { NewCalendarDerivationRequestRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

type Cause = NewCalendarDerivationRequestRow['cause'];

/** The two causes that start a regular run; every other cause starts a full one (CL-TAX-19). */
export type RegularCause = Extract<Cause, 'statistics_update' | 'collection_pass'>;

/** The causes that start a full run (CL-TAX-19, CL-SEN-17). */
export type FullCause = Exclude<Cause, RegularCause>;

// The causes that only an action of the owner records (CL-TEL-21).
const OWNER_CAUSES: readonly Cause[] = [
  'type_validated',
  'type_reactivated',
  'type_changed',
  'birthday_changed',
  'mapping_changed',
  'team_change_entered',
] satisfies readonly FullCause[];

/**
 * A need for a calendar derivation run: the kind of run, tied to its cause (only the
 * statistics update and the collection pass make regular runs), for one player or, with no
 * `player`, every eligible one, and for one calendar-derived type or, with no `eventType`,
 * both (CL-TAX-19, ADR 0015).
 */
export type DerivationRequest = Readonly<{
  player?: string;
  eventType?: string;
}> &
  (
    | Readonly<{ kind: 'regular'; cause: RegularCause }>
    | Readonly<{ kind: 'full'; cause: FullCause }>
  );

/** Why a request is refused: the type it names is not a calendar-derived one (CL-TAX-18). */
export type DerivationRefusal = 'not_calendar_derived';

// The task that runs the requests (module map section 1.9).
const DERIVATION_TASK = 'calendar-derivation';

async function isCalendarDerived(tx: Transaction, eventTypeId: string): Promise<boolean> {
  const [type] = await tx
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), isNotNull(eventTypes.calendarDerivation)))
    .limit(1);
  return type !== undefined;
}

/**
 * Records a pending calendar derivation run in the caller's transaction `tx`, the one of
 * the change that calls for it (CL-TAX-19, ADR 0015). A need for a scope (kind, player,
 * type) that no run holds joins the pending request of that scope, which keeps its cause
 * and its instant and stays owner-driven only when the joining need is the owner's too
 * (CL-TEL-21, TEL-18); one that arrives while a run holds the request adds a row, run
 * after. `follows_owner_change` is true at insert when the cause is one only an owner
 * action records. A type that is not calendar-derived is refused, which no check of the
 * database can say. A rollback of `tx` leaves no request; the wake of the
 * `calendar-derivation` task, a write to the wake plan outside the transaction that
 * `wakeAt` gives no way to join, may outlive it, and then a tick finds no request due.
 */
export async function requestDerivation(
  tx: Transaction,
  request: DerivationRequest,
): Promise<Result<undefined, DerivationRefusal>> {
  const { kind, cause, player = null, eventType = null } = request;
  if (eventType !== null && !(await isCalendarDerived(tx, eventType))) {
    return err('not_calendar_derived');
  }
  const requestedAt = new Date(now()).toISOString();
  const isOwnerChange = OWNER_CAUSES.includes(cause);
  // Drizzle cannot name the expressions of the unique key as a conflict target.
  await tx.execute(sql`
    INSERT INTO calendar_derivation_requests
      (kind, player_id, event_type_id, cause, follows_owner_change, requested_at)
    VALUES (${kind}, ${player}, ${eventType}, ${cause}, ${isOwnerChange}, ${requestedAt}::timestamptz)
    ON CONFLICT (kind, coalesce(player_id::text, ''), coalesce(event_type_id, ''))
      WHERE lease_expires_at IS NULL
    DO UPDATE SET follows_owner_change =
      calendar_derivation_requests.follows_owner_change AND excluded.follows_owner_change`);
  await wakeAt(now(), DERIVATION_TASK);
  return ok(undefined);
}

/**
 * The instant at which the earliest request of the calendar derivation is due, or null
 * when none is pending: a request is due when it was recorded, and a request that a run
 * holds, when its lease lapses, so that a run that died is resumed (TRV-30, CL-TAX-19,
 * module map section 1.9).
 */
export async function nextDueAt(db: Database): Promise<EpochMs | null> {
  const dueAt = sql`coalesce(${calendarDerivationRequests.leaseExpiresAt}, ${calendarDerivationRequests.requestedAt})`;
  const [earliest] = await db
    .select({ at: dueAt.mapWith(calendarDerivationRequests.requestedAt) })
    .from(calendarDerivationRequests)
    .orderBy(dueAt)
    .limit(1);
  return earliest === undefined ? null : toEpochMs(earliest.at.getTime());
}

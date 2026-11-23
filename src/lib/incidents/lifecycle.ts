import { and, eq } from 'drizzle-orm';

import { incidents } from '@/lib/db';
import { record } from '@/lib/journal';
import { emit } from '@/lib/outbox';
import { now } from '@/lib/time';

import { causeKeyOf, levelOf } from './kinds';
import { nameOfCause } from './names';

import type { IncidentCause, IncidentOpening, QuotaCauses, ServiceRole } from './kinds';
import type { Transaction } from '@/lib/db';

// The journal message of an opening, by the level of its kind (TRV-43, glossary 9.2).
const OPENING_MESSAGES = {
  incident: 'incident_opened',
  warning: 'warning_opened',
  reminder: 'reminder_opened',
} as const;

/** The open incident of `cause`: its kind, its cause key and its status. */
function openOf(cause: IncidentCause) {
  return and(
    eq(incidents.kind, cause.kind),
    eq(incidents.causeKey, causeKeyOf(cause)),
    eq(incidents.status, 'open'),
  );
}

/** The stored fields of `opening` beyond its cause: a quota incident's service, causes and count. */
function quotaFields(opening: IncidentOpening) {
  return {
    serviceRole: 'serviceRole' in opening ? opening.serviceRole : null,
    quotaCauses: 'quotaCauses' in opening ? [...opening.quotaCauses] : [],
    details: 'waitingArticles' in opening ? { waitingArticles: opening.waitingArticles } : {},
  };
}

/**
 * Opens the incident of `opening` in the caller's transaction `tx`, once per cause: while
 * an incident of that cause is open, nothing changes (TRV-45, CA-TRV-14). A new incident
 * is open since `since`, when its cause began, or now; its opening is journaled by the
 * level of its kind and emits an `incident_opened` fact of the pass `passId`, both in `tx`
 * (TEL-15). Returns the new incident's id, or null when its cause was already open.
 */
export async function open(
  tx: Transaction,
  opening: IncidentOpening,
  passId?: string,
): Promise<number | null> {
  const [opened] = await tx
    .insert(incidents)
    .values({
      kind: opening.kind,
      causeKey: causeKeyOf(opening),
      openedAt: new Date(opening.since ?? now()),
      ...quotaFields(opening),
    })
    .onConflictDoNothing()
    .returning({ id: incidents.id });
  if (opened === undefined) {
    return null;
  }
  await record(tx, {
    messageKey: OPENING_MESSAGES[levelOf(opening.kind)],
    incidentId: opened.id,
    params: { incident: nameOfCause(opening) },
  });
  await emit(tx, { kind: 'incident_opened', incidentId: opened.id }, passId);
  return opened.id;
}

/**
 * Closes the open incident of `cause` in the caller's transaction `tx`, when its cause
 * disappears: the only way an incident closes, never at the owner's request, who can only
 * hide it (TRV-45, CL-TRV-11, CL-IHM-20). The closing is journaled and emits an
 * `incident_closed` fact of the pass `passId`, both in `tx` (TEL-15). Returns the closed
 * incident's id, or null when no incident of that cause was open.
 */
export async function close(
  tx: Transaction,
  cause: IncidentCause,
  passId?: string,
): Promise<number | null> {
  const [closed] = await tx
    .update(incidents)
    .set({ status: 'closed', closedAt: new Date(now()) })
    .where(openOf(cause))
    .returning({ id: incidents.id });
  if (closed === undefined) {
    return null;
  }
  await record(tx, {
    messageKey: 'incident_closed',
    incidentId: closed.id,
    params: { incident: nameOfCause(cause) },
  });
  await emit(tx, { kind: 'incident_closed', incidentId: closed.id }, passId);
  return closed.id;
}

/**
 * Replaces the causes of the open `quota_reached` incident of `serviceRole` in the
 * caller's transaction `tx`: a change of cause updates the open incident without a new
 * message, and its count of waiting articles, written once when it opened, stays
 * (CL-DET-04, CL-DET-05; CL-TRV-11). Returns the updated incident's id, or null when none
 * of that service was open.
 */
export async function updateQuotaCauses(
  tx: Transaction,
  serviceRole: ServiceRole,
  quotaCauses: QuotaCauses,
): Promise<number | null> {
  const [updated] = await tx
    .update(incidents)
    .set({ quotaCauses: [...quotaCauses] })
    .where(openOf({ kind: 'quota_reached', serviceRole }))
    .returning({ id: incidents.id });
  return updated?.id ?? null;
}

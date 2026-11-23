import { and, eq } from 'drizzle-orm';

import { incidents } from '@/lib/db';
import { record } from '@/lib/journal';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { nameOfRow } from './names';

import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

/** Why an incident cannot be hidden: none of that id is open, having closed meanwhile. */
export type HideError = Readonly<{ kind: 'not_open' }>;

/**
 * Hides the open incident `incidentId` at the owner's request, in the action's transaction
 * `tx`: it leaves Home and the to-do list, stays open while its cause lasts, in the journal
 * and on the status screen, and counts among the hidden incidents until it closes; hiding
 * never closes it (IHM-20, CL-IHM-20, CL-TRV-11). The hiding is journaled once; hiding it
 * again changes nothing. Fails with `not_open` when no open incident has that id.
 */
export async function hide(tx: Transaction, incidentId: number): Promise<Result<void, HideError>> {
  const [incident] = await tx
    .select({
      kind: incidents.kind,
      serviceRole: incidents.serviceRole,
      hiddenAt: incidents.hiddenAt,
    })
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.status, 'open')))
    .for('update');
  if (incident === undefined) {
    return err({ kind: 'not_open' });
  }
  if (incident.hiddenAt === null) {
    await tx
      .update(incidents)
      .set({ hiddenAt: new Date(now()) })
      .where(eq(incidents.id, incidentId));
    await record(tx, {
      messageKey: 'incident_hidden',
      incidentId,
      params: { incident: nameOfRow(incident) },
    });
  }
  return ok(undefined);
}

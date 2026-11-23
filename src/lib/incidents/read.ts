import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { incidents } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import type { IncidentKind, QuotaIncidentCause, ServiceRole } from './kinds';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

type Reader = Database | Transaction;

/**
 * An open incident as Home, the to-do list and the status screen read it: its kind and
 * cause, a quota incident's service and causes, the classification incident's number of
 * eligible articles when it opened (DET-11), and since when it is open and hidden.
 */
export type OpenIncident = Readonly<{
  id: number;
  kind: IncidentKind;
  causeKey: string;
  serviceRole: ServiceRole | null;
  quotaCauses: readonly QuotaIncidentCause[];
  waitingArticles: number | null;
  openedAt: EpochMs;
  hiddenAt: EpochMs | null;
}>;

// The documented keys of `incidents.details` (operations.md §1.3); a damaged value reads as none.
const DETAILS = z.object({ waitingArticles: z.number().int().nonnegative() }).partial().catch({});

/**
 * The open incidents, hidden ones included, which Home and the to-do list leave out and
 * the status screen shows, oldest first (TRV-45, TRV-46, IHM-20).
 */
export async function listOpen(db: Reader): Promise<readonly OpenIncident[]> {
  const rows = await db
    .select()
    .from(incidents)
    .where(eq(incidents.status, 'open'))
    .orderBy(asc(incidents.openedAt), asc(incidents.id));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    causeKey: row.causeKey,
    serviceRole: row.serviceRole,
    quotaCauses: row.quotaCauses,
    waitingArticles: DETAILS.parse(row.details).waitingArticles ?? null,
    openedAt: toEpochMs(row.openedAt.getTime()),
    hiddenAt: row.hiddenAt === null ? null : toEpochMs(row.hiddenAt.getTime()),
  }));
}

/** The number of hidden incidents still open, shown beside Home's incidents (IHM-20, CL-IHM-20). */
export async function hiddenCount(db: Reader): Promise<number> {
  return db.$count(incidents, and(eq(incidents.status, 'open'), isNotNull(incidents.hiddenAt)));
}

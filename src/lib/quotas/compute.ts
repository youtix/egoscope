// The app's own estimate of the month's database compute (TRV-03, TRV-08; database
// sheet): the minutes in which the database was active, each followed by the five
// minutes before the compute suspends, at the fixed 0.25 CU, per calendar month from
// 00:00 UTC on the 1st (CL-TRV-12). Neon's console stays the authority.
import { randomUUID } from 'node:crypto';

import { and, gte, lt } from 'drizzle-orm';

import { databaseActivityMinutes } from '@/lib/db';
import { close, open } from '@/lib/incidents';
import { getParams } from '@/lib/params';
import { now } from '@/lib/time';

import { isShareReached } from './limits';
import { BUCKET_MS, bucketOf, fixedPeriodAt } from './periods';

import type { Period } from './periods';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

type Executor = Database | Transaction;

/** The month's estimate against its limit, with the warning at the warning share (TRV-05). */
export type ComputeEstimate = Readonly<{
  computeHours: number;
  /** `quotas.database.computeHoursPerMonth`, null while not entered. */
  limitHours: number | null;
  month: Period;
  warning: boolean;
}>;

// The compute suspends five minutes after the last active query, and is fixed at
// 0.25 CU on the Free plan (database sheet).
const SUSPEND_AFTER_MS = 300_000;
const COMPUTE_UNITS = 0.25;
const MS_PER_HOUR = 3_600_000;

// This server instance, which writes at most one row a minute, and the last minute it wrote.
const INSTANCE_ID = randomUUID();
const written: { lastMinute: EpochMs | null } = { lastMinute: null };

/**
 * Records that the database is active this minute, from this server instance, through
 * the caller's connection, already open: at most one row a minute per instance, and no
 * query at all when this instance already wrote this minute's (TRV-03, TRV-08).
 */
export async function recordDatabaseActivity(db: Executor): Promise<void> {
  const minute = bucketOf(now());
  if (minute === written.lastMinute) {
    return;
  }
  await db
    .insert(databaseActivityMinutes)
    .values({ minuteAt: new Date(minute), instanceId: INSTANCE_ID })
    .onConflictDoNothing();
  written.lastMinute = minute;
}

/**
 * The milliseconds of the union of the active minutes, sorted, each extended by the
 * compute's five-minute tail, counted up to `end` (TRV-03).
 */
export function activeMs(minutes: readonly number[], end: number): number {
  let total = 0;
  let coveredUntil = -Infinity;
  for (const minute of minutes) {
    const start = Math.max(minute, coveredUntil);
    const stop = Math.min(minute + BUCKET_MS + SUSPEND_AFTER_MS, end);
    total += Math.max(stop - start, 0);
    coveredUntil = Math.max(coveredUntil, stop);
  }
  return total;
}

/**
 * The estimate of the database's compute-hours in the calendar month of `at`: the union
 * of the minutes recorded by every instance, each extended by five minutes, at 0.25 CU,
 * against `quotas.database.computeHoursPerMonth`, warned at `quotas.warningShare` of it
 * (TRV-03, TRV-05, TRV-08, CL-TRV-12).
 */
export async function computeEstimate(db: Executor, at: EpochMs): Promise<ComputeEstimate> {
  const month = fixedPeriodAt('month', at);
  const { minuteAt } = databaseActivityMinutes;
  const inMonth = and(gte(minuteAt, new Date(month.start)), lt(minuteAt, new Date(month.end)));
  const rows = await db
    .selectDistinct({ minuteAt })
    .from(databaseActivityMinutes)
    .where(inMonth)
    .orderBy(minuteAt);
  const minutes = rows.map((row) => row.minuteAt.getTime());
  const computeHours = (activeMs(minutes, month.end) / MS_PER_HOUR) * COMPUTE_UNITS;
  const values = await getParams(db);
  const limitHours = values.get('quotas.database.computeHoursPerMonth');
  const share = values.get('quotas.warningShare');
  const isWarning = limitHours !== null && isShareReached(computeHours, limitHours, share);
  return { computeHours, limitHours, month, warning: isWarning };
}

/**
 * Gives the database's quota warning in the caller's transaction `tx` while the month's
 * compute estimate is at the warning share, and ends it once the month renews below
 * it (TRV-05, CL-TRV-12).
 */
export async function syncComputeWarning(tx: Transaction, at: EpochMs): Promise<void> {
  const { warning } = await computeEstimate(tx, at);
  const cause = { kind: 'quota_warning', serviceRole: 'database' } as const;
  await (warning ? open(tx, cause) : close(tx, cause));
}

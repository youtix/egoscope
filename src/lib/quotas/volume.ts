// The database's volume against its capacity, measured live for the status screen and
// sampled once a day by the purge (TRV-07, TRV-08).
import { sql } from 'drizzle-orm';

import { databaseSizeSamples } from '@/lib/db';
import { close, open } from '@/lib/incidents';
import { getParams } from '@/lib/params';
import { now } from '@/lib/time';

import { syncComputeWarning } from './compute';
import { BYTES_PER_MEGABYTE } from './limits';

import type { Database, Transaction } from '@/lib/db';
import type { IsoDate } from '@/lib/time';

type Executor = Database | Transaction;

/** The volume used, the capacity entered, null until it is, and the warning (TRV-07). */
export type DatabaseVolume = Readonly<{
  usedBytes: number;
  capacityBytes: number | null;
  warning: boolean;
}>;

const PERCENT = 100;
const VOLUME_WARNING = { kind: 'database_volume_warning' } as const;

/**
 * The database's volume against `quotas.database.capacityMegabytes`, with the warning
 * at `quotas.databaseWarningShare` of it, in two reads (TRV-07, TRV-08).
 */
export async function databaseVolume(db: Executor): Promise<DatabaseVolume> {
  const measured = await db
    .select({ size: sql<number>`pg_database_size(current_database())`.mapWith(Number) })
    .from(sql`(select 1) as measure`);
  // The measure has exactly one row.
  const usedBytes = measured.reduce((total, row) => total + row.size, 0);
  const values = await getParams(db);
  const capacity = values.get('quotas.database.capacityMegabytes');
  const capacityBytes = capacity === null ? null : capacity * BYTES_PER_MEGABYTE;
  const share = values.get('quotas.databaseWarningShare');
  const isWarning = capacityBytes !== null && usedBytes * PERCENT >= capacityBytes * share;
  return { usedBytes, capacityBytes, warning: isWarning };
}

/**
 * The purge's daily sample of the database, for the owner's day `day`, in the caller's
 * transaction `tx`: stores its size, so that the app measures its real volume (TRV-08);
 * opens "database volume warning" at the share of the capacity and closes it when the
 * volume falls below (TRV-07); and gives or ends the warning of the month's compute
 * estimate (TRV-05). Returns the volume measured.
 */
export async function recordDatabaseSize(tx: Transaction, day: IsoDate): Promise<DatabaseVolume> {
  const volume = await databaseVolume(tx);
  await tx
    .insert(databaseSizeSamples)
    .values({ sampledOn: day, sizeBytes: volume.usedBytes })
    .onConflictDoUpdate({
      target: databaseSizeSamples.sampledOn,
      set: { sizeBytes: volume.usedBytes },
    });
  await (volume.warning ? open(tx, VOLUME_WARNING) : close(tx, VOLUME_WARNING));
  await syncComputeWarning(tx, now());
  return volume;
}

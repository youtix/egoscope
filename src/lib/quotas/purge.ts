import { lt } from 'drizzle-orm';

import { databaseActivityMinutes, databaseSizeSamples, quotaUsage } from '@/lib/db';
import { toEpochMs, userDay } from '@/lib/time';

import { fixedPeriodAt } from './periods';

import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const MS_PER_DAY = 86_400_000;

/** What the purge keeps: `journal.retentionDays` before `now`, the owner's days in `timeZone`. */
export type QuotaRetention = Readonly<{ now: EpochMs; retentionDays: number; timeZone: string }>;

/**
 * Deletes, in the purge's transaction `tx`, the quota-usage periods that started and the
 * size samples taken more than `journal.retentionDays` before `now`, and the database
 * activity minutes before the previous calendar month, which the compute estimate no
 * longer reads (module map §4; TRV-08, TRV-48). Returns the number of rows deleted,
 * which the purge journals.
 */
export async function purgeExpired(tx: Transaction, retention: QuotaRetention): Promise<number> {
  const cutoff = toEpochMs(retention.now - retention.retentionDays * MS_PER_DAY);
  const thisMonth = fixedPeriodAt('month', retention.now);
  const previousMonth = fixedPeriodAt('month', toEpochMs(thisMonth.start - 1));
  const periods = await tx
    .delete(quotaUsage)
    .where(lt(quotaUsage.periodStartAt, new Date(cutoff)))
    .returning({ id: quotaUsage.id });
  const samples = await tx
    .delete(databaseSizeSamples)
    .where(lt(databaseSizeSamples.sampledOn, userDay(cutoff, retention.timeZone)))
    .returning({ day: databaseSizeSamples.sampledOn });
  const minutes = await tx
    .delete(databaseActivityMinutes)
    .where(lt(databaseActivityMinutes.minuteAt, new Date(previousMonth.start)))
    .returning({ minute: databaseActivityMinutes.minuteAt });
  return periods.length + samples.length + minutes.length;
}

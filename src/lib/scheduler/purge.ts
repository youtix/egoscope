import { lt } from 'drizzle-orm';

import { taskRuns } from '@/lib/db';

import { HOUR_MS } from './limits';

import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const HOURS_PER_DAY = 24;

/**
 * Deletes, in the purge's transaction `tx`, the finished task runs that ended more than
 * `journal.retentionDays` before `now`, never a running or waiting one (module map §4,
 * operations.md §1.5). Returns the number of runs deleted, which the purge journals.
 */
export async function purgeExpired(
  tx: Transaction,
  retention: Readonly<{ now: EpochMs; retentionDays: number }>,
): Promise<number> {
  const cutoff = new Date(retention.now - retention.retentionDays * HOURS_PER_DAY * HOUR_MS);
  const deleted = await tx
    .delete(taskRuns)
    .where(lt(taskRuns.finishedAt, cutoff))
    .returning({ id: taskRuns.id });
  return deleted.length;
}

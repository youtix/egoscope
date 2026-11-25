// The counters that the cache kept without the database, flushed by each database pass
// into the journal and `quotas` (module map §1.6 step 5; CL-TRV-25).
import { inArray, max } from 'drizzle-orm';

import { journalEntries } from '@/lib/db';
import { recordCountedAttempts } from '@/lib/journal';
import { recordProbeCalls } from '@/lib/quotas';
import { drainCounters } from '@/lib/wake-plan';

import { epochOf } from './runs';

import type { Database } from '@/lib/db';
import type { JournalMessageKey } from '@/lib/journal';
import type { EpochMs } from '@/lib/time';

// The journal entries of the attempts counted without the database (CL-TRV-25).
const ATTEMPT_MESSAGES: readonly JournalMessageKey[] = [
  'trigger_refused',
  'telegram_update_ignored',
  'trigger_refusals_counted',
  'telegram_updates_counted',
];

/** The latest instant of an attempt already journaled, none when none was. */
async function lastJournaledAttempt(db: Database): Promise<EpochMs | null> {
  const [row] = await db
    .select({ at: max(journalEntries.occurredAt) })
    .from(journalEntries)
    .where(inArray(journalEntries.messageKey, ATTEMPT_MESSAGES));
  const at = row?.at ?? null;
  return at === null ? null : epochOf(at);
}

/**
 * Journals the attempts, and hands the probe calls, that the cache counted without the
 * database (TRV-03, TRV-65, CL-TRV-25). A drain that raced a write of the counters gives
 * back attempts already journaled: those at or before the last one journaled are skipped.
 * A cache that fails to drain leaves its counters for the next pass.
 */
export async function flushCounters(db: Database): Promise<void> {
  const drained = await drainCounters();
  if (!drained.ok) {
    return;
  }
  const { attempts, beyond, probeCalls } = drained.counters;
  if (attempts.length + beyond.length + probeCalls.length === 0) {
    return;
  }
  const last = await lastJournaledAttempt(db);
  const isNew = (at: EpochMs) => last === null || at > last;
  await db.transaction(async (tx) => {
    await recordCountedAttempts(tx, {
      attempts: attempts.filter(({ at }) => isNew(at)),
      beyond: beyond.filter(({ lastAt }) => isNew(lastAt)),
    });
    await recordProbeCalls(tx, probeCalls);
  });
}

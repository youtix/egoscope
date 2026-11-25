// The counters that the cache kept without the database, flushed by each database pass
// into the journal and `quotas` (module map §1.6 step 5; CL-TRV-25).
import { and, inArray, sql } from 'drizzle-orm';

import { journalEntries } from '@/lib/db';
import { recordCountedAttempts } from '@/lib/journal';
import { recordProbeCalls } from '@/lib/quotas';
import { toEpochMs } from '@/lib/time';
import { drainCounters } from '@/lib/wake-plan';

import type { Database } from '@/lib/db';
import type { JournalMessageKey } from '@/lib/journal';
import type { EpochMs } from '@/lib/time';
import type { AttemptKind, Counters } from '@/lib/wake-plan';

type Attempt = Counters['attempts'][number];
type Beyond = Counters['beyond'][number];

const REFUSED_TRIGGER: AttemptKind = 'refused_trigger';

// The journal entry of one attempt, and the count entry of the attempts beyond an
// instance's 1,000, of each category, as `journal.recordCountedAttempts` writes them.
const TRIGGER_ENTRIES = { one: 'trigger_refused', count: 'trigger_refusals_counted' } as const;
const UPDATE_ENTRIES = {
  one: 'telegram_update_ignored',
  count: 'telegram_updates_counted',
} as const;

const ATTEMPT_MESSAGES: readonly JournalMessageKey[] = [
  ...Object.values(TRIGGER_ENTRIES),
  ...Object.values(UPDATE_ENTRIES),
];

/** What tells an entry of a counted attempt: its message, its instant and its conversation's kind. */
const entryKey = (messageKey: string, at: number, conversation: string | null) =>
  `${messageKey}@${String(at)}@${conversation ?? ''}`;

const attemptKey = ({ kind, at }: Attempt) =>
  kind === REFUSED_TRIGGER
    ? entryKey(TRIGGER_ENTRIES.one, at, null)
    : entryKey(UPDATE_ENTRIES.one, at, kind);

/** The counts beyond 1,000 of each category, with the instant of their count entry, their last one. */
function countGroups(beyond: readonly Beyond[]) {
  const groups = [
    {
      messageKey: TRIGGER_ENTRIES.count,
      counts: beyond.filter((count) => count.kind === REFUSED_TRIGGER),
    },
    {
      messageKey: UPDATE_ENTRIES.count,
      counts: beyond.filter((count) => count.kind !== REFUSED_TRIGGER),
    },
  ];
  return groups
    .filter(({ counts }) => counts.length > 0)
    .map(({ messageKey, counts }) => {
      const at = toEpochMs(Math.max(...counts.map((count) => count.lastAt)));
      return { key: entryKey(messageKey, at, null), at, counts };
    });
}

/** The entries of counted attempts that the journal already holds at `instants`, by their key. */
async function journaledAt(db: Database, instants: readonly EpochMs[]): Promise<Set<string>> {
  const dates = instants.map((instant) => new Date(instant));
  const rows = await db
    .select({
      messageKey: journalEntries.messageKey,
      occurredAt: journalEntries.occurredAt,
      conversation: sql<string | null>`${journalEntries.messageParams}->>'conversation'`,
    })
    .from(journalEntries)
    .where(
      and(
        inArray(journalEntries.messageKey, ATTEMPT_MESSAGES),
        inArray(journalEntries.occurredAt, dates),
      ),
    );
  const keys = rows.map(({ messageKey, occurredAt, conversation }) =>
    entryKey(messageKey, occurredAt.getTime(), conversation),
  );
  return new Set(keys);
}

/**
 * Journals the attempts, and hands the probe calls, that the cache counted without the
 * database (TRV-03, TRV-65, CL-TRV-25). A drain that raced a write of the counters gives
 * back attempts already journaled: an attempt is skipped only when the journal holds its
 * very entry, the same message at the same instant for the same kind of conversation, and
 * a count beyond 1,000 when it holds the same count entry, so that an attempt that another
 * instance writes after a pass, however old, is still journaled. A cache that fails to
 * drain leaves its counters for the next pass.
 */
export async function flushCounters(db: Database): Promise<void> {
  const drained = await drainCounters();
  if (!drained.ok) {
    return;
  }
  const { attempts, beyond, probeCalls } = drained.counters;
  const groups = countGroups(beyond);
  const instants = [...attempts.map(({ at }) => at), ...groups.map(({ at }) => at)];
  if (instants.length + probeCalls.length === 0) {
    return;
  }
  const journaled = await journaledAt(db, instants);
  await db.transaction(async (tx) => {
    await recordCountedAttempts(tx, {
      attempts: attempts.filter((attempt) => !journaled.has(attemptKey(attempt))),
      beyond: groups.flatMap(({ key, counts }) => (journaled.has(key) ? [] : counts)),
    });
    await recordProbeCalls(tx, probeCalls);
  });
}

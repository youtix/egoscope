import { journalEntries } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { entryRow } from './record';

import type { ConversationKind } from './labels';
import type { JournalEntryInput } from './record';
import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/**
 * An attempt that a server instance counted without the database: a refused call of
 * the task trigger, or a stranger's Telegram update by the kind of its conversation
 * (TRV-65, TEL-31, CL-TRV-21).
 */
type CountedAttemptKind = 'refused_trigger' | ConversationKind;

/**
 * What the next database pass journals of the attempts counted without the database:
 * each attempt with its own instant and kind, and, for the attempts beyond an instance's
 * 1,000, their count by kind with the first and the last instant (CL-TRV-25).
 */
export type CountedAttempts = Readonly<{
  attempts: readonly Readonly<{ kind: CountedAttemptKind; at: EpochMs }>[];
  beyond: readonly Readonly<{
    kind: CountedAttemptKind;
    count: number;
    firstAt: EpochMs;
    lastAt: EpochMs;
  }>[];
}>;

type Beyond = CountedAttempts['beyond'][number];

/** The entry of one attempt, with its own instant: a refused trigger, or a stranger's update. */
function attemptEntry({ kind, at }: CountedAttempts['attempts'][number]): JournalEntryInput {
  return kind === 'refused_trigger'
    ? { messageKey: 'trigger_refused', occurredAt: at }
    : { messageKey: 'telegram_update_ignored', occurredAt: at, params: { conversation: kind } };
}

/** The earliest first instant and the latest last instant of `counts`, which hold at least one count. */
function span(counts: readonly Beyond[]): Readonly<{ firstAt: EpochMs; lastAt: EpochMs }> {
  return {
    firstAt: toEpochMs(Math.min(...counts.map((count) => count.firstAt))),
    lastAt: toEpochMs(Math.max(...counts.map((count) => count.lastAt))),
  };
}

/** How many attempts of `kind` went beyond the instances' 1,000, in all. */
function total(beyond: readonly Beyond[], kind: CountedAttemptKind): number {
  return beyond.filter((count) => count.kind === kind).reduce((sum, count) => sum + count.count, 0);
}

/** The count entries of the attempts beyond the instance's 1,000: one per category. */
function countEntries(beyond: readonly Beyond[]): readonly JournalEntryInput[] {
  const triggers = beyond.filter((count) => count.kind === 'refused_trigger');
  const updates = beyond.filter((count) => count.kind !== 'refused_trigger');
  const entries: JournalEntryInput[] = [];
  if (triggers.length > 0) {
    const { firstAt, lastAt } = span(triggers);
    entries.push({
      messageKey: 'trigger_refusals_counted',
      occurredAt: lastAt,
      params: { count: total(triggers, 'refused_trigger'), firstAt, lastAt },
    });
  }
  if (updates.length > 0) {
    const { firstAt, lastAt } = span(updates);
    entries.push({
      messageKey: 'telegram_updates_counted',
      occurredAt: lastAt,
      params: {
        privateCount: total(updates, 'private'),
        groupCount: total(updates, 'group'),
        channelCount: total(updates, 'channel'),
        firstAt,
        lastAt,
      },
    });
  }
  return entries;
}

/**
 * Journals, in the database pass's transaction `tx`, the attempts that the server
 * instances counted without the database: one entry per attempt with its own instant
 * and kind, a refused trigger in the category `trigger_refused` and a stranger's
 * Telegram update in `telegram_message`, and one count entry per category for the
 * attempts beyond an instance's 1,000, with their count by kind and the first and the
 * last instant (TRV-65, TEL-31, CL-TRV-21, CL-TRV-25). One insert writes them all.
 * Returns the number of entries written.
 */
export async function recordCountedAttempts(
  tx: Transaction,
  counted: CountedAttempts,
): Promise<number> {
  const entries = [
    ...counted.attempts.map((attempt) => attemptEntry(attempt)),
    ...countEntries(counted.beyond),
  ];
  if (entries.length === 0) {
    return 0;
  }
  await tx.insert(journalEntries).values(entries.map((entry) => entryRow(entry)));
  return entries.length;
}

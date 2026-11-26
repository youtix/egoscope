import { journalEntries, journalTechnicalDetails } from '@/lib/db';
import { now } from '@/lib/time';

import { messageOf } from './catalog';
import { referenceColumns } from './references';
import { keptDetails } from './technical-details';

import type { JournalMessageKey, ParamsOf, SubjectOf } from './catalog';
import type { EntryReferences, SubjectFields } from './references';
import type { TechnicalDetails } from './technical-details';
import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/** The parameters field of the entries of `K`: required when its message has some. */
type ParamsField<K extends JournalMessageKey> = [ParamsOf<K>] extends [never]
  ? Readonly<{ params?: never }>
  : Readonly<{ params: ParamsOf<K> }>;

/** One entry of `K`: its message, its subject's identifier and its parameters. */
type EntryOf<K extends JournalMessageKey> = Readonly<{
  messageKey: K;
  /** When it happened: now, unless an attempt counted without the database brings its own instant. */
  occurredAt?: EpochMs;
  /** The run the entry belongs to, and the incident it is tied to, which keeps it while open. */
  taskRunId?: number;
  incidentId?: number;
  technicalDetails?: TechnicalDetails;
}> &
  SubjectFields[SubjectOf<K>] &
  ParamsField<K>;

/**
 * One journal entry as its writer gives it: a message of the closed list with the
 * references and parameters that message takes, never a copied text (CL-TRV-10).
 */
export type JournalEntryInput = { [K in JournalMessageKey]: EntryOf<K> }[JournalMessageKey];

/** What `record` stores, every message alike. */
type StoredInput = EntryReferences &
  Readonly<{
    messageKey: JournalMessageKey;
    occurredAt?: EpochMs;
    params?: Readonly<Record<string, unknown>>;
    technicalDetails?: TechnicalDetails;
  }>;

/**
 * The row of `entry`: the category and the level of its message (TRV-43), its
 * references and its parameters, its instant now unless it brings its own.
 */
export function entryRow(entry: StoredInput): typeof journalEntries.$inferInsert {
  const message = messageOf(entry.messageKey);
  if (message === undefined) {
    throw new Error(`No message of the closed list is named ${entry.messageKey}.`);
  }
  return {
    occurredAt: new Date(entry.occurredAt ?? now()),
    category: message.category,
    level: message.level,
    messageKey: entry.messageKey,
    messageParams: entry.params ?? {},
    ...referenceColumns(entry),
  };
}

/**
 * Writes one entry of the activity journal in the caller's transaction `tx`, the one
 * of the change it records (TRV-41): the category and the level of its message (TRV-43),
 * its references by identifier and its parameters, from which the text is built at
 * display, so that an erased item's mentions go at once (CL-TRV-10); its technical
 * details apart, reduced to the allowlist (TRV-44, CL-DSN-11). Returns the entry's id,
 * to which a parameter change, for one, links.
 */
export async function record(tx: Transaction, entry: JournalEntryInput): Promise<number> {
  const stored: StoredInput = entry;
  const [inserted] = await tx
    .insert(journalEntries)
    .values(entryRow(stored))
    .returning({ id: journalEntries.id });
  if (inserted === undefined) {
    throw new Error(`The journal entry ${entry.messageKey} returned no row from its insert.`);
  }
  if (stored.technicalDetails !== undefined) {
    await tx.insert(journalTechnicalDetails).values({
      journalEntryId: inserted.id,
      details: keptDetails(stored.technicalDetails, stored.messageKey),
    });
  }
  return inserted.id;
}

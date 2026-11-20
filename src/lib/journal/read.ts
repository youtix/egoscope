import { and, asc, desc, eq, gt, gte, inArray, lt, or } from 'drizzle-orm';

import { journalEntries, journalTechnicalDetails } from '@/lib/db';
import { formatInstant, toEpochMs } from '@/lib/time';

import { CATEGORY_LABELS, LEVEL_LABELS, wordsFor } from './labels';
import { renderEntry } from './render';
import { readDetails } from './technical-details';

import type { JournalEntryCategory, JournalLevel } from './entries';
import type { RenderedEntry } from './render';
import type { StoredTechnicalDetails } from './technical-details';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { SQL } from 'drizzle-orm';

/** Where a page of the journal ends: its last entry, after which the next page starts. */
export type JournalCursor = Readonly<{ occurredAt: EpochMs; id: number }>;

/** A period of the journal: from `from`, included, to `to`, excluded. */
export type JournalPeriod = Readonly<{ from: EpochMs; to: EpochMs }>;

/** What a page of the journal shows (IHM-38): its filters, its size and where it starts. */
export type JournalQuery = Readonly<{
  /** The owner's time zone, the `display.timeZone` setting, in which instants are written. */
  timeZone: string;
  /** Only the entries of these categories; every category when left out. */
  categories?: readonly JournalEntryCategory[];
  /** Only the entries of this period; every entry when left out. */
  period?: JournalPeriod;
  /** The number of entries of a page, the `display.listPageSize` setting (IHM-18). */
  pageSize: number;
  /** The end of the previous page; the newest entries when left out. */
  after?: JournalCursor;
  /** Whether each entry comes with its technical details, which stay hidden otherwise (TRV-44). */
  withTechnicalDetails?: boolean;
}>;

/** One entry as the journal screen shows it: its text built at display (CL-TRV-10). */
export type JournalEntryView = RenderedEntry &
  Readonly<{
    id: number;
    occurredAt: EpochMs;
    category: JournalEntryCategory;
    level: JournalLevel;
    /** Only when asked for, and when the entry has some (TRV-44). */
    technicalDetails: StoredTechnicalDetails | null;
  }>;

/** A page of entries, newest first, and where the next page starts, if one does. */
export type JournalPage = Readonly<{
  entries: readonly JournalEntryView[];
  next: JournalCursor | null;
}>;

type Reader = Database | Transaction;

/** How the entries are read: which ones, in which order, how many, with their details or not. */
type Reading = Readonly<{
  where: SQL | undefined;
  order: readonly SQL[];
  limit: number;
  withTechnicalDetails: boolean;
}>;

// The entries that the export reads at a time, so that a long period is never held whole.
const EXPORT_BATCH_SIZE = 500;

/** The entries that come after `cursor` in the journal's order, newest first. */
function olderThan(cursor: JournalCursor): SQL | undefined {
  const at = new Date(cursor.occurredAt);
  return or(
    lt(journalEntries.occurredAt, at),
    and(eq(journalEntries.occurredAt, at), lt(journalEntries.id, cursor.id)),
  );
}

/** The entries that come after `cursor` in the export's order, oldest first. */
function newerThan(cursor: JournalCursor): SQL | undefined {
  const at = new Date(cursor.occurredAt);
  return or(
    gt(journalEntries.occurredAt, at),
    and(eq(journalEntries.occurredAt, at), gt(journalEntries.id, cursor.id)),
  );
}

/** The entries of `period`: from its start, included, to its end, excluded. */
function within(period: JournalPeriod): SQL | undefined {
  return and(
    gte(journalEntries.occurredAt, new Date(period.from)),
    lt(journalEntries.occurredAt, new Date(period.to)),
  );
}

function filters(query: Omit<JournalQuery, 'timeZone' | 'pageSize'>): SQL | undefined {
  return and(
    query.categories === undefined ? undefined : inArray(journalEntries.category, query.categories),
    query.period === undefined ? undefined : within(query.period),
    query.after === undefined ? undefined : olderThan(query.after),
  );
}

/**
 * The entries that `reading` asks for, each with its text built at display, and its
 * technical details when asked for, read in the same query (TRV-44, CL-TRV-10).
 */
async function readEntries(
  db: Reader,
  timeZone: string,
  reading: Reading,
): Promise<readonly JournalEntryView[]> {
  const rows = await db
    .select({ entry: journalEntries, details: journalTechnicalDetails.details })
    .from(journalEntries)
    .leftJoin(
      journalTechnicalDetails,
      eq(journalTechnicalDetails.journalEntryId, journalEntries.id),
    )
    .where(reading.where)
    .orderBy(...reading.order)
    .limit(reading.limit);
  return rows.map(({ entry, details }) => ({
    ...renderEntry(entry, timeZone),
    id: entry.id,
    occurredAt: toEpochMs(entry.occurredAt.getTime()),
    category: entry.category,
    level: entry.level,
    technicalDetails:
      details !== null && reading.withTechnicalDetails ? readDetails(details) : null,
  }));
}

/**
 * A page of the activity journal, newest first, filtered by category and period
 * (IHM-38), each entry with its text built at display from its message and references,
 * so that an erased item reads "an item that no longer exists" or "a deleted player"
 * (CL-TRV-10), and its technical details only when asked for (TRV-44).
 */
export async function list(db: Reader, query: JournalQuery): Promise<JournalPage> {
  const read = await readEntries(db, query.timeZone, {
    where: filters(query),
    order: [desc(journalEntries.occurredAt), desc(journalEntries.id)],
    // One entry more than the page, which tells whether another page follows.
    limit: query.pageSize + 1,
    withTechnicalDetails: query.withTechnicalDetails === true,
  });
  const entries = read.slice(0, query.pageSize);
  const last = entries.at(-1);
  return {
    entries,
    next:
      last !== undefined && read.length > entries.length
        ? { occurredAt: last.occurredAt, id: last.id }
        : null,
  };
}

/** One technical detail, indented: an instant in the owner's zone, any other value as stored. */
function writeDetail(key: string, value: unknown, timeZone: string): string {
  if (key === 'at' && typeof value === 'number') {
    return `  ${key}: ${formatInstant(toEpochMs(value), timeZone, 'full')}`;
  }
  return `  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`;
}

/** One entry of the export: its instant, level and category, its text, then its details. */
function block(entry: JournalEntryView, timeZone: string): string {
  const heading = [
    formatInstant(entry.occurredAt, timeZone, 'full'),
    wordsFor(LEVEL_LABELS, entry.level),
    wordsFor(CATEGORY_LABELS, entry.category),
  ].join(' · ');
  const details = Object.entries(entry.technicalDetails ?? {}).map(([key, value]) =>
    writeDetail(key, value, timeZone),
  );
  return [heading, entry.text, ...details].join('\n');
}

/**
 * The activity journal of `period` as readable text, for the person who helps the owner
 * diagnose a problem (TRV-49): a title, then one block per entry, oldest first, with its
 * instant in the owner's zone, its level, its category and its text built at display
 * (CL-TRV-10), then, when asked for, its allowlisted technical details, indented (TRV-44,
 * operations.md section 5.4). The text comes in parts, the entries read a batch at a
 * time, so that the export streams a long period without holding it whole.
 * @yields {string} The title, then each entry's block, after a blank line.
 */
export async function* exportText(
  db: Reader,
  request: Readonly<{ timeZone: string; period: JournalPeriod; withTechnicalDetails?: boolean }>,
): AsyncGenerator<string, void, undefined> {
  const { timeZone, period } = request;
  yield `Activity journal from ${formatInstant(period.from, timeZone, 'full')} to ${formatInstant(period.to, timeZone, 'full')}\n`;
  let after: JournalCursor | undefined;
  for (;;) {
    const batch = await readEntries(db, timeZone, {
      where: and(within(period), after === undefined ? undefined : newerThan(after)),
      order: [asc(journalEntries.occurredAt), asc(journalEntries.id)],
      limit: EXPORT_BATCH_SIZE,
      withTechnicalDetails: request.withTechnicalDetails === true,
    });
    for (const entry of batch) {
      yield `\n${block(entry, timeZone)}\n`;
    }
    const last = batch.at(-1);
    if (last === undefined || batch.length < EXPORT_BATCH_SIZE) {
      return;
    }
    after = { occurredAt: last.occurredAt, id: last.id };
  }
}

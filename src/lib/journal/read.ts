import { and, asc, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';

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
type StoredRow = typeof journalEntries.$inferSelect;

/** The entries that come after `cursor` in the journal's order, newest first. */
function olderThan(cursor: JournalCursor): SQL | undefined {
  const at = new Date(cursor.occurredAt);
  return or(
    lt(journalEntries.occurredAt, at),
    and(eq(journalEntries.occurredAt, at), lt(journalEntries.id, cursor.id)),
  );
}

/** The entries of `period`: from its start, included, to its end, excluded. */
function within(period: JournalPeriod): SQL | undefined {
  const from = new Date(period.from);
  const to = new Date(period.to);
  return and(gte(journalEntries.occurredAt, from), lt(journalEntries.occurredAt, to));
}

function filters(query: Omit<JournalQuery, 'timeZone' | 'pageSize'>): SQL | undefined {
  return and(
    query.categories === undefined ? undefined : inArray(journalEntries.category, query.categories),
    query.period === undefined ? undefined : within(query.period),
    query.after === undefined ? undefined : olderThan(query.after),
  );
}

/** The technical details of the entries `ids`, by entry. */
async function detailsOf(
  db: Reader,
  ids: readonly number[],
): Promise<ReadonlyMap<number, StoredTechnicalDetails>> {
  const rows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(journalTechnicalDetails)
          .where(inArray(journalTechnicalDetails.journalEntryId, [...ids]));
  return new Map(rows.map((row) => [row.journalEntryId, readDetails(row.details)]));
}

function view(
  row: StoredRow,
  timeZone: string,
  details: ReadonlyMap<number, StoredTechnicalDetails>,
): JournalEntryView {
  return {
    ...renderEntry(row, timeZone),
    id: row.id,
    occurredAt: toEpochMs(row.occurredAt.getTime()),
    category: row.category,
    level: row.level,
    technicalDetails: details.get(row.id) ?? null,
  };
}

/**
 * A page of the activity journal, newest first, filtered by category and period
 * (IHM-38), each entry with its text built at display from its message and references,
 * so that an erased item reads "an item that no longer exists" or "a deleted player"
 * (CL-TRV-10), and its technical details only when asked for (TRV-44).
 */
export async function list(db: Reader, query: JournalQuery): Promise<JournalPage> {
  const rows = await db
    .select()
    .from(journalEntries)
    .where(filters(query))
    .orderBy(desc(journalEntries.occurredAt), desc(journalEntries.id))
    .limit(query.pageSize + 1);
  const page = rows.slice(0, query.pageSize);
  const last = page.at(-1);
  const details =
    query.withTechnicalDetails === true
      ? await detailsOf(
          db,
          page.map((row) => row.id),
        )
      : new Map();
  return {
    entries: page.map((row) => view(row, query.timeZone, details)),
    next:
      last !== undefined && rows.length > query.pageSize
        ? { occurredAt: toEpochMs(last.occurredAt.getTime()), id: last.id }
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
 * diagnose a problem (TRV-49): one block per entry, oldest first, with its instant in the
 * owner's zone, its level, its category and its text built at display (CL-TRV-10), then,
 * when asked for, its allowlisted technical details, indented (TRV-44, operations.md
 * section 5.4).
 */
export async function exportText(
  db: Reader,
  request: Readonly<{ timeZone: string; period: JournalPeriod; withTechnicalDetails?: boolean }>,
): Promise<string> {
  const rows = await db
    .select()
    .from(journalEntries)
    .where(filters({ period: request.period }))
    .orderBy(asc(journalEntries.occurredAt), asc(journalEntries.id));
  const details =
    request.withTechnicalDetails === true
      ? await detailsOf(
          db,
          rows.map((row) => row.id),
        )
      : new Map();
  const title = `Activity journal from ${formatInstant(request.period.from, request.timeZone, 'full')} to ${formatInstant(request.period.to, request.timeZone, 'full')}`;
  const blocks = rows.map((row) => block(view(row, request.timeZone, details), request.timeZone));
  return [title, ...blocks].join('\n\n').concat('\n');
}

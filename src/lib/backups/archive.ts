import 'server-only';

import { createHash } from 'node:crypto';

import { asc, is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import * as database from '@/lib/db';

import type { ZipEntry } from './zip';
import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** A table of the archive: its definition, the tables it must come after, its second-pass columns. */
type ArchiveTable = Readonly<{
  table: PgTable;
  name: string;
  columns: readonly PgColumn[];
  parents: ReadonlySet<string>;
  secondPass: readonly string[];
}>;

/** What the manifest says of one exported table, once its file is written. */
type TableEntry = Readonly<{ table: ArchiveTable; rows: number; sha256: string }>;

const FORMAT = 'egoscope-export';
const FORMAT_VERSION = '1.0';
const README_FILE = 'readme.txt';
const MANIFEST_FILE = 'manifest.json';
const PAGE_SIZE = 1000;
const MANIFEST_INDENT = 2;

// The one foreign key that closes a cycle, cut here so that its table loads first; the
// self-references are found from the schema. A new cycle joins this list (operations.md §5.1).
const CYCLE_BREAKERS: ReadonlySet<PgColumn> = new Set([database.backtestRequests.triggerImportId]);

const README = `Egoscope full export, format ${FORMAT} ${FORMAT_VERSION}

This archive holds all the data of your Egoscope installation, so keep it in a private place:
anyone who reads it reads everything you recorded. An event that you withdraw after this export
stays in it; deleting your earlier exports is then up to you.

It never holds the deployment configuration, the secrets, the account's password data, the
sessions, the login failures, the drafts or the withdrawal ledger. The number of withdrawn events
is in the manifest.

Files
- readme.txt: this text.
- <table>.jsonl: one file per table, in UTF-8, one JSON object per row and per line, one key per
  column. Instants are ISO 8601 strings in UTC with milliseconds, dates are YYYY-MM-DD, JSON
  columns are embedded as JSON, arrays are JSON arrays, numbers use a decimal point, and an
  empty column is null.
- manifest.json, the last file: the format and its version, the export instant, the number of
  withdrawn events, then every table in loading order with its file, its number of rows, the
  SHA-256 of its file and its columns (name, type, whether it may be empty, the column it
  references), and the last value each identity sequence has issued. An archive without it was
  cut short.

Loading order
Each table comes after every table it references. The columns listed as second_pass_columns are
loaded empty first, then filled once every row exists, in the same transaction.
`;

const encoder = new TextEncoder();

/** The column that `column` of `table` references, written `<table>.<column>`, or null. */
function referenceOf(column: PgColumn, table: PgTable): string | null {
  for (const fk of getTableConfig(table).foreignKeys) {
    const reference = fk.reference();
    const target = reference.foreignColumns[reference.columns.indexOf(column)];
    if (target !== undefined) {
      return [getTableConfig(reference.foreignTable).name, target.name].join('.');
    }
  }
  return null;
}

/** The table `table` as the archive reads and loads it. */
function describe(table: PgTable): ArchiveTable {
  const config = getTableConfig(table);
  const parents = new Set<string>();
  const secondPass: string[] = [];
  for (const fk of config.foreignKeys) {
    const reference = fk.reference();
    const parent = getTableConfig(reference.foreignTable).name;
    if (parent === config.name || reference.columns.some((column) => CYCLE_BREAKERS.has(column))) {
      secondPass.push(...reference.columns.map((column) => column.name));
    } else {
      parents.add(parent);
    }
  }
  return { table, name: config.name, columns: config.columns, parents, secondPass };
}

/** `tables`, each after every table it references among them, in name order within a rank. */
function loadOrder(tables: readonly ArchiveTable[]): readonly ArchiveTable[] {
  const names = new Set(tables.map((table) => table.name));
  const order: ArchiveTable[] = [];
  const placed = new Set<string>();
  let waiting = [...names]
    .toSorted((left, right) => left.localeCompare(right, 'en'))
    .flatMap((name) => tables.filter((table) => table.name === name));
  while (waiting.length > 0) {
    const ready = waiting.filter((table) =>
      [...table.parents].every((parent) => placed.has(parent) || !names.has(parent)),
    );
    if (ready.length === 0) {
      const cycle = waiting.map((table) => table.name).join(', ');
      throw new Error(`These tables reference each other in a cycle: ${cycle}.`);
    }
    for (const table of ready) {
      order.push(table);
      placed.add(table.name);
    }
    waiting = waiting.filter((table) => !placed.has(table.name));
  }
  return order;
}

/**
 * Every table of the schema that `@/lib/db` exports, except those kept out of the
 * archive, in loading order (TRV-51, TRV-52, CL-TRV-05, CL-DSN-08, operations.md §5.1).
 */
function archivedTables(): readonly ArchiveTable[] {
  const exported: readonly unknown[] = Object.values(database);
  const tables = exported.filter(
    (value): value is PgTable => is(value, PgTable) && !database.isOutsideArchive(value),
  );
  return loadOrder(tables.map((table) => describe(table)));
}

/** The order in which the pages of `table` are read: its primary key. */
function keyOrder(table: ArchiveTable) {
  const keys = table.columns.filter((column) => column.primary);
  const composite = getTableConfig(table.table).primaryKeys.flatMap((key) => key.columns);
  return [...keys, ...composite].map((column) => asc(column));
}

/**
 * The rows of `table` read a page at a time in `tx`, one JSON line each, keyed by
 * column name; drizzle gives instants as dates, which JSON writes in ISO 8601 UTC.
 * @yields {Readonly<{ text: string; rows: number }>} The lines of each page, and how many.
 */
async function* pagesOf(
  tx: Transaction,
  table: ArchiveTable,
): AsyncGenerator<Readonly<{ text: string; rows: number }>> {
  const fields = Object.fromEntries(table.columns.map((column) => [column.name, column]));
  const order = keyOrder(table);
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await tx
      .select(fields)
      .from(table.table)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset(offset);
    if (page.length > 0) {
      yield { text: page.map((row) => `${JSON.stringify(row)}\n`).join(''), rows: page.length };
    }
    if (page.length < PAGE_SIZE) {
      return;
    }
  }
}

/** The value of the withdrawn-events counter, which the manifest carries (CL-DSN-08). */
async function withdrawnEventCount(tx: Transaction): Promise<number> {
  const [counter] = await tx
    .select({ value: database.withdrawnEventCounter.value })
    .from(database.withdrawnEventCounter);
  return counter?.value ?? 0;
}

/**
 * For each table with an identity column, the last value its sequence has issued, rows
 * erased since included, 0 when it has issued none (operations.md §2.5 step 3, CL-TRV-06).
 */
async function identitySequences(
  tx: Transaction,
  tables: readonly ArchiveTable[],
): Promise<Readonly<Record<string, number>>> {
  const identities = tables.flatMap((table) => {
    const column = table.columns.find((candidate) => candidate.generatedIdentity !== undefined);
    return column === undefined ? [] : [sql`(${table.name}::text, ${column.name}::text)`];
  });
  const sequence = sql`pg_get_serial_sequence(identity.table_name, identity.column_name)::regclass`;
  const rows = await tx
    .select({
      name: sql<string>`identity.table_name`,
      last: sql<number>`coalesce(pg_sequence_last_value(${sequence}), 0)`.mapWith(Number),
    })
    .from(
      sql`(values ${sql.join(identities, sql.raw(', '))}) as identity(table_name, column_name)`,
    );
  return Object.fromEntries(rows.map((row) => [row.name, row.last]));
}

/** What the manifest says of the table of `entry`, with the documentation of its columns. */
function manifestTable(entry: TableEntry) {
  const { table } = entry;
  const columns = table.columns.map((column) => ({
    name: column.name,
    type: column.getSQLType(),
    nullable: !column.notNull,
    references: referenceOf(column, table.table),
  }));
  const pairs: readonly (readonly [string, unknown])[] = [
    ['name', table.name],
    ['file', `${table.name}.jsonl`],
    ['rows', entry.rows],
    ['sha256', entry.sha256],
    ['columns', columns],
    ['second_pass_columns', table.secondPass],
  ];
  return Object.fromEntries(pairs);
}

/**
 * The manifest, the archive's last entry, read in `tx` once the files of the `expected`
 * tables are written, and `entries` says what each one holds. A caller that skipped a
 * table's file is a bug, which throws instead of giving a manifest without that table.
 */
async function manifest(
  tx: Transaction,
  exportedAt: EpochMs,
  { entries, expected }: Readonly<{ entries: readonly TableEntry[]; expected: number }>,
): Promise<ZipEntry> {
  if (entries.length !== expected) {
    throw new Error(
      `The manifest expects ${String(expected)} tables, but ${String(entries.length)} were read: read every table's file before the manifest.`,
    );
  }
  const pairs: readonly (readonly [string, unknown])[] = [
    ['format', FORMAT],
    ['format_version', FORMAT_VERSION],
    ['exported_at', new Date(exportedAt).toISOString()],
    ['withdrawn_event_count', await withdrawnEventCount(tx)],
    ['tables', entries.map((entry) => manifestTable(entry))],
    [
      'identity_sequences',
      await identitySequences(
        tx,
        entries.map((entry) => entry.table),
      ),
    ],
  ];
  const content = Object.fromEntries(pairs);
  const text = `${JSON.stringify(content, null, MANIFEST_INDENT)}\n`;
  return { name: MANIFEST_FILE, chunks: [encoder.encode(text)] };
}

/** The entry of `table`, which adds to `entries` what the manifest says of it once read. */
function tableEntry(tx: Transaction, table: ArchiveTable, entries: TableEntry[]): ZipEntry {
  async function* chunks(): AsyncGenerator<Uint8Array<ArrayBuffer>> {
    const hash = createHash('sha256');
    let rows = 0;
    for await (const page of pagesOf(tx, table)) {
      const bytes = encoder.encode(page.text);
      hash.update(bytes);
      rows += page.rows;
      yield bytes;
    }
    entries.push({ table, rows, sha256: hash.digest('hex') });
  }
  return { name: `${table.name}.jsonl`, chunks: chunks() };
}

/**
 * The entries of the archive that export, backup and restore share, read in `tx`, which
 * the caller opens as one repeatable-read snapshot (TRV-51, TRV-52, TRV-53): a readme
 * readable without the application, with the warning of TRV-56; one JSON Lines file per
 * table of the schema, those kept out of the archive excepted (CL-TRV-05, CL-DSN-08); and
 * last the manifest, which documents every table and column in loading order with the
 * second-pass columns, the withdrawn-events counter's value and, read after the tables,
 * the last value of each identity sequence (operations.md §5.1, CL-TRV-06).
 * @yields {ZipEntry} The readme, each table's file, then the manifest.
 */
export async function* archiveEntries(
  tx: Transaction,
  exportedAt: EpochMs,
): AsyncGenerator<ZipEntry, void, undefined> {
  const entries: TableEntry[] = [];
  const tables = archivedTables();
  yield { name: README_FILE, chunks: [encoder.encode(README)] };
  for (const table of tables) {
    yield tableEntry(tx, table, entries);
  }
  yield await manifest(tx, exportedAt, { entries, expected: tables.length });
}

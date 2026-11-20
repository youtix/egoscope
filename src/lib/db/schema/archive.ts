import type { PgTable } from 'drizzle-orm/pg-core';

// The tables that their schema files mark as kept out of the archive.
const keptOut = new WeakSet<PgTable>();

/**
 * Marks a table that backups and full exports leave out, as the export format of
 * the data model lists them (operations.md §5.1): the account, its sessions and
 * login failures, the drafts, and the withdrawal ledger (TRV-51, TRV-52,
 * CL-TRV-05, CL-DSN-08). The schema file wraps the table's definition with it.
 */
export function outsideArchive<TTable extends PgTable>(table: TTable): TTable {
  keptOut.add(table);
  return table;
}

/**
 * Says whether backups and full exports leave `table` out, so that the archive,
 * which enumerates the schema, skips it by its definition (TRV-51, TRV-52,
 * CL-TRV-05, CL-DSN-08).
 */
export function isOutsideArchive(table: PgTable): boolean {
  return keptOut.has(table);
}

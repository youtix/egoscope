import 'server-only';

import { and, eq, getTableColumns, sql } from 'drizzle-orm';

import { changedElsewhere, err, ok } from '@/lib/result';

import type { Transaction } from './transaction';
import type { ChangedElsewhere, Result } from '@/lib/result';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

/** A table whose rows the owner edits, each with the version its screens send back (CL-IHM-18). */
export type VersionedTable = PgTable & Readonly<{ rowVersion: AnyPgColumn<{ data: number }> }>;

/** A change of one row, made only if the row still has the version the screen showed. */
export type VersionedChange<T extends VersionedTable> = Readonly<{
  /** The row, by its key. */
  where: SQL;
  /** The `row_version` that the screen showed and its form sent back. */
  expectedVersion: number;
  /** The new values; the version moves on by itself, whatever these say of it. */
  set: { readonly [K in keyof T['$inferInsert']]?: T['$inferInsert'][K] };
}>;

/** The row that a save meant to change is gone, deleted elsewhere (CL-IHM-19). */
export type NoLongerExists = Readonly<{ kind: 'no_longer_exists' }>;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };

/**
 * Says whether `row`, read back from `table`, holds each of its columns: the typed row
 * of that table. Drizzle cannot type the rows of a table that a function receives as a
 * type parameter, so the queries below read them through the plain table type.
 */
function isRowOf<T extends VersionedTable>(
  table: T,
  row: Readonly<Record<string, unknown>>,
): row is T['$inferSelect'] {
  return Object.keys(getTableColumns(table)).every((column) => Object.hasOwn(row, column));
}

/**
 * Changes one row in the caller's transaction `tx` only when its `row_version` is still
 * `expectedVersion`, the one the screen showed, and moves the version on by one: the row
 * as it now stands. A row changed meanwhile, on another device or by a scheduled task,
 * is left as it is and returned as `changed_elsewhere`, so that the form shows its
 * current version and keeps the owner's input (CL-IHM-18); a row deleted meanwhile is
 * `no_longer_exists` (CL-IHM-19).
 */
export async function updateVersioned<T extends VersionedTable>(
  tx: Transaction,
  table: T,
  change: VersionedChange<T>,
): Promise<Result<T['$inferSelect'], ChangedElsewhere<T['$inferSelect']> | NoLongerExists>> {
  const versioned: VersionedTable = table;
  const updatedRows = await tx
    .update(versioned)
    .set({ ...change.set, rowVersion: sql`${versioned.rowVersion} + 1` })
    .where(and(change.where, eq(versioned.rowVersion, change.expectedVersion)))
    .returning();
  const updated = updatedRows.find((row): row is T['$inferSelect'] => isRowOf(table, row));
  if (updated !== undefined) {
    return ok(updated);
  }
  const currentRows = await tx.select().from(versioned).where(change.where);
  const current = currentRows.find((row): row is T['$inferSelect'] => isRowOf(table, row));
  return err(current === undefined ? NO_LONGER_EXISTS : changedElsewhere(current));
}

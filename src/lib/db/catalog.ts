import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { integer, pgSchema, text } from 'drizzle-orm/pg-core';

import type { Database } from './types';

// The view of the catalog that describes every column: its place in its table, the
// name of its type, whether it takes a null, and its default or its identity.
const catalogColumns = pgSchema('information_schema').table('columns', {
  tableSchema: text('table_schema').notNull(),
  tableName: text('table_name').notNull(),
  columnName: text('column_name').notNull(),
  ordinalPosition: integer('ordinal_position').notNull(),
  udtName: text('udt_name').notNull(),
  isNullable: text('is_nullable').notNull(),
  columnDefault: text('column_default'),
  identityGeneration: text('identity_generation'),
});

// The view of the catalog that lists every index with its definition.
const catalogIndexes = pgSchema('pg_catalog').table('pg_indexes', {
  schemaName: text('schemaname').notNull(),
  tableName: text('tablename').notNull(),
  indexName: text('indexname').notNull(),
  definition: text('indexdef').notNull(),
});

// The constraints of every table, of which `f` marks the foreign keys.
const catalogConstraints = pgSchema('pg_catalog').table('pg_constraint', {
  oid: integer('oid').notNull(),
  tableOid: integer('conrelid').notNull(),
  type: text('contype').notNull(),
});

// The table of a constraint, by its name in the public schema.
const constrainedTable = sql<string>`${catalogConstraints.tableOid}::regclass::text`;

/**
 * Every column of `tables`, table by table in name order and each in its place, as
 * the migrations built it, in the words of SQL: its type, `NOT NULL` unless it takes
 * a null, then its default or its identity, so that a schema test compares them with
 * the data model's column tables (TRV-68, TRV-76).
 */
export async function describeColumns(db: Database, tables: readonly string[]): Promise<string[]> {
  const columns = await db
    .select({
      table: catalogColumns.tableName,
      name: catalogColumns.columnName,
      // The name SQL gives the type: text[] for the array that the view calls ARRAY.
      type: sql<string>`${catalogColumns.udtName}::regtype::text`,
      nullable: catalogColumns.isNullable,
      default: catalogColumns.columnDefault,
      identity: catalogColumns.identityGeneration,
    })
    .from(catalogColumns)
    .where(and(eq(catalogColumns.tableSchema, 'public'), inArray(catalogColumns.tableName, tables)))
    .orderBy(asc(catalogColumns.tableName), asc(catalogColumns.ordinalPosition));
  return columns.map((column) => {
    const nullable = column.nullable === 'NO' ? ' NOT NULL' : '';
    const value = column.default === null ? '' : ` DEFAULT ${column.default}`;
    const identity = column.identity === null ? '' : ` GENERATED ${column.identity} AS IDENTITY`;
    return `${column.table}.${column.name} ${column.type}${nullable}${value}${identity}`;
  });
}

/**
 * Every index of `tables`, primary keys and unique constraints included, in name
 * order and as Postgres writes it, so that a schema test compares them with the
 * indexes and unique constraints of the data model (TRV-76).
 */
export async function describeIndexes(db: Database, tables: readonly string[]): Promise<string[]> {
  const indexes = await db
    .select({ definition: catalogIndexes.definition })
    .from(catalogIndexes)
    .where(and(eq(catalogIndexes.schemaName, 'public'), inArray(catalogIndexes.tableName, tables)))
    .orderBy(asc(catalogIndexes.indexName));
  return indexes.map((index) => index.definition);
}

/**
 * Every foreign key of `tables`, as `table FOREIGN KEY (column) REFERENCES
 * table(column) ON DELETE rule`, table by table, so that a schema test compares them
 * with the references of the data model and the rule each states (TRV-76).
 */
export async function describeForeignKeys(
  db: Database,
  tables: readonly string[],
): Promise<string[]> {
  const definition = sql<string>`pg_get_constraintdef(${catalogConstraints.oid})`;
  const keys = await db
    .select({ table: constrainedTable, definition })
    .from(catalogConstraints)
    .where(and(eq(catalogConstraints.type, 'f'), inArray(constrainedTable, tables)))
    .orderBy(asc(constrainedTable), asc(definition));
  return keys.map((key) => `${key.table} ${key.definition}`);
}

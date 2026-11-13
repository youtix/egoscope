import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { startPglite } from './pglite';

import type { PgliteDatabase } from './pglite';

// The catalog views that describe what the migrations built, and Drizzle's own
// record of the migrations it applied.
const informationSchema = pgSchema('information_schema');
const columns = informationSchema.table('columns', {
  tableSchema: text('table_schema'),
  tableName: text('table_name'),
  columnName: text('column_name'),
  dataType: text('data_type'),
  isNullable: text('is_nullable'),
  columnDefault: text('column_default'),
});
const tableConstraints = informationSchema.table('table_constraints', {
  tableSchema: text('table_schema'),
  tableName: text('table_name'),
  constraintName: text('constraint_name'),
  constraintType: text('constraint_type'),
});
const appliedMigrations = pgSchema('drizzle').table('__drizzle_migrations', {
  hash: text('hash'),
});

const BREAKPOINT = '\n--> statement-breakpoint\n';

/** An empty PGlite database, stopped when the test ends. */
async function emptyDatabase(): Promise<PgliteDatabase> {
  const pglite = await startPglite({});
  onTestFinished(pglite.close);
  return pglite;
}

/**
 * A project root of its own as the working directory, whose drizzle/ holds
 * `migrations` in order, each a list of statements, as drizzle-kit writes them.
 */
function projectWith(migrations: readonly (readonly string[])[]): void {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-migrations-'));
  mkdirSync(path.join(folder, 'drizzle', 'meta'), { recursive: true });
  const entries = migrations.map((statements, index) => {
    const tag = `000${String(index)}_probe`;
    writeFileSync(path.join(folder, 'drizzle', `${tag}.sql`), statements.join(BREAKPOINT));
    return { idx: index, version: '7', when: index + 1, tag, breakpoints: true };
  });
  writeFileSync(
    path.join(folder, 'drizzle', 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  );
  vi.spyOn(process, 'cwd').mockReturnValue(folder);
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
}

/** The tables of the public schema, by name. */
async function publicTables(pglite: PgliteDatabase): Promise<readonly (string | null)[]> {
  const rows = await pglite.db
    .selectDistinct({ name: columns.tableName })
    .from(columns)
    .where(eq(columns.tableSchema, 'public'))
    .orderBy(asc(columns.tableName));
  return rows.map((row) => row.name);
}

describe('the migrations', { timeout: 60_000 }, () => {
  it('[TRV-76] build every table and column of the schema from an empty database', async () => {
    const pglite = await emptyDatabase();

    await pglite.migrate();
    const built = await pglite.db
      .select({
        table: columns.tableName,
        column: columns.columnName,
        type: columns.dataType,
        nullable: columns.isNullable,
        default: columns.columnDefault,
      })
      .from(columns)
      .where(eq(columns.tableSchema, 'public'))
      .orderBy(asc(columns.tableName), asc(columns.columnName));

    expect(built).toStrictEqual([
      {
        table: 'installation',
        column: 'first_started_at',
        type: 'timestamp with time zone',
        nullable: 'NO',
        default: null,
      },
      { table: 'installation', column: 'id', type: 'smallint', nullable: 'NO', default: null },
      {
        table: 'sequence_counters',
        column: 'last_value',
        type: 'integer',
        nullable: 'NO',
        default: '0',
      },
      { table: 'sequence_counters', column: 'name', type: 'text', nullable: 'NO', default: null },
    ]);
  });

  it('[TRV-76] give every table its primary key', async () => {
    const pglite = await emptyDatabase();

    await pglite.migrate();
    const keys = await pglite.db
      .select({ table: tableConstraints.tableName, name: tableConstraints.constraintName })
      .from(tableConstraints)
      .where(
        and(
          eq(tableConstraints.tableSchema, 'public'),
          eq(tableConstraints.constraintType, 'PRIMARY KEY'),
        ),
      )
      .orderBy(asc(tableConstraints.tableName));

    expect(keys).toStrictEqual([
      { table: 'installation', name: 'installation_pkey' },
      { table: 'sequence_counters', name: 'sequence_counters_pkey' },
    ]);
  });

  it('[TRV-76] apply only what is pending: a second run changes nothing', async () => {
    const pglite = await emptyDatabase();

    await pglite.migrate();
    await pglite.migrate();

    await expect(pglite.db.select().from(appliedMigrations)).resolves.toHaveLength(1);
    await expect(publicTables(pglite)).resolves.toStrictEqual([
      'installation',
      'sequence_counters',
    ]);
  });

  it('[TRV-76] evolve a migrated database with the migrations that came after', async () => {
    const pglite = await emptyDatabase();
    const first = ['CREATE TABLE "first_probe" ("id" integer PRIMARY KEY);'];
    projectWith([first]);
    await pglite.migrate();
    projectWith([first, ['CREATE TABLE "second_probe" ("id" integer PRIMARY KEY);']]);

    await pglite.migrate();

    await expect(publicTables(pglite)).resolves.toStrictEqual(['first_probe', 'second_probe']);
    await expect(pglite.db.select().from(appliedMigrations)).resolves.toHaveLength(2);
  });

  it('[TRV-76] roll the whole run back when a migration fails, leaving the structure as it was', async () => {
    const pglite = await emptyDatabase();
    projectWith([
      ['CREATE TABLE "first_probe" ("id" integer PRIMARY KEY);'],
      ['CREATE TABLE "second_probe" ("id" integer PRIMARY KEY);', 'SELECT * FROM "missing";'],
    ]);

    await expect(pglite.migrate()).rejects.toMatchObject({
      cause: { message: 'relation "missing" does not exist' },
    });
    await expect(publicTables(pglite)).resolves.toStrictEqual([]);
  });
});

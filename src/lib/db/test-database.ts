import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { z } from 'zod';

import { migrationConfig } from './migrations';
import { startPglite } from './pglite';

import type { PgliteDatabase } from './pglite';
import type { Database } from './types';
import type { SQL } from 'drizzle-orm';

/** A test's own database, and the way to close it. */
export type TestDatabase = Readonly<{ db: Database; close: () => Promise<void> }>;

/** Where the migrated template is kept between test files, and how it is built when absent. */
export type TemplateStore = Readonly<{
  folder: string;
  /** Names the template, and changes whenever its content would. */
  key: () => Promise<string>;
  build: () => Promise<Blob>;
}>;

/** Test databases that share their template, and the way to stop the PGlite that waits. */
export type TestDatabases = Readonly<{
  create: () => Promise<TestDatabase>;
  /** Stops the PGlite that a closed database left for the next call, if one waits. */
  stop: () => Promise<void>;
}>;

// A test file's PGlite between two of its tests.
type KeptDatabase = Readonly<{
  pglite: PgliteDatabase;
  /** Reads the fingerprint, as the catalog of `pglite` wrote the statement once. */
  fingerprinting: SQL;
  /** The fingerprint as it was when the database last equaled the template. */
  fingerprint: string;
}>;

// The hash that names a template and the digest that ends its file, so that a file cut
// short or damaged is never loaded.
const HASH = 'sha256';
const DIGEST_LENGTH = 32;

// The stored templates, in a folder that git ignores and that every test worker of the
// checkout reads, and where PGlite says which version is installed.
const TEMPLATE_FOLDER = ['node_modules', '.cache', 'egoscope', 'test-database'];
const PGLITE_MANIFEST = ['node_modules', '@electric-sql', 'pglite', 'package.json'];
const JOURNAL = ['meta', '_journal.json'];
const STORED = '.tar';
const PARTIAL = '.partial';

// What the fingerprint reads: every table and every sequence outside the public schema, the
// catalogs among them and the bookkeeping of Drizzle's migrator, but not the TOAST tables,
// which only hold the long values of the others.
const FINGERPRINTED = sql`
  select c.relkind as kind, format('%I.%I', n.nspname, c.relname) as name
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'S') and n.nspname not in ('public', 'pg_toast')
  order by c.oid`;

// The tables of the public schema that hold a page: those that held a row since the
// template, alive or dead, since a table without a page never held any.
const OCCUPIED = sql`
  select format('%I.%I', n.nspname, c.relname) as name
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and pg_catalog.pg_relation_size(c.oid) > 0
  order by c.oid`;

// Puts every sequence of the public schema, those of the identity columns among them, back
// at its start, where the template has it.
const RESTART = sql`
  select count(pg_catalog.setval(s.seqrelid, s.seqstart, false))::integer as restarted
  from pg_catalog.pg_sequence s
  join pg_catalog.pg_class c on c.oid = s.seqrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'`;

const relation = z.object({ kind: z.enum(['r', 'S']), name: z.string() });
const relationRows = z.object({ rows: z.array(relation) });
const fingerprintValue = z.object({ fingerprint: z.string() });
const fingerprintRow = z.object({ rows: z.tuple([fingerprintValue]) });
const tableName = z.object({ name: z.string() });
const tableRows = z.object({ rows: z.array(tableName) });

/** Calls `work` on the first call only, and gives every call its promise. */
function once<T>(work: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined;
  return async () => (result ??= work());
}

function digestOf(bytes: Uint8Array): Buffer {
  return createHash(HASH).update(bytes).digest();
}

/**
 * The name of the template that the migrations of `migrationConfig()` build on the
 * installed PGlite: a hash of the migration journal, of every migration it lists and of
 * PGlite's manifest, so that it changes whenever the template's content would (TRV-76).
 */
export async function templateKey(): Promise<string> {
  const config = migrationConfig();
  const journalFile = path.join(config.migrationsFolder, ...JOURNAL);
  const manifestFile = path.join(process.cwd(), ...PGLITE_MANIFEST);
  const [journal, manifest] = await Promise.all([readFile(journalFile), readFile(manifestFile)]);
  const hash = createHash(HASH).update(manifest).update(journal);
  for (const migration of readMigrationFiles(config)) {
    hash.update(migration.hash);
  }
  return hash.digest('hex');
}

/** Builds the template: an empty PGlite with every migration applied, as files (TRV-76). */
export async function buildTemplate(): Promise<Blob> {
  const pglite = await startPglite({});
  await pglite.migrate();
  const files = await pglite.dump();
  await pglite.close();
  return files;
}

function storedFile(folder: string, key: string): string {
  return path.join(folder, `${key}${STORED}`);
}

async function readIfPresent(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch {
    return undefined;
  }
}

async function readStoredTemplate(folder: string, key: string): Promise<Blob | undefined> {
  const content = await readIfPresent(storedFile(folder, key));
  if (content === undefined || content.length <= DIGEST_LENGTH) {
    return undefined;
  }
  const files = content.subarray(0, -DIGEST_LENGTH);
  const isWhole = digestOf(files).equals(content.subarray(-DIGEST_LENGTH));
  return isWhole ? new Blob([new Uint8Array(files)]) : undefined;
}

async function removeOtherKeys(folder: string, key: string): Promise<void> {
  const names = await readdir(folder);
  const others = names.filter((name) => !name.startsWith(`${key}.`));
  await Promise.all(
    others.map(async (name) => rm(path.join(folder, name), { force: true, recursive: true })),
  );
}

// Written beside its place, then renamed: a worker never reads half a file, and a run
// killed while writing leaves only a partial file, which nothing reads.
async function storeTemplate(folder: string, key: string, template: Blob): Promise<void> {
  const files = new Uint8Array(await template.arrayBuffer());
  const partial = path.join(folder, `${key}.${randomUUID()}${PARTIAL}`);
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(partial, Buffer.concat([files, digestOf(files)]));
    await rename(partial, storedFile(folder, key));
    await removeOtherKeys(folder, key);
  } catch {
    // Storing only saves the next workers a build: this one keeps its template in memory,
    // and removes what it may have begun to write, if it can.
    await Promise.allSettled([rm(partial, { force: true })]);
  }
}

async function builtTemplate(store: TemplateStore, key: string): Promise<Blob> {
  const template = await store.build();
  await storeTemplate(store.folder, key, template);
  return template;
}

async function storedOrBuiltTemplate(store: TemplateStore): Promise<Blob> {
  const key = await store.key();
  return (await readStoredTemplate(store.folder, key)) ?? builtTemplate(store, key);
}

// For each table, its rows and the newest transaction that wrote one, which any change to
// the table changes; for each sequence, its value; and when the configuration was last
// loaded, which a reload after `alter system` changes.
function fingerprintingOf(relations: readonly z.infer<typeof relation>[]): SQL {
  const parts = relations.map(({ kind, name }) =>
    kind === 'S'
      ? `(select last_value || ':' || is_called from ${name})`
      : `(select count(*) || ':' || coalesce(max(xmin::text::bigint), 0) from ${name})`,
  );
  return sql.raw(
    `select array[pg_catalog.pg_conf_load_time()::text, ${parts.join(', ')}]::text as fingerprint`,
  );
}

async function fingerprintOf(db: Database, fingerprinting: SQL): Promise<string> {
  const result = await db.execute(fingerprinting);
  return fingerprintRow.parse(result).rows[0].fingerprint;
}

async function open(template: Blob): Promise<KeptDatabase> {
  const pglite = await startPglite({ loadDataDir: template });
  try {
    const { rows: relations } = relationRows.parse(await pglite.db.execute(FINGERPRINTED));
    const fingerprinting = fingerprintingOf(relations);
    return { pglite, fingerprinting, fingerprint: await fingerprintOf(pglite.db, fingerprinting) };
  } catch (error) {
    // A PGlite that refused its files may refuse to close as well; the first error tells why.
    await Promise.allSettled([pglite.close()]);
    throw error;
  }
}

/**
 * Puts `kept` back in the state of the template, and gives it with the fingerprint that it
 * now has; gives nothing when it cannot, or when a test changed anything outside the
 * tables and the sequences of the public schema.
 */
async function returnToTemplate(kept: KeptDatabase): Promise<KeptDatabase | undefined> {
  const { pglite, fingerprinting } = kept;
  try {
    if (pglite.isInTransaction()) {
      await pglite.db.execute(sql`rollback`);
    }
    if ((await fingerprintOf(pglite.db, fingerprinting)) !== kept.fingerprint) {
      return undefined;
    }
    // Settings, prepared statements, cursors, session locks and temporary objects.
    await pglite.db.execute(sql`discard all`);
    await pglite.db.execute(RESTART);
    const { rows: occupied } = tableRows.parse(await pglite.db.execute(OCCUPIED));
    if (occupied.length === 0) {
      return kept;
    }
    // Truncating also empties the tables that refer to these, and gives each new files,
    // which the catalog records: the fingerprint is read again.
    await pglite.db.execute(
      sql.raw(`truncate ${occupied.map(({ name }) => name).join(', ')} cascade`),
    );
    return { ...kept, fingerprint: await fingerprintOf(pglite.db, fingerprinting) };
  } catch {
    return undefined;
  }
}

/**
 * Gives test databases copied from the template that `store` keeps or builds, loaded or
 * built once (TRV-76). Closing a database first refuses every later call of its `db`, then
 * waits for the calls made before to end, then puts its PGlite back in the state of the
 * template: every table of the public schema empty, every identity and sequence at its
 * start, no transaction open, the schema untouched. The next call takes that PGlite in
 * milliseconds. A PGlite that cannot go back, or whose schema, roles, large objects or
 * migration records a test changed, stops instead, and so does one closed while another
 * already waits. A database asked for while none waits starts its own PGlite.
 */
export function testDatabases(store: TemplateStore): TestDatabases {
  let template: Promise<Blob> | undefined;
  let waiting: KeptDatabase | undefined;

  async function start(): Promise<KeptDatabase> {
    template ??= storedOrBuiltTemplate(store);
    try {
      return await open(await template);
    } catch {
      // A stored template that PGlite refuses counts as absent: built again, stored over it.
      template = builtTemplate(store, await store.key());
      return open(await template);
    }
  }

  async function giveBack(kept: KeptDatabase): Promise<void> {
    const reset = await returnToTemplate(kept);
    if (reset === undefined) {
      // A PGlite that failed to go back may fail to close too; nothing else depends on it.
      await Promise.allSettled([kept.pglite.close()]);
    } else if (waiting === undefined) {
      waiting = reset;
    } else {
      await kept.pglite.close();
    }
  }

  return {
    create: async () => {
      const reused = waiting;
      waiting = undefined;
      const kept = reused ?? (await start());
      const loan = kept.pglite.lend();
      return {
        db: loan.db,
        close: once(async () => {
          await loan.revoke();
          await giveBack(kept);
        }),
      };
    },
    stop: async () => {
      const kept = waiting;
      waiting = undefined;
      await kept?.pglite.close();
    },
  };
}

// The databases of this test file, which Vitest runs in a worker of its own, from the
// template that the first worker of a run stores for the others.
const fileDatabases = testDatabases({
  folder: path.join(process.cwd(), ...TEMPLATE_FOLDER),
  key: templateKey,
  build: buildTemplate,
});

/**
 * Gives a test an in-memory database of its own with every migration applied
 * (TRV-76): no installed database is needed, and no other test has left anything in
 * it. Close it when the test ends, `onTestFinished(database.close)`: closing waits for
 * the queries already sent, then puts its PGlite back in the state of the template for
 * the next test of the file, while one left open holds about 200 MB and makes the next
 * test start a PGlite of its own. Once closed, which a second call does again
 * harmlessly, its `db` refuses every query and transaction, as a closed PGlite does
 * ("PGlite is closed"), and never reaches the next test's data.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  return fileDatabases.create();
}

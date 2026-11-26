import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { z } from 'zod';

import { startPglite } from './pglite';
import { followedPlayers, installation, sequenceCounters, teams } from './schema';
import { nextValue } from './sequence';
import { buildTemplate, createTestDatabase, templateKey, testDatabases } from './test-database';

import type { TemplateStore, TestDatabase } from './test-database';
import type { Database } from './types';
import type { SQL } from 'drizzle-orm';

/** A test database, closed when the test ends. */
async function openTestDatabase(): Promise<TestDatabase> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  return database;
}

const started = z.object({ started: z.string() });
const startRow = z.object({ rows: z.tuple([started]) });
const named = z.object({ name: z.string() });
const nameRows = z.object({ rows: z.array(named) });
const counted = z.object({ count: z.number() });
const countRow = z.object({ rows: z.tuple([counted]) });
const transaction = z.object({ id: z.string().nullable() });
const transactionRow = z.object({ rows: z.tuple([transaction]) });
const sequence = z.object({ name: z.string(), value: z.string().nullable() });
const sequenceRows = z.object({ rows: z.array(sequence) });

/** When the PGlite behind `db` started, which tells one PGlite from another. */
async function startOf(db: Database): Promise<string> {
  const result = await db.execute(sql`select pg_postmaster_start_time()::text as started`);
  return startRow.parse(result).rows[0].started;
}

/** The names that `query` gives in its column `name`. */
async function names(db: Database, query: SQL): Promise<string[]> {
  const result = await db.execute(query);
  return nameRows.parse(result).rows.map((row) => row.name);
}

/** Every table of the public schema, as the catalog lists them. */
async function publicTables(db: Database): Promise<string[]> {
  return names(
    db,
    sql`select c.relname as name
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`,
  );
}

/** The tables of the public schema that hold a page, of which a fresh database has none. */
async function tablesWithPages(db: Database): Promise<string[]> {
  return names(
    db,
    sql`select c.relname as name
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and pg_catalog.pg_relation_size(c.oid) > 0
      order by c.relname`,
  );
}

/** The roles of the database. */
async function roles(db: Database): Promise<string[]> {
  return names(db, sql`select rolname as name from pg_catalog.pg_roles`);
}

/** Each table of `tables` with the number of its rows. */
async function rowCounts(db: Database, tables: readonly string[]): Promise<[string, number][]> {
  return Promise.all(
    tables.map(async (table): Promise<[string, number]> => {
      const result = await db.execute(
        sql`select count(*)::integer as count from public.${sql.identifier(table)}`,
      );
      return [table, countRow.parse(result).rows[0].count];
    }),
  );
}

/** Every sequence of the public schema with its last value, null until it gives one. */
async function sequenceValues(db: Database): Promise<[string, string | null][]> {
  const result = await db.execute(sql`
    select sequencename as name, last_value::text as value
    from pg_catalog.pg_sequences where schemaname = 'public' order by sequencename`);
  return sequenceRows.parse(result).rows.map((row) => [row.name, row.value]);
}

/** What a test finds in `db`: the rows of each public table, its pages and its sequences. */
async function contentOf(db: Database): Promise<{
  rows: [string, number][];
  paged: string[];
  sequences: [string, string | null][];
}> {
  const tables = await publicTables(db);
  return {
    rows: await rowCounts(db, tables),
    paged: await tablesWithPages(db),
    sequences: await sequenceValues(db),
  };
}

/** The transaction that `db` is in, when one is open and has written. */
async function openTransaction(db: Database): Promise<string | null> {
  const result = await db.execute(sql`select pg_current_xact_id_if_assigned()::text as id`);
  return transactionRow.parse(result).rows[0].id;
}

/** The PGlite client behind `db`, which Drizzle lets a test reach. */
function clientOf(db: Database): PGlite {
  const client: unknown = Reflect.get(db, '$client');
  assert.ok(client instanceof PGlite);
  return client;
}

/** The first identity of `teams` and the first import number that `db` gives. */
async function firstNumbers(db: Database): Promise<[number | undefined, number]> {
  const [team] = await db
    .insert(teams)
    .values({ abbreviation: 'NRV', name: 'Norvale Comets' })
    .returning({ id: teams.id });
  const number = await db.transaction(async (tx) => nextValue(tx, 'import_sequence'));
  return [team?.id, number];
}

// The tables that `writeRows` writes, by name, and the sequence of the identity of `teams`.
const WRITTEN = ['followed_players', 'installation', 'sequence_counters', 'teams'];
const TEAM_IDS = 'teams_id_seq';

/** Writes rows into tables of every kind of key: identity, uuid, singleton, counter. */
async function writeRows(db: Database): Promise<void> {
  const [team] = await db
    .insert(teams)
    .values({ abbreviation: 'QLB', name: 'Quillbrook Herons' })
    .returning({ id: teams.id });
  await db.insert(followedPlayers).values({
    displayName: 'Tobin Ashgrove',
    displayNameNormalized: 'tobin ashgrove',
    currentTeamId: team?.id,
  });
  await db.insert(installation).values({ id: 1, firstStartedAt: sql`now()` });
  await db.transaction(async (tx) => nextValue(tx, 'import_sequence'));
  await db.transaction(async (tx) => nextValue(tx, 'request_reference_2026'));
}

/** Writes rows into a database, closes it and tells which PGlite it was. */
async function writtenAndClosed(): Promise<string> {
  const { db, close } = await createTestDatabase();
  const start = await startOf(db);
  await writeRows(db);
  await close();
  return start;
}

describe('createTestDatabase', { timeout: 60_000 }, () => {
  it('[TRV-76] gives a database with every migration applied and no rows', async () => {
    const { db } = await openTestDatabase();

    const rows = await Promise.all([
      db.select().from(installation),
      db.select().from(sequenceCounters),
    ]);

    expect(rows).toStrictEqual([[], []]);
  });

  it('gives each caller a database of its own, which no write of another reaches', async () => {
    const first = await openTestDatabase();
    await first.db.insert(sequenceCounters).values({ name: 'import_sequence', lastValue: 7 });

    const second = await openTestDatabase();

    await expect(first.db.select().from(sequenceCounters)).resolves.toStrictEqual([
      { name: 'import_sequence', lastValue: 7 },
    ]);
    await expect(second.db.select().from(sequenceCounters)).resolves.toStrictEqual([]);
  });

  it('closes the database, which then answers no query', async () => {
    const { db, close } = await createTestDatabase();

    await close();

    await expect(db.select().from(installation)).rejects.toMatchObject({
      cause: { message: 'PGlite is closed' },
    });
  });

  it('[TRV-76] gives the next test the PGlite that a test closed, and a held one to nobody', async () => {
    const closed = await createTestDatabase();
    const closedStart = await startOf(closed.db);
    await closed.close();

    const next = await openTestDatabase();
    const meanwhile = await openTestDatabase();

    expect(await startOf(next.db)).toBe(closedStart);
    expect(await startOf(meanwhile.db)).not.toBe(closedStart);
  });

  it('[TRV-76] empties every table and restarts every counter that a test wrote', async () => {
    const written = await createTestDatabase();
    await writeRows(written.db);
    expect(await tablesWithPages(written.db)).toStrictEqual(WRITTEN);
    await written.close();

    const next = await openTestDatabase();
    const fresh = await openTestDatabase();
    const content = await contentOf(next.db);

    expect(content).toStrictEqual(await contentOf(fresh.db));
    expect(content).toStrictEqual({
      rows: content.rows.map(([table]) => [table, 0]),
      paged: [],
      sequences: content.sequences.map(([name]) => [name, null]),
    });
    expect({
      tables: content.rows.map(([table]) => table).filter((table) => WRITTEN.includes(table)),
      sequences: content.sequences.map(([name]) => name).filter((name) => name === TEAM_IDS),
    }).toStrictEqual({ tables: WRITTEN, sequences: [TEAM_IDS] });
    expect([await firstNumbers(next.db), await firstNumbers(fresh.db)]).toStrictEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it('[TRV-76] keeps giving one PGlite to tests that write and close, one after the other', async () => {
    const starts = [await writtenAndClosed(), await writtenAndClosed(), await writtenAndClosed()];

    expect(starts).toStrictEqual([starts[0], starts[0], starts[0]]);
  });

  it('[TRV-76] ends the transaction that a test left open, even a failed one', async () => {
    const left = await createTestDatabase();
    const leftStart = await startOf(left.db);
    await left.db.execute(sql`begin`);
    await left.db.insert(sequenceCounters).values({ name: 'import_sequence', lastValue: 7 });
    await expect(left.db.execute(sql`select 1 / 0`)).rejects.toThrow('Failed query');
    await left.close();

    const next = await openTestDatabase();

    expect(await startOf(next.db)).toBe(leftStart);
    expect(await openTransaction(next.db)).toBeNull();
    await expect(next.db.select().from(sequenceCounters)).resolves.toStrictEqual([]);
  });

  it('[TRV-76] leaves nothing of a test that threw inside a transaction', async () => {
    const failed = await createTestDatabase();
    const failedStart = await startOf(failed.db);
    await failed.db.insert(teams).values({ abbreviation: 'WSP', name: 'Westpine Owls' });
    await expect(
      failed.db.transaction(async (tx) => {
        await nextValue(tx, 'import_sequence');
        throw new Error('a check failed in the middle of the transaction');
      }),
    ).rejects.toThrow('a check failed in the middle of the transaction');
    await failed.close();

    const next = await openTestDatabase();

    expect(await startOf(next.db)).toBe(failedStart);
    expect(await openTransaction(next.db)).toBeNull();
    expect(await firstNumbers(next.db)).toStrictEqual([1, 1]);
  });

  it('[TRV-76] waits for the queries sent before it closed, then ends what they left open', async () => {
    const racing = await createTestDatabase();
    const racingStart = await startOf(racing.db);
    const client = clientOf(racing.db);
    const sentQueries = Promise.all([
      client.query('begin'),
      client.query(
        `insert into sequence_counters (name, last_value) values ('import_sequence', 7)`,
      ),
    ]);
    const isInTransaction = client.isInTransaction();
    await racing.close();

    const next = await openTestDatabase();

    await expect(sentQueries).resolves.toMatchObject([{ rows: [] }, { affectedRows: 1 }]);
    expect([isInTransaction, await startOf(next.db)]).toStrictEqual([false, racingStart]);
    expect(await openTransaction(next.db)).toBeNull();
    await expect(next.db.select().from(sequenceCounters)).resolves.toStrictEqual([]);
  });

  it('[TRV-76] starts a fresh PGlite after one that could not go back, and closes without error', async () => {
    const broken = await createTestDatabase();
    const brokenStart = await startOf(broken.db);
    const client = clientOf(broken.db);
    await client.close();
    await broken.close();

    const next = await openTestDatabase();

    expect(client.closed).toBe(true);
    expect(await startOf(next.db)).not.toBe(brokenStart);
    await expect(next.db.select().from(sequenceCounters)).resolves.toStrictEqual([]);
  });

  it('[TRV-76] stops a database closed while another already waits', async () => {
    const first = await createTestDatabase();
    const second = await createTestDatabase();
    const [firstStart, secondStart] = [await startOf(first.db), await startOf(second.db)];
    await first.close();
    await second.close();

    const next = await openTestDatabase();
    const meanwhile = await openTestDatabase();

    expect(await startOf(next.db)).toBe(firstStart);
    expect(await startOf(meanwhile.db)).not.toBe(secondStart);
  });

  it('[TRV-76] stops a database whose schema a test changed, for a fresh one', async () => {
    const changed = await createTestDatabase();
    const changedStart = await startOf(changed.db);
    await changed.db.execute(sql`create table public.left_by_a_test (id integer)`);
    await changed.close();

    const next = await openTestDatabase();

    expect(await startOf(next.db)).not.toBe(changedStart);
    expect(await publicTables(next.db)).not.toContain('left_by_a_test');
  });

  it('[TRV-76] stops a database whose column a test altered, for a fresh one', async () => {
    const altered = await createTestDatabase();
    const alteredStart = await startOf(altered.db);
    await altered.db.execute(sql`alter table public.teams rename column name to label`);
    await altered.close();

    const next = await openTestDatabase();

    expect(await startOf(next.db)).not.toBe(alteredStart);
    await expect(next.db.select().from(teams)).resolves.toStrictEqual([]);
  });

  it('[TRV-76] stops a database in which a test created a role, for a fresh one', async () => {
    const changed = await createTestDatabase();
    const changedStart = await startOf(changed.db);
    await changed.db.execute(sql`create role left_by_a_test`);
    await changed.close();

    const next = await openTestDatabase();

    expect(await startOf(next.db)).not.toBe(changedStart);
    expect(await roles(next.db)).not.toContain('left_by_a_test');
  });

  it('[TRV-76] resets the settings that a test changed for its session', async () => {
    const changed = await createTestDatabase();
    const changedStart = await startOf(changed.db);
    await changed.db.execute(sql`set statement_timeout = 1234`);
    await changed.close();

    const next = await openTestDatabase();

    expect(await startOf(next.db)).toBe(changedStart);
    expect(
      await names(next.db, sql`select current_setting('statement_timeout') as name`),
    ).toStrictEqual(['0']);
  });

  it('[TRV-76] closes harmlessly twice, and refuses any later write through the closed handle', async () => {
    const closed = await createTestDatabase();
    const closedStart = await startOf(closed.db);
    await closed.close();
    await closed.close();

    const next = await openTestDatabase();

    expect(await startOf(next.db)).toBe(closedStart);
    await expect(
      closed.db.insert(sequenceCounters).values({ name: 'import_sequence', lastValue: 7 }),
    ).rejects.toMatchObject({ cause: { message: 'PGlite is closed' } });
    await expect(
      closed.db.transaction(async (tx) => tx.select().from(sequenceCounters)),
    ).rejects.toThrow('PGlite is closed');
    await expect(next.db.select().from(sequenceCounters)).resolves.toStrictEqual([]);
  });

  it('[TRV-76] refuses a method of the client taken before it closed', async () => {
    const closed = await createTestDatabase();
    const query: unknown = Reflect.get(clientOf(closed.db), 'query');
    assert.ok(typeof query === 'function');
    await closed.close();
    const next = await openTestDatabase();

    expect((): unknown =>
      Reflect.apply(query, undefined, [
        "insert into sequence_counters (name, last_value) values ('import_sequence', 7)",
      ]),
    ).toThrow('PGlite is closed');
    await expect(next.db.select().from(sequenceCounters)).resolves.toStrictEqual([]);
  });
});

/** Calls `work` on the first call only, and gives every call its promise. */
function once<T>(work: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined;
  return async () => (result ??= work());
}

// The real template, built once for the tests of the stored template.
const realTemplate = once(buildTemplate);

/** A key function that gives `key`. */
function keyed(key: string): () => Promise<string> {
  return vi.fn<() => Promise<string>>().mockResolvedValue(key);
}

/** A store in a folder of its own, removed when the test ends, whose builds are counted. */
async function countedStore(
  key: string,
  build = vi.fn<() => Promise<Blob>>(realTemplate),
): Promise<{ store: TemplateStore; builds: () => number }> {
  const folder = await mkdtemp(path.join(tmpdir(), 'egoscope-template-'));
  onTestFinished(async () => rm(folder, { recursive: true, force: true }));
  return { store: { folder, key: keyed(key), build }, builds: () => build.mock.calls.length };
}

/**
 * The real template as the build of another worker gives it, from a PGlite of its own: the same
 * database, in other bytes.
 */
async function anotherWorkersTemplate(): Promise<Blob> {
  const pglite = await startPglite({ loadDataDir: await realTemplate() });
  try {
    return await pglite.dump();
  } finally {
    await pglite.close();
  }
}

/** A build that gives `template` once released, and says when a worker asked for it. */
function withheldBuild(template: () => Promise<Blob>): Readonly<{
  build: () => Promise<Blob>;
  asked: Promise<void>;
  release: () => void;
}> {
  const asked = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  return {
    build: async () => {
      asked.resolve(undefined);
      await released.promise;
      return template();
    },
    asked: asked.promise,
    release: () => {
      released.resolve(undefined);
    },
  };
}

/** A database of a new worker of `store`, checked to be migrated, then closed and stopped. */
async function workerDatabase(store: TemplateStore): Promise<void> {
  const databases = testDatabases(store);
  const { db, close } = await databases.create();
  try {
    await expect(db.select().from(installation)).resolves.toStrictEqual([]);
  } finally {
    await close();
    await databases.stop();
  }
}

describe('the stored template', { timeout: 60_000 }, () => {
  it('[TRV-76] is built by the first worker only, and loaded by the next', async () => {
    const { store, builds } = await countedStore('first');

    await workerDatabase(store);
    await workerDatabase(store);

    expect(builds()).toBe(1);
    expect(await readdir(store.folder)).toStrictEqual(['first.tar']);
  });

  it('[TRV-76] ignores and removes the template of another key, and what a killed run left', async () => {
    const { store, builds } = await countedStore('old');
    await workerDatabase(store);
    await writeFile(path.join(store.folder, 'new.killed-run.partial'), 'a template cut short');

    await workerDatabase({ ...store, key: keyed('new') });

    expect(builds()).toBe(2);
    expect(await readdir(store.folder)).toStrictEqual(['new.tar']);
  });

  it('[TRV-76] replaces a template cut short or damaged, and loads the replacement', async () => {
    const { store, builds } = await countedStore('first');
    const file = path.join(store.folder, 'first.tar');
    await workerDatabase(store);
    const whole = await readFile(file);

    await writeFile(file, whole.subarray(0, Math.floor(whole.length / 2)));
    await workerDatabase(store);
    const damaged = await readFile(file);
    const middle = Math.floor(damaged.length / 2);
    damaged.writeUInt8(damaged.readUInt8(middle) ^ 0xff, middle);
    await writeFile(file, damaged);
    await workerDatabase(store);
    await workerDatabase(store);
    const replaced = await readFile(file);

    expect(builds()).toBe(3);
    expect(replaced.equals(whole)).toBe(true);
  });

  it('[TRV-76] builds again a stored template that PGlite refuses, and stores the new one', async () => {
    const build = vi
      .fn<() => Promise<Blob>>(realTemplate)
      .mockResolvedValueOnce(new Blob(['not the files of a database']));
    const { store, builds } = await countedStore('first', build);

    await workerDatabase(store);
    await workerDatabase(store);

    expect(builds()).toBe(2);
  });

  it('[TRV-76] stays one whole file when two workers build it at once, even for one reading it', async () => {
    const { store, builds } = await countedStore('first');
    const file = path.join(store.folder, 'first.tar');
    const late = withheldBuild(anotherWorkersTemplate);
    const lateWorker = workerDatabase({ ...store, build: late.build });
    await Promise.race([late.asked, lateWorker]);

    await workerDatabase(store);
    const stored = await readFile(file);
    const reader = await open(file);
    onTestFinished(async () => reader.close());
    late.release();
    await lateWorker;
    const read = await reader.readFile();
    const replaced = await readFile(file);
    await workerDatabase(store);

    expect(replaced.equals(stored)).toBe(false);
    expect(read.equals(stored)).toBe(true);
    expect(builds()).toBe(1);
    expect(await readdir(store.folder)).toStrictEqual(['first.tar']);
  });

  it('[TRV-76] still gives databases when it cannot be stored', async () => {
    const { store, builds } = await countedStore('first');
    const blocked = path.join(store.folder, 'a-file');
    await writeFile(blocked, 'not a folder');

    await workerDatabase({ ...store, folder: blocked });
    await workerDatabase({ ...store, folder: blocked });

    expect(builds()).toBe(2);
    expect(await readdir(store.folder)).toStrictEqual(['a-file']);
  });
});

// The manifests of PGlite and drizzle-orm, from the project root.
const PGLITE_MANIFEST = path.join('node_modules', '@electric-sql', 'pglite', 'package.json');
const DRIZZLE_MANIFEST = path.join('node_modules', 'drizzle-orm', 'package.json');

/** A copy of the migrations and of the two manifests, in a folder that becomes the project root. */
async function projectCopy(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'egoscope-key-'));
  onTestFinished(async () => rm(root, { recursive: true, force: true }));
  await cp(path.join(process.cwd(), 'drizzle'), path.join(root, 'drizzle'), { recursive: true });
  await Promise.all(
    [PGLITE_MANIFEST, DRIZZLE_MANIFEST].map(async (manifest) => {
      await mkdir(path.dirname(path.join(root, manifest)), { recursive: true });
      await cp(path.join(process.cwd(), manifest), path.join(root, manifest));
    }),
  );
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  return root;
}

/** Appends `text` to the file `file` of the folder `root`. */
async function append(root: string, file: string, text: string): Promise<void> {
  const target = path.join(root, file);
  await writeFile(target, `${await readFile(target, 'utf8')}${text}`);
}

describe('templateKey', () => {
  it('[TRV-76] changes with the journal, any migration and the installed PGlite and drizzle-orm only', async () => {
    const root = await projectCopy();
    const files = await readdir(path.join(root, 'drizzle'));
    const migration = files.find((name) => name.endsWith('.sql'));
    assert.ok(migration !== undefined);
    const keys = [await templateKey(), await templateKey()];

    await append(root, path.join('drizzle', migration), '\n-- changed\n');
    keys.push(await templateKey());
    await append(root, path.join('drizzle', 'meta', '_journal.json'), '\n');
    keys.push(await templateKey());
    await append(root, PGLITE_MANIFEST, '\n');
    keys.push(await templateKey());
    await append(root, DRIZZLE_MANIFEST, '\n');
    keys.push(await templateKey());

    expect(keys[0]).toMatch(/^[\da-f]{64}$/u);
    expect(keys[1]).toBe(keys[0]);
    expect(new Set(keys).size).toBe(keys.length - 1);
  });
});

import 'server-only';

import { startPglite } from './pglite';

import type { Database } from './types';

/** A test's own database, and the way to close it. */
export type TestDatabase = Readonly<{ db: Database; close: () => Promise<void> }>;

async function buildTemplate(): Promise<Blob> {
  const pglite = await startPglite({});
  await pglite.migrate();
  const files = await pglite.dump();
  await pglite.close();
  return files;
}

/** Calls `work` on the first call only, and gives every call its promise. */
function once<T>(work: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined;
  return async () => (result ??= work());
}

// The migrated database that every test database copies: starting PGlite and
// migrating takes seconds, loading a copy a fraction of that. Built once per
// test file, which Vitest runs in a worker of its own.
const template = once(buildTemplate);

/**
 * Gives a test an in-memory database of its own with every migration applied
 * (TRV-76): no installed database is needed, and no two tests share state.
 * Close it when the test ends, since an open database holds about 200 MB:
 * `onTestFinished(database.close)`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const pglite = await startPglite({ loadDataDir: await template() });
  return { db: pglite.db, close: pglite.close };
}

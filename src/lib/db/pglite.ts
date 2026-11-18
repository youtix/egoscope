import 'server-only';

import { migrationConfig } from './migrations';
import * as schema from './schema';

import type { OpenDatabase } from './types';
import type { PGliteOptions } from '@electric-sql/pglite';

/** A database on PGlite, with the way to copy its files and to stop it. */
export type PgliteDatabase = OpenDatabase &
  Readonly<{
    /** The data directory as one uncompressed archive, which `loadDataDir` reads back. */
    dump: () => Promise<Blob>;
    close: () => Promise<void>;
  }>;

/**
 * Starts PGlite, Postgres compiled to WebAssembly, in this process, for tests
 * and local work, so that no installed database is needed (TRV-76). PGlite and
 * its driver are loaded here only: a deployment that never starts PGlite never
 * loads it.
 */
export async function startPglite(options: PGliteOptions): Promise<PgliteDatabase> {
  const [engine, driver, migrator] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  const pglite = new engine.PGlite(options);
  const db = driver.drizzle({ client: pglite, schema });
  return {
    db,
    migrate: async () => migrator.migrate(db, migrationConfig()),
    dump: async () => pglite.dumpDataDir('none'),
    close: async () => pglite.close(),
  };
}

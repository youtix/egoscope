import 'server-only';

import { migrationConfig } from './migrations';
import * as schema from './schema';

import type { Database, OpenDatabase } from './types';
import type { PGlite, PGliteOptions } from '@electric-sql/pglite';

/** A Drizzle client of a PGlite that is lent, and the way to end the loan. */
export type PgliteLoan = Readonly<{
  db: Database;
  /** Refuses every later call of the client, then waits for the calls made before to end. */
  revoke: () => Promise<void>;
}>;

/** A database on PGlite, with the way to copy its files and to stop it. */
export type PgliteDatabase = OpenDatabase &
  Readonly<{
    /** The data directory as one uncompressed archive, which `loadDataDir` reads back. */
    dump: () => Promise<Blob>;
    close: () => Promise<void>;
    /** Whether a transaction block is open, such as one that a `BEGIN` left. */
    isInTransaction: () => boolean;
    /**
     * Another Drizzle client of the same database: once revoked, every call of its
     * client, a query, a transaction or a close, is refused as a closed PGlite refuses
     * it, while the database itself stays open.
     */
    lend: () => PgliteLoan;
  }>;

// What a revoked client answers, as PGlite answers once closed.
const CLOSED = 'PGlite is closed';

function refuseClosed(): never {
  throw new Error(CLOSED);
}

/**
 * A promise of the caller's own for `result`, so that a failure that the caller ignores is
 * still reported as unhandled, which the revocation's wait for `result` would otherwise hide;
 * once `result` settles, it leaves `pending`.
 */
async function callersOwn(
  result: Promise<unknown>,
  pending: Set<Promise<unknown>>,
): Promise<unknown> {
  try {
    return await result;
  } finally {
    pending.delete(result);
  }
}

/**
 * A client that forwards every call to `pglite` until it is revoked, a call of a method
 * taken before included, and keeps the calls that it forwarded until each settles, so that
 * the revocation can wait for them without holding the results of those that ended.
 */
function lendClient(pglite: PGlite): Readonly<{ client: PGlite; revoke: () => Promise<void> }> {
  let isRevoked = false;
  const pending = new Set<Promise<unknown>>();
  const client = new Proxy(pglite, {
    get(target, property): unknown {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') {
        return value;
      }
      return (...parameters: unknown[]): unknown => {
        if (isRevoked) {
          refuseClosed();
        }
        const result: unknown = Reflect.apply(value, target, parameters);
        if (!(result instanceof Promise)) {
          return result;
        }
        pending.add(result);
        return callersOwn(result, pending);
      };
    },
  });
  return {
    client,
    revoke: async () => {
      isRevoked = true;
      await Promise.allSettled(pending);
    },
  };
}

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
    isInTransaction: () => pglite.isInTransaction(),
    lend: () => {
      const { client, revoke } = lendClient(pglite);
      return { db: driver.drizzle({ client, schema }), revoke };
    },
  };
}

import 'server-only';

import { openConnection } from './database';

import type { DatabaseError } from './database';

export type MigrationError =
  | DatabaseError
  | Readonly<{
      kind: 'migration-failed';
      /**
       * The code of the failure, such as ECONNREFUSED or the SQLSTATE 28P01, and
       * never its message, which can name the host, the user or the database
       * (TRV-64); an error without a code, which names none, gives its message.
       */
      reason: string;
    }>;

export type MigrationResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: MigrationError }>;

// Drizzle wraps the error of a failed query with the query; the reason is the
// error it wraps. The messages of Node, pg and Postgres can name the host and
// port, the user or the database of the connection, all of it connection
// information that is never logged (TRV-64): an error with a code gives the code
// alone.
function reasonOf(error: unknown): string {
  const failure = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return failure instanceof Error && 'code' in failure && typeof failure.code === 'string'
    ? failure.code
    : String(failure);
}

/**
 * The migration of the deploy step (TRV-76): applies every pending migration
 * through the direct connection, `DATABASE_URL_UNPOOLED`, in one transaction,
 * so that a failure leaves the structure as it was and fails the deployment. A
 * failure gives its code, never a message that names the connection (TRV-64).
 */
export async function migrateDatabase(): Promise<MigrationResult> {
  try {
    // PGlite migrates as it opens, so opening can fail like migrating.
    const direct = await openConnection('direct');
    if (!direct.ok) {
      return direct;
    }
    await direct.open.migrate();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: { kind: 'migration-failed', reason: reasonOf(error) } };
  }
}

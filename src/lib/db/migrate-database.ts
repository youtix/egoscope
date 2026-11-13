import 'server-only';

import { openConnection } from './database';

import type { DatabaseError } from './database';

export type MigrationError = DatabaseError | Readonly<{ kind: 'migration-failed'; reason: string }>;

export type MigrationResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: MigrationError }>;

// Drizzle wraps the error of a failed query with the query; the reason is the
// error it wraps. An error prints as its name and message, never its details.
const reasonOf = (error: unknown): string =>
  String(error instanceof Error && error.cause instanceof Error ? error.cause : error);

/**
 * The migration of the deploy step (TRV-76): applies every pending migration
 * through the direct connection, `DATABASE_URL_UNPOOLED`, in one transaction,
 * so that a failure leaves the structure as it was and fails the deployment.
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

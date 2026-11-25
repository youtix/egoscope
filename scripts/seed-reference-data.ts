/**
 * The seeding of the reference data (TAX-15, TRV-76), shared by the deploy step
 * (`db:migrate`) and by `db:seed`: opens the direct connection, which is the one
 * PGlite database outside Vercel, and seeds the installation row and the nine
 * candidate types. A failure gives the code of the error, never its message, which can
 * name the host, the user or the database of the connection (TRV-64).
 */
import { getDirectDb } from '@/lib/db';
import { seedCandidateTypes } from '@/lib/taxonomy';
import { now } from '@/lib/time';

export type SeedOutcome = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

// Drizzle wraps the error of a failed query with the query; the code is the one of the
// error it wraps, such as ECONNREFUSED or an SQLSTATE.
function reasonOf(error: unknown): string {
  const failure = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return failure instanceof Error && 'code' in failure && typeof failure.code === 'string'
    ? failure.code
    : 'unknown error';
}

/** Seeds the database that the environment names; idempotent, so every deploy may run it. */
export async function seedReferenceData(): Promise<SeedOutcome> {
  try {
    const direct = await getDirectDb();
    if (!direct.ok) {
      return { ok: false, reason: 'the database is not configured' };
    }
    await seedCandidateTypes(direct.db, now());
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

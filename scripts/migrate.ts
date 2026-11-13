/**
 * The deploy step (TRV-76), which the production build runs before `next build`
 * (the `vercel-build` script): it applies the pending migrations of drizzle/
 * through the direct connection, DATABASE_URL_UNPOOLED, so that nobody ever
 * touches the database by hand. Only a production deployment migrates: a
 * preview carries no database variables and never touches the database. A
 * failure exits non-zero, which fails the build, so the previous deployment
 * keeps serving. Run with `bun run db:migrate`.
 */
import { migrateDatabase } from '@/lib/db';
import { readServerEnv } from '@/lib/env';

import type { MigrationError } from '@/lib/db';

/** What to do about a failed migration, said in the build log. */
function explain(error: MigrationError): string {
  switch (error.kind) {
    case 'database-not-configured': {
      return 'DATABASE_URL and DATABASE_URL_UNPOOLED must both be set for Production in Vercel.';
    }
    case 'migration-failed': {
      return `the migrations could not be applied, and the structure is unchanged: ${error.reason}`;
    }
  }
}

async function main(): Promise<number> {
  // Read before the environment is validated: a preview's environment lacks the
  // database variables by design, and its build must pass all the same.
  if (process.env['VERCEL_ENV'] !== 'production') {
    console.info('db:migrate: not a production deployment, so the database is left untouched.');
    return 0;
  }
  const env = readServerEnv();
  if (!env.ok) {
    console.error(
      `✖ db:migrate: the server environment is invalid: ${env.error.variables.join(', ')}.`,
    );
    return 1;
  }
  // Slot: the backup taken before every change of structure (TRV-55, CL-TRV-19), added by the backup task.
  const migrated = await migrateDatabase();
  if (!migrated.ok) {
    console.error(`✖ db:migrate: ${explain(migrated.error)}`);
    return 1;
  }
  // Slot: the seeding of the reference data, added by the seed task.
  console.info('✔ db:migrate: the database structure is up to date.');
  return 0;
}

process.exitCode = await main();

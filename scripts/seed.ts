/**
 * Seeds a local database (TAX-15): the installation row and the nine candidate
 * types, on the PGlite database of `.pglite/`, the one `next dev` keeps. Stop
 * `next dev` first, since two processes must not open that folder at once. The
 * deploy step seeds the production database itself, so this script refuses a
 * database URL, and no shell that exports production connection strings can
 * reach production through it. Idempotent. Run with `bun run db:seed`.
 */
import { readServerEnv } from '@/lib/env';

import { seedReferenceData } from './seed-reference-data';

async function main(): Promise<number> {
  const env = readServerEnv();
  if (!env.ok) {
    console.error(
      `✖ db:seed: the server environment is invalid: ${env.error.variables.join(', ')}.`,
    );
    return 1;
  }
  if (env.env.DATABASE_URL !== undefined || env.env.DATABASE_URL_UNPOOLED !== undefined) {
    console.error(
      '✖ db:seed: a database URL is set, and this script seeds the local database only; unset it, or let the deploy step seed.',
    );
    return 1;
  }
  const seeded = await seedReferenceData();
  if (!seeded.ok) {
    console.error(`✖ db:seed: the reference data could not be seeded: ${seeded.reason}.`);
    return 1;
  }
  console.info('✔ db:seed: the installation row and the nine candidate types are in place.');
  return 0;
}

// An explicit exit: the PGlite database that was opened keeps the process alive, and
// its files are written by the time the seeding resolves.
// eslint-disable-next-line unicorn/no-process-exit -- this script is a CLI, and `@/lib/db` gives no way to close the PGlite database that keeps it alive.
process.exit(await main());

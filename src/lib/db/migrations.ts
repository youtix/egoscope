import 'server-only';

import path from 'node:path';

import type { MigrationConfig } from 'drizzle-orm/migrator';

// The SQL migrations that drizzle-kit generates from the schema, committed in
// the repository and read from the project root.
const MIGRATIONS_FOLDER = 'drizzle';

/**
 * Where the migrations are, for Drizzle's migrators, which apply in one
 * transaction every migration that a database has not recorded yet, so that
 * the application prepares and evolves its own structure (TRV-76).
 */
export function migrationConfig(): MigrationConfig {
  return { migrationsFolder: path.join(process.cwd(), MIGRATIONS_FOLDER) };
}

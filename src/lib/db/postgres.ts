import 'server-only';

import { attachDatabasePool } from '@vercel/functions/db-connections';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { logger } from '@/lib/log';

import { migrationConfig } from './migrations';
import * as schema from './schema';

import type { OpenDatabase } from './types';
import type { Secret } from '@/lib/env';
import type { PoolConfig } from 'pg';

// A few connections per function instance, closed soon after the last query:
// Vercel keeps an instance alive only until its pool has closed them.
const MAX_CONNECTIONS = 3;
const IDLE_TIMEOUT_MS = 5000;
// A suspended Neon compute wakes in under a second; a server silent this long
// is unreachable.
const CONNECTION_TIMEOUT_MS = 10_000;

// pg drops a connection that fails while idle and emits the error on the pool,
// where an unheard error would crash the process.
function reportIdleFailure(error: Error): void {
  logger.warn('An idle database connection failed; the next query opens another one.', {
    error,
  });
}

/**
 * Creates a node-postgres pool, which opens no connection before its first
 * query, and logs a connection that fails while idle instead of crashing the
 * server (TRV-14).
 */
export function createPool(config: PoolConfig): Pool {
  const pool = new Pool(config);
  pool.on('error', reportIdleFailure);
  return pool;
}

/**
 * Opens the database of a Postgres server, Neon in production, through a small
 * node-postgres pool registered with `attachDatabasePool`, which closes its idle
 * connections before Vercel suspends the function. The URL carries
 * `sslmode=verify-full`, which the environment checks (TRV-14). Nothing
 * connects here: the pool opens its first connection on the first query.
 */
export function openPostgres(url: Secret): OpenDatabase {
  const pool = createPool({
    connectionString: url.reveal(),
    max: MAX_CONNECTIONS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    // Lets a script, such as the deploy step, end once its queries are done.
    allowExitOnIdle: true,
  });
  attachDatabasePool(pool);
  const db = drizzle({ client: pool, schema });
  return { db, migrate: async () => migrate(db, migrationConfig()) };
}

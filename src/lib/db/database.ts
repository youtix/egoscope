import 'server-only';

import path from 'node:path';

import { readServerEnv } from '@/lib/env';

import { startPglite } from './pglite';
import { openPostgres } from './postgres';
import { databaseTarget } from './target';

import type { Connection, DatabaseTarget } from './target';
import type { Database, OpenDatabase } from './types';

/** Why no database can be given: on Vercel without a URL, or with an invalid environment. */
export type DatabaseError = Readonly<{ kind: 'database-not-configured' }>;

export type DatabaseResult =
  Readonly<{ ok: true; db: Database }> | Readonly<{ ok: false; error: DatabaseError }>;

type OpenResult =
  Readonly<{ ok: true; open: OpenDatabase }> | Readonly<{ ok: false; error: DatabaseError }>;

type ReachableTarget = Exclude<DatabaseTarget, Readonly<{ kind: 'not-configured' }>>;

// Where `next dev` keeps its database, under the project root (git-ignored).
const LOCAL_DATA_DIR = '.pglite';
const NOT_CONFIGURED = { ok: false, error: { kind: 'database-not-configured' } } as const;

// Nothing is opened when this module loads: each database is opened by its
// first caller, and kept for the life of the server.
const opened = new Map<Connection | 'pglite', Promise<OpenDatabase>>();

async function open(target: ReachableTarget): Promise<OpenDatabase> {
  if (target.kind === 'postgres') {
    return openPostgres(target.url);
  }
  const pglite = await startPglite(
    target.isPersistent ? { dataDir: path.join(process.cwd(), LOCAL_DATA_DIR) } : {},
  );
  await pglite.migrate();
  return pglite;
}

/**
 * The opened database behind `connection`, opened by the first call and kept
 * for the life of the server (TRV-14). Outside Vercel, both connections share
 * one PGlite database, which applies every pending migration before it serves
 * its first query (TRV-76).
 */
export async function openConnection(connection: Connection): Promise<OpenResult> {
  const target = databaseTarget(readServerEnv(), connection);
  if (target.kind === 'not-configured') {
    return NOT_CONFIGURED;
  }
  const key = target.kind === 'pglite' ? target.kind : connection;
  const database = opened.get(key) ?? open(target);
  opened.set(key, database);
  return { ok: true, open: await database };
}

async function databaseFor(connection: Connection): Promise<DatabaseResult> {
  const result = await openConnection(connection);
  return result.ok ? { ok: true, db: result.open.db } : result;
}

/**
 * The database for everything the application does (TRV-14): Neon through its
 * pooled connection string (PgBouncer in transaction mode) when `DATABASE_URL`
 * is set; PGlite outside Vercel without it, migrated first (TRV-76); "not
 * configured" on Vercel without it, never PGlite. The first call creates the
 * client and its pool, which opens no connection before the first query: call
 * it where a query follows, never at import or start-up, since every query keeps
 * the database's compute billed for five minutes.
 */
export async function getDb(): Promise<DatabaseResult> {
  return databaseFor('pooled');
}

/**
 * The database through Neon's direct connection string, `DATABASE_URL_UNPOOLED`,
 * for migrations (TRV-76) and long reads such as the backup export (TRV-14).
 * Outside Vercel without a URL, it is the same PGlite database as `getDb()`; with
 * a pooled URL but no direct one, it is "not configured". Like `getDb()`, it
 * opens no connection before its first query.
 */
export async function getDirectDb(): Promise<DatabaseResult> {
  return databaseFor('direct');
}

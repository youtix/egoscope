import type * as schema from './schema';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * The typed Drizzle client of every table, the same type whatever the driver
 * (node-postgres for a Postgres server, PGlite's own otherwise), with
 * driver-level transactions (TRV-14). Raw `execute` results are `unknown`,
 * since each driver shapes them its own way: prefer the typed queries.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** An opened database, and the way to bring its structure up to date (TRV-76). */
export type OpenDatabase = Readonly<{
  db: Database;
  /** Applies, in one transaction, every migration of drizzle/ not applied yet; throws when one fails. */
  migrate: () => Promise<void>;
}>;

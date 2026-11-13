import type { Secret, ServerEnvResult } from '@/lib/env';

/**
 * The connection a caller needs: `pooled` for everything the application does,
 * `direct` for migrations and long reads such as the backup export (TRV-14).
 */
export type Connection = 'pooled' | 'direct';

/** Where the database is, as the environment says (TRV-14). */
export type DatabaseTarget =
  | Readonly<{ kind: 'postgres'; url: Secret }>
  | Readonly<{ kind: 'pglite'; isPersistent: boolean }>
  | Readonly<{ kind: 'not-configured' }>;

const NOT_CONFIGURED: DatabaseTarget = { kind: 'not-configured' };

/**
 * Chooses the database from the environment (TRV-14). A `DATABASE_URL` means a
 * Postgres server, Neon in production, reached through it or, for the direct
 * connection, through `DATABASE_URL_UNPOOLED`. No URL means PGlite, outside
 * Vercel only: on disk for `next dev`, in memory otherwise. On Vercel, a missing
 * URL means "not configured", never PGlite: previews carry no database
 * variables by design, so that they never write to the production database.
 * An invalid environment is "not configured" anywhere.
 */
export function databaseTarget(env: ServerEnvResult, connection: Connection): DatabaseTarget {
  if (!env.ok) {
    return NOT_CONFIGURED;
  }
  const { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct, VERCEL_ENV, NODE_ENV } = env.env;
  if (pooled !== undefined) {
    const url = connection === 'pooled' ? pooled : direct;
    return url === undefined ? NOT_CONFIGURED : { kind: 'postgres', url };
  }
  return VERCEL_ENV === undefined
    ? { kind: 'pglite', isPersistent: NODE_ENV === 'development' }
    : NOT_CONFIGURED;
}

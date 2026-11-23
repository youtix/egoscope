import { drizzle } from 'drizzle-orm/node-postgres';

import type { Database } from '@/lib/db';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/** A database that refuses every query, and what the code under test tried on it. */
export type NoQueryDatabase = Readonly<{
  db: Database;
  /** The statements tried, in their order: each one failed its caller. */
  attempts: () => readonly string[];
}>;

/**
 * A database stub that fails any query, to prove that a path stays off the database
 * (module map §1.8, D-23): an idle tick, the request proxy, a stranger's webhook. Each
 * statement, a transaction's `begin` included, rejects with an error that names it, and
 * is kept in `attempts()`, which a test expects empty, so that a caller that catches
 * the error still fails the test; a relational query (`db.query`) throws at once.
 */
export function noQueryDatabase(): NoQueryDatabase {
  // The tables of the application, as the type of its database names them.
  type Schema = Database extends PgDatabase<PgQueryResultHKT, infer S> ? S : never;
  const tried: string[] = [];
  const refuse = (statement: string): never => {
    tried.push(statement);
    throw new Error(`The database was queried where no query may run: ${statement}`);
  };
  const stub = drizzle.mock<Schema>({ logger: { logQuery: refuse } });
  const db = new Proxy<Database>(stub, {
    get: (target, key, receiver) => {
      if (key === 'query') {
        return refuse('a relational query');
      }
      const value: unknown = Reflect.get(target, key, receiver);
      return value;
    },
  });
  return { db, attempts: () => [...tried] };
}

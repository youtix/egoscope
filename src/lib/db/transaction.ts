import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import { TransactionRollbackError } from 'drizzle-orm';

import { getDb } from './database';

import type { DatabaseError } from './database';
import type { Database } from './types';
import type { Err, Result } from '@/lib/result';

/**
 * One interactive transaction, from BEGIN to COMMIT on one client of the pool: what the
 * work of `transaction()` writes through, and what `nextValue`, `updateVersioned` and the
 * journal take, so that their writes belong to the caller's transaction.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The transaction that the calls nested in `transaction()` join. A callback bound to the
 * work's context, as Next.js `after()` binds its own, still finds it there once it has
 * ended: hence `ended`.
 */
const ambient = new AsyncLocalStorage<Transaction>();

/** The transactions whose work is over: committed or rolled back, never to be joined again. */
const ended = new WeakSet<Transaction>();

/** The transactions that a failed nested call dooms to roll back, whatever the work around it returns. */
const doomed = new WeakSet<Transaction>();

/** Runs `work` in the transaction `outer` around it, which a failure or a throw of `work` dooms. */
async function join<T, E>(
  outer: Transaction,
  work: (tx: Transaction) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  let result: Result<T, E>;
  try {
    result = await work(outer);
  } catch (error) {
    doomed.add(outer);
    throw error;
  }
  if (!result.ok) {
    doomed.add(outer);
  }
  return result;
}

/** Runs `work` with `tx` as the transaction its nested calls join, and only until it ends. */
async function runAmbient<T, E>(
  tx: Transaction,
  work: (tx: Transaction) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  try {
    return await ambient.run(tx, async () => work(tx));
  } finally {
    ended.add(tx);
  }
}

/**
 * Runs `work` in a new transaction of `db`: committed when it succeeds, rolled back when
 * it fails, throws, or went on to succeed after a nested call failed or threw.
 */
async function runOutermost<T, E>(
  db: Database,
  work: (tx: Transaction) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  let failure: Err<E> | undefined;
  try {
    // No transaction configuration: the driver sends a bare BEGIN, and nothing here sets
    // the session, which PgBouncer's transaction mode would lose between transactions.
    return await db.transaction(async (tx) => {
      const result = await runAmbient(tx, work);
      if (!result.ok) {
        failure = result;
        tx.rollback();
      }
      if (doomed.has(tx)) {
        throw new Error(
          'A call nested in this transaction failed, and the work around it went on as if it had succeeded: return that failure, or let its error through, instead.',
        );
      }
      return result;
    });
  } catch (error) {
    // The driver signals the rollback asked above with this error, and the failure is the answer.
    if (failure !== undefined && error instanceof TransactionRollbackError) {
      return failure;
    }
    throw error;
  }
}

/**
 * Runs `work` in one interactive database transaction (TRV-14): committed when it
 * succeeds, rolled back when it returns a failure or throws. Inside it, a nested call
 * of `transaction()`, from another service for instance, joins it instead of opening
 * another one, so a composed action writes all or nothing (module map, sections 1.5
 * and 1.7): a failure or a throw of the nested call rolls the whole transaction back,
 * and the work around it must return a failure or throw too, since going on as if it
 * had succeeded is a bug. A call made once that work is over, from a callback bound to
 * its context such as one that `after()` runs, opens a transaction of its own. The
 * transaction holds one client of the pool from BEGIN to COMMIT and changes no session
 * setting, so it works through Neon's pooler in transaction mode. "Not configured" when
 * no database is (`getDb()`).
 */
export async function transaction<T, E>(
  work: (tx: Transaction) => Promise<Result<T, E>>,
): Promise<Result<T, DatabaseError | E>> {
  const outer = ambient.getStore();
  if (outer !== undefined && !ended.has(outer)) {
    return join(outer, work);
  }
  const database = await getDb();
  return database.ok ? runOutermost(database.db, work) : database;
}

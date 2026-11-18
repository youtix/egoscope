import 'server-only';

import { sql } from 'drizzle-orm';

import { getDb } from './database';

import type { DatabaseError } from './database';

export type PingError = DatabaseError | Readonly<{ kind: 'database-unreachable' }>;

export type PingResult = Readonly<{ ok: true }> | Readonly<{ ok: false; error: PingError }>;

// A trivial query answers in milliseconds, and a suspended Neon compute wakes
// in under a second.
const PING_TIMEOUT_MS = 5000;
const UNREACHABLE: PingResult = { ok: false, error: { kind: 'database-unreachable' } };

/** Resolves to true once `work` succeeds, and rejects when it fails. */
async function isDone(work: Promise<unknown>): Promise<true> {
  await work;
  return true;
}

/** Says whether `work` succeeds before `timeoutMs` has passed. */
async function isDoneInTime(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, false);
  });
  try {
    return await Promise.race([isDone(work), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one trivial query on the application's connection within a short
 * timeout, for the installation check that a later task builds:
 * `database-unreachable` when the database does not answer in time, drops the
 * connection or offers no verified encryption (TRV-14). Nothing calls it on its
 * own, since a query wakes the database.
 */
export async function ping(): Promise<PingResult> {
  const database = await getDb();
  if (!database.ok) {
    return database;
  }
  const isAnswered = await isDoneInTime(database.db.execute(sql`select 1`), PING_TIMEOUT_MS);
  return isAnswered ? { ok: true } : UNREACHABLE;
}

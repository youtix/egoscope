import 'server-only';

import { eq, lte } from 'drizzle-orm';

import { accounts, getDb, loginFailures } from '@/lib/db';
import { readServerEnv } from '@/lib/env';
import { record } from '@/lib/journal';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { hashPassword, isSamePassword } from './password';
import { ACCOUNT_ID, endAllSessions } from './sessions';

import type { Database, DatabaseError, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

/** The deployment configuration lacks the initial password that the account starts from (TRV-57). */
export type AccountError = Readonly<{ kind: 'initial-password-missing' }>;

/** Why a request cannot reach the account: no database, or no initial password. */
export type ReadyError = AccountError | DatabaseError;

/** The single account's row. */
type AccountRow = typeof accounts.$inferSelect;

const MISSING = { kind: 'initial-password-missing' } as const satisfies AccountError;

/** The configured initial password (TRV-57, TRV-64), revealed only to be hashed or compared. */
function initialPassword(): string | undefined {
  const env = readServerEnv();
  return env.ok ? env.env.INITIAL_PASSWORD?.reveal() : undefined;
}

/** The account on its initial password, whose hash is also the fingerprint kept to detect a reset. */
function initialState(hash: string) {
  return {
    passwordHash: hash,
    passwordStatus: 'initial',
    initialPasswordFingerprint: hash,
    passwordChangedAt: new Date(now()),
    loginLockedUntil: null,
  } as const;
}

/** The account's row, locked until `tx` ends, so that logins and password changes take turns. */
export async function lockedAccount(tx: Transaction): Promise<AccountRow> {
  const [account] = await tx.select().from(accounts).for('update');
  if (account === undefined) {
    throw new Error('The account is read before `ensureAccount` created it.');
  }
  return account;
}

/** Makes `initial` the account's password again, which every device must log in with (TRV-63). */
async function reset(tx: Transaction, initial: string): Promise<void> {
  const hash = await hashPassword(initial);
  await tx.update(accounts).set(initialState(hash)).where(eq(accounts.id, ACCOUNT_ID));
  const resetAt = new Date(now());
  await tx.delete(loginFailures).where(lte(loginFailures.occurredAt, resetAt));
  await endAllSessions(tx, 'reset');
  await record(tx, { messageKey: 'password_reset' });
}

/**
 * Brings the single account in line with the configured initial password, in the caller's
 * transaction `tx` (TRV-57, TRV-63): creates it on first use, from that password, which the
 * owner must then replace; when the configured initial password no longer matches the
 * fingerprint of the one the account started from, makes it the account's password again,
 * ends every session with `reset`, lifts the lockout and journals the reset. No other data
 * changes. Refused while the configuration lacks the initial password.
 */
export async function ensureAccount(tx: Transaction): Promise<Result<void, AccountError>> {
  const initial = initialPassword();
  if (initial === undefined) {
    return err(MISSING);
  }
  const [account] = await tx
    .select({ fingerprint: accounts.initialPasswordFingerprint })
    .from(accounts)
    .for('update');
  if (account === undefined) {
    const hash = await hashPassword(initial);
    await tx.insert(accounts).values(initialState(hash)).onConflictDoNothing();
  } else if (!(await isSamePassword(initial, account.fingerprint))) {
    await reset(tx, initial);
  }
  return ok(undefined);
}

/** The database once its account is in line with the configuration, in a transaction of its own. */
async function prepare(): Promise<Result<Database, ReadyError>> {
  const database = await getDb();
  if (!database.ok) {
    return err(database.error);
  }
  const ensured = await database.db.transaction(async (tx) => ensureAccount(tx));
  return ensured.ok ? ok(database.db) : ensured;
}

/** Runs `work` once, the calls made meanwhile sharing its run, and again after a failure. */
function onceUntilSuccess<T, E>(work: () => Promise<Result<T, E>>): () => Promise<Result<T, E>> {
  let pending: Promise<Result<T, E>> | undefined;
  return async () => {
    pending ??= work();
    const result = await pending;
    if (!result.ok) {
      pending = undefined;
    }
    return result;
  };
}

/**
 * The database, once `ensureAccount` has run for this server instance: before its first
 * login or session check, never when it starts or loads a module, so that a cold start
 * serving an idle tick touches nothing (TRV-63, module map §1.8 and §3.6). The requests
 * arriving meanwhile wait for that one run, and a failed run is tried again by the next.
 */
export const readyDatabase = onceUntilSuccess(prepare);

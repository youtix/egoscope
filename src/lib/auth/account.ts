import 'server-only';

import { eq, lte } from 'drizzle-orm';

import { accounts, getDb, loginFailures } from '@/lib/db';
import { readServerEnv } from '@/lib/env';
import { record } from '@/lib/journal';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { hashPassword, isLongEnough, isSamePassword } from './password';
import { ACCOUNT_ID, endAllSessions } from './sessions';

import type { Database, DatabaseError, Transaction } from '@/lib/db';
import type { ServerEnvError } from '@/lib/env';
import type { Result } from '@/lib/result';

/** A valid server environment that sets no initial password, outside a deployment (TRV-57). */
type InitialPasswordMissing = Readonly<{ kind: 'initial-password-missing' }>;

/**
 * Why the account cannot start from the deployment configuration (TRV-57, TRV-60, TRV-63):
 * the server environment is invalid, which names its variables and never a value; it sets
 * no initial password; or the initial password is shorter than `auth.passwordMinLength`,
 * whose value `minLength` is, never the length of the password (TRV-64).
 */
export type AccountError =
  | ServerEnvError
  | InitialPasswordMissing
  | Readonly<{ kind: 'initial-password-too-short'; minLength: number }>;

/** Why a request cannot reach the account: no database, or a configuration it cannot start from. */
export type ReadyError = AccountError | DatabaseError;

/** The single account's row. */
type AccountRow = typeof accounts.$inferSelect;

const MISSING = { kind: 'initial-password-missing' } as const satisfies InitialPasswordMissing;

/**
 * The configured initial password (TRV-57, TRV-64), revealed only to be measured, hashed or
 * compared; or why there is none: an invalid server environment, or one that sets none.
 */
function initialPassword(): Result<string, ServerEnvError | InitialPasswordMissing> {
  const env = readServerEnv();
  if (!env.ok) {
    return err(env.error);
  }
  const initial = env.env.INITIAL_PASSWORD?.reveal();
  return initial === undefined ? err(MISSING) : ok(initial);
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
 * changes. Refused while the server environment is invalid or lacks the initial password;
 * and, when the initial password would become the account's, while it is shorter than
 * `auth.passwordMinLength` (TRV-60, TRV-76), which then leaves everything as it was. An
 * initial password that still matches the fingerprint is not measured again: the account
 * may long since use a password of its own, and a minimum raised later must not lock it out.
 */
export async function ensureAccount(tx: Transaction): Promise<Result<void, AccountError>> {
  const initial = initialPassword();
  if (!initial.ok) {
    return initial;
  }
  const [account] = await tx
    .select({ fingerprint: accounts.initialPasswordFingerprint })
    .from(accounts)
    .for('update');
  if (account !== undefined && (await isSamePassword(initial.value, account.fingerprint))) {
    return ok(undefined);
  }
  const minLength = await getParam(tx, 'auth.passwordMinLength');
  if (!isLongEnough(initial.value, minLength)) {
    return err({ kind: 'initial-password-too-short', minLength });
  }
  if (account === undefined) {
    const hash = await hashPassword(initial.value);
    await tx.insert(accounts).values(initialState(hash)).onConflictDoNothing();
  } else {
    await reset(tx, initial.value);
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

/**
 * Runs `work` once, the calls made meanwhile sharing its run, and again after a failure:
 * a run that returns an error or throws is forgotten before any caller sees its outcome.
 */
function onceUntilSuccess<T, E>(work: () => Promise<Result<T, E>>): () => Promise<Result<T, E>> {
  let pending: Promise<Result<T, E>> | undefined;
  const run = async () => {
    try {
      const result = await work();
      if (!result.ok) {
        pending = undefined;
      }
      return result;
    } catch (error) {
      pending = undefined;
      throw error;
    }
  };
  return async () => {
    pending ??= run();
    return pending;
  };
}

/**
 * The database, once `ensureAccount` has run for this server instance: before its first
 * login or session check, never when it starts or loads a module, so that a cold start
 * serving an idle tick touches nothing (TRV-63, module map §1.8 and §3.6). The requests
 * arriving meanwhile wait for that one run, and a failed run is tried again by the next.
 */
export const readyDatabase = onceUntilSuccess(prepare);

import 'server-only';

import { eq } from 'drizzle-orm';

import { accounts } from '@/lib/db';
import { close } from '@/lib/incidents';
import { record } from '@/lib/journal';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { lockedAccount, readyDatabase } from './account';
import { lockEnd, recordFailure, refuseWhileLocked } from './lockout';
import { hashPassword, isLongEnough, isSamePassword } from './password';
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './session-cookie';
import { ACCOUNT_ID, endAllSessions, endSession, openSession, sessionState } from './sessions';

import type { ReadyError } from './account';
import type { LoginRefusal } from './lockout';
import type { PasswordStatus, Session, SessionEndReason, SessionState } from './sessions';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

const LOG_IN_PATH = '/log-in';
const CHOOSE_PASSWORD_PATH = '/choose-password';

/** A login: the password typed, and a short description of the device (IHM-06). */
export type LoginAttempt = Readonly<{ password: string; device: string }>;

/**
 * Why a request has no session to work in: the device logs in, with the path it asked for
 * and how its session ended, if it did (IHM-08, IHM-10); or the account still uses the
 * initial password, which must be replaced first (TRV-57).
 */
export type SessionRefusal =
  | Readonly<{ kind: 'log-in'; redirect: string; ended: SessionEndReason | null }>
  | Readonly<{ kind: 'choose-password'; redirect: string }>;

/** Why a password was not replaced (TRV-57, TRV-60). */
export type PasswordRefusal =
  | Readonly<{ kind: 'no-session' }>
  | Readonly<{ kind: 'too-short'; minLength: number }>
  | Readonly<{ kind: 'wrong-password' }>
  | Readonly<{ kind: 'password-already-chosen' }>;

/** Which sessions a logout ends: this device's, or every device's (TRV-62, IHM-08). */
export type LogOutScope = 'this-device' | 'all-devices';

type Account = Awaited<ReturnType<typeof lockedAccount>>;
type Replacement = Readonly<{
  newPassword: string;
  refusal: (account: Account) => PasswordRefusal | null | Promise<PasswordRefusal | null>;
}>;

const NO_SESSION = { kind: 'no-session' } as const satisfies PasswordRefusal;

/** Checks the password at `at`, in `tx`; on success, opens the device's session. */
async function attempt(tx: Transaction, login: LoginAttempt) {
  const at = now();
  const account = await lockedAccount(tx);
  const lockedUntil = lockEnd(account.loginLockedUntil, at);
  if (lockedUntil !== null) {
    return err(await refuseWhileLocked(tx, lockedUntil));
  }
  if (!(await isSamePassword(login.password, account.passwordHash))) {
    return err(await recordFailure(tx, at, account.loginLockedUntil));
  }
  const cookie = await openSession(tx, login.device, at);
  await close(tx, { kind: 'logins_refused' });
  return ok({ cookie, passwordStatus: account.passwordStatus });
}

/**
 * Logs the device in with `login.password` (TRV-61, TRV-62, IHM-07): while logins are
 * locked, refused without examining the password; a wrong password is journaled and
 * counted toward the lockout; the right one opens a session, sets its cookie (HttpOnly,
 * Secure, SameSite=Lax) and closes the "Logins refused" incident. Returns the account's
 * password status, since an account on its initial password must replace it first.
 */
export async function logIn(
  login: LoginAttempt,
): Promise<Result<Readonly<{ passwordStatus: PasswordStatus }>, LoginRefusal | ReadyError>> {
  const ready = await readyDatabase();
  if (!ready.ok) {
    return ready;
  }
  const outcome = await ready.value.transaction(async (tx) => attempt(tx, login));
  if (!outcome.ok) {
    return outcome;
  }
  await writeSessionCookie(outcome.value.cookie);
  return ok({ passwordStatus: outcome.value.passwordStatus });
}

/** Until when logins are locked, or null when they are allowed, for the login screen (TRV-61, IHM-07). */
export async function lockoutStatus(): Promise<
  Result<Readonly<{ lockedUntil: EpochMs | null }>, ReadyError>
> {
  const ready = await readyDatabase();
  if (!ready.ok) {
    return ready;
  }
  const [account] = await ready.value
    .select({ lockedUntil: accounts.loginLockedUntil })
    .from(accounts);
  return ok({ lockedUntil: lockEnd(account?.lockedUntil ?? null, now()) });
}

/**
 * The state of the device's session (TRV-62, IHM-08): open, which this use keeps open;
 * ended, with how; or none. A request without a session cookie asks nothing of the database.
 */
export async function currentSession(): Promise<Result<SessionState, ReadyError>> {
  const value = await readSessionCookie();
  if (value === undefined) {
    return ok({ state: 'none' });
  }
  const ready = await readyDatabase();
  return ready.ok
    ? ok(await ready.value.transaction(async (tx) => sessionState(tx, value)))
    : ready;
}

/**
 * The open session of the device, which every session-protected page, action and handler
 * requires (TRV-58, TRV-62, IHM-08): otherwise the login page with `path` to return to
 * and how the session ended, if it did, so that the device erases its data when the owner
 * ended it, and keeps its drafts when it expired (CL-IHM-10, IHM-11); or the "Choose your
 * password" screen while the account uses its initial password (TRV-57).
 */
export async function requireSession(
  path: string,
): Promise<Result<Session, ReadyError | SessionRefusal>> {
  const current = await currentSession();
  if (!current.ok) {
    return current;
  }
  const state = current.value;
  if (state.state === 'open') {
    return state.session.passwordStatus === 'initial'
      ? err({ kind: 'choose-password', redirect: CHOOSE_PASSWORD_PATH })
      : ok(state.session);
  }
  const query = new URLSearchParams({ next: path }).toString();
  const ended = state.state === 'ended' ? state.reason : null;
  return err({ kind: 'log-in', redirect: `${LOG_IN_PATH}?${query}`, ended });
}

/**
 * Replaces the password in `tx` for the device of the cookie `value`: every session ends
 * with `password_changed` and the device continues in a session opened at that instant,
 * so that its own login does not precede the change (TRV-60, operations.md §2.4). The
 * account's row is locked before the session is read, the order that logins and `endIn` follow.
 */
async function replaceIn(tx: Transaction, value: string, change: Replacement) {
  const account = await lockedAccount(tx);
  const state = await sessionState(tx, value);
  if (state.state !== 'open') {
    return err(NO_SESSION);
  }
  const minLength = await getParam(tx, 'auth.passwordMinLength');
  if (!isLongEnough(change.newPassword, minLength)) {
    return err({ kind: 'too-short', minLength } as const);
  }
  const refusal = await change.refusal(account);
  if (refusal !== null) {
    return err(refusal);
  }
  const at = await endAllSessions(tx, 'password_changed');
  await tx
    .update(accounts)
    .set({
      passwordHash: await hashPassword(change.newPassword),
      passwordStatus: 'chosen',
      passwordChangedAt: new Date(at),
    })
    .where(eq(accounts.id, ACCOUNT_ID));
  await record(tx, { messageKey: 'password_changed' });
  return ok(await openSession(tx, state.session.device, at));
}

/** Replaces the password from the device's session and gives the device its new session cookie. */
async function replacePassword(
  change: Replacement,
): Promise<Result<void, PasswordRefusal | ReadyError>> {
  const value = await readSessionCookie();
  if (value === undefined) {
    return err(NO_SESSION);
  }
  const ready = await readyDatabase();
  if (!ready.ok) {
    return ready;
  }
  const outcome = await ready.value.transaction(async (tx) => replaceIn(tx, value, change));
  if (!outcome.ok) {
    return outcome;
  }
  await writeSessionCookie(outcome.value);
  return ok(undefined);
}

/**
 * Replaces the initial password with `password`, the "Choose your password" step (TRV-57,
 * TRV-60): at least `auth.passwordMinLength` characters; every other session ends. Refused
 * once the initial password has been replaced, since no old password is asked for.
 */
export async function choosePassword(
  password: string,
): Promise<Result<void, PasswordRefusal | ReadyError>> {
  return replacePassword({
    newPassword: password,
    refusal: (account) =>
      account.passwordStatus === 'initial' ? null : { kind: 'password-already-chosen' },
  });
}

/**
 * Changes the password from the account settings (TRV-60, CA-TRV-31): the current password
 * is required, the new one has at least `auth.passwordMinLength` characters, and every
 * other device's session ends while this device continues.
 */
export async function changePassword(
  change: Readonly<{ currentPassword: string; newPassword: string }>,
): Promise<Result<void, PasswordRefusal | ReadyError>> {
  return replacePassword({
    newPassword: change.newPassword,
    refusal: async (account) =>
      (await isSamePassword(change.currentPassword, account.passwordHash))
        ? null
        : { kind: 'wrong-password' },
  });
}

/**
 * Ends the open session of the cookie `value` in `tx`, or every session, journaled (IHM-08).
 * The account's row is locked first, as logins and password changes lock it before they
 * touch a session row, so that two endings at once take turns instead of deadlocking.
 */
async function endIn(tx: Transaction, value: string, scope: LogOutScope) {
  await lockedAccount(tx);
  const state = await sessionState(tx, value);
  if (state.state !== 'open') {
    return err(NO_SESSION);
  }
  if (scope === 'all-devices') {
    await endAllSessions(tx, 'logged_out');
    await record(tx, { messageKey: 'logged_out_everywhere' });
  } else {
    await endSession(tx, state.session.id);
  }
  return ok(undefined);
}

/**
 * Logs out this device, or every device (TRV-62, IHM-08): the session cookie is removed,
 * and the ended sessions answer `logged_out` to their devices at their next contact.
 */
export async function logOut(
  scope: LogOutScope,
): Promise<Result<void, Readonly<{ kind: 'no-session' }> | ReadyError>> {
  const value = await readSessionCookie();
  await clearSessionCookie();
  if (value === undefined) {
    return err(NO_SESSION);
  }
  const ready = await readyDatabase();
  return ready.ok ? ready.value.transaction(async (tx) => endIn(tx, value, scope)) : ready;
}

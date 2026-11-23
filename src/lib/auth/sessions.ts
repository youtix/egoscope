import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, lt, lte } from 'drizzle-orm';

import { accounts, loginFailures, sessions } from '@/lib/db';
import { getParam } from '@/lib/params';
import { now, toEpochMs } from '@/lib/time';

import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const TOKEN_BYTES = 32;
const TOKEN_ENCODING = 'base64url';
const MS_PER_DAY = 86_400_000;
export const MS_PER_MINUTE = 60_000;
// The single account's row (H-10).
export const ACCOUNT_ID = 1;
// A session cookie's value: the token, 32 bytes in base64url, then the instant the device
// logged in, so that a device whose token the server no longer knows still sends it.
const COOKIE_VALUE = /^(?<token>[\w-]{43})\.(?<loggedInAt>\d{1,15})$/u;

/** How a session ended (`SessionEndReason`; IHM-08, TRV-60, TRV-62, TRV-63, CL-TRV-05). */
export type SessionEndReason = NonNullable<typeof sessions.$inferSelect.endReason>;

/** How every session ended at once: a logout of all devices, a password change, a reset or a restore. */
export type AllSessionsEndReason = NonNullable<typeof accounts.$inferSelect.allSessionsEndReason>;

/** Whether the account still uses the configured initial password (`AccountPasswordStatus`, TRV-57). */
export type PasswordStatus = typeof accounts.$inferSelect.passwordStatus;

/** An open session of one device, and the status of the account's password. */
export type Session = Readonly<{
  id: number;
  device: string;
  openedAt: EpochMs;
  passwordStatus: PasswordStatus;
}>;

/**
 * What a device's session cookie stands for: an open session; one that ended, by expiry or
 * by the owner, which the device is told (IHM-08); or none at all.
 */
export type SessionState =
  | Readonly<{ state: 'open'; session: Session }>
  | Readonly<{ state: 'ended'; reason: SessionEndReason }>
  | Readonly<{ state: 'none' }>;

const NONE = { state: 'none' } as const satisfies SessionState;
const EXPIRED = { state: 'ended', reason: 'expired' } as const satisfies SessionState;

/** The stored form of a token: its SHA-256 hash, never the token itself (TRV-64). */
function hashOf(token: Buffer): Uint8Array {
  return createHash('sha256').update(token).digest();
}

/** The instant a session used at `at` expires, `auth.sessionIdleDays` later (TRV-62). */
async function expiryAfter(tx: Transaction, at: EpochMs): Promise<Date> {
  return new Date(at + (await getParam(tx, 'auth.sessionIdleDays')) * MS_PER_DAY);
}

/**
 * Opens a session of `device` at `at`, in `tx` (TRV-62): a token of 32 random bytes, of
 * which only the hash is stored. Returns the value of the device's session cookie.
 */
export async function openSession(tx: Transaction, device: string, at: EpochMs): Promise<string> {
  const token = randomBytes(TOKEN_BYTES);
  await tx.insert(sessions).values({
    tokenHash: hashOf(token),
    device,
    openedAt: new Date(at),
    lastUsedAt: new Date(at),
    expiresAt: await expiryAfter(tx, at),
  });
  return `${token.toString(TOKEN_ENCODING)}.${String(at)}`;
}

/** Marks the open session `row` used now, which moves its expiry (TRV-62), with the account's status. */
async function touch(
  tx: Transaction,
  row: Readonly<{ id: number; device: string; openedAt: Date }>,
) {
  const at = now();
  await tx
    .update(sessions)
    .set({ lastUsedAt: new Date(at), expiresAt: await expiryAfter(tx, at) })
    .where(eq(sessions.id, row.id));
  const [account] = await tx.select({ status: accounts.passwordStatus }).from(accounts);
  if (account === undefined) {
    throw new Error('A session exists while the account does not.');
  }
  const openedAt = toEpochMs(row.openedAt.getTime());
  return { id: row.id, device: row.device, openedAt, passwordStatus: account.status };
}

/**
 * The answer to a token the server no longer knows: the account's last ending of every
 * session when the device logged in before it, expiry otherwise (IHM-08, operations.md §1.10).
 */
async function unknownToken(tx: Transaction, loggedInAt: EpochMs): Promise<SessionState> {
  const [ending] = await tx
    .select({ reason: accounts.allSessionsEndReason })
    .from(accounts)
    .where(gt(accounts.allSessionsEndedAt, new Date(loggedInAt)));
  const reason = ending?.reason ?? null;
  return reason === null ? EXPIRED : { state: 'ended', reason };
}

/**
 * The state of the session that the cookie value `value` names, in `tx` (TRV-62, IHM-08,
 * CL-IHM-10): an open session, which this use keeps open for `auth.sessionIdleDays` more;
 * an ended one with its reason, `expired` once unused beyond that duration; for a token the
 * server no longer knows, the reason of the last ending of every session when the device
 * logged in before it, expiry otherwise; none for a value that names no session.
 */
export async function sessionState(tx: Transaction, value: string): Promise<SessionState> {
  const { token, loggedInAt } = COOKIE_VALUE.exec(value)?.groups ?? {};
  if (token === undefined || loggedInAt === undefined) {
    return NONE;
  }
  const tokenHash = hashOf(Buffer.from(token, TOKEN_ENCODING));
  const [row] = await tx.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
  if (row === undefined) {
    return unknownToken(tx, toEpochMs(Number(loggedInAt)));
  }
  if (row.endReason !== null) {
    return { state: 'ended', reason: row.endReason };
  }
  return row.expiresAt.getTime() <= now()
    ? EXPIRED
    : { state: 'open', session: await touch(tx, row) };
}

/** Ends the session `id` because its device logged out, in `tx` (TRV-62, IHM-08). */
export async function endSession(tx: Transaction, id: number): Promise<void> {
  await tx
    .update(sessions)
    .set({ endedAt: new Date(now()), endReason: 'logged_out' })
    .where(and(eq(sessions.id, id), isNull(sessions.endedAt)));
}

/**
 * Ends every open session at once with `reason`, in the caller's transaction `tx`: a logout
 * of all devices (`logged_out`), a password change (`password_changed`), a reset (`reset`)
 * or a restore (`restored`, the last step of `backups`), and records that ending on the
 * account, which outlives the session rows, so that a device whose token is gone still
 * learns it (TRV-60, TRV-63, IHM-08, CL-TRV-05). A session already past its idle expiry
 * stays expired. Returns the instant of the ending.
 */
export async function endAllSessions(
  tx: Transaction,
  reason: AllSessionsEndReason,
): Promise<EpochMs> {
  const at = now();
  const endedAt = new Date(at);
  await tx
    .update(sessions)
    .set({ endedAt, endReason: reason })
    .where(and(isNull(sessions.endedAt), gt(sessions.expiresAt, endedAt)));
  await tx
    .update(accounts)
    .set({ allSessionsEndedAt: endedAt, allSessionsEndReason: reason })
    .where(eq(accounts.id, ACCOUNT_ID));
  return at;
}

/**
 * The purge's step for the account, in the caller's transaction `tx` (module map §4,
 * operations.md §1.10 and §1.11): deletes the sessions past their idle expiry, an ended
 * session having kept its row and its token hash until then so that its device is told how
 * it ended, and the login failures older than `auth.loginFailureWindowMinutes`, which no
 * longer count. Returns how many rows it deleted.
 */
export async function purgeExpired(
  tx: Transaction,
  purge: Readonly<{ now: EpochMs }>,
): Promise<number> {
  const window = await getParam(tx, 'auth.loginFailureWindowMinutes');
  const expired = await tx
    .delete(sessions)
    .where(lte(sessions.expiresAt, new Date(purge.now)))
    .returning({ id: sessions.id });
  const outdated = await tx
    .delete(loginFailures)
    .where(lt(loginFailures.occurredAt, new Date(purge.now - window * MS_PER_MINUTE)))
    .returning({ id: loginFailures.id });
  return expired.length + outdated.length;
}

import 'server-only';

import { eq, gte } from 'drizzle-orm';

import { accounts, loginFailures } from '@/lib/db';
import { open } from '@/lib/incidents';
import { record } from '@/lib/journal';
import { getParams } from '@/lib/params';
import { toEpochMs } from '@/lib/time';

import { ACCOUNT_ID, MS_PER_MINUTE } from './sessions';

import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/**
 * A refused login (TRV-61, IHM-07): logins are locked until `lockedUntil`, and no password
 * was examined; or the password was wrong, and when this failure locked logins, until when.
 */
export type LoginRefusal =
  | Readonly<{ kind: 'locked'; lockedUntil: EpochMs }>
  | Readonly<{ kind: 'wrong-password'; lockedUntil: EpochMs | null }>;

/**
 * What asked for the password: a login, or a password change from the settings, whose
 * wrong current password counts as a refused login (TRV-61, IHM-09).
 */
type Attempt = 'login' | 'password-change';

// The journal message of each attempt, refused for a wrong password or while locked.
const REFUSED = {
  login: { wrong: 'login_refused', locked: 'login_refused_while_locked' },
  'password-change': {
    wrong: 'password_change_refused',
    locked: 'password_change_refused_while_locked',
  },
} as const;

/** The end of the lockout in force at `at`, or null when logins are allowed (TRV-61). */
export function lockEnd(lockedUntil: Date | null, at: EpochMs): EpochMs | null {
  const end = lockedUntil?.getTime();
  return end !== undefined && end > at ? toEpochMs(end) : null;
}

/**
 * Refuses an `attempt` while logins are locked: journaled as a refused attempt, and its
 * passwords neither examined nor counted (TRV-61, IHM-07).
 */
export async function refuseWhileLocked(
  tx: Transaction,
  lockedUntil: EpochMs,
  attempt: Attempt,
): Promise<LoginRefusal> {
  await record(tx, {
    messageKey: REFUSED[attempt].locked,
    params: { lockedUntilAt: lockedUntil },
  });
  return { kind: 'locked', lockedUntil };
}

/**
 * Records in `tx` the wrong password that an `attempt` gave at `at`, after the lockout that
 * ended at `lastLockEnd` (TRV-61): the failure is journaled and counted, a login's and a
 * password change's alike; the one that brings the failures within
 * `auth.loginFailureWindowMinutes`, since the last lockout ended, to
 * `auth.loginFailureThreshold` locks logins for `auth.lockoutMinutes`, journals the lockout
 * and opens the "Logins refused" incident.
 */
export async function recordFailure(
  tx: Transaction,
  failure: Readonly<{ attempt: Attempt; at: EpochMs; lastLockEnd: Date | null }>,
): Promise<LoginRefusal> {
  const { attempt, at, lastLockEnd } = failure;
  await tx.insert(loginFailures).values({ occurredAt: new Date(at) });
  await record(tx, { messageKey: REFUSED[attempt].wrong });
  const params = await getParams(tx);
  const windowStart = at - params.get('auth.loginFailureWindowMinutes') * MS_PER_MINUTE;
  const since = Math.max(windowStart, lastLockEnd?.getTime() ?? windowStart);
  const threshold = params.get('auth.loginFailureThreshold');
  const counted = await tx
    .select({ id: loginFailures.id })
    .from(loginFailures)
    .where(gte(loginFailures.occurredAt, new Date(since)))
    .limit(threshold);
  if (counted.length < threshold) {
    return { kind: 'wrong-password', lockedUntil: null };
  }
  const lockedUntil = toEpochMs(at + params.get('auth.lockoutMinutes') * MS_PER_MINUTE);
  await tx
    .update(accounts)
    .set({ loginLockedUntil: new Date(lockedUntil) })
    .where(eq(accounts.id, ACCOUNT_ID));
  await record(tx, { messageKey: 'login_locked', params: { lockedUntilAt: lockedUntil } });
  await open(tx, { kind: 'logins_refused' });
  return { kind: 'wrong-password', lockedUntil };
}

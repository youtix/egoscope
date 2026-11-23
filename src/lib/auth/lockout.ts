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

/** The end of the lockout in force at `at`, or null when logins are allowed (TRV-61). */
export function lockEnd(lockedUntil: Date | null, at: EpochMs): EpochMs | null {
  const end = lockedUntil?.getTime();
  return end !== undefined && end > at ? toEpochMs(end) : null;
}

/** Refuses a login while logins are locked: journaled, and neither examined nor counted (TRV-61). */
export async function refuseWhileLocked(
  tx: Transaction,
  lockedUntil: EpochMs,
): Promise<LoginRefusal> {
  await record(tx, {
    messageKey: 'login_refused_while_locked',
    params: { lockedUntilAt: lockedUntil },
  });
  return { kind: 'locked', lockedUntil };
}

/**
 * Records a wrong password given at `at`, in `tx` (TRV-61): the failure is journaled and
 * counted; the one that brings the failures within `auth.loginFailureWindowMinutes`, since
 * the last lockout ended, to `auth.loginFailureThreshold` locks logins for
 * `auth.lockoutMinutes`, journals the lockout and opens the "Logins refused" incident.
 */
export async function recordFailure(
  tx: Transaction,
  at: EpochMs,
  lastLockEnd: Date | null,
): Promise<LoginRefusal> {
  await tx.insert(loginFailures).values({ occurredAt: new Date(at) });
  await record(tx, { messageKey: 'login_refused' });
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

import 'server-only';

import { io } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentSession, lockoutStatus } from '@/lib/auth';
import { logger } from '@/lib/log';
import { ERASE_DEVICE_DATA_COOKIE, EraseDeviceData } from '@/lib/offline';
import { ok } from '@/lib/result';
import { Banner, Notice, PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { logInAction } from './actions';
import { lockoutUntil } from './lockout';
import { LogInForm } from './log-in-form';
import { destination, returnPath } from './return-path';
import { endedLabel, endReasonOf } from './session-ending';

import type { Lockout } from './lockout';
import type { SessionEndReason } from '@/lib/auth';
import type { Result } from '@/lib/result';
import type { Route } from 'next';
import type { ReactNode } from 'react';

/** The query of the login address: the screen to return to, and how the session ended. */
export type LogInQuery = Readonly<Record<string, string | string[] | undefined>>;

type Unchecked = Readonly<{ kind: string }>;

/**
 * Whether the device has already been told that its session expired, the one ending
 * that erases nothing: only then may the address spare it the step (IHM-08, IHM-11).
 */
function wasToldOfExpiry(reason: SessionEndReason, told: SessionEndReason | null): boolean {
  return reason === 'expired' && told === 'expired';
}

/**
 * Sends on a device that has no login to make: one whose session is open, to `target`
 * or first to "Choose your password" (TRV-57); one whose session ended, whatever the
 * address says, through the step that erases its data if the owner ended it (IHM-08,
 * CL-IHM-10, CL-TRV-05), unless it expired and the address has already `told` it so.
 * Any other stays, unless the server cannot read its session.
 */
async function sendOnward(
  target: Route,
  told: SessionEndReason | null,
): Promise<Result<undefined, Unchecked>> {
  // The session is read at the time of the request, never in a prerender.
  await io();
  const session = await currentSession();
  if (!session.ok) {
    return session;
  }
  const state = session.value;
  if (state.state === 'open') {
    redirect(destination(state.session.passwordStatus, target));
  }
  if (state.state === 'ended' && !wasToldOfExpiry(state.reason, told)) {
    redirect(`/log-in/erase?${new URLSearchParams({ next: target }).toString()}`);
  }
  return ok(undefined);
}

/** The lockout in progress, if any, or why the server cannot tell. */
async function currentLockout(): Promise<Result<Lockout | null, Unchecked>> {
  const status = await lockoutStatus();
  if (!status.ok) {
    return status;
  }
  const { lockedUntil } = status.value;
  return lockedUntil === null ? ok(null) : lockoutUntil(lockedUntil);
}

/** The screen while the server cannot check passwords, whose cause only the server log names. */
function unavailable(cause: string): ReactNode {
  logger.error('The login screen could not check the session.', { cause });
  return (
    <>
      <PageHeader title={sentence('interface.logIn')} />
      <Notice tone="danger" message={sentence('interface.passwordNotChecked')} />
    </>
  );
}

/**
 * The login screen, for the screen that the device asked for, `next` (IHM-05 to IHM-07,
 * IHM-10, IHM-11): a device whose session is open goes on to it, or to "Choose your
 * password" first (TRV-57); a device whose session ended, whatever its address says, goes
 * through the step that erases its data when the owner ended it (IHM-08, CL-IHM-10,
 * CL-TRV-05) and comes back with how it ended, unless it expired and was told so; any
 * other sees how its session ended, if it did, the lockout in progress and the form.
 */
export async function LogInScreen({
  query,
}: Readonly<{ query: Promise<LogInQuery> }>): Promise<ReactNode> {
  const { next, ended } = await query;
  const target = returnPath(next);
  const told = endReasonOf(ended);
  const onward = await sendOnward(target, told);
  if (!onward.ok) {
    return unavailable(onward.error.kind);
  }
  const lockout = await currentLockout();
  if (!lockout.ok) {
    return unavailable(lockout.error.kind);
  }
  // Set by the step that erases the data of a device whose session the owner ended.
  const sent = await cookies();
  const isErasing = sent.has(ERASE_DEVICE_DATA_COOKIE);
  return (
    <>
      {isErasing && <EraseDeviceData />}
      <PageHeader title={sentence('interface.logIn')} />
      {told !== null && <Banner message={endedLabel(told)} />}
      <LogInForm action={logInAction.bind(null, target)} initial={{ lockout: lockout.value }} />
    </>
  );
}

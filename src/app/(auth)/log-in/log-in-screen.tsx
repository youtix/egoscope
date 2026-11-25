import 'server-only';

import { redirect } from 'next/navigation';

import { currentSession, lockoutStatus } from '@/lib/auth';
import { logger } from '@/lib/log';
import { ok } from '@/lib/result';
import { Banner, Notice, PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { logInAction } from './actions';
import { lockoutUntil } from './lockout';
import { LogInForm } from './log-in-form';
import { destination, returnPath } from './return-path';
import { endedLabel, endReasonOf } from './session-ending';

import type { Lockout } from './lockout';
import type { Result } from '@/lib/result';
import type { ReactNode } from 'react';

/** The query of the login address: the screen to return to, and how the session ended. */
export type LogInQuery = Readonly<Record<string, string | string[] | undefined>>;

/** The lockout in progress, if any, or why the server cannot tell. */
async function currentLockout(): Promise<Result<Lockout | null, Readonly<{ kind: string }>>> {
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
 * password" first (TRV-57); a device whose session ended, and has not been told how, goes
 * through the step that erases its data when the owner ended it (IHM-08, CL-TRV-05) and
 * comes back with how it ended; any other sees how its session ended, if it did, the
 * lockout in progress and the form.
 */
export async function LogInScreen({
  query,
}: Readonly<{ query: Promise<LogInQuery> }>): Promise<ReactNode> {
  const { next, ended } = await query;
  const target = returnPath(next);
  const told = endReasonOf(ended);
  const session = await currentSession();
  if (!session.ok) {
    return unavailable(session.error.kind);
  }
  const state = session.value;
  if (state.state === 'open') {
    redirect(destination(state.session.passwordStatus, target));
  }
  if (state.state === 'ended' && state.reason !== told) {
    redirect(`/log-in/erase?${new URLSearchParams({ next: target }).toString()}`);
  }
  const lockout = await currentLockout();
  if (!lockout.ok) {
    return unavailable(lockout.error.kind);
  }
  return (
    <>
      <PageHeader title={sentence('interface.logIn')} />
      {told !== null && <Banner message={endedLabel(told)} />}
      <LogInForm action={logInAction.bind(null, target)} initial={{ lockout: lockout.value }} />
    </>
  );
}

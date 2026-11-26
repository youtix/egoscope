'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { logIn } from '@/lib/auth';
import { logger } from '@/lib/log';
import { sentence } from '@/lib/wording';

import { describeDevice } from './device';
import { lockoutUntil } from './lockout';
import { destination, returnPath } from './return-path';

import type { Lockout } from './lockout';
import type { LoginRefusal, ReadyError } from '@/lib/auth';
import type { EpochMs } from '@/lib/time';
import type { FieldErrors } from '@/lib/ui';
import type { Route } from 'next';

/**
 * What the login form shows after an attempt: the error of its field, a message on the
 * whole attempt when the server cannot check passwords, and the lockout of logins while
 * it lasts (IHM-06, IHM-07).
 */
export type LogInState = Readonly<{
  errors?: FieldErrors;
  message?: string;
  lockout: Lockout | null;
}>;

const PASSWORD = 'password';

/** The answer while the server cannot check passwords, whose cause only the server log names (TRV-64). */
function notChecked(cause: string): LogInState {
  logger.error('The password could not be checked.', { cause });
  return { message: sentence('interface.passwordNotChecked'), lockout: null };
}

/** `state`, with the lockout of logins that ends at `until`. */
async function withLockout(until: EpochMs, state: LogInState): Promise<LogInState> {
  const lockout = await lockoutUntil(until);
  return lockout.ok ? { ...state, lockout: lockout.value } : notChecked(lockout.error.kind);
}

/**
 * What the form shows of a refused attempt (TRV-61, IHM-07): while logins are locked,
 * until when, the password unexamined; a wrong password, and the lockout that it may
 * have started; or that the server cannot check passwords now.
 */
async function refused(error: LoginRefusal | ReadyError): Promise<LogInState> {
  switch (error.kind) {
    case 'locked': {
      return withLockout(error.lockedUntil, { lockout: null });
    }
    case 'wrong-password': {
      const state = { errors: { [PASSWORD]: sentence('interface.wrongPassword') }, lockout: null };
      return error.lockedUntil === null ? state : withLockout(error.lockedUntil, state);
    }
    case 'invalid-server-env':
    case 'database-not-configured':
    case 'initial-password-missing':
    case 'initial-password-too-short': {
      return notChecked(error.kind);
    }
  }
}

/**
 * The login page for the screen `next`, without how the session ended, so that the page
 * reads it from the session and sends the device through the step that erases its data
 * (IHM-08, CL-IHM-10). The page, not the step itself: Next.js fetches the target of an
 * action's redirect on the server and drops its cookies, so only a redirect of the page
 * leads the browser itself to the step and its Clear-Site-Data.
 */
function logInPage(next: Route): `/log-in?${string}` {
  return `/log-in?${new URLSearchParams({ next }).toString()}`;
}

/**
 * Logs the device in with the password of the form (TRV-61, IHM-06, IHM-07, IHM-10,
 * IHM-11): a session opens, and the device goes to the screen it asked for, `next`, a
 * path of this app, or first to "Choose your password" while the account uses its
 * initial password. A device whose session the owner ended goes back to the login page
 * instead, which has it erase its data first, whatever password it typed (IHM-08,
 * CL-IHM-10, CL-TRV-05). The password travels in the body of the request, never in an
 * address. An empty field is not an attempt, and is not counted.
 */
export async function logInAction(
  next: unknown,
  _previous: LogInState,
  formData: FormData,
): Promise<LogInState> {
  const password = formData.get(PASSWORD);
  if (typeof password !== 'string' || password === '') {
    return { errors: { [PASSWORD]: sentence('interface.typePassword') }, lockout: null };
  }
  const sent = await headers();
  const outcome = await logIn({ password, device: describeDevice(sent.get('user-agent')) });
  if (outcome.ok) {
    redirect(destination(outcome.value.passwordStatus, returnPath(next)));
  }
  if (outcome.error.kind === 'session-ended') {
    redirect(logInPage(returnPath(next)));
  }
  return refused(outcome.error);
}

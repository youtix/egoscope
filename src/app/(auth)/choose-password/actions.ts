'use server';

import { redirect } from 'next/navigation';

import { choosePassword } from '@/lib/auth';
import { logger } from '@/lib/log';
import { formatCount, sentence } from '@/lib/wording';

import { logInAddress } from './log-in-address';

import type { PasswordRefusal, ReadyError } from '@/lib/auth';
import type { FieldErrors } from '@/lib/ui';

/** What the form shows after a refused choice: the error of its field, or a message on the whole. */
export type ChoosePasswordState = Readonly<{ errors?: FieldErrors; message?: string }>;

const PASSWORD = 'password';

/**
 * What the form shows of a refused choice: a password too short, with the minimum
 * length (TRV-60); or that the server cannot save it now. A device without a session on
 * the initial password goes to the login page, which sends it where it belongs.
 */
function refused(error: PasswordRefusal | ReadyError, next: unknown): ChoosePasswordState {
  switch (error.kind) {
    case 'too-short': {
      const k = formatCount(error.minLength);
      return { errors: { [PASSWORD]: sentence('interface.passwordTooShort', { k }) } };
    }
    case 'no-session':
    case 'password-already-chosen':
    case 'locked':
    case 'wrong-password': {
      return redirect(logInAddress(next));
    }
    case 'invalid-server-env':
    case 'database-not-configured':
    case 'initial-password-missing':
    case 'initial-password-too-short': {
      logger.error('The password could not be saved.', { cause: error.kind });
      return { message: sentence('interface.passwordNotStored') };
    }
  }
}

/**
 * Replaces the initial password with the one of the form, the "Choose your password"
 * step (TRV-57, TRV-60, IHM-06, CL-TRV-15): at least the minimum length; every other
 * device is logged out, and this one goes on, in a new session, to the screen it asked
 * for, `next`, through the login page. The password travels in the body of the request,
 * never in an address (IHM-10).
 */
export async function choosePasswordAction(
  next: unknown,
  _previous: ChoosePasswordState,
  formData: FormData,
): Promise<ChoosePasswordState> {
  const password = formData.get(PASSWORD);
  const chosen = await choosePassword(typeof password === 'string' ? password : '');
  if (chosen.ok) {
    redirect(logInAddress(next));
  }
  return refused(chosen.error, next);
}

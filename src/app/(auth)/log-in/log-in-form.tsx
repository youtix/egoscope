'use client';

import { useActionState, useEffect, useState } from 'react';

import { now } from '@/lib/time';
import { Button, Form, FormField, Notice, PasswordInput } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { LogInState } from './actions';
import type { Lockout } from './lockout';
import type { ReactNode } from 'react';

export type LogInFormProps = Readonly<{
  /** The login action, bound to the screen to return to. */
  action: (previous: LogInState, formData: FormData) => Promise<LogInState>;
  /** What the form shows before any attempt: the lockout in progress, if any. */
  initial: LogInState;
}>;

/**
 * The lockout while it lasts: lifted at its end, so that the form sends again without
 * a reload, and never before, so that nothing is sent while logins are locked (IHM-07).
 */
function useLockout(lockout: Lockout | null): Lockout | null {
  const [lifted, setLifted] = useState<Lockout | null>(null);
  useEffect(() => {
    const timer =
      lockout === null
        ? undefined
        : setTimeout(
            () => {
              setLifted(lockout);
            },
            Math.max(0, lockout.until - now()),
          );
    return () => {
      clearTimeout(timer);
    };
  }, [lockout]);
  return lockout === lifted ? null : lockout;
}

/**
 * The login form (IHM-06, IHM-07): one field, the password, which the owner can show in
 * clear and the phone's password manager can fill; while logins are locked, until when,
 * and a button that sends nothing and says why.
 */
export function LogInForm({ action, initial }: LogInFormProps): ReactNode {
  const [state, dispatch] = useActionState(action, initial);
  const lockout = useLockout(state.lockout);
  return (
    <Form
      action={dispatch}
      errors={state.errors}
      message={state.message}
      errorSummaryTitle={sentence('interface.notLoggedIn')}
    >
      <Notice tone="danger" message={lockout?.notice} />
      <FormField name="password" label={sentence('interface.password')}>
        <PasswordInput
          autoComplete="current-password"
          revealLabel={sentence('interface.showPassword')}
        />
      </FormField>
      <Button
        type="submit"
        variant="primary"
        label={sentence('interface.logIn')}
        {...(lockout !== null && { disabledReason: sentence('interface.loginsRefusedMeanwhile') })}
      />
    </Form>
  );
}

'use client';

import { useActionState } from 'react';

import { Button, Form, FormField, PasswordInput } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ChoosePasswordState } from './actions';
import type { ReactNode } from 'react';

export type ChoosePasswordFormProps = Readonly<{
  /** The action that saves the password, bound to the screen to return to. */
  action: (previous: ChoosePasswordState, formData: FormData) => Promise<ChoosePasswordState>;
}>;

const NOTHING_YET: ChoosePasswordState = {};

/**
 * The form of "Choose your password" (TRV-57, IHM-06): one field, the new password, which
 * the owner can show in clear and the phone's password manager can propose and keep.
 */
export function ChoosePasswordForm({ action }: ChoosePasswordFormProps): ReactNode {
  const [state, dispatch] = useActionState(action, NOTHING_YET);
  return (
    <Form
      action={dispatch}
      errors={state.errors}
      message={state.message}
      errorSummaryTitle={sentence('interface.passwordNotSaved')}
    >
      <FormField name="password" label={sentence('interface.newPassword')}>
        <PasswordInput
          autoComplete="new-password"
          revealLabel={sentence('interface.showPassword')}
        />
      </FormField>
      <Button type="submit" variant="primary" label={sentence('interface.savePassword')} />
    </Form>
  );
}

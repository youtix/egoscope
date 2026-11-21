'use client';

import { startTransition, useId, useMemo } from 'react';

import { ErrorSummary } from './error-summary';
import { FormContext } from './form-context';

import type { FieldErrors } from './form-context';
import type { ReactNode, SubmitEvent } from 'react';

export type FormProps = Readonly<{
  /** The action: a Server Action, or the dispatch function that `useActionState` returns for one. */
  action: (formData: FormData) => void | Promise<void>;
  /**
   * The error of each field that the last submission refused, by field name, in the
   * order of the fields. The summary takes the focus whenever a new object arrives,
   * so pass the action state's own object, never one built anew at each render,
   * which would pull the focus to the summary at every keystroke.
   */
  errors?: FieldErrors | undefined;
  /** One message about the last submission as a whole, such as a server error that no field explains. */
  message?: string | undefined;
  /** The title of the summary that lists the message and the field errors. */
  errorSummaryTitle: string;
  children: ReactNode;
}>;

const NO_ERRORS: FieldErrors = {};

/**
 * Sends the form's data to its action, unless no submit button sent it: an Enter
 * key in a form whose only submit button waits behind a confirmation.
 * React does not reset the fields of a form that sends its own data, so a refused
 * submission keeps the owner's input visible, to be sent again (CL-IHM-18).
 */
function submitTo(action: FormProps['action'], event: SubmitEvent<HTMLFormElement>): void {
  event.preventDefault();
  const { submitter } = event.nativeEvent;
  if (!(submitter instanceof HTMLButtonElement)) {
    return;
  }
  const formData = new FormData(event.currentTarget, submitter);
  startTransition(async () => {
    await action(formData);
  });
}

/**
 * A form for a Server Action and `useActionState`: it shows the errors of the last
 * submission in a summary at its top and beside each field, keeps the owner's
 * input when the action refuses it (CL-IHM-18), and tells its submit buttons
 * while the action runs. The fields validate on the server, whose messages are the
 * app's own words, so the browser's are off.
 */
export function Form({
  action,
  errors = NO_ERRORS,
  message,
  errorSummaryTitle,
  children,
}: FormProps): ReactNode {
  const formId = useId();
  const state = useMemo(() => ({ formId, errors }), [formId, errors]);
  return (
    <FormContext value={state}>
      <form
        id={formId}
        action={action}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => submitTo(action, event)}
      >
        <ErrorSummary title={errorSummaryTitle} message={message} errors={errors} formId={formId} />
        {children}
      </form>
    </FormContext>
  );
}

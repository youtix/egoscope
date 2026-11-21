'use client';

import { useEffect, useId, useRef } from 'react';

import { controlId } from './form-context';
import { ToneIcon } from './icons';
import { TONE_CLASSES } from './tone';

import type { FieldErrors } from './form-context';
import type { MouseEvent, ReactNode } from 'react';

type ErrorSummaryProps = Readonly<{
  title: string;
  message: string | undefined;
  errors: FieldErrors;
  formId: string;
}>;

/** Moves the focus to the control that the link of an error points to. */
function focusControl(event: MouseEvent<HTMLAnchorElement>, id: string): void {
  event.preventDefault();
  document.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus();
}

/**
 * The summary of a refused submission, at the top of its form: the form's message
 * and each field's error, linked to its control. It takes the focus when it shows,
 * so that a screen reader says what to fix and the keyboard is one step from it.
 */
export function ErrorSummary({ title, message, errors, formId }: ErrorSummaryProps): ReactNode {
  const titleId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldErrors = Object.entries(errors);
  const isShown = message !== undefined || fieldErrors.length > 0;
  useEffect(() => {
    if (isShown) {
      summaryRef.current?.focus();
    }
  }, [isShown, message, errors]);
  if (!isShown) {
    return null;
  }
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
      className={`flex gap-3 rounded-xl border-2 p-4 ${TONE_CLASSES.danger}`}
    >
      <ToneIcon tone="danger" />
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {message !== undefined && <p>{message}</p>}
        {fieldErrors.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {fieldErrors.map(([name, error]) => {
              const id = controlId(formId, name);
              return (
                <li key={name}>
                  <a
                    href={`#${id}`}
                    className="font-medium underline underline-offset-4"
                    onClick={(event) => focusControl(event, id)}
                  >
                    {error}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

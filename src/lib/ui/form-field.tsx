'use client';

import { useId, useMemo } from 'react';

import { FieldError } from './field-error';
import { describedBy, FieldContext, useControlId, useFieldError } from './form-context';

import type { ReactNode } from 'react';

export type FormFieldProps = Readonly<{
  /** The name under which the control sends its value, and under which the form gives its error. */
  name: string;
  label: string;
  /** A sentence under the label that helps fill the field. */
  hint?: string;
  /** The words that mark a required field beside its label; when given, the field is required. */
  requiredMark?: string;
  /** The one control that the field labels: a TextInput, PasswordInput, Textarea, Select or PasteArea. */
  children: ReactNode;
}>;

/**
 * A labeled field: its label, its hint, the error that its form holds for it and
 * its control, which screen readers name by the label and describe by the hint and
 * the error (IHM-62), and whose error is written, never shown by color alone
 * (IHM-61). Inside a Form, the error summary links to the control.
 */
export function FormField({
  name,
  label,
  hint,
  requiredMark,
  children,
}: FormFieldProps): ReactNode {
  const id = useControlId(name, useId());
  const error = useFieldError(name);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const control = useMemo(
    () => ({
      id,
      name,
      required: requiredMark !== undefined,
      invalid: error !== undefined,
      describedBy: describedBy(hint !== undefined && hintId, error !== undefined && errorId),
    }),
    [id, name, requiredMark, error, hint, hintId, errorId],
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="leading-snug font-medium">
        {label}
        {requiredMark !== undefined && (
          // The control says that it is required to screen readers; the mark is for the eye.
          <span aria-hidden="true" className="font-normal text-ink-muted">
            {` ${requiredMark}`}
          </span>
        )}
      </label>
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error !== undefined && <FieldError id={errorId} message={error} />}
      <FieldContext value={control}>{children}</FieldContext>
    </div>
  );
}

'use client';

import { useId } from 'react';

import { FieldError } from './field-error';
import { describedBy, useControlId, useFieldError } from './form-context';

import type { ReactNode } from 'react';

export type CheckboxProps = Readonly<{
  /** The name under which the box sends "on" when checked, and under which the form gives its error. */
  name: string;
  label: string;
  /** A sentence under the label that explains the choice. */
  hint?: string;
  defaultChecked?: boolean;
}>;

/**
 * A box to check, labeled by the words beside it, which a tap on the words also
 * checks, on a target a thumb hits comfortably (IHM-61, IHM-62).
 */
export function Checkbox({ name, label, hint, defaultChecked }: CheckboxProps): ReactNode {
  const id = useControlId(name, useId());
  const error = useFieldError(name);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      {error !== undefined && <FieldError id={errorId} message={error} />}
      <label htmlFor={id} className="flex min-h-touch cursor-pointer items-center gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy(
            hint !== undefined && hintId,
            error !== undefined && errorId,
          )}
          className="size-6 shrink-0 cursor-pointer accent-accent"
        />
        <span className="leading-snug">{label}</span>
      </label>
      {hint !== undefined && (
        <p id={hintId} className="pl-9 text-sm text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

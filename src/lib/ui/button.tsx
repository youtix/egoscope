'use client';

import { useId } from 'react';
import { useFormStatus } from 'react-dom';

import { buttonClasses } from './button-styles';
import { SpinnerIcon } from './icons';

import type { ButtonVariant } from './button-styles';
import type { ReactNode } from 'react';

export type ButtonProps = Readonly<{
  /** The visible text, which is also the name that screen readers say (IHM-62). */
  label: string;
  /** How strongly the action stands out; one `primary` action per screen. */
  variant?: ButtonVariant;
  /** `submit` sends the form that holds the button. */
  type?: 'button' | 'submit';
  /**
   * Why the action is not available now, such as offline or before any type is
   * validated: the button is disabled and this sentence shows under it, read with
   * it (IHM-55, IHM-58).
   */
  disabledReason?: string;
  onClick?: () => void;
}>;

/**
 * A button with an explicit label, which screen readers say as it is written
 * (IHM-62), on a target a thumb hits comfortably (IHM-61). An unavailable action
 * says why, rather than only looking unavailable. A submit button keeps its focus
 * and ignores presses while its form's action runs.
 */
export function Button({
  label,
  variant = 'secondary',
  type = 'button',
  disabledReason,
  onClick,
}: ButtonProps): ReactNode {
  const reasonId = useId();
  const isPending = useFormStatus().pending && type === 'submit';
  const button = (
    <button
      type={type}
      className={buttonClasses(variant)}
      disabled={disabledReason !== undefined}
      aria-disabled={isPending || undefined}
      aria-describedby={disabledReason === undefined ? undefined : reasonId}
      onClick={(event) => {
        if (isPending) {
          event.preventDefault();
          return;
        }
        onClick?.();
      }}
    >
      {isPending && <SpinnerIcon />}
      {label}
    </button>
  );
  if (disabledReason === undefined) {
    return button;
  }
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      {button}
      <span id={reasonId} className="text-sm text-ink-muted">
        {disabledReason}
      </span>
    </span>
  );
}

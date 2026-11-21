'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { use, useEffect, useRef, useState } from 'react';

import { buttonClasses } from './button-styles';
import { ACTIONS_CLASSES, BACKDROP_CLASSES, POPUP_CLASSES, TITLE_CLASSES } from './dialog-styles';
import { FormContext } from './form-context';

import type { MouseEvent, ReactNode } from 'react';

/** One question of a confirmation: what it asks, what follows, and the words of the button that agrees. */
export type ConfirmationStep = Readonly<{
  title: string;
  description: string;
  confirmLabel: string;
}>;

export type ConfirmDialogProps = ConfirmationStep &
  Readonly<{
    /** The label of the button that opens the confirmation (IHM-62). */
    triggerLabel: string;
    /** `danger` for an action that erases data. */
    variant?: 'primary' | 'danger';
    /** The label of the button that closes the confirmation without acting. */
    cancelLabel: string;
    /** What the action changes or erases, under the first question (JOU-24, IHM-68). */
    children?: ReactNode;
    /**
     * A second question, asked once the first is agreed to, for an action that
     * cannot be undone, such as deleting a player's data (JOU-24).
     */
    secondStep?: ConfirmationStep;
  }>;

/** Submits the form of the button that `event` presses, with the button as its submitter. */
function submitOwnForm(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
  const button = event.currentTarget;
  button.form?.requestSubmit(button);
}

/**
 * Asks before a Form's submission: a button opens a dialog that asks the question
 * and says what follows, and only its confirm button submits the form; Cancel,
 * where the focus starts, or Escape closes it without acting. With `secondStep`,
 * the question is asked twice, the focus moving to the second one. Renders only
 * inside a Form, whose fields, errors and kept input it shares.
 */
export function ConfirmDialog({
  triggerLabel,
  variant = 'primary',
  title,
  description,
  confirmLabel,
  cancelLabel,
  children,
  secondStep,
}: ConfirmDialogProps): ReactNode {
  const form = use(FormContext);
  const [open, setOpen] = useState(false);
  const [onSecondStep, setOnSecondStep] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (onSecondStep) {
      headingRef.current?.focus();
    }
  }, [onSecondStep]);
  if (form === undefined) {
    throw new Error('ConfirmDialog renders only inside a Form, whose submission it confirms.');
  }
  const step =
    onSecondStep && secondStep !== undefined ? secondStep : { title, description, confirmLabel };
  const changeOpen = (isOpen: boolean): void => {
    setOpen(isOpen);
    setOnSecondStep(false);
  };
  return (
    <AlertDialog.Root open={open} onOpenChange={changeOpen}>
      <AlertDialog.Trigger className={buttonClasses(variant)}>{triggerLabel}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP_CLASSES} />
        <AlertDialog.Popup className={POPUP_CLASSES}>
          <AlertDialog.Title ref={headingRef} tabIndex={-1} className={TITLE_CLASSES}>
            {step.title}
          </AlertDialog.Title>
          <AlertDialog.Description>{step.description}</AlertDialog.Description>
          {!onSecondStep && children}
          <div className={ACTIONS_CLASSES}>
            <AlertDialog.Close className={buttonClasses('secondary')}>
              {cancelLabel}
            </AlertDialog.Close>
            {secondStep === undefined || onSecondStep ? (
              <button
                key="confirm"
                type="submit"
                form={form.formId}
                className={buttonClasses(variant)}
                onClick={(event) => {
                  submitOwnForm(event);
                  changeOpen(false);
                }}
              >
                {step.confirmLabel}
              </button>
            ) : (
              <button
                key="continue"
                type="button"
                className={buttonClasses(variant)}
                onClick={() => setOnSecondStep(true)}
              >
                {step.confirmLabel}
              </button>
            )}
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

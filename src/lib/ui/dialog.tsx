'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';

import { buttonClasses } from './button-styles';
import { ACTIONS_CLASSES, BACKDROP_CLASSES, POPUP_CLASSES, TITLE_CLASSES } from './dialog-styles';

import type { ButtonVariant } from './button-styles';
import type { ReactNode } from 'react';

export type DialogProps = Readonly<{
  /** The label of the button that opens the dialog (IHM-62). */
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  title: string;
  /** A sentence under the title, which screen readers say with it. */
  description?: string;
  /** The label of the button that closes the dialog. */
  closeLabel: string;
  children?: ReactNode;
}>;

/**
 * A modal dialog that a button opens: the focus moves into it and stays there,
 * Escape and its close button close it, and the focus then returns to the button
 * that opened it. Screen readers name it by its title, and its close button by
 * its label (IHM-61, IHM-62).
 */
export function Dialog({
  triggerLabel,
  triggerVariant = 'secondary',
  title,
  description,
  closeLabel,
  children,
}: DialogProps): ReactNode {
  return (
    <BaseDialog.Root>
      <BaseDialog.Trigger className={buttonClasses(triggerVariant)}>
        {triggerLabel}
      </BaseDialog.Trigger>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={BACKDROP_CLASSES} />
        <BaseDialog.Popup className={POPUP_CLASSES}>
          <BaseDialog.Title className={TITLE_CLASSES}>{title}</BaseDialog.Title>
          {description !== undefined && (
            <BaseDialog.Description className="text-ink-muted">
              {description}
            </BaseDialog.Description>
          )}
          {children}
          <div className={ACTIONS_CLASSES}>
            <BaseDialog.Close className={buttonClasses('secondary')}>{closeLabel}</BaseDialog.Close>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

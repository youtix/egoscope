'use client';

import { Button } from './button';
import { useCopy } from './use-copy';

import type { ButtonVariant } from './button-styles';
import type { ReactNode } from 'react';

export type CopyButtonProps = Readonly<{
  /** The text that the button puts on the clipboard, whole. */
  text: string;
  label: string;
  variant?: ButtonVariant;
  /** What the button says once the text is copied, such as "Prompt copied" (IHM-39). */
  copiedMessage: string;
  /** What it says when the phone refuses the clipboard: how to copy the selected text by a long press. */
  fallbackMessage: string;
  /** The identifier of the element that shows the text, selected when the clipboard is refused. */
  selectTargetId?: string;
  /** Called once the text is on the clipboard, such as to note the time of the copy (IHM-39). */
  onCopied?: () => void;
}>;

/**
 * Copies a text in one touch, without any selection by hand, and confirms it in
 * words that screen readers announce (IHM-39, IHM-43). When the phone refuses the
 * clipboard, the text on the screen is selected and the button says how to copy
 * it by a long press. The confirmation's room is kept, so the page does not move.
 */
export function CopyButton({
  text,
  label,
  variant = 'primary',
  copiedMessage,
  fallbackMessage,
  selectTargetId,
  onCopied,
}: CopyButtonProps): ReactNode {
  const { status, copy } = useCopy({
    text,
    copiedMessage,
    fallbackMessage,
    selectTargetId,
    onCopied,
  });
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        label={label}
        variant={variant}
        onClick={() => {
          void copy();
        }}
      />
      <p role="status" className="min-h-[1lh] text-sm text-ink-muted">
        {status}
      </p>
    </div>
  );
}

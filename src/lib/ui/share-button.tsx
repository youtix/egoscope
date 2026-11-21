'use client';

import { Button } from './button';
import { useCopy } from './use-copy';

import type { ReactNode } from 'react';

export type ShareButtonProps = Readonly<{
  /** The text that the button shares, whole. */
  text: string;
  label: string;
  /** What the button says once it copied the text, where the phone has no share sheet. */
  copiedMessage: string;
  /** What it says when the clipboard is refused too: how to copy the selected text by a long press. */
  fallbackMessage: string;
  /** The identifier of the element that shows the text, selected when the clipboard is refused. */
  selectTargetId?: string;
}>;

/** Says whether `error` is the owner closing the share sheet, which is no failure. */
function isCanceled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Hands a text to the phone's share sheet, such as to send the prompt to the
 * research app (IHM-27). Where there is no share sheet, or it fails, the button
 * copies the text instead and says so; closing the sheet does nothing.
 */
export function ShareButton({
  text,
  label,
  copiedMessage,
  fallbackMessage,
  selectTargetId,
}: ShareButtonProps): ReactNode {
  const { status, copy } = useCopy({
    text,
    copiedMessage,
    fallbackMessage,
    selectTargetId,
    onCopied: undefined,
  });
  const share = async (): Promise<void> => {
    if ('share' in navigator) {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        if (isCanceled(error)) {
          return;
        }
      }
    }
    await copy();
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        label={label}
        onClick={() => {
          void share();
        }}
      />
      <p role="status" className="min-h-[1lh] text-sm text-ink-muted">
        {status}
      </p>
    </div>
  );
}

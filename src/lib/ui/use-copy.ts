'use client';

import { useState } from 'react';

import { copyToClipboard, selectContents } from './clipboard';

/** What a copy needs: the text, what it says once done or refused, and what to select when refused. */
export type CopyOptions = Readonly<{
  text: string;
  copiedMessage: string;
  fallbackMessage: string;
  selectTargetId: string | undefined;
  onCopied: (() => void) | undefined;
}>;

/** A copy, and the sentence that it last said. */
type Copy = Readonly<{ status: string | undefined; copy: () => Promise<void> }>;

/**
 * Copies a text in one touch and confirms it (IHM-39, IHM-43). When the phone
 * refuses the clipboard, it selects the text on the screen instead and says how to
 * copy it by a long press (edge case « Presse-papiers inaccessible »).
 */
export function useCopy({
  text,
  copiedMessage,
  fallbackMessage,
  selectTargetId,
  onCopied,
}: CopyOptions): Copy {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const copy = async (): Promise<void> => {
    if ((await copyToClipboard(text)) === 'copied') {
      setStatus(copiedMessage);
      onCopied?.();
      return;
    }
    if (selectTargetId !== undefined) {
      selectContents(selectTargetId);
    }
    setStatus(fallbackMessage);
  };
  return { status, copy };
}

'use client';

import { useRef, useState } from 'react';

import { Button } from './button';
import { readFromClipboard } from './clipboard';
import { CONTROL_CLASSES } from './control-styles';
import { useFieldControl } from './form-context';

import type { ChangeEvent, ReactNode } from 'react';

// The files that hold a research result: JSON, or plain text.
const TEXT_FILES = '.json,.txt,application/json,text/plain';
// Room for a good part of a pasted result on a phone, before the area scrolls.
const ROWS = 12;

export type PasteAreaProps = Readonly<{
  /** The text, which the screen keeps as a draft at each change (IHM-42). */
  value: string;
  onValueChange: (value: string) => void;
  /** The label of the button that pastes the clipboard (IHM-28). */
  pasteLabel: string;
  /** What the area says when the phone refuses the clipboard: how to paste by a long press. */
  pasteRefusedMessage: string;
  /** The label of the button that picks a text file instead (IHM-28). */
  fileLabel: string;
  /** The largest file, in bytes, that the area reads. */
  maxFileBytes: number;
  fileTooLargeMessage: string;
  fileUnreadableMessage: string;
}>;

/**
 * The large area where the research result is pasted (IHM-28): autocorrection,
 * which on iOS also brings smart punctuation, automatic capitals and the spelling
 * check are off, so the pasted JSON stays as the AI wrote it (IMP-02). A button
 * pastes the clipboard where the phone allows it, and says how to paste by a long
 * press where it does not; another reads a text file instead, up to a size. The
 * text wraps and stays readable on a phone (IHM-63). Labeled by its FormField.
 */
export function PasteArea({
  value,
  onValueChange,
  pasteLabel,
  pasteRefusedMessage,
  fileLabel,
  maxFileBytes,
  fileTooLargeMessage,
  fileUnreadableMessage,
}: PasteAreaProps): ReactNode {
  const control = useFieldControl('PasteArea');
  const filePickerRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const show = (text: string): void => {
    setMessage(undefined);
    onValueChange(text);
  };
  const paste = async (): Promise<void> => {
    const text = await readFromClipboard();
    if (text === undefined) {
      setMessage(pasteRefusedMessage);
      return;
    }
    show(text);
  };
  const read = async (file: File): Promise<void> => {
    if (file.size > maxFileBytes) {
      setMessage(fileTooLargeMessage);
      return;
    }
    try {
      show(await file.text());
    } catch {
      setMessage(fileUnreadableMessage);
    }
  };
  const pick = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    if (filePickerRef.current !== null) {
      // Cleared, so that picking the same file again reads it again.
      filePickerRef.current.value = '';
    }
    if (file !== undefined) {
      void read(file);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        {...control}
        value={value}
        rows={ROWS}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${CONTROL_CLASSES} resize-y font-mono`}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          label={pasteLabel}
          onClick={() => {
            void paste();
          }}
        />
        <Button label={fileLabel} onClick={() => filePickerRef.current?.click()} />
        <input
          ref={filePickerRef}
          type="file"
          accept={TEXT_FILES}
          aria-label={fileLabel}
          hidden
          onChange={pick}
        />
      </div>
      <p role="status" className="min-h-[1lh] text-sm text-ink-muted">
        {message}
      </p>
    </div>
  );
}

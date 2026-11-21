'use client';

import { useId, useState } from 'react';

import { Button } from './button';
import { cx } from './class-names';

import type { ReactNode } from 'react';

/** The labels of the button that unfolds a folded text and folds it again. */
export type FoldLabels = Readonly<{ showAllLabel: string; showLessLabel: string }>;

export type LongTextProps = Readonly<{
  /** What the text is, which names its region for screen readers, such as "Prompt". */
  label: string;
  text: string;
  /** The identifier of the text, which a copy button selects when the clipboard is refused. */
  id?: string;
  /** When given, the text starts folded to its first lines, with a button that shows it all (IHM-27). */
  fold?: FoldLabels;
}>;

/**
 * A long text, such as the prompt, a pasted result or a preview (IHM-63): kept
 * as written, wrapped at the width of the screen in portrait as in landscape,
 * never scrolling sideways. Folded, it shows its first lines and a button that
 * unfolds it, which says whether the text is shown in full.
 */
export function LongText({ label, text, id, fold }: LongTextProps): ReactNode {
  const ownId = useId();
  const textId = id ?? ownId;
  const [folded, setFolded] = useState(fold !== undefined);
  return (
    <div className="flex flex-col items-start gap-2">
      <div
        id={textId}
        role="region"
        aria-label={label}
        className={cx(
          'w-full rounded-lg border border-line bg-surface-muted p-4 font-mono text-sm break-words whitespace-pre-wrap',
          folded && 'max-h-[12lh] overflow-hidden',
        )}
      >
        {text}
      </div>
      {fold !== undefined && (
        <Button
          label={folded ? fold.showAllLabel : fold.showLessLabel}
          variant="quiet"
          onClick={() => setFolded((isFolded) => !isFolded)}
        />
      )}
    </div>
  );
}

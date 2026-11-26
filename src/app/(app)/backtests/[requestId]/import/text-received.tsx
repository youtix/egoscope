import { formatCount, sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

// How many characters of the end of the text show, enough to see whether the answer was
// copied whole.
const TAIL_LENGTH = 120;
// The first code point that a text writes as a pair of surrogates, two UTF-16 units.
const FIRST_OF_A_PAIR = 0x1_00_00;

/**
 * The UTF-16 units of the code point that starts at `index`: two for a pair of surrogates,
 * one for any other, a lone surrogate included, and one where no code point starts, before
 * the text.
 */
function unitsAt(text: string, index: number): number {
  return Number(text.codePointAt(index)) > FIRST_OF_A_PAIR ? 2 : 1;
}

/**
 * The characters of a text as the owner counts them, its code points, a lone surrogate
 * counting as one, as `checkPastedTextSize` walks them: without copying the text, which
 * may hold 2 MB and is counted at each change.
 */
function characterCount(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += unitsAt(text, index)) {
    count += 1;
  }
  return count;
}

/**
 * The last `count` characters of a text, or all of it when it is shorter: it never begins
 * with the second half of a pair, which ends where the pair starting two units before does.
 */
function lastCharacters(text: string, count: number): string {
  let start = text.length;
  for (let taken = 0; taken < count && start > 0; taken += 1) {
    start -= unitsAt(text, start - 2);
  }
  return text.slice(start);
}

/**
 * The characters received and the end of the text of the paste area, to see whether it was
 * all copied (IMP-02, CL-IMP-27): characters are counted as code points, and the end is
 * the last 120 of them.
 */
export function TextReceived({ text }: Readonly<{ text: string }>): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-ink-muted">
        {sentence('imports.charactersReceived', { k: formatCount(characterCount(text)) })}
      </p>
      {text !== '' && (
        <>
          <p className="text-sm text-ink-muted">{sentence('imports.endOfText')}</p>
          <pre className="rounded-lg border border-line bg-surface-muted p-2 font-mono text-sm break-words whitespace-pre-wrap">
            {lastCharacters(text, TAIL_LENGTH)}
          </pre>
        </>
      )}
    </div>
  );
}

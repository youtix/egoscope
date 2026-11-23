import { useId } from 'react';

import { definition } from '@/lib/wording';

import type { DefinedTerm } from '@/lib/wording';
import type { ReactNode } from 'react';

export type GlossaryTermProps = Readonly<{
  /** The term of glossary section 7.7 whose label this is: `'normalizedGap'` for "Gap". */
  term: DefinedTerm;
}>;

/**
 * The first label of a glossary term on a screen, which opens the term's
 * one-sentence definition with one tap, or one press of Enter or Space (IHM-15,
 * CL-IHM-26). It is a button named by the label, set apart from the text around it
 * by a dotted underline, not by color alone (IHM-61). The definition opens above
 * the page, centered, and closes with a tap outside it or Escape; the browser says
 * to screen readers whether it is open. It needs no script.
 */
export function GlossaryTerm({ term }: GlossaryTermProps): ReactNode {
  const definitionId = useId();
  const { label, text } = definition(term);
  return (
    <>
      <button
        type="button"
        popoverTarget={definitionId}
        className="inline-flex min-h-6 max-w-full cursor-help items-center text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
      >
        {label}
      </button>
      <span
        id={definitionId}
        popover="auto"
        className="m-auto max-w-[min(24rem,calc(100%-2rem))] rounded-xl border-2 border-line-strong bg-surface p-4 text-left text-base font-normal text-ink shadow-lg"
      >
        {text}
      </span>
    </>
  );
}

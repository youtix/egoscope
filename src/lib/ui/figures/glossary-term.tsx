import { useId } from 'react';

import { definition } from '@/lib/wording';

import type { DefinedTerm } from '@/lib/wording';
import type { ReactNode } from 'react';

export type GlossaryTermProps = Readonly<{
  /** The term of glossary section 7.7 whose label this is: `'normalizedGap'` for "Gap". */
  term: DefinedTerm;
  /**
   * Whether the label is written as plain text, for a later occurrence of the term on
   * the screen: a `span` with the label, no button and no definition in the page.
   * Absent or false, the label opens the definition, as the first occurrence does
   * (IHM-15, CL-IHM-26). It may be passed as `undefined`, so that a figure forwards
   * its own optional `plain`.
   */
  plain?: boolean | undefined;
}>;

/**
 * The first label of a glossary term on a screen, which opens the term's
 * one-sentence definition with one tap, or one press of Enter or Space (IHM-15,
 * CL-IHM-26). It is a button named by the label, set apart from the text around it
 * by a dotted underline, not by color alone (IHM-61). The definition opens above
 * the page, centered, and closes with a tap outside it or Escape; the browser says
 * to screen readers whether it is open. It needs no script. With `plain`, a later
 * occurrence of the term, it is the label as text alone (IHM-15, CL-IHM-26).
 */
export function GlossaryTerm({ term, plain }: GlossaryTermProps): ReactNode {
  const definitionId = useId();
  const { label, text } = definition(term);
  if (plain === true) {
    return <span>{label}</span>;
  }
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

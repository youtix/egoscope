import { definition, formatCount, sentence } from '@/lib/wording';

import { directionWord } from './direction';
import { GlossaryTerm } from './glossary-term';

import type { FigureVerdictDirection } from './direction';
import type { DefinedTerm, SentenceKey } from '@/lib/wording';
import type { ReactNode } from 'react';

// The stored values of the verdict (SEN-23, SEN-24), those of the profiles that the
// calculation engine gives.
type VerdictValue =
  | Readonly<{ level: 'inconclusive'; direction: null }>
  | Readonly<{ level: 'possible' | 'probable'; direction: FigureVerdictDirection }>;

/**
 * The level of a verdict, by its stored value (SEN-23): the figures' copy of the
 * engine's `VerdictLevel`, which `ui` cannot import, kept equal to it by a type test
 * of the gallery.
 */
export type FigureVerdictLevel = VerdictValue['level'];

/**
 * The confidence of a profile, by its stored value (SEN-25): the figures' copy of the
 * engine's `ProfileConfidence`, which `ui` cannot import, kept equal to it by a type
 * test of the gallery.
 */
export type FigureProfileConfidence = 'low' | 'medium' | 'high';

const LEVEL_WORDS = {
  inconclusive: 'sensitivity.inconclusive',
  possible: 'sensitivity.possible',
  probable: 'sensitivity.probable',
} as const satisfies Record<FigureVerdictLevel, SentenceKey>;

const CONFIDENCE_WORDS = {
  low: 'sensitivity.lowConfidence',
  medium: 'sensitivity.mediumConfidence',
  high: 'sensitivity.highConfidence',
} as const satisfies Record<FigureProfileConfidence, SentenceKey>;

export type VerdictProps = Readonly<{
  /** The verdict: inconclusive, or possible or probable with its direction (SEN-23, SEN-24). */
  verdict: VerdictValue;
  /** The profile confidence, which no verdict is shown without (SEN-25, SEN-38). */
  confidence: FigureProfileConfidence;
  /** The number of valid cases, which no verdict is shown without (SEN-38). */
  validCount: number;
  /**
   * Whether the labels "Verdict" and "Profile confidence" are written as plain text,
   * for a later occurrence of the terms on the screen; absent, they open their
   * definitions, as the first occurrence does (IHM-15, CL-IHM-26).
   */
  plain?: boolean;
}>;

/** The verdict's level, followed by its direction when it has one: "possible, increase". */
function verdictWords(verdict: VerdictValue): string {
  const level = sentence(LEVEL_WORDS[verdict.level]);
  return verdict.direction === null
    ? level
    : sentence('sensitivity.levelAndDirection', {
        level,
        direction: directionWord(verdict.direction),
      });
}

/** The label of `term`: its glossary term, or its words alone when `plain` (CL-IHM-26). */
function TermLabel({ term, plain }: Readonly<{ term: DefinedTerm; plain: boolean }>): ReactNode {
  return plain ? <span>{definition(term).label}</span> : <GlossaryTerm term={term} />;
}

/**
 * A verdict as every screen shows it, always with its profile confidence and its
 * number of valid cases (SEN-38, IHM-45), its direction written in full (IHM-47).
 * The labels of the verdict and of the profile confidence open their definitions,
 * unless `plain` writes them as text (IHM-15, CL-IHM-26).
 */
export function Verdict({ verdict, confidence, validCount, plain }: VerdictProps): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <TermLabel term="verdict" plain={plain === true} />
        <span className="text-lg font-semibold">{verdictWords(verdict)}</span>
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <TermLabel term="profileConfidence" plain={plain === true} />
        <span className="font-medium">{sentence(CONFIDENCE_WORDS[confidence])}</span>
      </p>
      <p className="text-sm">
        {sentence('sensitivity.validCaseCount', { k: formatCount(validCount) })}
      </p>
    </div>
  );
}

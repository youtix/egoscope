import { formatCount, sentence } from '@/lib/wording';

import { directionWord } from './direction';
import { GlossaryTerm } from './glossary-term';

import type { VerdictDirection } from './direction';
import type { SentenceKey } from '@/lib/wording';
import type { ReactNode } from 'react';

// The stored values of the verdict and of the profile confidence (SEN-23 to SEN-25),
// those of the profiles that the calculation engine gives.
type VerdictValue =
  | Readonly<{ level: 'inconclusive'; direction: null }>
  | Readonly<{ level: 'possible' | 'probable'; direction: VerdictDirection }>;
type ProfileConfidence = 'low' | 'medium' | 'high';

const LEVEL_WORDS = {
  inconclusive: 'sensitivity.inconclusive',
  possible: 'sensitivity.possible',
  probable: 'sensitivity.probable',
} as const satisfies Record<VerdictValue['level'], SentenceKey>;

const CONFIDENCE_WORDS = {
  low: 'sensitivity.lowConfidence',
  medium: 'sensitivity.mediumConfidence',
  high: 'sensitivity.highConfidence',
} as const satisfies Record<ProfileConfidence, SentenceKey>;

export type VerdictProps = Readonly<{
  /** The verdict: inconclusive, or possible or probable with its direction (SEN-23, SEN-24). */
  verdict: VerdictValue;
  /** The profile confidence, which no verdict is shown without (SEN-25, SEN-38). */
  confidence: ProfileConfidence;
  /** The number of valid cases, which no verdict is shown without (SEN-38). */
  validCount: number;
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

/**
 * A verdict as every screen shows it, always with its profile confidence and its
 * number of valid cases (SEN-38, IHM-45), its direction written in full (IHM-47).
 * The labels of the verdict and of the profile confidence open their definitions
 * (IHM-15, CL-IHM-26).
 */
export function Verdict({ verdict, confidence, validCount }: VerdictProps): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <GlossaryTerm term="verdict" />
        <span className="text-lg font-semibold">{verdictWords(verdict)}</span>
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <GlossaryTerm term="profileConfidence" />
        <span className="font-medium">{sentence(CONFIDENCE_WORDS[confidence])}</span>
      </p>
      <p className="text-sm">
        {sentence('sensitivity.validCaseCount', { k: formatCount(validCount) })}
      </p>
    </div>
  );
}

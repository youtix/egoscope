import { definition, formatCount, formatGap, sentence } from '@/lib/wording';

import { Direction, shownDirection } from './direction';
import { GlossaryTerm } from './glossary-term';

import type { ReactNode } from 'react';

export type MeanGapProps = Readonly<{
  /** The mean of the valid cases' normalized gaps (SEN-20). */
  meanGap: number;
  /** The bounds of the plausible range, twice the expected noise on either side (SEN-22). */
  rangeLow: number;
  rangeHigh: number;
  /** The number of valid cases the mean rests on, which no mean gap is shown without (SEN-38). */
  validCount: number;
  /**
   * Whether the label "Range" is written as plain text, for a later occurrence of the
   * term on the screen; absent, it opens its definition, as the first occurrence does
   * (IHM-15, CL-IHM-26).
   */
  plain?: boolean;
}>;

/**
 * A mean gap as every screen shows it: its sign and two decimals, its direction
 * written in full, its plausible range and the number of valid cases it rests on
 * (SEN-38, IHM-45, IHM-47, CA-IHM-10). Its props need all four, so that no screen
 * can show a mean gap without its case count. The range's label opens its
 * definition, unless `plain` writes it as text (IHM-15, CL-IHM-26).
 */
export function MeanGap({
  meanGap,
  rangeLow,
  rangeHigh,
  validCount,
  plain,
}: MeanGapProps): ReactNode {
  const written = formatGap(meanGap);
  const direction = shownDirection(written);
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{sentence('sensitivity.meanGap')}</span>
        <span className="text-lg font-semibold tabular-nums">{written}</span>
        {direction !== undefined && <Direction direction={direction} />}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        {plain === true ? (
          <span>{definition('plausibleRange').label}</span>
        ) : (
          <GlossaryTerm term="plausibleRange" />
        )}
        <span className="tabular-nums">
          {sentence('sensitivity.rangeBounds', {
            low: formatGap(rangeLow),
            high: formatGap(rangeHigh),
          })}
        </span>
      </p>
      <p className="text-sm">
        {sentence('sensitivity.validCaseCount', { k: formatCount(validCount) })}
      </p>
    </div>
  );
}

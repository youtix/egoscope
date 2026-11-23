import { formatCount, formatShare, sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

export type CountOrShareProps = Readonly<{
  /** The cases the proportion counts, such as the cases above zero. */
  part: number;
  /** The cases it is a proportion of, its denominator. */
  whole: number;
  /** The `sensitivity.countsBelowCases` parameter in force: below it, counts replace percentages (SEN-39). */
  countsBelowCases: number;
}>;

/**
 * A proportion of cases, written as two counts when its own denominator is below
 * the `sensitivity.countsBelowCases` parameter, "5 of 7", and as a percentage
 * otherwise, "71%" (SEN-39, CL-SEN-21, H-SEN-14).
 */
export function CountOrShare({ part, whole, countsBelowCases }: CountOrShareProps): ReactNode {
  return (
    <span className="tabular-nums">
      {whole < countsBelowCases
        ? sentence('sensitivity.proportionAsCounts', {
            k: formatCount(part),
            m: formatCount(whole),
          })
        : formatShare(part, whole)}
    </span>
  );
}

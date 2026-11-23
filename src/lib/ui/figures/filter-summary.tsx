import { formatCount, sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

export type FilterSummaryProps = Readonly<{
  /** The active filter, as its label writes it: "probable". */
  filter: string;
  /** The profiles the filter keeps. */
  count: number;
  /** Every profile of the list, whatever the filter. */
  total: number;
}>;

/**
 * The active filter of a profile list and the total it is taken from, '3 "probable"
 * profiles of 41', so that no screen shows only the profiles a filter keeps (IHM-49,
 * CA-IHM-12, CL-IHM-25).
 */
export function FilterSummary({ filter, count, total }: FilterSummaryProps): ReactNode {
  return (
    <p className="font-medium">
      {sentence('interface.filterSummary', {
        k: formatCount(count),
        filter,
        total: formatCount(total),
      })}
    </p>
  );
}

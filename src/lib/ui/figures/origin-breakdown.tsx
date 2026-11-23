import { formatCount, sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

export type OriginBreakdownProps = Readonly<{
  /** The valid cases of historical events, which a backtest reported. */
  historical: number;
  /** The valid cases of tracked events, recorded before their game. */
  tracked: number;
}>;

/** The split written out, naming only the origins that hold cases. */
function breakdown(historical: number, tracked: number): string {
  const k = formatCount(historical + tracked);
  if (historical > 0 && tracked > 0) {
    return sentence('interface.bothOrigins', {
      k,
      historical: formatCount(historical),
      tracked: formatCount(tracked),
    });
  }
  if (historical > 0) {
    return sentence('interface.historicalOnly', { k });
  }
  return tracked > 0
    ? sentence('interface.trackedOnly', { k })
    : sentence('sensitivity.validCaseCount', { k });
}

/**
 * The valid cases of a summary, split by origin: "7 valid cases: 5 historical, 2
 * tracked", and "7 valid cases: 7 historical" when every case is historical (IHM-46,
 * CA-IHM-09, CL-IHM-24).
 */
export function OriginBreakdown({ historical, tracked }: OriginBreakdownProps): ReactNode {
  return <p>{breakdown(historical, tracked)}</p>;
}

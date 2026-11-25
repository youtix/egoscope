import {
  CountOrShare,
  DrillDownLink,
  FilterSummary,
  MeanGap,
  MethodNotice,
  OriginBreakdown,
  Verdict,
} from '@/lib/ui';

import type { ReactNode } from 'react';

// The default of the `sensitivity.countsBelowCases` parameter (SEN-39).
const COUNTS_BELOW_CASES = 20;

/**
 * The honest-display figures (IHM-15, IHM-45 to IHM-52), in each of their states:
 * mean gaps of opposite signs on the same case count and one that rounds to zero,
 * a verdict of each level and each profile confidence, the split by origin with
 * both origins and with one, proportions below and above the case number of SEN-39,
 * filter summaries, a gap that leads to its numbers and the short notice. As on a
 * screen, only the first mean gap and the first verdict open the definitions of
 * their labels; the others are plain (CL-IHM-26).
 */
export function FigureSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-3">
        <MeanGap meanGap={0.6} rangeLow={0.1} rangeHigh={1.1} validCount={9} />
        <MeanGap meanGap={-0.6} rangeLow={-1.1} rangeHigh={-0.1} validCount={9} plain />
        <MeanGap meanGap={0.004} rangeLow={-0.4} rangeHigh={0.4} validCount={9} plain />
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        <Verdict
          verdict={{ level: 'possible', direction: 'increase' }}
          confidence="low"
          validCount={8}
        />
        <Verdict
          verdict={{ level: 'probable', direction: 'decrease' }}
          confidence="high"
          validCount={21}
          plain
        />
        <Verdict
          verdict={{ level: 'inconclusive', direction: null }}
          confidence="medium"
          validCount={1}
          plain
        />
      </div>
      <div className="flex flex-col gap-2">
        <OriginBreakdown historical={5} tracked={2} />
        <OriginBreakdown historical={7} tracked={0} />
        <OriginBreakdown historical={0} tracked={2} />
        <OriginBreakdown historical={1} tracked={0} />
      </div>
      <div className="flex flex-col gap-2">
        <p>
          Few cases: <CountOrShare part={5} whole={7} countsBelowCases={COUNTS_BELOW_CASES} />
        </p>
        <p>
          Many cases: <CountOrShare part={15} whole={21} countsBelowCases={COUNTS_BELOW_CASES} />
        </p>
        <p>
          One case: <CountOrShare part={1} whole={1} countsBelowCases={COUNTS_BELOW_CASES} />
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <FilterSummary filter="probable" count={3} total={41} />
        <FilterSummary filter="probable" count={1} total={1} />
      </div>
      <p>
        Gap of a sample case: <DrillDownLink gap={0.8} href="/dev/ui" />
      </p>
      <MethodNotice href="/dev/ui" />
    </div>
  );
}

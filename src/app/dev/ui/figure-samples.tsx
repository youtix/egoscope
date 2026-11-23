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
 * The honest-display figures (IHM-15, IHM-45 to IHM-52): two mean gaps of opposite
 * signs on the same case count, a verdict, the split by origin, a proportion below
 * and above the case number of SEN-39, a filter summary, a gap that leads to its
 * numbers and the short notice.
 */
export function FigureSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <MeanGap meanGap={0.6} rangeLow={0.1} rangeHigh={1.1} validCount={9} />
        <MeanGap meanGap={-0.6} rangeLow={-1.1} rangeHigh={-0.1} validCount={9} />
      </div>
      <Verdict
        verdict={{ level: 'possible', direction: 'increase' }}
        confidence="low"
        validCount={8}
      />
      <OriginBreakdown historical={5} tracked={2} />
      <p>
        Few cases: <CountOrShare part={5} whole={7} countsBelowCases={COUNTS_BELOW_CASES} />
      </p>
      <p>
        Many cases: <CountOrShare part={15} whole={21} countsBelowCases={COUNTS_BELOW_CASES} />
      </p>
      <FilterSummary filter="probable" count={3} total={41} />
      <p>
        Gap of a sample case: <DrillDownLink gap={0.8} href="/dev/ui" />
      </p>
      <MethodNotice />
    </div>
  );
}

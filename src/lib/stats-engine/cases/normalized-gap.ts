// The normalized gap of a case (SEN-08, SEN-09): how far the performance index of its
// measured game lies from the player's season baseline, the measured game left out, in
// units of that baseline's standard deviation. It is never rounded, and provisional
// while its baseline is. The result of the game, his team's win or loss, is no input of
// it (VUE-03). Which cases have one is the case state's rule (case-state.ts).

/** The status of a gap (SEN-09), as it is stored. */
export type GapStatus = 'provisional' | 'final';

/**
 * A season baseline that a gap is computed against (SEN-08, STA-16 to STA-21): a final or
 * provisional one, the measured game left out, as seasonBaseline gives it, whose standard
 * deviation is above zero, since a deviation of zero makes it insufficient (CL-STA-08).
 */
export type GapBaseline = Readonly<{
  status: 'final' | 'provisional';
  mean: number;
  standardDeviation: number;
}>;

/** A normalized gap and its status (SEN-08, SEN-09), as a case stores them. */
export type NormalizedGap = Readonly<{ normalizedGap: number; gapStatus: GapStatus }>;

/**
 * The normalized gap of a measured game whose performance index is `performanceIndex`
 * (SEN-08, SEN-09, VUE-03): the index minus the mean of `baseline`, divided by its
 * standard deviation, never rounded (CL-STA-09), so that +0.5 is half his usual
 * variability above his usual level; provisional while the baseline is provisional, final
 * once it is final. Only the player's own index enters it, never his team's result.
 */
export function normalizedGap(performanceIndex: number, baseline: GapBaseline): NormalizedGap {
  return {
    normalizedGap: (performanceIndex - baseline.mean) / baseline.standardDeviation,
    gapStatus: baseline.status,
  };
}

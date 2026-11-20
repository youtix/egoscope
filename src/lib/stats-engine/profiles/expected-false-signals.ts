// The verdicts chance alone would produce (SEN-41, CL-SEN-20, ADR 0021). With no effect
// anywhere, the signal-to-noise ratio of a profile follows the standard normal law, so the
// share of evaluated pairs that pure noise carries beyond a signal-to-noise threshold t,
// either way, is 2 × (1 − Φ(t)): 4.55 % beyond the "possible" default of 2, 0.27 % beyond
// the "probable" default of 3. The thresholds in force decide; the mean-gap thresholds and
// the dispersion floor are left out, the counts being an approximation, and no verdict is
// ever corrected for them (CL-SEN-20, ADR 0021).

import type { EngineParams } from '../types';

/**
 * The verdicts chance alone would produce (SEN-41, CL-SEN-20): the evaluated pairs, the
 * player–type pairs, archived ones included, whose default-view profile reaches the
 * valid-case threshold in force; the shares of pure noise beyond the "possible" and the
 * "probable" signal-to-noise thresholds, either way; and the verdicts they give the pairs,
 * at least possible and probable. Exact, never rounded: the screens round them.
 */
export type ExpectedFalseSignals = Readonly<{
  evaluatedPairCount: number;
  atLeastPossibleShare: number;
  probableShare: number;
  atLeastPossibleCount: number;
  probableCount: number;
}>;

// The Mills ratio R(z) = (1 − Φ(z)) ÷ φ(z) at the even points z = 0, 2, … 10, φ being the
// standard normal density (Marsaglia, "Evaluating the Normal Distribution", Journal of
// Statistical Software 11(4), 2004), so that every threshold from 0 to 11 lies within 1
// of one of them.
const MILLS_RATIO_AT_0 = 1.2533141373155003;
const MILLS_RATIO_AT_2 = 0.4213692292880545;
const MILLS_RATIO_AT_4 = 0.23665238291356067;
const MILLS_RATIO_AT_6 = 0.16237766089686745;
const MILLS_RATIO_AT_8 = 0.1231319632579323;
const MILLS_RATIO_AT_10 = 0.09902859647173193;
const MILLS_RATIOS: readonly number[] = [
  MILLS_RATIO_AT_0,
  MILLS_RATIO_AT_2,
  MILLS_RATIO_AT_4,
  MILLS_RATIO_AT_6,
  MILLS_RATIO_AT_8,
  MILLS_RATIO_AT_10,
];
// The tabulated points lie 2 apart.
const POINT_SPACING = 2;
// The Taylor series of R runs to the 29th power of the offset, at most 1 in absolute value:
// its next terms fall below 1e-15 of R.
const TAYLOR_PAIRS = 14;
// The even orders 2, 4, … 28 of the series' pairs of terms.
const EVEN_ORDERS = Array.from({ length: TAYLOR_PAIRS }, (_, index) => 2 * (index + 1));
// ln √(2π), which turns e^(−t²/2) into the density φ(t).
const LOG_SQRT_TWO_PI = 0.9189385332046728;
// A share counts the noise beyond the threshold in both directions (SEN-24).
const BOTH_DIRECTIONS = 2;

/**
 * R(z + offset), the Mills ratio near the tabulated point z, from its value there: its
 * Taylor series Σ dₙ offsetⁿ, with d₀ = R(z), d₁ = z·d₀ − 1 and dₙ = (z·dₙ₋₁ + dₙ₋₂) ÷ n,
 * since R′ = z·R − 1, summed two terms at a time (Marsaglia, 2004).
 */
function millsRatioNear(point: number, millsRatio: number, offset: number): number {
  let even = millsRatio;
  let odd = point * millsRatio - 1;
  let power = 1;
  let sum = even + offset * odd;
  for (const order of EVEN_ORDERS) {
    even = (even + point * odd) / order;
    odd = (odd + point * even) / (order + 1);
    power *= offset * offset;
    sum += power * (even + offset * odd);
  }
  return sum;
}

/**
 * The upper tail 1 − Φ(t) of the standard normal law beyond a threshold t from 0 to 11,
 * as R(t) × φ(t), which keeps its relative precision far into the tail, where 1 − Φ(t)
 * would lose its digits to Φ(t)'s rounding: its relative error stays below 1e-12. Only a
 * bug can give another threshold, since the registry's run from 0.5 to 10 (CL-TRV-16).
 */
function upperTail(threshold: number): number {
  const index = Math.round(threshold / POINT_SPACING);
  const millsRatio = MILLS_RATIOS[index];
  if (millsRatio === undefined || threshold < 0) {
    throw new RangeError(
      `No normal tail for a threshold of ${String(threshold)}: it is computed from 0 to 11.`,
    );
  }
  const point = POINT_SPACING * index;
  return (
    millsRatioNear(point, millsRatio, threshold - point) *
    Math.exp(-(threshold ** 2) / 2 - LOG_SQRT_TWO_PI)
  );
}

/**
 * Computes the verdicts chance alone would produce among the evaluated pairs (SEN-41,
 * CL-SEN-20, ADR 0021): pairs × 2 × (1 − Φ(t)) at least possible, t being
 * sensitivity.possibleSignalToNoise, and probable, t being
 * sensitivity.probableSignalToNoise; at the defaults, shares of 4.55 % and 0.27 %, and
 * about 2.3 and 0.1 verdicts for 50 pairs (CA-SEN-19). The shares follow the thresholds in
 * force and keep their significant digits whatever the threshold. General trends are no
 * evaluated pairs, and only the default view counts (CL-SEN-19); the caller counts the
 * pairs.
 */
export function expectedFalseSignals(
  evaluatedPairCount: number,
  params: EngineParams,
): ExpectedFalseSignals {
  const atLeastPossibleShare =
    BOTH_DIRECTIONS * upperTail(params.sensitivity.possibleSignalToNoise);
  const probableShare = BOTH_DIRECTIONS * upperTail(params.sensitivity.probableSignalToNoise);
  return {
    evaluatedPairCount,
    atLeastPossibleShare,
    probableShare,
    atLeastPossibleCount: evaluatedPairCount * atLeastPossibleShare,
    probableCount: evaluatedPairCount * probableShare,
  };
}

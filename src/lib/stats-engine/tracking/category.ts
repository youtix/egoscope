// The category of a tracked case (SUI-22, H-SUI-05) and the counts that chance alone would
// give a set of cases with a forecast (CL-SUI-15). With no effect, a gap in the forecast
// direction behaves as a standard normal value, so its tail beyond the category threshold
// gives the expected share of confirmed cases, and as many refuted. Nothing is rounded:
// rounding is a display matter (CL-SUI-15, SEN-39).

import type { VerdictDirection } from '../profiles/verdict';
import type { EngineParams } from '../types';

/** The category of a valid tracked case (SUI-22, glossary 4.2). */
export type CaseCategory = 'confirmed' | 'refuted' | 'neutral' | 'no_forecast';

/**
 * What chance alone gives a set of cases with a forecast (SUI-24, CL-SUI-15): the expected
 * numbers of confirmed, refuted and neutral cases, unrounded.
 */
export type ChanceExpectedCounts = Readonly<{
  confirmed: number;
  refuted: number;
  neutral: number;
}>;

// The upper tail of the standard normal distribution, 1 − Φ(x) for x ≥ 0, by formula
// 26.2.17 of Abramowitz and Stegun, whose absolute error stays below 7.5 × 10⁻⁸:
// φ(x) × (b₁u + b₂u² + b₃u³ + b₄u⁴ + b₅u⁵) with u = 1 ÷ (1 + p·x).
const TAIL_P = 0.2316419;
const TAIL_B1 = 0.31938153;
const TAIL_B2 = -0.356563782;
const TAIL_B3 = 1.781477937;
const TAIL_B4 = -1.821255978;
const TAIL_B5 = 1.330274429;
const TAIL_COEFFICIENTS: readonly number[] = [TAIL_B1, TAIL_B2, TAIL_B3, TAIL_B4, TAIL_B5];
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function normalDensity(x: number): number {
  return Math.exp(-(x * x) / 2) / SQRT_TWO_PI;
}

function upperNormalTail(x: number): number {
  const u = 1 / (1 + TAIL_P * x);
  const polynomial = TAIL_COEFFICIENTS.reduceRight((sum, coefficient) => coefficient + u * sum, 0);
  return normalDensity(x) * u * polynomial;
}

/**
 * The gap in the forecast direction (SUI-22, H-04): the normalized gap for a forecast of an
 * increase, its opposite for a forecast of a decrease.
 */
export function gapInForecastDirection(normalizedGap: number, direction: VerdictDirection): number {
  return direction === 'increase' ? normalizedGap : -normalizedGap;
}

/**
 * The category of a valid tracked case (SUI-22, H-SUI-05, CA-SUI-10): without a forecast,
 * `no_forecast`; otherwise, with t = tracking.categoryThreshold, `confirmed` when the gap in
 * the forecast direction is at least +t, `refuted` when it is at most −t, `neutral` between.
 */
export function caseCategory(
  direction: VerdictDirection | null,
  normalizedGap: number,
  params: EngineParams,
): CaseCategory {
  if (direction === null) {
    return 'no_forecast';
  }
  const gap = gapInForecastDirection(normalizedGap, direction);
  const threshold = params.tracking.categoryThreshold;
  if (gap >= threshold) {
    return 'confirmed';
  }
  if (gap <= -threshold) {
    return 'refuted';
  }
  return 'neutral';
}

/**
 * The counts that chance alone gives n cases with a forecast (SUI-22, SUI-24, CL-SUI-15):
 * with t = tracking.categoryThreshold, which the registry keeps at 0 or above, and Φ the
 * standard normal distribution function, n × (1 − Φ(t)) confirmed, as many refuted and
 * n × (2Φ(t) − 1) neutral; at t = 0.25, 40.1 %, 40.1 % and 19.7 % of n. Unrounded.
 */
export function chanceExpectedCounts(
  forecastCaseCount: number,
  params: EngineParams,
): ChanceExpectedCounts {
  const tail = upperNormalTail(params.tracking.categoryThreshold);
  return {
    confirmed: forecastCaseCount * tail,
    refuted: forecastCaseCount * tail,
    neutral: forecastCaseCount * (1 - 2 * tail),
  };
}

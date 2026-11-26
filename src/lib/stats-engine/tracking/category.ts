// The category of a tracked case (SUI-22, H-SUI-05) and the counts that chance alone would
// give a set of cases with a forecast (CL-SUI-15). With no effect, a gap in the forecast
// direction behaves as a standard normal value, so its tail beyond the category threshold
// gives the expected share of confirmed cases, and as many refuted: the one upper tail of
// the core, that of the expected false signals. Nothing is rounded: rounding is a display
// matter (CL-SUI-15, SEN-39).

import { upperTail } from '../profiles/expected-false-signals';

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
  const tail = upperTail(params.tracking.categoryThreshold);
  return {
    confirmed: forecastCaseCount * tail,
    refuted: forecastCaseCount * tail,
    neutral: forecastCaseCount * (1 - 2 * tail),
  };
}

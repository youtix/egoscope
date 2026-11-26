// The summary of a set of gaps and the assessment of a set of tracked cases with a forecast
// (SUI-24, SUI-26, SUI-27, CL-SUI-07, CL-SUI-08): the mean gap in the forecast direction
// with its plausible range (SEN-22), the announced gap, and their comparison with the
// expected noise times the 'possible' signal-to-noise threshold in force. A row assessment
// is a type of its own, never mixed with a case category (glossary 4.2). Nothing is
// rounded: rounding is a display matter.

import { verdictQuantities } from '../profiles/verdict';
import { gapInForecastDirection } from './category';

import type { VerdictDirection } from '../profiles/verdict';
import type { EngineParams } from '../types';

/** The assessment of a set of tracked cases with a forecast (SUI-27, glossary 4.2). */
export type RowAssessment =
  'confirmed' | 'confirmed_weaker_than_announced' | 'refuted' | 'undecided';

/**
 * Below the minimum number of cases with a forecast, no assessment but "too few tracked
 * cases to conclude (k of 10)", k being `tooFew` (SUI-26).
 */
export type TooFewTrackedCases = Readonly<{ tooFew: number }>;

/**
 * A mean gap with its count and its plausible range, mean ± 2 × expected noise, the expected
 * noise being the larger of the sample deviation and 1, and 1 below two gaps, divided by √n
 * (SEN-22, SUI-24).
 */
export type GapSummary = Readonly<{
  meanGap: number;
  count: number;
  expectedNoise: number;
  rangeLow: number;
  rangeHigh: number;
}>;

/**
 * A valid tracked case with a forecast, as the assessment reads it: the forecast's direction
 * and announced mean gap, and the case's normalized gap (SUI-22, SUI-24).
 */
export type AssessedCase = Readonly<{
  direction: VerdictDirection;
  announcedMeanGap: number;
  normalizedGap: number;
}>;

/**
 * What a set of tracked cases with a forecast shows (SUI-24, SUI-26, SUI-27): the mean gap in
 * the forecast direction with its count and range, the announced gap, both null without a
 * case, and the assessment, or the count of cases when they are too few for one, as the
 * validation row reads them.
 */
export type CaseSetAssessment = Readonly<{
  meanGapInForecastDirection: GapSummary | null;
  announcedGap: number | null;
  assessment: RowAssessment | TooFewTrackedCases;
}>;

/**
 * The summary of a set of gaps (SEN-22, SUI-24): mean m, count n, expected noise
 * b = max(sample deviation, 1) ÷ √n, the deviation counting as 1 below two gaps, and the
 * range m ± 2b. Null without a gap. The sums run in the order of `gaps`, which the caller
 * fixes.
 */
export function gapSummary(gaps: readonly number[]): GapSummary | null {
  const quantities = verdictQuantities(gaps);
  if (quantities === null) {
    return null;
  }
  return {
    meanGap: quantities.meanGap,
    count: gaps.length,
    expectedNoise: quantities.expectedNoise,
    rangeLow: quantities.rangeLow,
    rangeHigh: quantities.rangeHigh,
  };
}

function assessmentOf(
  meanGap: GapSummary,
  announcedGap: number,
  params: EngineParams,
): RowAssessment | TooFewTrackedCases {
  if (meanGap.count < params.tracking.minTrackedCasesForAssessment) {
    return { tooFew: meanGap.count };
  }
  const margin = params.sensitivity.possibleSignalToNoise * meanGap.expectedNoise;
  const isMarginReached = meanGap.meanGap >= margin;
  const isShortOfAnnounced = announcedGap - meanGap.meanGap >= margin;
  if (isMarginReached) {
    return isShortOfAnnounced ? 'confirmed_weaker_than_announced' : 'confirmed';
  }
  return isShortOfAnnounced ? 'refuted' : 'undecided';
}

/**
 * Assesses a set of tracked cases with a forecast (SUI-24, SUI-26, SUI-27, CL-SUI-07,
 * CL-SUI-08): m the mean gap in the forecast direction, b its expected noise, a the
 * announced gap (the mean of the announced mean gaps in the forecast direction) and
 * k = sensitivity.possibleSignalToNoise in force. Below tracking.minTrackedCasesForAssessment
 * cases, no assessment but the count; otherwise `confirmed` if m ≥ k·b and a − m < k·b,
 * `confirmed_weaker_than_announced` if m ≥ k·b and a − m ≥ k·b, `refuted` if m < k·b and
 * a − m ≥ k·b, `undecided` otherwise. The numbers and the range come in every case, and are
 * null without a case, whose count is then 0. The sums run in the order of `cases`, which
 * the caller fixes.
 */
export function assessCases(
  cases: readonly AssessedCase[],
  params: EngineParams,
): CaseSetAssessment {
  const meanGapInForecastDirection = gapSummary(
    cases.map((item) => gapInForecastDirection(item.normalizedGap, item.direction)),
  );
  if (meanGapInForecastDirection === null) {
    return {
      meanGapInForecastDirection: null,
      announcedGap: null,
      assessment: { tooFew: cases.length },
    };
  }
  const announcedSum = cases.reduce(
    (sum, item) => sum + gapInForecastDirection(item.announcedMeanGap, item.direction),
    0,
  );
  const announcedGap = announcedSum / cases.length;
  return {
    meanGapInForecastDirection,
    announcedGap,
    assessment: assessmentOf(meanGapInForecastDirection, announcedGap, params),
  };
}

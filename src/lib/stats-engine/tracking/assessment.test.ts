import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { assessCases, gapSummary } from './assessment';

import type { VerdictDirection } from '../profiles/verdict';
import type { EngineParams } from '../types';
import type { AssessedCase, GapSummary, RowAssessment } from './assessment';

// The registry's defaults. JSON gives the baseline phase as a string, which the comparison
// narrows to a BaselinePhase (types.test.ts).
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};
const MINIMUM = DEFAULTS.tracking.minTrackedCasesForAssessment;
// Sixteen equal gaps have no deviation, so the expected noise is 1 ÷ √16 = 0.25 and, with
// the default 'possible' signal-to-noise threshold of 2, the margin k·b is exactly 0.5.
const EQUAL_GAP_CASES = 16;
const DIGITS = 9;
// Enough digits to tell a value from its rounding to any number of decimals up to 11.
const UNROUNDED_DIGITS = 12;
// A billionth below a bound, which a rounding to 8 decimals or fewer would carry onto it.
const JUST_BELOW = 1e-9;
// What a property reads when a summary is missing, which its first assertion already refuses.
const NO_SUMMARY: GapSummary = {
  meanGap: 0,
  count: 0,
  expectedNoise: 0,
  rangeLow: 0,
  rangeHigh: 0,
};

function withParams(
  possibleSignalToNoise: number,
  minTrackedCasesForAssessment: number,
): EngineParams {
  return {
    ...DEFAULTS,
    sensitivity: { ...DEFAULTS.sensitivity, possibleSignalToNoise },
    tracking: { ...DEFAULTS.tracking, minTrackedCasesForAssessment },
  };
}

// Cases of a forecast of an increase, all with the same gap and the same announced gap.
function equalCases(count: number, gap: number, announcedGap: number): AssessedCase[] {
  return Array.from({ length: count }, (): AssessedCase => ({
    direction: 'increase',
    normalizedGap: gap,
    announcedMeanGap: announcedGap,
  }));
}

// The same cases under a forecast of a decrease: every gap in the forecast direction stays.
function asDecrease(cases: readonly AssessedCase[]): AssessedCase[] {
  return cases.map((item): AssessedCase => ({
    direction: 'decrease',
    normalizedGap: -item.normalizedGap,
    announcedMeanGap: -item.announcedMeanGap,
  }));
}

// Sixteen equal cases of a forecast of a decrease, the gaps given in its direction.
function decreaseCases(gap: number, announcedGap: number): AssessedCase[] {
  return asDecrease(equalCases(EQUAL_GAP_CASES, gap, announcedGap));
}

// The rule of SUI-27, written apart from the code under test.
function expectedAssessment(meanGap: number, announcedGap: number, margin: number): RowAssessment {
  const isShortOfAnnounced = announcedGap - meanGap >= margin;
  if (meanGap >= margin) {
    return isShortOfAnnounced ? 'confirmed_weaker_than_announced' : 'confirmed';
  }
  return isShortOfAnnounced ? 'refuted' : 'undecided';
}

function assessmentOf(cases: readonly AssessedCase[], params: EngineParams = DEFAULTS) {
  return assessCases(cases, params).assessment;
}

describe('gapSummary', () => {
  it('[SUI-24] gives the mean, the count and the range of two standard deviations of the mean', () => {
    const summary = gapSummary([-2, 0, 2, 4]);
    const deviation = Math.sqrt(20 / 3);
    expect(summary?.meanGap).toBe(1);
    expect(summary?.count).toBe(4);
    expect(summary?.expectedNoise).toBeCloseTo(deviation / 2, DIGITS);
    expect(summary?.rangeLow).toBeCloseTo(1 - deviation, DIGITS);
    expect(summary?.rangeHigh).toBeCloseTo(1 + deviation, DIGITS);
  });

  it('[SUI-24] floors the deviation at 1, and counts it as 1 for a single gap', () => {
    const pair = gapSummary([0.3, 0.9]);
    expect(pair?.meanGap).toBeCloseTo(0.6, DIGITS);
    expect(pair?.expectedNoise).toBeCloseTo(1 / Math.SQRT2, DIGITS);
    expect(pair?.rangeLow).toBeCloseTo(0.6 - Math.SQRT2, DIGITS);
    expect(gapSummary([0.4])).toStrictEqual({
      meanGap: 0.4,
      count: 1,
      expectedNoise: 1,
      rangeLow: 0.4 - 2,
      rangeHigh: 0.4 + 2,
    });
  });

  it('[SUI-24] gives no summary without a gap', () => {
    expect(gapSummary([])).toBeNull();
  });
});

describe('assessCases', () => {
  it('[SUI-26] gives no assessment below 10 cases with a forecast, but the count, the numbers and the range', () => {
    expect(MINIMUM).toBe(10);
    const result = assessCases(equalCases(MINIMUM - 1, 2, 2), DEFAULTS);
    expect(result).toStrictEqual({
      meanGapInForecastDirection: {
        meanGap: 2,
        count: 9,
        expectedNoise: 1 / 3,
        rangeLow: 2 - 2 / 3,
        rangeHigh: 2 + 2 / 3,
      },
      announcedGap: 2,
      assessment: { tooFew: 9 },
    });
    expect(assessmentOf(equalCases(MINIMUM, 2, 2))).toBe('confirmed');
  });

  it('[SUI-24] [SUI-26] gives no numbers and a count of 0 without a case with a forecast', () => {
    expect(assessCases([], DEFAULTS)).toStrictEqual({
      meanGapInForecastDirection: null,
      announcedGap: null,
      assessment: { tooFew: 0 },
    });
  });

  it('[SUI-26] [CL-SUI-08] follows the minimum in force', () => {
    expect(assessmentOf(equalCases(4, 2, 2), withParams(2, 5))).toStrictEqual({ tooFew: 4 });
    expect(assessmentOf(equalCases(5, 2, 2), withParams(2, 5))).toBe('confirmed');
  });

  it('[SUI-27] confirms a mean gap that reaches twice the expected noise exactly, the announced gap less than that above it', () => {
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.5, 0.99))).toBe('confirmed');
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.5, 0.5))).toBe('confirmed');
    expect(assessmentOf(decreaseCases(0.5, 0.99))).toBe('confirmed');
  });

  it('[SUI-27] confirms with a weaker effect when the announced gap exceeds the mean gap by twice the noise or more', () => {
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.5, 1))).toBe(
      'confirmed_weaker_than_announced',
    );
    expect(assessmentOf(decreaseCases(0.5, 1))).toBe('confirmed_weaker_than_announced');
  });

  it('[SUI-27] refutes a mean gap under twice the noise whose announced gap exceeds it by twice the noise or more', () => {
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.25, 0.75))).toBe('refuted');
    expect(assessmentOf(decreaseCases(-0.5, 0.25))).toBe('refuted');
  });

  it('[SUI-27] leaves undecided a mean gap under twice the noise close to the announced gap', () => {
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.25, 0.74))).toBe('undecided');
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.49, 0.5))).toBe('undecided');
  });

  it('[SUI-27] [CL-SUI-07] takes the factor from the possible signal-to-noise threshold in force', () => {
    // With k = 3 the margin is 0.75: a mean gap of 0.5 no longer reaches it.
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.5, 1), withParams(3, MINIMUM))).toBe(
      'undecided',
    );
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.75, 0.75), withParams(3, MINIMUM))).toBe(
      'confirmed',
    );
    // With k = 1.5 the margin is 0.375, below the default one, which a mean gap of 0.375 reaches.
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.375, 0.375), withParams(1.5, MINIMUM))).toBe(
      'confirmed',
    );
    expect(assessmentOf(equalCases(EQUAL_GAP_CASES, 0.37, 0.37), withParams(1.5, MINIMUM))).toBe(
      'undecided',
    );
  });

  it('[SUI-24] [SUI-27] takes each gap and each announced gap in its own forecast direction', () => {
    const cases: AssessedCase[] = [...equalCases(5, 1, 3), ...asDecrease(equalCases(5, 0.5, 2))];
    const result = assessCases(cases, DEFAULTS);
    expect(result.meanGapInForecastDirection?.meanGap).toBe(0.75);
    expect(result.announcedGap).toBe(2.5);
    expect(result.meanGapInForecastDirection?.count).toBe(10);
  });

  it('[SUI-24] [SUI-27] keeps the mean gap and the announced gap unrounded', () => {
    const cases: AssessedCase[] = [
      { direction: 'increase', normalizedGap: 1 / 3, announcedMeanGap: 0.123456789 },
      { direction: 'decrease', normalizedGap: -1 / 7, announcedMeanGap: -2 / 3 },
    ];
    const result = assessCases(cases, DEFAULTS);
    expect(result.meanGapInForecastDirection?.meanGap).toBeCloseTo(5 / 21, UNROUNDED_DIGITS);
    expect(result.announcedGap).toBeCloseTo((0.123456789 + 2 / 3) / 2, UNROUNDED_DIGITS);
  });

  it('[SUI-27] compares the unrounded mean gap with the margin', () => {
    // A billionth short of the margin of 0.5 stays short of it, the announced gap close by.
    const result = assessCases(equalCases(EQUAL_GAP_CASES, 0.5 - JUST_BELOW, 0.5), DEFAULTS);
    expect(result.meanGapInForecastDirection?.meanGap).toBeCloseTo(
      0.5 - JUST_BELOW,
      UNROUNDED_DIGITS,
    );
    expect(result.assessment).toBe('undecided');
  });

  it('[SUI-27] compares the unrounded announced gap with the mean gap and the margin', () => {
    // An announced gap a billionth short of m + k·b = 1 leaves the effect as announced.
    const result = assessCases(equalCases(EQUAL_GAP_CASES, 0.5, 1 - JUST_BELOW), DEFAULTS);
    expect(result.announcedGap).toBeCloseTo(1 - JUST_BELOW, UNROUNDED_DIGITS);
    expect(result.assessment).toBe('confirmed');
  });

  it('[SUI-27] applies the rule to any set of cases from the minimum on', () => {
    const assessed = fc.record({
      direction: fc.constantFrom<VerdictDirection>('increase', 'decrease'),
      normalizedGap: fc.double({ min: -3, max: 3, noNaN: true }),
      announcedMeanGap: fc.double({ min: -3, max: 3, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(assessed, { minLength: MINIMUM, maxLength: 40, size: 'max' }),
        (cases) => {
          const { meanGapInForecastDirection, announcedGap, assessment } = assessCases(
            cases,
            DEFAULTS,
          );
          expect(meanGapInForecastDirection).not.toBeNull();
          expect(announcedGap).not.toBeNull();
          const summary = meanGapInForecastDirection ?? NO_SUMMARY;
          const margin = DEFAULTS.sensitivity.possibleSignalToNoise * summary.expectedNoise;
          expect(assessment).toBe(expectedAssessment(summary.meanGap, announcedGap ?? NaN, margin));
        },
      ),
    );
  });
});

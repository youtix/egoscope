import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { caseCategory, chanceExpectedCounts, gapInForecastDirection } from './category';

import type { VerdictDirection } from '../profiles/verdict';
import type { EngineParams } from '../types';
import type { CaseCategory } from './category';

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
const THRESHOLD = DEFAULTS.tracking.categoryThreshold;
// Φ(t) to sixteen digits, from a reference table of the standard normal distribution.
const PHI_REFERENCE = [
  [0, 0.5],
  [0.25, 0.5987063256829237],
  [0.5, 0.6914624612740131],
  [1, 0.8413447460685429],
  [1.5, 0.9331927987311419],
  [2, 0.9772498680518208],
  [3, 0.9986501019683699],
  [5, 0.9999997133484281],
] as const;
// toBeCloseTo(value, 6) accepts a difference below 5 × 10⁻⁷, within the brief's 10⁻⁶.
const PHI_DIGITS = 6;
// The gaps that the forecast direction only turns around are equal to the last bit.
const EXACT_DIGITS = 12;
// The registry's range of tracking.categoryThreshold.
const MAX_THRESHOLD = 5;

function withThreshold(categoryThreshold: number): EngineParams {
  return { ...DEFAULTS, tracking: { ...DEFAULTS.tracking, categoryThreshold } };
}

// The rule of SUI-22, written apart from the code under test.
function expectedCategory(directed: number, categoryThreshold: number): CaseCategory {
  if (directed >= categoryThreshold) {
    return 'confirmed';
  }
  return directed <= -categoryThreshold ? 'refuted' : 'neutral';
}

const direction = fc.constantFrom<VerdictDirection>('increase', 'decrease');
const gap = fc.double({ min: -10, max: 10, noNaN: true });
const threshold = fc.double({ min: 0, max: MAX_THRESHOLD, noNaN: true });

describe('gapInForecastDirection', () => {
  it('[SUI-22] keeps the gap for an increase and takes its opposite for a decrease', () => {
    expect(gapInForecastDirection(0.4, 'increase')).toBeCloseTo(0.4, EXACT_DIGITS);
    expect(gapInForecastDirection(-0.4, 'decrease')).toBeCloseTo(0.4, EXACT_DIGITS);
    expect(gapInForecastDirection(0.1, 'decrease')).toBeCloseTo(-0.1, EXACT_DIGITS);
  });
});

describe('caseCategory', () => {
  it('[CA-SUI-10] confirms -0.40 against a decrease, finds +0.10 neutral and -0.30 against an increase refuted', () => {
    expect(gapInForecastDirection(-0.4, 'decrease')).toBeCloseTo(0.4, EXACT_DIGITS);
    expect(caseCategory('decrease', -0.4, DEFAULTS)).toBe('confirmed');
    expect(caseCategory('decrease', 0.1, DEFAULTS)).toBe('neutral');
    expect(caseCategory('increase', -0.3, DEFAULTS)).toBe('refuted');
  });

  it('[SUI-22] uses a default category threshold of 0.25', () => {
    expect(THRESHOLD).toBeCloseTo(0.25, EXACT_DIGITS);
  });

  it.each([
    ['increase', 0.25, 'confirmed'],
    ['decrease', -0.25, 'confirmed'],
    ['increase', -0.25, 'refuted'],
    ['decrease', 0.25, 'refuted'],
    ['increase', 0.24, 'neutral'],
    ['increase', -0.24, 'neutral'],
    ['decrease', 0, 'neutral'],
  ] as const)(
    '[SUI-22] with a forecast %s, classes a gap of %s as %s, the bounds included',
    (forecast, normalizedGap, category) => {
      expect(caseCategory(forecast, normalizedGap, DEFAULTS)).toBe(category);
    },
  );

  it('[SUI-22] classes a valid case without a forecast as no forecast, whatever its gap', () => {
    fc.assert(
      fc.property(gap, (normalizedGap) => {
        expect(caseCategory(null, normalizedGap, DEFAULTS)).toBe('no_forecast');
      }),
    );
  });

  it('[SUI-22] follows the category threshold in force for any gap and either direction', () => {
    fc.assert(
      fc.property(direction, gap, threshold, (forecast, normalizedGap, categoryThreshold) => {
        const directed = forecast === 'increase' ? normalizedGap : -normalizedGap;
        expect(caseCategory(forecast, normalizedGap, withThreshold(categoryThreshold))).toBe(
          expectedCategory(directed, categoryThreshold),
        );
      }),
    );
  });
});

describe('chanceExpectedCounts', () => {
  it('[SUI-22] [CL-SUI-15] expects 40.1 %, 40.1 % and 19.7 % of the cases at the default threshold', () => {
    const counts = chanceExpectedCounts(1000, DEFAULTS);
    expect(counts.confirmed).toBeCloseTo(401.2936743170763, 3);
    expect(counts.refuted).toBe(counts.confirmed);
    expect(counts.neutral).toBeCloseTo(197.4126513658474, 3);
  });

  it('[CL-SUI-15] gives each count unrounded for a small set of cases', () => {
    const counts = chanceExpectedCounts(7, DEFAULTS);
    expect(counts.confirmed).toBeCloseTo(7 * (1 - 0.5987063256829237), PHI_DIGITS);
    expect(counts.neutral).toBeCloseTo(7 * (2 * 0.5987063256829237 - 1), PHI_DIGITS);
    expect(chanceExpectedCounts(0, DEFAULTS)).toStrictEqual({
      confirmed: 0,
      refuted: 0,
      neutral: 0,
    });
  });

  it.each(PHI_REFERENCE)(
    '[CL-SUI-15] computes the distribution function to 1e-6 at a threshold of %s',
    (categoryThreshold, phi) => {
      const counts = chanceExpectedCounts(1, withThreshold(categoryThreshold));
      expect(counts.confirmed).toBeCloseTo(1 - phi, PHI_DIGITS);
      expect(counts.refuted).toBeCloseTo(1 - phi, PHI_DIGITS);
      expect(counts.neutral).toBeCloseTo(2 * phi - 1, PHI_DIGITS);
    },
  );

  it('[CL-SUI-15] splits every set of cases into as many confirmed as refuted and counts that add up to it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), threshold, (cases, categoryThreshold) => {
        const counts = chanceExpectedCounts(cases, withThreshold(categoryThreshold));
        expect(counts.refuted).toBe(counts.confirmed);
        expect(counts.confirmed + counts.refuted + counts.neutral).toBeCloseTo(cases, PHI_DIGITS);
      }),
    );
  });
});

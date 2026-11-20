import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { expectedFalseSignals } from './expected-false-signals';

import type { EngineParams } from '../types';

// The registry's defaults.
const DEFAULTS: EngineParams = {
  games: {
    minutesFloor: 15,
    minutesAverageShare: 50,
    minBaselineGames: 10,
    postseasonBaseline: 'postseason',
    partialBaselineShare: 20,
    dailyUpdateDelayHours: 3,
    correctionWindowDays: 7,
    boxScoreUnavailableAfterDays: 30,
    retryFirstDelayHours: 1,
    retryIntervalHours: 4,
    incidentAfterHours: 12,
    quotaReserveShare: 10,
  },
  sensitivity: {
    maxAttachmentDays: 10,
    coOccurringCasesDoubtful: false,
    injuryReturnMinGamesMissed: 4,
    injuryReturnFirstGames: 2,
    allPlayoffGamesUnusualStakes: false,
    opponentWinShareLow: 25,
    opponentWinShareHigh: 75,
    opponentMinGames: 10,
    minValidCases: 5,
    possibleSignalToNoise: 2,
    possibleMeanGap: 0.25,
    probableSignalToNoise: 3,
    probableMeanGap: 0.4,
    confidenceMediumFromCases: 8,
    confidenceHighFromCases: 15,
    confidenceDispersionDrop: 1.5,
    confidenceDoubtfulShareDrop: 30,
    trendMinPlayers: 3,
    trendMaxTopShare: 50,
    countsBelowCases: 20,
  },
  tracking: { categoryThreshold: 0.25, minTrackedCasesForAssessment: 10 },
};

// Φ(t), and the share 2 × (1 − Φ(t)) of pure noise beyond t either way, rounded to the
// nearest double from a 120-digit evaluation of the series
// Φ(t) = 1/2 + φ(t) × (t + t³/3 + t⁵/(3·5) + …).
const PHI: readonly (readonly [number, number])[] = [
  [0, 0.5],
  [1, 0.8413447460685429],
  [1.96, 0.9750021048517795],
  [2, 0.9772498680518208],
  [3, 0.9986501019683699],
];
// Thresholds around each tabulated point of the computation, 0, 2, 4, 6, 8 and 10, up to
// 1 away from it, through the registry's bounds of 0.5 and 10 and beyond.
const SHARES: readonly (readonly [number, number])[] = [
  [0.5, 0.6170750774519738],
  [1, 0.3173105078629141],
  [1.96, 0.04999579029644087],
  [2, 0.04550026389635842],
  [2.5, 0.01241933065155227],
  [3, 0.002699796063260189],
  [4, 6.334248366623985e-5],
  [4.5, 6.7953462494601205e-6],
  [5.5, 3.7979124931775436e-8],
  [7.5, 6.381783345821793e-14],
  [8.5, 1.8959069644406635e-17],
  [9.5, 2.0989030150725216e-21],
  [10, 1.523970604832105e-23],
  [10.99, 4.269260958084101e-28],
];
const DEFAULT_SHARES = { atLeastPossible: 0.04550026389635842, probable: 0.002699796063260189 };
// A share keeps its digits, the relative error staying below 1e-12, whatever the threshold.
const RELATIVE_PRECISION = 1e-12;

/** The registry's defaults with other signal-to-noise thresholds of SEN-23. */
function withThresholds(possibleSignalToNoise: number, probableSignalToNoise = 3): EngineParams {
  return {
    ...DEFAULTS,
    sensitivity: { ...DEFAULTS.sensitivity, possibleSignalToNoise, probableSignalToNoise },
  };
}

/** How far `actual` lies from `expected`, relative to it. */
function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / expected;
}

describe('expectedFalseSignals', () => {
  it('[SEN-41] [CL-SEN-20] takes shares of 4.55 % and 0.27 % at the default thresholds of 2 and 3, exact', () => {
    const signals = expectedFalseSignals(1, DEFAULTS);

    expect(signals.atLeastPossibleShare * 100).toBeCloseTo(4.55, 2);
    expect(signals.probableShare * 100).toBeCloseTo(0.27, 2);
    expect(
      relativeError(signals.atLeastPossibleShare, DEFAULT_SHARES.atLeastPossible),
    ).toBeLessThan(RELATIVE_PRECISION);
    expect(relativeError(signals.probableShare, DEFAULT_SHARES.probable)).toBeLessThan(
      RELATIVE_PRECISION,
    );
  });

  it('[SEN-41] [CL-SEN-20] gives 50 evaluated pairs 2.275 verdicts at least possible and 0.135 probable', () => {
    const signals = expectedFalseSignals(50, DEFAULTS);

    expect(signals.evaluatedPairCount).toBe(50);
    expect(signals.atLeastPossibleCount).toBeCloseTo(2.275, 3);
    expect(signals.probableCount).toBeCloseTo(0.135, 3);
  });

  it('[CA-SEN-19] [SEN-41] [CL-SEN-20] expects about 2.3 verdicts at least possible and 0.1 probable among 50 evaluated pairs, at one decimal', () => {
    const signals = expectedFalseSignals(50, DEFAULTS);

    expect(signals.atLeastPossibleCount).toBeCloseTo(2.3, 1);
    expect(signals.probableCount).toBeCloseTo(0.1, 1);
  });

  it.each(PHI)(
    '[SEN-41] [CL-SEN-20] computes Φ to 1e-9 at %s: the share beyond it is 2 × (1 − Φ)',
    (threshold, phi) => {
      const { atLeastPossibleShare } = expectedFalseSignals(1, withThresholds(threshold));

      expect(Math.abs(1 - atLeastPossibleShare / 2 - phi)).toBeLessThan(1e-9);
    },
  );

  it.each(SHARES)(
    '[SEN-41] [CL-SEN-20] keeps every significant digit of the share beyond %s, whatever the threshold',
    (threshold, share) => {
      const signals = expectedFalseSignals(1, withThresholds(threshold, threshold));

      expect(relativeError(signals.atLeastPossibleShare, share)).toBeLessThan(RELATIVE_PRECISION);
      expect(relativeError(signals.probableShare, share)).toBeLessThan(RELATIVE_PRECISION);
    },
  );

  it('[SEN-41] follows a change of the thresholds, as ADR 0021 asks: 2.5 and 4 give 1.24 % and 0.0063 %', () => {
    const signals = expectedFalseSignals(200, withThresholds(2.5, 4));

    expect(signals.atLeastPossibleShare * 100).toBeCloseTo(1.24, 2);
    expect(signals.probableShare * 100).toBeCloseTo(0.0063, 4);
    expect(signals.atLeastPossibleCount).toBeCloseTo(2.484, 3);
    expect(signals.probableCount).toBeCloseTo(0.0127, 4);
  });

  it('[SEN-41] [CL-SEN-20] leaves the mean-gap thresholds out of the count', () => {
    const otherMeanGaps: EngineParams = {
      ...DEFAULTS,
      sensitivity: { ...DEFAULTS.sensitivity, possibleMeanGap: 0.6, probableMeanGap: 1.2 },
    };

    expect(expectedFalseSignals(50, otherMeanGaps)).toStrictEqual(
      expectedFalseSignals(50, DEFAULTS),
    );
  });

  it('[SEN-41] expects no verdict without an evaluated pair', () => {
    expect(expectedFalseSignals(0, DEFAULTS)).toMatchObject({
      evaluatedPairCount: 0,
      atLeastPossibleCount: 0,
      probableCount: 0,
    });
  });

  it('[SEN-41] multiplies the evaluated pairs by each share', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000 }), (pairs) => {
        const signals = expectedFalseSignals(pairs, DEFAULTS);

        expect(signals.atLeastPossibleCount).toBe(pairs * signals.atLeastPossibleShare);
        expect(signals.probableCount).toBe(pairs * signals.probableShare);
      }),
    );
  });

  it.each([-0.5, 11, NaN])(
    '[SEN-41] refuses a threshold of %s, outside 0 to 11, which only a bug can give',
    (threshold) => {
      expect(() => expectedFalseSignals(1, withThresholds(threshold))).toThrow(
        new RangeError(
          `No normal tail for a threshold of ${String(threshold)}: it is computed from 0 to 11.`,
        ),
      );
    },
  );
});

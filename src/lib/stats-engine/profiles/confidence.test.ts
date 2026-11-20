import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { doubtfulShare, profileConfidence } from './confidence';
import { runRobustnessTest } from './robustness';
import { tallyProfile } from './tally';
import { profileVerdict } from './verdict';

import type { EngineParams } from '../types';
import type {
  ConfidenceInputs,
  ConfidenceStepDownReason,
  ConfidenceValues,
  ProfileConfidence,
} from './confidence';
import type { ProfileCase } from './tally';

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

// Raw values are compared to 1e-9, the worked example's at their printed precision
// (CL-STA-09, CL-SEN-24).
const PRECISION = 9;
const DAY_MS = 86_400_000;
const ALL_REASONS: ConfidenceStepDownReason[] = [
  'high_dispersion',
  'high_doubtful_share',
  'fragile_verdict',
];
// The levels from low up, for the property test's own count of the steps.
const LEVELS: readonly ProfileConfidence[] = ['low', 'medium', 'high'];

/** The registry's defaults with other thresholds of SEN-25. */
function withThresholds(thresholds: Partial<EngineParams['sensitivity']>): EngineParams {
  return { ...DEFAULTS, sensitivity: { ...DEFAULTS.sensitivity, ...thresholds } };
}

/** Ten valid cases that agree, none excluded, and a verdict that holds: no sign of a weak base. */
function base(changes: Partial<ConfidenceInputs> = {}): ConfidenceInputs {
  return { validCount: 10, excludedCount: 0, gapDispersion: 1, isFragile: false, ...changes };
}

/** A base whose three signs of weakness all hold. */
function weakBase(validCount: number): ConfidenceInputs {
  return { validCount, excludedCount: validCount, gapDispersion: 2, isFragile: true };
}

/** A profile confidence and its reasons. */
function confidence(
  level: ProfileConfidence,
  reasons: readonly ConfidenceStepDownReason[] = [],
): ConfidenceValues {
  return { profileConfidence: level, confidenceStepDownReasons: reasons };
}

/** A valid case whose measured game starts on day `caseId`. */
function valid(
  caseId: number,
  normalizedGap: number,
): Extract<ProfileCase, { status: 'measured' }> {
  return {
    caseId,
    events: [{ researchConfidence: 'high' }],
    isCoOccurring: false,
    status: 'measured',
    measuredGameScheduledStartAt: caseId * DAY_MS,
    normalizedGap,
    gapStatus: 'final',
  };
}

// The 08 worked example, cases C1 to C11 in the order of their games, with the gaps it
// prints (CL-SEN-24): C4 and C9 are excluded, for playing time and unusual stakes, and
// C6 is not measurable.
const WORKED_EXAMPLE_CASES: ProfileCase[] = [
  valid(1, 1.16),
  valid(2, -0.43),
  valid(3, 0.95),
  { ...valid(4, -1.9), status: 'excluded', triggeredCriteria: ['playing_time_too_low'] },
  valid(5, 0.55),
  {
    caseId: 6,
    events: [{ researchConfidence: 'high' }],
    isCoOccurring: false,
    status: 'not_measurable',
    statusReason: 'no_game_within_window',
  },
  valid(7, 1.81),
  valid(8, -0.2),
  { ...valid(9, 0.63), status: 'excluded', triggeredCriteria: ['unusual_stakes'] },
  valid(10, 1.13),
  valid(11, 1.43),
];

/** The same cases with gaps of the opposite sign. */
function mirrored(cases: readonly ProfileCase[]): ProfileCase[] {
  return cases.map((caseItem) =>
    'normalizedGap' in caseItem
      ? { ...caseItem, normalizedGap: -caseItem.normalizedGap }
      : caseItem,
  );
}

/** What a profile shows from its cases: its verdict values, its fragility and its confidence. */
function evaluated(cases: readonly ProfileCase[]) {
  const { quantities, verdict } = profileVerdict(cases, DEFAULTS);
  const { validCount, excludedCount } = tallyProfile(cases, []);
  const { isFragile } = runRobustnessTest(cases, verdict, DEFAULTS);
  const gapDispersion = quantities?.gapDispersion ?? null;
  return {
    quantities,
    verdict,
    isFragile,
    confidence: profileConfidence(
      { validCount, excludedCount, gapDispersion, isFragile },
      DEFAULTS,
    ),
  };
}

// Inputs within the registry's bounds (CL-TRV-16): valid and excluded counts, a gap
// dispersion or none, a fragility, and the four thresholds of SEN-25, high above medium.
const anyInputs = fc.record({
  validCount: fc.nat({ max: 40 }),
  excludedCount: fc.nat({ max: 40 }),
  gapDispersion: fc.option(fc.double({ min: 0, max: 4, noNaN: true }), { nil: null }),
  isFragile: fc.boolean(),
});
const anyThresholds = fc
  .record({
    confidenceMediumFromCases: fc.integer({ min: 1, max: 30 }),
    above: fc.integer({ min: 1, max: 30 }),
    confidenceDispersionDrop: fc.integer({ min: 1, max: 40 }).map((tenths) => tenths / 10),
    confidenceDoubtfulShareDrop: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ above, ...thresholds }) => ({
    ...thresholds,
    confidenceHighFromCases: thresholds.confidenceMediumFromCases + above,
  }));

/**
 * SEN-25 counted another way, for the property test: levels as ranks from low up, and the
 * doubtful-case share compared across its division, on whole numbers.
 */
function countedByHand(
  { validCount, excludedCount, gapDispersion, isFragile }: ConfidenceInputs,
  thresholds: Pick<
    EngineParams['sensitivity'],
    | 'confidenceMediumFromCases'
    | 'confidenceHighFromCases'
    | 'confidenceDispersionDrop'
    | 'confidenceDoubtfulShareDrop'
  >,
): ConfidenceValues {
  const signs: [ConfidenceStepDownReason, boolean][] = [
    [
      'high_dispersion',
      gapDispersion !== null && gapDispersion > thresholds.confidenceDispersionDrop,
    ],
    [
      'high_doubtful_share',
      excludedCount * 100 > thresholds.confidenceDoubtfulShareDrop * (validCount + excludedCount),
    ],
    ['fragile_verdict', isFragile],
  ];
  const reasons = signs.filter(([, holds]) => holds).map(([reason]) => reason);
  const startingRank =
    Number(validCount >= thresholds.confidenceMediumFromCases) +
    Number(validCount >= thresholds.confidenceHighFromCases);
  return confidence(LEVELS[Math.max(0, startingRank - reasons.length)] ?? 'low', reasons);
}

describe('doubtfulShare', () => {
  it('[SEN-25] [CA-SEN-14] gives 4 excluded cases beside 6 valid ones a share of 40 %', () => {
    expect(doubtfulShare(6, 4)).toBeCloseTo(0.4, PRECISION);
  });

  it('[SEN-25] divides the excluded cases by the valid and excluded cases together', () => {
    // The worked example's 2 excluded cases beside 8 valid ones: 20 %.
    expect(doubtfulShare(8, 2)).toBeCloseTo(0.2, PRECISION);
    expect(doubtfulShare(0, 3)).toBe(1);
    expect(doubtfulShare(5, 0)).toBe(0);
  });

  it('[SEN-25] [CL-SEN-15] gives no share without a valid or an excluded case', () => {
    expect(doubtfulShare(0, 0)).toBeNull();
  });
});

describe('profileConfidence', () => {
  it.each([
    [1, 'low'],
    [7, 'low'],
    [8, 'medium'],
    [14, 'medium'],
    [15, 'high'],
    [40, 'high'],
  ] as const)('[SEN-25] starts %i valid cases at %s, with no reason', (validCount, level) => {
    expect(profileConfidence(base({ validCount }), DEFAULTS)).toStrictEqual(confidence(level));
  });

  it('[SEN-25] takes the valid-case counts of its starting levels from the parameters', () => {
    const params = withThresholds({ confidenceMediumFromCases: 3, confidenceHighFromCases: 6 });

    expect(profileConfidence(base({ validCount: 2 }), params)).toStrictEqual(confidence('low'));
    expect(profileConfidence(base({ validCount: 3 }), params)).toStrictEqual(confidence('medium'));
    expect(profileConfidence(base({ validCount: 5 }), params)).toStrictEqual(confidence('medium'));
    expect(profileConfidence(base({ validCount: 6 }), params)).toStrictEqual(confidence('high'));
  });

  it('[SEN-25] steps down a level for a gap dispersion above 1.5, not for one of exactly 1.5', () => {
    // Three gaps of −1.5, 0 and +1.5 have a dispersion of exactly 1.5.
    const justAbove = 1.5 + Number.EPSILON;

    expect(profileConfidence(base({ gapDispersion: 1.5 }), DEFAULTS)).toStrictEqual(
      confidence('medium'),
    );
    expect(profileConfidence(base({ gapDispersion: justAbove }), DEFAULTS)).toStrictEqual(
      confidence('low', ['high_dispersion']),
    );
  });

  it('[SEN-25] compares the gap dispersion with sensitivity.confidenceDispersionDrop', () => {
    const params = withThresholds({ confidenceDispersionDrop: 2 });

    expect(profileConfidence(base({ gapDispersion: 1.9 }), params)).toStrictEqual(
      confidence('medium'),
    );
    expect(profileConfidence(base({ gapDispersion: 2.1 }), params)).toStrictEqual(
      confidence('low', ['high_dispersion']),
    );
  });

  it('[SEN-25] [CL-SEN-15] takes no dispersion step without a dispersion, below two valid cases', () => {
    const params = withThresholds({ confidenceMediumFromCases: 1 });

    expect(profileConfidence(base({ validCount: 1, gapDispersion: null }), params)).toStrictEqual(
      confidence('medium'),
    );
  });

  it('[SEN-25] steps down a level for a doubtful-case share above 30 %, not for one of exactly 30 %', () => {
    // 6 of 20 cases excluded is exactly 30 %, 7 of 21 a third.
    expect(profileConfidence(base({ validCount: 14, excludedCount: 6 }), DEFAULTS)).toStrictEqual(
      confidence('medium'),
    );
    expect(profileConfidence(base({ validCount: 14, excludedCount: 7 }), DEFAULTS)).toStrictEqual(
      confidence('low', ['high_doubtful_share']),
    );
  });

  it('[SEN-25] compares the doubtful-case share with sensitivity.confidenceDoubtfulShareDrop, in percent', () => {
    const atForty = base({ validCount: 12, excludedCount: 8 });

    expect(
      profileConfidence(atForty, withThresholds({ confidenceDoubtfulShareDrop: 40 })),
    ).toStrictEqual(confidence('medium'));
    expect(
      profileConfidence(atForty, withThresholds({ confidenceDoubtfulShareDrop: 39 })),
    ).toStrictEqual(confidence('low', ['high_doubtful_share']));
  });

  it('[CA-SEN-14] [SEN-25] gives 6 valid and 4 excluded cases a doubtful share of 40 % and one step down', () => {
    const inputs = base({ validCount: 6, excludedCount: 4 });
    const stepDown = ['high_doubtful_share'] as const;

    expect(doubtfulShare(inputs.validCount, inputs.excludedCount)).toBeCloseTo(0.4, PRECISION);
    // With the defaults, 6 valid cases start low, and the level stays there.
    expect(profileConfidence(inputs, DEFAULTS)).toStrictEqual(confidence('low', stepDown));
    expect(
      profileConfidence(inputs, withThresholds({ confidenceMediumFromCases: 6 })),
    ).toStrictEqual(confidence('low', stepDown));
    expect(
      profileConfidence(
        inputs,
        withThresholds({ confidenceMediumFromCases: 3, confidenceHighFromCases: 6 }),
      ),
    ).toStrictEqual(confidence('medium', stepDown));
  });

  it('[SEN-25] [SEN-26] steps down a level for a fragile verdict', () => {
    expect(profileConfidence(base({ isFragile: true }), DEFAULTS)).toStrictEqual(
      confidence('low', ['fragile_verdict']),
    );
    expect(profileConfidence(base({ validCount: 20, isFragile: true }), DEFAULTS)).toStrictEqual(
      confidence('medium', ['fragile_verdict']),
    );
  });

  it('[SEN-25] steps down once per reason, which it gives in the order of SEN-25', () => {
    const twoSigns = base({ validCount: 20, gapDispersion: 2, isFragile: true });

    expect(profileConfidence(twoSigns, DEFAULTS)).toStrictEqual(
      confidence('low', ['high_dispersion', 'fragile_verdict']),
    );
    expect(profileConfidence(weakBase(20), DEFAULTS)).toStrictEqual(confidence('low', ALL_REASONS));
  });

  it('[SEN-25] never goes below low, and still gives the reason of every step', () => {
    expect(profileConfidence(weakBase(10), DEFAULTS)).toStrictEqual(confidence('low', ALL_REASONS));
    expect(profileConfidence(weakBase(3), DEFAULTS)).toStrictEqual(confidence('low', ALL_REASONS));
  });

  it('[SEN-25] [CL-SEN-15] is low without a valid case, a step down given for excluded cases', () => {
    const noCase = base({ validCount: 0, gapDispersion: null });

    expect(profileConfidence(noCase, DEFAULTS)).toStrictEqual(confidence('low'));
    expect(profileConfidence({ ...noCase, excludedCount: 2 }, DEFAULTS)).toStrictEqual(
      confidence('low', ['high_doubtful_share']),
    );
  });

  it('[SEN-25] lowers the starting level once per sign that holds, never below low, whatever the thresholds', () => {
    fc.assert(
      fc.property(anyInputs, anyThresholds, (inputs, thresholds) => {
        expect(profileConfidence(inputs, withThresholds(thresholds))).toStrictEqual(
          countedByHand(inputs, thresholds),
        );
      }),
    );
  });
});

describe('profileConfidence of the 08 worked example', () => {
  it('[CA-SEN-11] [SEN-25] [SEN-26] [CL-SEN-24] gives "possible, increase", fragile, with a mean gap of +0.80 from +0.09 to +1.51 and a profile confidence of low', () => {
    const profile = evaluated(WORKED_EXAMPLE_CASES);

    expect(profile.quantities?.meanGap).toBeCloseTo(0.8, 2);
    expect(profile.quantities?.rangeLow).toBeCloseTo(0.09, 2);
    expect(profile.quantities?.rangeHigh).toBeCloseTo(1.51, 2);
    expect(profile).toMatchObject({
      verdict: { level: 'possible', direction: 'increase' },
      isFragile: true,
    });
    // Medium at 8 cases; a dispersion of 0.78 and 20 % of doubtful cases take no step.
    expect(profile.confidence).toStrictEqual(confidence('low', ['fragile_verdict']));
  });

  it('[CA-SEN-11] [SEN-25] would leave the worked example at medium if its verdict held', () => {
    const { confidence: values, quantities } = evaluated(WORKED_EXAMPLE_CASES);
    const holding = {
      validCount: 8,
      excludedCount: 2,
      gapDispersion: quantities?.gapDispersion ?? null,
      isFragile: false,
    };

    expect(values.confidenceStepDownReasons).toStrictEqual(['fragile_verdict']);
    expect(profileConfidence(holding, DEFAULTS)).toStrictEqual(confidence('medium'));
  });

  it('[CA-SEN-12] [SEN-24] [H-04] gives the mirrored gaps "possible, decrease", the mirrored range and the same profile confidence', () => {
    const profile = evaluated(mirrored(WORKED_EXAMPLE_CASES));

    expect(profile.quantities?.meanGap).toBeCloseTo(-0.8, 2);
    expect(profile.quantities?.rangeLow).toBeCloseTo(-1.51, 2);
    expect(profile.quantities?.rangeHigh).toBeCloseTo(-0.09, 2);
    expect(profile).toMatchObject({
      verdict: { level: 'possible', direction: 'decrease' },
      isFragile: true,
    });
    expect(profile.confidence).toStrictEqual(evaluated(WORKED_EXAMPLE_CASES).confidence);
  });
});

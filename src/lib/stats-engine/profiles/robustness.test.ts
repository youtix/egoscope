import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isSameVerdict, runRobustnessTest } from './robustness';
import { profileVerdict } from './verdict';

import type { EngineParams } from '../types';
import type { RobustnessTest } from './robustness';
import type { ProfileCase } from './tally';
import type { Verdict, VerdictQuantities } from './verdict';

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

// The worked example's values compare at their printed precision, and those it gives as
// « environ » within 0.05 (CL-SEN-24).
const ABOUT = 1;
const DAY_MS = 86_400_000;
const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };
const POSSIBLE_INCREASE: Verdict = { level: 'possible', direction: 'increase' };
const POSSIBLE_DECREASE: Verdict = { level: 'possible', direction: 'decrease' };
const PROBABLE_INCREASE: Verdict = { level: 'probable', direction: 'increase' };
const OPPOSITE = { increase: 'decrease', decrease: 'increase' } as const;

/** The registry's defaults with other thresholds of SEN-23. */
function withThresholds(thresholds: Partial<EngineParams['sensitivity']>): EngineParams {
  return { ...DEFAULTS, sensitivity: { ...DEFAULTS.sensitivity, ...thresholds } };
}

/** A valid case whose measured game starts on `day`, by default its identifier. */
function valid(
  caseId: number,
  normalizedGap: number,
  day = caseId,
): Extract<ProfileCase, { status: 'measured' }> {
  return {
    caseId,
    events: [{ researchConfidence: 'high' }],
    isCoOccurring: false,
    status: 'measured',
    measuredGameScheduledStartAt: day * DAY_MS,
    normalizedGap,
    gapStatus: 'final',
  };
}

/** Valid cases with these gaps, their games in the gaps' order. */
function validCases(gaps: readonly number[]): ProfileCase[] {
  return gaps.map((gap, index) => valid(index + 1, gap));
}

/** `count` gaps of `gap`. */
function repeated(gap: number, count: number): number[] {
  return Array.from({ length: count }, () => gap);
}

/** The same cases with gaps of the opposite sign. */
function mirrored(cases: readonly ProfileCase[]): ProfileCase[] {
  return cases.map((caseItem) =>
    'normalizedGap' in caseItem
      ? { ...caseItem, normalizedGap: -caseItem.normalizedGap }
      : caseItem,
  );
}

/** The same verdict in the opposite direction. */
function opposite(verdict: Verdict): Verdict {
  return verdict.direction === null
    ? verdict
    : { level: verdict.level, direction: OPPOSITE[verdict.direction] };
}

/**
 * What opposite gaps give: the same spread around the opposite mean gap, to the bit,
 * negation being exact. A sum of gaps starts from +0, so a mean gap of zero is +0 both
 * ways, which `0 - x` writes too.
 */
function mirrorOf(quantities: VerdictQuantities | null): VerdictQuantities | null {
  return quantities === null
    ? null
    : {
        ...quantities,
        meanGap: 0 - quantities.meanGap,
        signalToNoise: 0 - quantities.signalToNoise,
        rangeLow: 0 - quantities.rangeHigh,
        rangeHigh: 0 - quantities.rangeLow,
      };
}

/** The robustness test of the profile's own verdict, as a profile runs it. */
function testOf(cases: readonly ProfileCase[], params = DEFAULTS): RobustnessTest {
  return runRobustnessTest(cases, profileVerdict(cases, params).verdict, params);
}

/** The cases each recomputation set aside, in order. */
function removedCases(test: RobustnessTest): number[] {
  return test.trials.map((trial) => trial.removedCaseId);
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
// Six gaps: −1 five times and +3, which removing +3 turns into "possible, decrease".
const LIFTED_BY_THE_HIGHEST = [-1, -1, -1, 3, -1, -1];

// From 5 to 12 gaps, in hundredths, around a shift of up to ±1.5 that they share, each
// with its own spread of up to ±1, so that their verdicts reach every level in both
// directions; hundredths also give ties, which the fixed order breaks.
const anySignalGaps = fc
  .tuple(
    fc.noBias(fc.integer({ min: -150, max: 150 })),
    fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 5, maxLength: 12 }),
  )
  .map(([shift, spreads]) => spreads.map((spread) => (shift + spread) / 100));
// The rarest outcome of the test, an inconclusive verdict found fragile, comes in about
// one run in 25: 600 runs all miss it with a chance below 1e-10.
const SIGNAL_RUNS = 600;
// From 5 to 12 valid cases with distinct identifiers and gaps in halves, several of them
// on one day and several of one gap, so that the fixed order breaks both kinds of tie.
const anyValidCases = fc
  .uniqueArray(
    fc.tuple(fc.nat({ max: 1000 }), fc.integer({ min: -6, max: 6 }), fc.nat({ max: 5 })),
    { minLength: 5, maxLength: 12, selector: ([caseId]) => caseId },
  )
  .map((rows) => rows.map(([caseId, halves, day]) => valid(caseId, halves / 2, day)));
const anyCasesAndShuffle = anyValidCases.chain((cases) =>
  fc.tuple(
    fc.constant(cases),
    fc.shuffledSubarray(cases, { minLength: cases.length, maxLength: cases.length }),
  ),
);

describe('isSameVerdict', () => {
  it('[SEN-26] [SEN-27] tells verdicts apart by their level and by their direction', () => {
    expect(isSameVerdict(POSSIBLE_INCREASE, { level: 'possible', direction: 'increase' })).toBe(
      true,
    );
    expect(isSameVerdict(POSSIBLE_INCREASE, PROBABLE_INCREASE)).toBe(false);
    expect(isSameVerdict(POSSIBLE_INCREASE, POSSIBLE_DECREASE)).toBe(false);
    expect(isSameVerdict(POSSIBLE_INCREASE, INCONCLUSIVE)).toBe(false);
  });
});

describe('runRobustnessTest', () => {
  it('[CA-SEN-11] [SEN-26] [CL-SEN-24] finds the worked example fragile: without C7 (+1.81), 7 cases give a mean gap of 0.656 and a ratio of about 1.7', () => {
    const test = runRobustnessTest(WORKED_EXAMPLE_CASES, POSSIBLE_INCREASE, DEFAULTS);
    const [trial] = test.trials;

    expect(test.isFragile).toBe(true);
    expect(test.trials).toHaveLength(1);
    expect(trial).toMatchObject({ removedCaseId: 7, verdict: INCONCLUSIVE });
    expect(trial?.quantities?.meanGap).toBeCloseTo(0.656, 3);
    expect(trial?.quantities?.signalToNoise).toBeCloseTo(1.7, ABOUT);
  });

  it('[CA-SEN-11] [SEN-26] [SEN-22] [CL-SEN-14] retains the dispersion of 0.72 left without C7 at 1, for a noise of 0.378', () => {
    const [trial] = runRobustnessTest(WORKED_EXAMPLE_CASES, POSSIBLE_INCREASE, DEFAULTS).trials;

    expect(trial?.quantities?.gapDispersion).toBeCloseTo(0.72, 2);
    expect(trial?.quantities?.retainedDispersion).toBe(1);
    expect(trial?.quantities?.expectedNoise).toBeCloseTo(0.378, 3);
  });

  it('[CA-SEN-12] [SEN-26] [SEN-24] finds the mirrored worked example fragile: without C7 (−1.81), the lowest gap, a mean gap of −0.656', () => {
    const test = runRobustnessTest(mirrored(WORKED_EXAMPLE_CASES), POSSIBLE_DECREASE, DEFAULTS);
    const [trial] = test.trials;

    expect(test.isFragile).toBe(true);
    expect(test.trials).toHaveLength(1);
    expect(trial).toMatchObject({ removedCaseId: 7, verdict: INCONCLUSIVE });
    expect(trial?.quantities?.meanGap).toBeCloseTo(-0.656, 3);
    expect(trial?.quantities?.signalToNoise).toBeCloseTo(-1.7, ABOUT);
  });

  it('[SEN-26] [CL-SEN-14] does not run below the valid-case threshold, where nothing is fragile', () => {
    // Four gaps of 1.5: a ratio of exactly 3, and of about 2.6 once one is set aside.
    const cases = validCases(repeated(1.5, 4));
    const atFour = withThresholds({ minValidCases: 4 });

    expect(testOf(cases)).toStrictEqual({ isFragile: false, trials: [] });
    expect(testOf(cases, atFour)).toMatchObject({
      isFragile: true,
      trials: [{ removedCaseId: 1, verdict: POSSIBLE_INCREASE }],
    });
  });

  it('[SEN-26] [CL-SEN-14] counts only the valid cases towards the valid-case threshold', () => {
    const cases: ProfileCase[] = [
      ...validCases(repeated(1.5, 4)),
      { ...valid(5, 1.5), status: 'excluded', triggeredCriteria: ['manual'] },
      {
        caseId: 6,
        events: [{ researchConfidence: null }],
        isCoOccurring: false,
        status: 'awaiting_game',
        statusReason: 'statistics_pending',
      },
    ];

    expect(runRobustnessTest(cases, PROBABLE_INCREASE, DEFAULTS)).toStrictEqual({
      isFragile: false,
      trials: [],
    });
  });

  it('[SEN-26] finds a probable verdict fragile when one case less leaves it possible: the level alone changes', () => {
    // Nine gaps of 1 give a ratio of exactly 3, eight of them √8, about 2.83.
    const test = testOf(validCases(repeated(1, 9)));

    expect(test.isFragile).toBe(true);
    expect(test.trials).toMatchObject([{ removedCaseId: 1, verdict: POSSIBLE_INCREASE }]);
  });

  it('[SEN-26] finds a verdict that keeps its level and direction without its strongest case not fragile', () => {
    // Sixteen gaps of 1 give a ratio of 4, fifteen of them about 3.87.
    const test = testOf(validCases(repeated(1, 16)));

    expect(test.isFragile).toBe(false);
    expect(test.trials).toMatchObject([{ removedCaseId: 1, verdict: PROBABLE_INCREASE }]);
  });

  it('[SEN-26] finds a verdict fragile when one case less turns its direction alone', () => {
    // With a possible ratio of 0.5 and no mean-gap threshold, four gaps of −1 and one of
    // +10 are "possible, increase" (a ratio of about 0.55); the four alone give −2.
    const loose = withThresholds({ possibleSignalToNoise: 0.5, possibleMeanGap: 0 });
    const cases = validCases([-1, -1, 10, -1, -1]);
    const test = runRobustnessTest(cases, POSSIBLE_INCREASE, loose);

    expect(profileVerdict(cases, loose).verdict).toStrictEqual(POSSIBLE_INCREASE);
    expect(test.isFragile).toBe(true);
    expect(test.trials).toMatchObject([{ removedCaseId: 3, verdict: POSSIBLE_DECREASE }]);
  });

  it('[SEN-26] [CL-SEN-14] recomputes without the valid-case threshold, so one case less than it can keep the verdict', () => {
    // Five gaps of 1.5 are probable (a ratio of about 3.35); four give a ratio of exactly 3.
    const test = testOf(validCases(repeated(1.5, 5)));

    expect(test.isFragile).toBe(false);
    expect(test.trials).toMatchObject([{ removedCaseId: 1, verdict: PROBABLE_INCREASE }]);
  });

  it('[SEN-26] sets aside the highest gap of an increase and the lowest of a decrease, never the largest in absolute value', () => {
    // Nine gaps of 1 and one of −1.5 are "possible, increase", which setting a 1 aside
    // keeps and setting the −1.5 aside would make probable.
    const cases = validCases([...repeated(1, 9), -1.5]);

    expect(testOf(cases)).toMatchObject({
      isFragile: false,
      trials: [{ removedCaseId: 1, verdict: POSSIBLE_INCREASE }],
    });
    expect(testOf(mirrored(cases))).toMatchObject({
      isFragile: false,
      trials: [{ removedCaseId: 1, verdict: POSSIBLE_DECREASE }],
    });
  });

  it('[SEN-26] [CL-SEN-14] sets aside the first of the tied highest gaps in the fixed order, by scheduled start', () => {
    // Nine gaps of 1, cases 1 to 9 on days 9 to 1: case 9's game, given last, starts first.
    const cases = Array.from({ length: 9 }, (_, index) => valid(index + 1, 1, 9 - index));

    expect(removedCases(testOf(cases))).toStrictEqual([9]);
  });

  it('[SEN-26] [CL-SEN-14] sets aside the first of the tied gaps by case identifier when their games start together', () => {
    const cases = [5, 2, 8, 3, 7, 4, 9, 6, 11].map((caseId) => valid(caseId, 1, 1));
    const mirror = testOf(mirrored(cases));

    expect(removedCases(testOf(cases))).toStrictEqual([2]);
    expect(removedCases(mirror)).toStrictEqual([2]);
  });

  it('[SEN-26] [CL-SEN-14] recomputes an inconclusive verdict without the highest gap, then without the lowest, each time from all the valid cases', () => {
    const test = runRobustnessTest(validCases(LIFTED_BY_THE_HIGHEST), INCONCLUSIVE, DEFAULTS);
    const [withoutHighest, withoutLowest] = test.trials;

    // The lowest gap is −1, a tie that goes to case 1, whose game comes first.
    expect(removedCases(test)).toStrictEqual([4, 1]);
    expect(withoutHighest?.quantities?.meanGap).toBe(-1);
    // Four gaps of −1 and the +3: a mean gap of −0.2, both cases set aside never together.
    expect(withoutLowest?.quantities?.meanGap).toBeCloseTo(-0.2, 9);
  });

  it('[SEN-26] [CL-SEN-14] finds an inconclusive verdict fragile when the first recomputation alone gives a verdict', () => {
    const test = runRobustnessTest(validCases(LIFTED_BY_THE_HIGHEST), INCONCLUSIVE, DEFAULTS);

    expect(test.isFragile).toBe(true);
    expect(test.trials.map((trial) => trial.verdict)).toStrictEqual([
      POSSIBLE_DECREASE,
      INCONCLUSIVE,
    ]);
  });

  it('[SEN-26] [CL-SEN-14] finds an inconclusive verdict fragile when the second recomputation alone gives a verdict', () => {
    const cases = validCases(LIFTED_BY_THE_HIGHEST.map((gap) => -gap));
    const test = runRobustnessTest(cases, INCONCLUSIVE, DEFAULTS);

    expect(test.isFragile).toBe(true);
    expect(test.trials.map((trial) => trial.verdict)).toStrictEqual([
      INCONCLUSIVE,
      POSSIBLE_INCREASE,
    ]);
  });

  it('[SEN-26] finds an inconclusive verdict that neither recomputation lifts not fragile', () => {
    const test = runRobustnessTest(validCases([0.1, -0.1, 0.2, -0.2, 0]), INCONCLUSIVE, DEFAULTS);

    expect(test).toMatchObject({
      isFragile: false,
      trials: [{ verdict: INCONCLUSIVE }, { verdict: INCONCLUSIVE }],
    });
    expect(removedCases(test)).toStrictEqual([3, 4]);
  });

  it('[SEN-26] [SEN-10] sets aside valid cases only, whatever the gaps of the excluded ones', () => {
    const cases: ProfileCase[] = [
      ...validCases([0.1, -0.1, 0.2, -0.2, 0]),
      { ...valid(6, 4.5), status: 'excluded', triggeredCriteria: ['opponent_strength'] },
      { ...valid(7, -4.5), status: 'excluded', triggeredCriteria: ['manual'] },
    ];

    expect(removedCases(runRobustnessTest(cases, INCONCLUSIVE, DEFAULTS))).toStrictEqual([3, 4]);
  });

  it('[SEN-24] [H-04] [CA-SEN-12] judges opposite gaps alike: the same fragility, and the same cases set aside', () => {
    const outcomes = new Set<string>();
    fc.assert(
      fc.property(anySignalGaps, (gaps) => {
        const original = testOf(validCases(gaps));
        const mirror = testOf(validCases(gaps.map((gap) => -gap)));
        const { verdict } = profileVerdict(validCases(gaps), DEFAULTS);
        // An inconclusive verdict sets aside the highest gap first, the mirror's lowest.
        const counterparts =
          verdict.direction === null ? original.trials.toReversed() : original.trials;
        outcomes.add(`${verdict.level} ${String(original.isFragile)}`);

        expect(mirror.isFragile).toBe(original.isFragile);
        expect(mirror.trials).toStrictEqual(
          counterparts.map((trial) => ({
            ...trial,
            quantities: mirrorOf(trial.quantities),
            verdict: opposite(trial.verdict),
          })),
        );
      }),
      { numRuns: SIGNAL_RUNS },
    );

    // The runs reached every outcome, so the property held on each.
    expect(outcomes).toStrictEqual(
      new Set([
        'inconclusive false',
        'inconclusive true',
        'possible false',
        'possible true',
        'probable false',
        'probable true',
      ]),
    );
  });

  it('[SEN-26] [CL-STA-09] gives the same test for the same cases in any order', () => {
    fc.assert(
      fc.property(anyCasesAndShuffle, ([cases, shuffled]) => {
        expect(testOf(shuffled)).toStrictEqual(testOf(cases));
      }),
    );
  });
});

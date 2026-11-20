import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import {
  compareCasesInFixedOrder,
  profileVerdict,
  signalVerdict,
  verdictQuantities,
} from './verdict';

import type { EngineParams } from '../types';
import type { ProfileCase } from './tally';
import type { Verdict, VerdictQuantities } from './verdict';

// Raw values are compared to 1e-9, the worked example's at their printed precision
// (CL-STA-09, CL-SEN-24).
const PRECISION = 9;

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

const DAY_MS = 86_400_000;
const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };
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

/** The same verdict in the opposite direction. */
function opposite(verdict: Verdict): Verdict {
  return verdict.direction === null
    ? verdict
    : { level: verdict.level, direction: OPPOSITE[verdict.direction] };
}

/**
 * What opposite gaps give: the same spread around the opposite mean gap. Negation is
 * exact in floating point, so the values match to the bit, but for the sign of a zero:
 * gaps that cancel out sum to +0 both ways, while a mean gap or a ratio that underflows
 * to zero keeps the sign of the gaps. `0 - x` writes every zero +0, and
 * `withPositiveZeros` writes the other side alike: a mean gap of zero has no direction
 * (SEN-24).
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

/** The same quantities with a mean gap or a ratio of −0 written +0, which `0 + x` does. */
function withPositiveZeros(quantities: VerdictQuantities | null): VerdictQuantities | null {
  return quantities === null
    ? null
    : {
        ...quantities,
        meanGap: 0 + quantities.meanGap,
        signalToNoise: 0 + quantities.signalToNoise,
      };
}

// The 08 worked example: the printed gaps of C1, C2, C3, C5, C7, C8, C10 and C11 in the
// order of their games, then C4 and C9, excluded, and C6, not measurable, which never
// enter the verdict (CL-SEN-24).
const WORKED_EXAMPLE_GAPS = [1.16, -0.43, 0.95, 0.55, 1.81, -0.2, 1.13, 1.43];
const WORKED_EXAMPLE_CASES: ProfileCase[] = [
  ...validCases(WORKED_EXAMPLE_GAPS),
  { ...valid(20, -1.9), status: 'excluded', triggeredCriteria: ['playing_time_too_low'] },
  { ...valid(21, 0.63), status: 'excluded', triggeredCriteria: ['unusual_stakes'] },
  {
    caseId: 22,
    events: [{ researchConfidence: 'high' }],
    isCoOccurring: false,
    status: 'not_measurable',
    statusReason: 'no_game_within_window',
  },
];
const MIRRORED_EXAMPLE_CASES = validCases(WORKED_EXAMPLE_GAPS.map((gap) => -gap));

const anyGap = fc.double({ min: -5, max: 5, noNaN: true });
const anyGaps = fc.array(anyGap, { minLength: 1, maxLength: 30, size: 'max' });
// From 5 to 12 gaps, in hundredths, around a shift of up to ±1.5 that they share, each
// with its own spread of up to ±1, so that their verdicts reach every level in both
// directions. The shift is drawn evenly: fast-check's bias would draw it close to zero,
// where every verdict is inconclusive, far more often.
const anySignalGaps = fc
  .tuple(
    fc.noBias(fc.integer({ min: -150, max: 150 })),
    fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 5, maxLength: 12 }),
  )
  .map(([shift, spreads]) => spreads.map((spread) => (shift + spread) / 100));
// The rarest of those verdicts, possible in either direction, comes in about one run in
// nine: 300 runs all miss one of them with a chance below 1e-15.
const SIGNAL_RUNS = 300;
// Valid cases with distinct identifiers, several of them on one day.
const anyValidCases = fc
  .uniqueArray(fc.tuple(fc.nat({ max: 1000 }), anyGap, fc.nat({ max: 5 })), {
    minLength: 1,
    maxLength: 20,
    size: 'max',
    selector: ([caseId]) => caseId,
  })
  .map((rows) => rows.map(([caseId, gap, day]) => valid(caseId, gap, day)));
const anyCasesAndShuffle = anyValidCases.chain((cases) =>
  fc.tuple(
    fc.constant(cases),
    fc.shuffledSubarray(cases, { minLength: cases.length, maxLength: cases.length }),
  ),
);

describe('verdictQuantities', () => {
  it('[SEN-22] [CL-SEN-15] gives no mean, range or ratio without a gap', () => {
    expect(verdictQuantities([])).toBeNull();
  });

  it('[SEN-22] [CL-SEN-15] gives one gap a mean of that gap, no dispersion, a noise of 1 and a range of the mean ± 2', () => {
    const quantities = verdictQuantities([0.7]);

    expect(quantities).toMatchObject({
      meanGap: 0.7,
      gapDispersion: null,
      retainedDispersion: 1,
      expectedNoise: 1,
      signalToNoise: 0.7,
    });
    expect(quantities?.rangeLow).toBeCloseTo(-1.3, PRECISION);
    expect(quantities?.rangeHigh).toBeCloseTo(2.7, PRECISION);
  });

  it('[SEN-20] [SEN-22] takes the sample dispersion, dividing by n − 1, and retains it above 1', () => {
    // Mean 1.5; squared differences 2.25 + 0.25 + 0.25 + 2.25 = 5, so √(5 ÷ 3).
    const quantities = verdictQuantities([0, 1, 2, 3]);

    expect(quantities?.meanGap).toBe(1.5);
    expect(quantities?.gapDispersion).toBeCloseTo(Math.sqrt(5 / 3), PRECISION);
    expect(quantities?.retainedDispersion).toBeCloseTo(Math.sqrt(5 / 3), PRECISION);
  });

  it('[SEN-22] divides the retained dispersion by √n, the mean gap by the noise, and spans the range 2 noises each side', () => {
    const noise = Math.sqrt(5 / 3) / 2;
    const quantities = verdictQuantities([0, 1, 2, 3]);

    expect(quantities?.expectedNoise).toBeCloseTo(noise, PRECISION);
    expect(quantities?.signalToNoise).toBeCloseTo(1.5 / noise, PRECISION);
    expect(quantities?.rangeLow).toBeCloseTo(1.5 - 2 * noise, PRECISION);
    expect(quantities?.rangeHigh).toBeCloseTo(1.5 + 2 * noise, PRECISION);
  });

  it('[SEN-22] computes the dispersion from two gaps on', () => {
    const quantities = verdictQuantities([0, 3]);

    expect(quantities?.gapDispersion).toBeCloseTo(Math.sqrt(4.5), PRECISION);
    expect(quantities?.retainedDispersion).toBeCloseTo(Math.sqrt(4.5), PRECISION);
  });

  it('[SEN-22] never lets the expected noise fall below 1 ÷ √n, nor the range span other than 2 noises each side', () => {
    fc.assert(
      fc.property(anyGaps, (gaps) => {
        const quantities = verdictQuantities(gaps);
        const meanGap = quantities?.meanGap ?? NaN;
        const noise = quantities?.expectedNoise ?? NaN;

        expect(noise * Math.sqrt(gaps.length)).toBeGreaterThanOrEqual(1 - 1e-9);
        expect(quantities?.rangeLow).toBeCloseTo(meanGap - 2 * noise, PRECISION);
        expect(quantities?.rangeHigh).toBeCloseTo(meanGap + 2 * noise, PRECISION);
      }),
    );
  });
});

describe('signalVerdict', () => {
  it('[SEN-23] [CL-SEN-15] is inconclusive without a gap', () => {
    expect(signalVerdict(null, DEFAULTS)).toStrictEqual(INCONCLUSIVE);
  });

  it('[SEN-23] [SEN-24] is probable when the ratio and the mean gap exactly reach the probable thresholds', () => {
    // Nine gaps of 1: a noise of 1 ÷ 3 and a ratio of exactly 3.
    const quantities = verdictQuantities(repeated(1, 9));
    const probable = { level: 'probable', direction: 'increase' };

    expect(signalVerdict(quantities, DEFAULTS)).toStrictEqual(probable);
    expect(signalVerdict(quantities, withThresholds({ probableMeanGap: 1 }))).toStrictEqual(
      probable,
    );
  });

  it('[SEN-24] [H-04] is probable, decrease, when the ratio and the mean gap exactly reach the probable thresholds in absolute value', () => {
    // Nine gaps of −1: a noise of 1 ÷ 3 and a ratio of exactly −3.
    const quantities = verdictQuantities(repeated(-1, 9));
    const probable = { level: 'probable', direction: 'decrease' };

    expect(quantities?.signalToNoise).toBe(-3);
    expect(signalVerdict(quantities, DEFAULTS)).toStrictEqual(probable);
    expect(signalVerdict(quantities, withThresholds({ probableMeanGap: 1 }))).toStrictEqual(
      probable,
    );
  });

  it('[SEN-23] is possible, not probable, when the ratio reaches the probable threshold but the mean gap does not', () => {
    const quantities = verdictQuantities(repeated(1, 9));

    expect(signalVerdict(quantities, withThresholds({ probableMeanGap: 1.5 }))).toStrictEqual({
      level: 'possible',
      direction: 'increase',
    });
  });

  it('[SEN-23] is possible when the ratio and the mean gap exactly reach the possible thresholds', () => {
    // Sixteen gaps of 0.5: a noise of 1 ÷ 4 and a ratio of exactly 2.
    const quantities = verdictQuantities(repeated(0.5, 16));
    const possible = { level: 'possible', direction: 'increase' };

    expect(signalVerdict(quantities, DEFAULTS)).toStrictEqual(possible);
    expect(signalVerdict(quantities, withThresholds({ possibleMeanGap: 0.5 }))).toStrictEqual(
      possible,
    );
  });

  it('[SEN-24] [H-04] is possible, decrease, when the ratio and the mean gap exactly reach the possible thresholds in absolute value', () => {
    // Sixteen gaps of −0.5: a noise of 1 ÷ 4 and a ratio of exactly −2.
    const quantities = verdictQuantities(repeated(-0.5, 16));
    const possible = { level: 'possible', direction: 'decrease' };

    expect(quantities?.signalToNoise).toBe(-2);
    expect(signalVerdict(quantities, DEFAULTS)).toStrictEqual(possible);
    expect(signalVerdict(quantities, withThresholds({ possibleMeanGap: 0.5 }))).toStrictEqual(
      possible,
    );
  });

  it('[SEN-23] is inconclusive when the ratio reaches the possible threshold but the mean gap does not', () => {
    const quantities = verdictQuantities(repeated(0.5, 16));

    expect(signalVerdict(quantities, withThresholds({ possibleMeanGap: 0.6 }))).toStrictEqual(
      INCONCLUSIVE,
    );
  });

  it('[SEN-23] is inconclusive when the mean gap reaches the thresholds but the ratio stays below them', () => {
    // Mean 1, dispersion √(4 ÷ 3): a noise of about 0.58 and a ratio of about 1.73.
    expect(signalVerdict(verdictQuantities([2, 0, 2, 0]), DEFAULTS)).toStrictEqual(INCONCLUSIVE);
  });

  it('[SEN-24] gives a mean gap of zero no direction, and so no verdict above inconclusive whatever the thresholds', () => {
    const quantities = verdictQuantities([0.5, -0.5, 0.5, -0.5, 0.5, -0.5]);
    const noThresholds = withThresholds({
      possibleSignalToNoise: 0,
      possibleMeanGap: 0,
      probableSignalToNoise: 0,
      probableMeanGap: 0,
    });

    expect(quantities?.meanGap).toBe(0);
    expect(signalVerdict(quantities, noThresholds)).toStrictEqual(INCONCLUSIVE);
  });
});

describe('compareCasesInFixedOrder', () => {
  it('[SEN-20] [CL-STA-09] orders cases by the scheduled start of their measured game, then by identifier', () => {
    // Case 4's game starts first, then those of cases 1 and 3 together, then case 2's.
    const cases = [valid(3, 0.1, 2), valid(4, 0.2, 1), valid(1, 0.3, 2), valid(2, 0.4, 3)];

    expect(cases.toSorted(compareCasesInFixedOrder).map(({ caseId }) => caseId)).toStrictEqual([
      4, 1, 3, 2,
    ]);
  });
});

describe('profileVerdict', () => {
  it('[SEN-20] [CL-SEN-24] gives the 08 worked example a mean gap of +0.80 and a gap dispersion of 0.78', () => {
    const { quantities } = profileVerdict(WORKED_EXAMPLE_CASES, DEFAULTS);

    expect(quantities?.meanGap).toBeCloseTo(0.8, 2);
    expect(quantities?.gapDispersion).toBeCloseTo(0.78, 2);
  });

  it('[SEN-22] [CL-SEN-24] retains a dispersion of 1 for the worked example: a noise of 0.354 and a ratio of 2.26', () => {
    const { quantities } = profileVerdict(WORKED_EXAMPLE_CASES, DEFAULTS);

    expect(quantities?.retainedDispersion).toBe(1);
    expect(quantities?.expectedNoise).toBeCloseTo(0.354, 3);
    expect(quantities?.signalToNoise).toBeCloseTo(2.26, 2);
  });

  it('[SEN-22] [CL-SEN-24] gives the worked example a plausible range from +0.09 to +1.51', () => {
    const { quantities } = profileVerdict(WORKED_EXAMPLE_CASES, DEFAULTS);

    expect(quantities?.rangeLow).toBeCloseTo(0.09, 2);
    expect(quantities?.rangeHigh).toBeCloseTo(1.51, 2);
  });

  it('[SEN-20] [SEN-23] [SEN-24] gives the worked example "possible, increase", 6 cases of 8 above zero', () => {
    expect(profileVerdict(WORKED_EXAMPLE_CASES, DEFAULTS)).toMatchObject({
      aboveZeroCount: 6,
      belowZeroCount: 2,
      verdict: { level: 'possible', direction: 'increase' },
    });
  });

  it('[SEN-24] [H-04] gives the mirrored worked example "possible, decrease" and the mirrored range', () => {
    const mirrored = profileVerdict(MIRRORED_EXAMPLE_CASES, DEFAULTS);

    expect(mirrored.quantities?.meanGap).toBeCloseTo(-0.8, 2);
    expect(mirrored.quantities?.rangeLow).toBeCloseTo(-1.51, 2);
    expect(mirrored.quantities?.rangeHigh).toBeCloseTo(-0.09, 2);
    expect(mirrored).toMatchObject({
      aboveZeroCount: 2,
      belowZeroCount: 6,
      verdict: { level: 'possible', direction: 'decrease' },
    });
  });

  it('[SEN-24] [H-04] gives opposite gaps the mirrored range around the opposite mean gap, to the bit', () => {
    fc.assert(
      fc.property(anyGaps, (gaps) => {
        const original = profileVerdict(validCases(gaps), DEFAULTS);
        const mirroredCases = validCases(gaps.map((gap) => -gap));

        expect(withPositiveZeros(profileVerdict(mirroredCases, DEFAULTS).quantities)).toStrictEqual(
          mirrorOf(original.quantities),
        );
      }),
      // Two subnormal gaps whose mean gap underflows to +0, and the mirrored one to −0.
      { examples: [[[-7.4e-323, 8e-323]]] },
    );
  });

  it('[SEN-24] [H-04] gives opposite gaps the same level, the opposite direction and the opposite counts', () => {
    const verdicts: Verdict[] = [];
    fc.assert(
      fc.property(anySignalGaps, (gaps) => {
        const original = profileVerdict(validCases(gaps), DEFAULTS);
        const mirroredCases = validCases(gaps.map((gap) => -gap));
        verdicts.push(original.verdict);

        expect(profileVerdict(mirroredCases, DEFAULTS)).toMatchObject({
          aboveZeroCount: original.belowZeroCount,
          belowZeroCount: original.aboveZeroCount,
          verdict: opposite(original.verdict),
        });
      }),
      { numRuns: SIGNAL_RUNS },
    );

    // The runs reached every level, in both directions, so the property held on each.
    expect(verdicts).toStrictEqual(
      expect.arrayContaining([
        INCONCLUSIVE,
        { level: 'possible', direction: 'increase' },
        { level: 'possible', direction: 'decrease' },
        { level: 'probable', direction: 'increase' },
        { level: 'probable', direction: 'decrease' },
      ]),
    );
  });

  it('[SEN-20] [CL-SEN-15] gives a profile without a valid case no mean, range or ratio, and an inconclusive verdict', () => {
    const cases: ProfileCase[] = [
      { ...valid(1, 2.5), status: 'excluded', triggeredCriteria: ['manual'] },
      {
        caseId: 2,
        events: [{ researchConfidence: null }],
        isCoOccurring: false,
        status: 'awaiting_game',
        statusReason: 'statistics_pending',
      },
    ];

    expect(profileVerdict(cases, DEFAULTS)).toStrictEqual({
      quantities: null,
      aboveZeroCount: 0,
      belowZeroCount: 0,
      verdict: INCONCLUSIVE,
    });
  });

  it('[SEN-23] [H-03] is inconclusive below the valid-case threshold whatever the signal', () => {
    // Four gaps of 1.5: a noise of 1 ÷ 2 and a ratio of exactly 3, probable from 4 cases.
    const cases = validCases(repeated(1.5, 4));

    expect(profileVerdict(cases, DEFAULTS).verdict).toStrictEqual(INCONCLUSIVE);
    expect(profileVerdict(cases, withThresholds({ minValidCases: 4 })).verdict).toStrictEqual({
      level: 'probable',
      direction: 'increase',
    });
  });

  it('[SEN-23] [H-03] lets the signal decide from exactly the valid-case threshold on', () => {
    // Five gaps of 1: a ratio of √5, about 2.24.
    const cases = validCases(repeated(1, 5));

    expect(profileVerdict(cases, DEFAULTS).verdict).toStrictEqual({
      level: 'possible',
      direction: 'increase',
    });
  });

  it('[SEN-23] [SEN-05] [H-03] counts only the valid cases towards the valid-case threshold, a case of two events once', () => {
    // Four valid gaps of 1.5, a ratio of exactly 3, among seven cases: an excluded, a
    // not-measurable and an awaiting case take the total past the threshold, not n; nor
    // does the second event grouped in the first case, which takes the events to five.
    const cases: ProfileCase[] = [
      {
        ...valid(1, 1.5),
        events: [{ researchConfidence: 'high' }, { researchConfidence: 'medium' }],
      },
      valid(2, 1.5),
      valid(3, 1.5),
      valid(4, 1.5),
      { ...valid(5, 2), status: 'excluded', triggeredCriteria: ['playing_time_too_low'] },
      {
        caseId: 6,
        events: [{ researchConfidence: 'high' }],
        isCoOccurring: false,
        status: 'not_measurable',
        statusReason: 'no_game_within_window',
      },
      {
        caseId: 7,
        events: [{ researchConfidence: null }],
        isCoOccurring: false,
        status: 'awaiting_game',
        statusReason: 'statistics_pending',
      },
    ];

    expect(profileVerdict(cases, DEFAULTS).verdict).toStrictEqual(INCONCLUSIVE);
    expect(profileVerdict(cases, withThresholds({ minValidCases: 4 })).verdict).toStrictEqual({
      level: 'probable',
      direction: 'increase',
    });
  });

  it('[SEN-20] counts the gaps above zero and below zero, a gap of zero in neither', () => {
    expect(profileVerdict(validCases([0.4, 0, -0.3, 1.2, -0]), DEFAULTS)).toMatchObject({
      aboveZeroCount: 2,
      belowZeroCount: 1,
    });
  });

  it('[SEN-20] [CL-STA-09] sums the gaps in the order of the measured games, whatever the order of the cases', () => {
    // Added in another order, 0.1, 0.2 and 0.3 give a mean that differs in its last bit.
    const inGameOrder = verdictQuantities([0.1, 0.2, 0.3]);
    const cases = [valid(10, 0.2, 2), valid(20, 0.3, 3), valid(30, 0.1, 1)];

    expect(verdictQuantities([0.2, 0.3, 0.1])).not.toStrictEqual(inGameOrder);
    expect(profileVerdict(cases, DEFAULTS).quantities).toStrictEqual(inGameOrder);
  });

  it('[SEN-20] [CL-STA-09] orders the cases of games that start at the same time by their identifiers', () => {
    const cases = [valid(2, 0.2, 1), valid(3, 0.3, 1), valid(1, 0.1, 1)];

    expect(profileVerdict(cases, DEFAULTS).quantities).toStrictEqual(
      verdictQuantities([0.1, 0.2, 0.3]),
    );
  });

  it('[SEN-20] [CL-STA-09] gives the same bits for the same cases in any order', () => {
    fc.assert(
      fc.property(anyCasesAndShuffle, ([cases, shuffled]) => {
        expect(profileVerdict(shuffled, DEFAULTS)).toStrictEqual(profileVerdict(cases, DEFAULTS));
      }),
    );
  });
});

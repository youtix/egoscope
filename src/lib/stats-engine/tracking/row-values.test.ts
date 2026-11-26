import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { verdictQuantities } from '../profiles/verdict';
import { caseSetValues, separateCounts } from './row-values';

import type { VerdictDirection } from '../profiles/verdict';
import type { EngineParams } from '../types';
import type { GapSummary } from './assessment';
import type { CaseGap, CasePlace } from './case-place';
import type { Forecast } from './forecast';
import type { CaseSetPart, CaseSetValues, PlacedCase, TouchedCount } from './row-values';

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
// Raw values are compared to 1e-9 (CL-STA-09); the worked examples print two decimals, and
// the expected noise three.
const DIGITS = 9;
const PRINTED_DIGITS = 2;
const NOISE_DIGITS = 3;
// Instants in milliseconds: the measured game of case n starts at START + n.
const START = 10_000;
const MINIMUM = DEFAULTS.tracking.minTrackedCasesForAssessment;

const NO_CASE = { withForecast: 0, confirmed: 0, refuted: 0, neutral: 0, noForecast: 0 };
const NO_TOUCH: TouchedCount = { count: 0, meanGapInForecastDirection: null };
const FORECAST: Forecast = {
  source: 'player_profile',
  level: 'possible',
  direction: 'increase',
  announcedMeanGap: 0.95,
  caseCount: 12,
  profileConfidence: 'medium',
};

function near(value: number): unknown {
  return expect.closeTo(value, DIGITS);
}

function printed(value: number, digits = PRINTED_DIGITS): unknown {
  return expect.closeTo(value, digits);
}

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('A value is missing');
  }
  return value;
}

function gapOf(caseId: number, normalizedGap: number): CaseGap {
  return {
    caseId,
    measuredGameScheduledStartAt: START + caseId,
    normalizedGap,
    gapStatus: 'final',
  };
}

/** A case of the testing set or of the late-forecast part. */
function tested(
  gap: CaseGap,
  forecast: Forecast | null = FORECAST,
  part: CaseSetPart = 'testing',
): PlacedCase {
  return { place: { kind: part, gap }, forecast };
}

/** A case in one of the separate counts. */
function counted(
  kind: Exclude<CasePlace['kind'], CaseSetPart>,
  gap: CaseGap | null,
  forecast: Forecast | null = FORECAST,
): PlacedCase {
  return { place: { kind, gap }, forecast };
}

/** A tested case whose gap in the direction of its forecast, announced at 0.95, is `gap`. */
function directed(caseId: number, gap: number, direction: VerdictDirection): PlacedCase {
  const sign = direction === 'increase' ? 1 : -1;
  return tested(gapOf(caseId, sign * gap), {
    ...FORECAST,
    direction,
    announcedMeanGap: sign * 0.95,
  });
}

function valuesIn(cases: readonly PlacedCase[], part: CaseSetPart = 'testing'): CaseSetValues {
  return caseSetValues(cases, part, DEFAULTS);
}

/** Ten gaps of 1: a noise of 1 ÷ √10, the floor, and a range of 1 ± 2 ÷ √10. */
const TEN_GAPS_OF_ONE = {
  meanGap: near(1),
  count: MINIMUM,
  expectedNoise: near(1 / Math.sqrt(MINIMUM)),
  rangeLow: near(1 - 2 / Math.sqrt(MINIMUM)),
  rangeHigh: near(1 + 2 / Math.sqrt(MINIMUM)),
};

/** A gap summary's mean and count. */
function summaryOf(summary: GapSummary | null): readonly number[] | null {
  return summary === null ? null : [summary.meanGap, summary.count];
}

/** The mean gap of the exits of a row with these exit cases and regrouping exits. */
function exitMean(cases: readonly PlacedCase[], exitGaps: readonly number[]): number | undefined {
  return separateCounts(cases, exitGaps).exit.meanGapInForecastDirection?.meanGap;
}

/** A post-tip-off count, its mean gap and the number of gaps behind it. */
function touchedOf({ count, meanGapInForecastDirection: meanGap }: TouchedCount): unknown[] {
  return [count, ...(summaryOf(meanGap) ?? [null, null])];
}

describe('caseSetValues', () => {
  it('[SUI-24] [CL-SUI-15] counts the categories beside the chance-expected counts of the cases with a forecast', () => {
    const values = valuesIn([
      directed(1, 0.25, 'increase'),
      directed(2, 0.9, 'decrease'),
      directed(3, -0.25, 'decrease'),
      directed(4, 0.24, 'increase'),
      tested(gapOf(5, 1.2), null),
      tested(gapOf(6, -1.2), null),
    ]);
    expect(values.categoryCounts).toStrictEqual({
      withForecast: 4,
      confirmed: 2,
      refuted: 1,
      neutral: 1,
      noForecast: 2,
    });
    // 4 × (1 − Φ(0.25)) and 4 × (2Φ(0.25) − 1), Φ(0.25) = 0.5987063256829237.
    expect(values.chanceExpectedCounts).toStrictEqual({
      confirmed: near(1.6051746972683052),
      refuted: near(1.6051746972683052),
      neutral: near(0.7896506054633896),
    });
  });

  it('[SUI-24] gives the mean gap in the forecast direction with its range, the announced gap, and the mean normalized gap of every case', () => {
    const values = valuesIn([
      tested(gapOf(1, -0.4), { ...FORECAST, direction: 'decrease', announcedMeanGap: -0.6 }),
      tested(gapOf(2, 0.2), { ...FORECAST, announcedMeanGap: 0.8 }),
      tested(gapOf(3, 1), null),
    ]);
    expect({
      meanGap: values.meanGapInForecastDirection,
      announcedGap: values.announcedGap,
      trackedMeanGap: summaryOf(values.trackedMeanGap),
    }).toStrictEqual({
      // Two gaps whose dispersion is retained at 1: a noise of 1 ÷ √2.
      meanGap: {
        meanGap: near(0.3),
        count: 2,
        expectedNoise: near(Math.SQRT1_2),
        rangeLow: near(0.3 - Math.SQRT2),
        rangeHigh: near(0.3 + Math.SQRT2),
      },
      announcedGap: near(0.7),
      trackedMeanGap: [near(0.8 / 3), 3],
    });
  });

  it('[SUI-24] gives a set without a case no count, no mean, and too few cases', () => {
    expect(valuesIn([])).toStrictEqual({
      categoryCounts: NO_CASE,
      chanceExpectedCounts: { confirmed: 0, refuted: 0, neutral: 0 },
      meanGapInForecastDirection: null,
      announcedGap: null,
      assessment: { tooFew: 0 },
      trackedMeanGap: null,
    });
  });

  it('[SUI-25] [CL-SUI-08] gives the late-forecast part the same values and its own assessment, at the same minimum, apart from the testing set', () => {
    const lateForecast = { ...FORECAST, announcedMeanGap: 1 };
    const cases = [
      ...Array.from({ length: MINIMUM }, (_, index) =>
        tested(gapOf(index + 1, 1), lateForecast, 'late'),
      ),
      tested(gapOf(MINIMUM + 1, 0.1)),
      counted('excluded', gapOf(MINIMUM + 2, 0.5)),
    ];
    expect(valuesIn(cases, 'late')).toStrictEqual({
      categoryCounts: { ...NO_CASE, withForecast: MINIMUM, confirmed: MINIMUM },
      chanceExpectedCounts: {
        confirmed: near(MINIMUM * 0.4012936743170763),
        refuted: near(MINIMUM * 0.4012936743170763),
        neutral: near(MINIMUM * 0.1974126513658474),
      },
      meanGapInForecastDirection: TEN_GAPS_OF_ONE,
      announcedGap: near(1),
      assessment: 'confirmed',
      trackedMeanGap: TEN_GAPS_OF_ONE,
    });
    expect(valuesIn(cases)).toMatchObject({
      categoryCounts: { ...NO_CASE, withForecast: 1, neutral: 1 },
      assessment: { tooFew: 1 },
    });
  });

  it('[CA-SUI-17] gives a pair with gaps of +0.9, -0.4 and +0.7 in the forecast direction 2 confirmed and 1 refuted, a mean of +0.40 from -0.75 to +1.55, and too few tracked cases (3 of 10)', () => {
    const values = valuesIn([
      directed(1, 0.9, 'increase'),
      directed(2, -0.4, 'decrease'),
      directed(3, 0.7, 'decrease'),
    ]);
    expect(values.categoryCounts).toStrictEqual({
      ...NO_CASE,
      withForecast: 3,
      confirmed: 2,
      refuted: 1,
    });
    // The dispersion of 0.70 is retained at 1: a range of 0.40 ± 2 ÷ √3.
    expect(values.meanGapInForecastDirection).toStrictEqual({
      meanGap: near(0.4),
      count: 3,
      expectedNoise: near(1 / Math.sqrt(3)),
      rangeLow: near(0.4 - 2 / Math.sqrt(3)),
      rangeHigh: near(0.4 + 2 / Math.sqrt(3)),
    });
    expect(values.meanGapInForecastDirection).toMatchObject({
      meanGap: printed(0.4),
      rangeLow: printed(-0.75),
      rangeHigh: printed(1.55),
    });
    expect([values.assessment, MINIMUM]).toStrictEqual([{ tooFew: 3 }, 10]);
  });

  it('[CA-SUI-18] assesses twelve cases with a mean of +0.23 below the bar of 0.58, and an announced gap of 0.95 above it by 0.72, as refuted', () => {
    const gaps = [0.9, -0.3, 0.4, 1.2, -0.8, 0.1, 0.6, -0.2, 0.5, 0.3, -0.6, 0.7];
    const values = valuesIn(
      gaps.map((gap, index) => directed(index + 1, gap, index % 2 === 0 ? 'increase' : 'decrease')),
    );
    const meanGap = present(values.meanGapInForecastDirection);
    const bar = DEFAULTS.sensitivity.possibleSignalToNoise * meanGap.expectedNoise;
    expect(values.categoryCounts).toStrictEqual({
      ...NO_CASE,
      withForecast: 12,
      confirmed: 7,
      refuted: 3,
      neutral: 2,
    });
    // The observed dispersion of 0.61 is retained at 1: an expected noise of 1 ÷ √12.
    expect({
      meanGap: meanGap.meanGap,
      dispersion: verdictQuantities(gaps)?.gapDispersion,
      retained: meanGap.expectedNoise * Math.sqrt(gaps.length),
      noise: meanGap.expectedNoise,
      bar,
      isBelowBar: meanGap.meanGap < bar,
      announcedGap: values.announcedGap,
      excess: present(values.announcedGap) - meanGap.meanGap,
    }).toStrictEqual({
      meanGap: printed(0.23),
      dispersion: printed(0.61),
      retained: near(1),
      noise: printed(0.289, NOISE_DIGITS),
      bar: printed(0.58),
      isBelowBar: true,
      announcedGap: near(0.95),
      excess: printed(0.72),
    });
    expect(values.assessment).toBe('refuted');
  });
});

describe('separateCounts', () => {
  it('[SUI-25] counts the cases recorded after tip-off, excluded, not measurable and pending, and none of the testing set', () => {
    const counts = separateCounts(
      [
        counted('recorded_after_tip_off', gapOf(1, 0.5)),
        counted('excluded', gapOf(2, 0.5)),
        counted('excluded', gapOf(3, -0.5)),
        counted('not_measurable', null),
        counted('awaiting_game', null),
        tested(gapOf(4, 0.5)),
        tested(gapOf(5, 0.5), FORECAST, 'late'),
      ],
      [],
    );
    expect(counts).toStrictEqual({
      recordedAfterTipOff: 1,
      excluded: 2,
      notMeasurable: 1,
      awaitingGame: 1,
      exit: NO_TOUCH,
      entry: NO_TOUCH,
      measuredGameChange: NO_TOUCH,
    });
  });

  it('[SUI-25] [SUI-17] [CL-SUI-10] [CL-SUI-16] counts each post-tip-off effect with the mean gap in the forecast direction of its cases with a gap and a forecast, the regrouping exits among the exits', () => {
    const counts = separateCounts(
      [
        counted('exit', gapOf(1, 0.8)),
        counted('exit', gapOf(2, -0.5), { ...FORECAST, direction: 'decrease' }),
        counted('entry', gapOf(3, 0.3)),
        counted('entry', gapOf(4, 2), null),
        counted('measured_game_change', null),
        counted('measured_game_change', gapOf(6, -0.2)),
      ],
      [0.6, null, -0.2],
    );
    expect({
      exit: touchedOf(counts.exit),
      entry: touchedOf(counts.entry),
      measuredGameChange: touchedOf(counts.measuredGameChange),
    }).toStrictEqual({
      exit: [5, near((0.8 + 0.5 - 0.2 + 0.6) / 4), 4],
      entry: [2, near(0.3), 1],
      measuredGameChange: [2, near(-0.2), 1],
    });
  });
});

describe('the sums of a row', () => {
  it('[SUI-24] [SUI-25] [CL-STA-09] run in the order of the measured games, then of the cases, and the exits by gap, to the bit, whatever the input order', () => {
    // (0.1 + 0.2) + 0.3 is 0.6000000000000001 and (0.3 + 0.2) + 0.1 is 0.6.
    const mean = (0.1 + 0.2 + 0.3) / 3;
    const inReverse = [0.3, 0.2, 0.1];
    // Case 3 holds the latest game: the cases sum from case 1 to case 3.
    const gaps = inReverse.map((gap, index) => gapOf(3 - index, gap));
    const values = valuesIn(gaps.map((gap) => tested(gap)));
    expect([
      values.meanGapInForecastDirection?.meanGap,
      values.trackedMeanGap?.meanGap,
      exitMean(
        gaps.map((gap) => counted('exit', gap)),
        [],
      ),
      exitMean([], inReverse),
    ]).toStrictEqual([mean, mean, mean, mean]);
  });
});

// Arbitrary cases of a row, in either part, with or without a forecast.
const caseSeed = fc.record({
  gap: fc.double({ min: -3, max: 3, noNaN: true }),
  direction: fc.constantFrom<VerdictDirection | null>('increase', 'decrease', null),
  part: fc.constantFrom<CaseSetPart>('testing', 'late'),
});
const shuffledCases = fc
  .array(caseSeed, { maxLength: 30, size: 'max' })
  .map((seeds) =>
    seeds.map(({ gap, direction, part }, index) =>
      tested(gapOf(index + 1, gap), direction === null ? null : { ...FORECAST, direction }, part),
    ),
  )
  .chain((cases) =>
    fc.tuple(fc.constant(cases), fc.shuffledSubarray(cases, { minLength: cases.length })),
  );

describe('caseSetValues, for any cases', () => {
  it('[SUI-24] [CL-SUI-15] [CL-STA-09] splits the cases of its part with a forecast into the categories, beside chance-expected counts that sum to them, to the bit in any order', () => {
    fc.assert(
      fc.property(shuffledCases, ([cases, shuffled]) => {
        const values = valuesIn(cases);
        const { categoryCounts: counts, chanceExpectedCounts: chance } = values;
        const testingCount = cases.filter(({ place }) => place.kind === 'testing').length;
        expect(counts.confirmed + counts.refuted + counts.neutral).toBe(counts.withForecast);
        expect(counts.withForecast + counts.noForecast).toBe(testingCount);
        expect(chance.confirmed + chance.refuted + chance.neutral).toBeCloseTo(
          counts.withForecast,
          DIGITS,
        );
        expect(valuesIn(shuffled)).toStrictEqual(values);
      }),
    );
  });
});

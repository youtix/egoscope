import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { countingPeriods, firstUncoveredOn } from './counting';

import type { CoveredPeriod, TypeCoverage } from './counting';

// The first NBA game of player A in the example of spec 05.
const FIRST_GAME = '2019-10-23';

const UNDER_V1: CoveredPeriod = {
  startOn: '2019-10-23',
  endOn: '2021-06-30',
  sheetVersionNumber: 1,
};
const UNDER_V2: CoveredPeriod = {
  startOn: '2021-07-01',
  endOn: '2023-06-30',
  sheetVersionNumber: 2,
};
const UNDER_V3: CoveredPeriod = {
  startOn: '2023-07-01',
  endOn: '2025-06-30',
  sheetVersionNumber: 3,
};
// A period that a type born of a split inherited (CL-BKT-06).
const INHERITED: CoveredPeriod = {
  startOn: '2019-10-23',
  endOn: '2024-06-30',
  sheetVersionNumber: 0,
};

type Span = readonly [startOn: string, endOn: string];

/** The coverage of a type never broadened, its spans researched under version 1. */
function coverageOf(...spans: readonly Span[]): TypeCoverage {
  return {
    coveredPeriods: spans.map(([startOn, endOn]) => ({ startOn, endOn, sheetVersionNumber: 1 })),
    latestBroadeningVersion: undefined,
  };
}

// --- Days as offsets, for the properties -----------------------------------------

// Offsets count days from 2019-10-01.
const ORIGIN = Date.UTC(2019, 9, 1);
const MS_PER_DAY = 86_400_000;

/** The date `offset` days after 2019-10-01, written YYYY-MM-DD. */
function dayAt(offset: number): string {
  return new Date(ORIGIN + offset * MS_PER_DAY).toISOString().slice(0, 10);
}

function dayOrUnknown(offset: number | undefined): string | undefined {
  return offset === undefined ? undefined : dayAt(offset);
}

type OffsetPeriod = Readonly<{ start: number; length: number; version: number }>;

const offsetPeriod: fc.Arbitrary<OffsetPeriod> = fc.record({
  start: fc.integer({ min: 0, max: 60 }),
  length: fc.integer({ min: 0, max: 12 }),
  version: fc.integer({ min: 0, max: 3 }),
});
const offsetPeriods = fc.array(offsetPeriod, { maxLength: 6 });
const broadeningVersion = fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined });
const firstGameOffset = fc.option(fc.integer({ min: 0, max: 80 }), { nil: undefined });

function coverageFrom(
  periods: readonly OffsetPeriod[],
  latestBroadeningVersion: number | undefined,
): TypeCoverage {
  return {
    coveredPeriods: periods.map(({ start, length, version }) => ({
      startOn: dayAt(start),
      endOn: dayAt(start + length),
      sheetVersionNumber: version,
    })),
    latestBroadeningVersion,
  };
}

function isWithin(day: number, period: OffsetPeriod): boolean {
  return period.start <= day && day <= period.start + period.length;
}

function uncoveredAfter(day: number, counting: readonly OffsetPeriod[]): number {
  return counting.some((period) => isWithin(day, period)) ? uncoveredAfter(day + 1, counting) : day;
}

/** The first uncovered day as an offset, found day by day from the start of the career. */
function firstUncoveredByDay(
  periods: readonly OffsetPeriod[],
  latestBroadeningVersion: number | undefined,
  firstGame: number | undefined,
): number | undefined {
  const counting = periods.filter(
    (period) => latestBroadeningVersion === undefined || period.version >= latestBroadeningVersion,
  );
  const careerStart = firstGame ?? Math.min(...counting.map((period) => period.start));
  return Number.isFinite(careerStart) ? uncoveredAfter(careerStart, counting) : undefined;
}

describe('countingPeriods', () => {
  it('[BKT-09] [CL-BKT-05] counts every period of a type that was never broadened', () => {
    const coverage = {
      coveredPeriods: [UNDER_V1, UNDER_V2, UNDER_V3],
      latestBroadeningVersion: undefined,
    };

    expect(countingPeriods(coverage)).toStrictEqual([UNDER_V1, UNDER_V2, UNDER_V3]);
  });

  it('[BKT-09] [CL-BKT-05] counts only the periods researched under the latest broadening version or a later one', () => {
    const coverage = { coveredPeriods: [UNDER_V3, UNDER_V1, UNDER_V2], latestBroadeningVersion: 2 };

    expect(countingPeriods(coverage)).toStrictEqual([UNDER_V3, UNDER_V2]);
  });

  it.each([
    ['stops counting them once its version 1 broadens it', 1, []],
    ['keeps counting them when its version 1 does not broaden it', undefined, [INHERITED]],
  ] as const)(
    '[CL-BKT-06] reads the periods a split type inherited under version 0: %s',
    (_, latestBroadeningVersion, expected) => {
      const coverage = { coveredPeriods: [INHERITED], latestBroadeningVersion };

      expect(countingPeriods(coverage)).toStrictEqual(expected);
    },
  );
});

describe('firstUncoveredOn', () => {
  /** A coverage that the search walks through, and the first day it leaves uncovered. */
  type Walk = Readonly<{
    name: string;
    firstNbaGameOn: string;
    spans: readonly Span[];
    expected: string;
  }>;

  it("[BKT-09] [CL-BKT-05] finds 2022-07-01 in the ruling's example, where a hole follows the first span", () => {
    const coverage = coverageOf(['2019-10-23', '2022-06-30'], ['2023-07-01', '2025-06-30']);

    expect(firstUncoveredOn(coverage, FIRST_GAME)).toBe('2022-07-01');
  });

  it('[BKT-09] [CL-BKT-05] starts the career on the first NBA game, uncovered when no counting period holds it', () => {
    expect(firstUncoveredOn(coverageOf(['2019-10-23', '2022-06-30']), '2018-10-17')).toBe(
      '2018-10-17',
    );
  });

  it('[BKT-09] [CL-BKT-05] starts the career on the earliest counting period while the first NBA game is unknown', () => {
    const coverage = coverageOf(['2023-07-01', '2025-06-30'], ['2019-10-23', '2022-06-30']);

    expect(firstUncoveredOn(coverage, undefined)).toBe('2022-07-01');
  });

  it.each([
    ['no covered period', []],
    ['periods older than its broadening only', [UNDER_V1]],
  ] as const)(
    '[BKT-09] [CL-BKT-05] leaves the day unknown with no first NBA game and %s',
    (_, coveredPeriods) => {
      expect(
        firstUncoveredOn({ coveredPeriods, latestBroadeningVersion: 2 }, undefined),
      ).toBeUndefined();
    },
  );

  it('[BKT-09] [CL-BKT-05] gives the career start to a type covered only before its latest broadening', () => {
    const coverage = { coveredPeriods: [UNDER_V1, UNDER_V2], latestBroadeningVersion: 3 };

    expect(firstUncoveredOn(coverage, FIRST_GAME)).toBe(FIRST_GAME);
  });

  it.each<Walk>([
    {
      name: 'a period that ends on the first NBA game',
      firstNbaGameOn: '2021-01-15',
      spans: [['2019-10-23', '2021-01-15']],
      expected: '2021-01-16',
    },
    {
      name: 'a period that starts before the first NBA game',
      firstNbaGameOn: FIRST_GAME,
      spans: [['2019-06-20', '2020-06-30']],
      expected: '2020-07-01',
    },
    {
      name: 'a period over before the first NBA game',
      firstNbaGameOn: FIRST_GAME,
      spans: [['2018-10-17', '2019-06-30']],
      expected: FIRST_GAME,
    },
    {
      name: 'adjacent periods',
      firstNbaGameOn: FIRST_GAME,
      spans: [
        ['2019-10-23', '2022-06-30'],
        ['2022-07-01', '2023-06-30'],
      ],
      expected: '2023-07-01',
    },
    {
      name: 'overlapping periods',
      firstNbaGameOn: FIRST_GAME,
      spans: [
        ['2021-01-01', '2023-06-30'],
        ['2019-10-23', '2022-06-30'],
      ],
      expected: '2023-07-01',
    },
    {
      name: 'a period inside another',
      firstNbaGameOn: FIRST_GAME,
      spans: [
        ['2019-10-23', '2023-06-30'],
        ['2020-01-01', '2020-06-30'],
      ],
      expected: '2023-07-01',
    },
    {
      name: 'a one-day period after another',
      firstNbaGameOn: FIRST_GAME,
      spans: [
        ['2019-10-23', '2022-06-30'],
        ['2022-07-01', '2022-07-01'],
      ],
      expected: '2022-07-02',
    },
  ])('[BKT-09] [CL-BKT-05] walks past $name', ({ firstNbaGameOn, spans, expected }) => {
    expect(firstUncoveredOn(coverageOf(...spans), firstNbaGameOn)).toBe(expected);
  });

  it.each([
    ['a month', '2022-04-30', '2022-05-01'],
    ['a year', '2025-12-31', '2026-01-01'],
    ['February in a leap year', '2024-02-28', '2024-02-29'],
    ['a leap day', '2024-02-29', '2024-03-01'],
    ['February in a common year', '2023-02-28', '2023-03-01'],
  ])(
    '[BKT-09] [CL-BKT-05] finds the day after a coverage that ends with %s',
    (_, endOn, expected) => {
      expect(firstUncoveredOn(coverageOf([FIRST_GAME, endOn]), FIRST_GAME)).toBe(expected);
    },
  );

  it('[BKT-09] [CL-BKT-05] finds the first day from the start of the career that no counting period holds', () => {
    fc.assert(
      fc.property(
        offsetPeriods,
        broadeningVersion,
        firstGameOffset,
        (periods, latest, firstGame) => {
          const expected = firstUncoveredByDay(periods, latest, firstGame);

          expect(firstUncoveredOn(coverageFrom(periods, latest), dayOrUnknown(firstGame))).toBe(
            dayOrUnknown(expected),
          );
        },
      ),
    );
  });
});

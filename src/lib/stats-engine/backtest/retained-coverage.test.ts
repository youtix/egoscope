import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isTypeCovered, retainedCoverage } from './retained-coverage';

import type { CoveredPeriod, TypeCoverage } from './counting';
import type { RequestedType } from './extents';
import type {
  CoverageGap,
  CoverageWarning,
  DeclaredCoverage,
  RetainedCoverage,
  RetainedPeriod,
} from './retained-coverage';

// Player A of spec 05: his first NBA game, and the day of the request in its examples.
const FIRST_GAME = '2019-10-23';
const CREATED = '2026-11-11';

/** A requested type with its period. */
function asked(eventTypeId: string, startOn: string | undefined, endOn: string): RequestedType {
  return { eventTypeId, periodStartOn: startOn, periodEndOn: endOn };
}

/** The coverage that a result declares. */
function declaredAs(
  coveredTypes: readonly string[],
  startOn: string,
  endOn: string,
): DeclaredCoverage {
  return { coveredTypes, startOn, endOn };
}

function kept(eventTypeId: string, startOn: string, endOn: string): RetainedPeriod {
  return { eventTypeId, startOn, endOn };
}

function gap(eventTypeId: string, startOn: string | undefined, endOn: string): CoverageGap {
  return { eventTypeId, startOn, endOn };
}

function ignored(...declaredTypes: readonly string[]): CoverageWarning {
  return { kind: 'declared_type_not_requested', detail: declaredTypes };
}

const CLAMPED: CoverageWarning = { kind: 'covered_period_clamped' };

function retention(
  retainedPeriods: readonly RetainedPeriod[],
  coverageGaps: readonly CoverageGap[] = [],
  resultWarnings: readonly CoverageWarning[] = [],
): RetainedCoverage {
  return { retainedPeriods, coverageGaps, resultWarnings };
}

// --- Days as offsets, for the properties -----------------------------------------

// Offsets count days from 2019-10-01; every period of the properties lies within the
// first LAST_OFFSET days.
const ORIGIN = Date.UTC(2019, 9, 1);
const MS_PER_DAY = 86_400_000;
const LAST_OFFSET = 60;

/** The date `offset` days after 2019-10-01, written YYYY-MM-DD. */
function dayAt(offset: number): string {
  return new Date(ORIGIN + offset * MS_PER_DAY).toISOString().slice(0, 10);
}

function dayOrUnknown(offset: number | undefined): string | undefined {
  return offset === undefined ? undefined : dayAt(offset);
}

const EVERY_DAY = Array.from({ length: LAST_OFFSET + 1 }, (_, offset) => dayAt(offset));
const TYPE_IDS = ['bereavement', 'media-storm', 'player-conflict'];

const offset = fc.integer({ min: 0, max: LAST_OFFSET });
const span = fc
  .tuple(offset, offset)
  .map(([one, other]) => ({ start: Math.min(one, other), end: Math.max(one, other) }));
const requestedTypes = fc
  .uniqueArray(
    fc.record({ eventTypeId: fc.constantFrom(...TYPE_IDS), span, isOpen: fc.boolean() }),
    {
      selector: ({ eventTypeId }) => eventTypeId,
      minLength: 1,
      maxLength: TYPE_IDS.length,
    },
  )
  .map((types) =>
    types.map(({ eventTypeId, span: { start, end }, isOpen }) =>
      asked(eventTypeId, dayOrUnknown(isOpen ? undefined : start), dayAt(end)),
    ),
  );
// A declared period may end before it starts, as after the recovery of a cut result.
const declaredCoverages = fc
  .record({ coveredTypes: fc.subarray([...TYPE_IDS, 'birthday']), start: offset, end: offset })
  .map(({ coveredTypes, start, end }) => declaredAs(coveredTypes, dayAt(start), dayAt(end)));
const firstGames = fc.option(offset, { nil: undefined }).map(dayOrUnknown);

type Import = Readonly<{
  request: readonly RequestedType[];
  declared: DeclaredCoverage;
  firstNbaGameOn: string | undefined;
}>;

/** Whether a period holds a day, an unknown start never coming after it. */
function isWithin(
  period: Readonly<{ startOn: string | undefined; endOn: string }>,
  day: string,
): boolean {
  return (period.startOn ?? '') <= day && day <= period.endOn;
}

/** Whether a retained period holds a day outside its type's requested period or the declared one. */
function isBeyondPeriods(period: RetainedPeriod, testImport: Import): boolean {
  const { request, declared, firstNbaGameOn } = testImport;
  const type = request.find(({ eventTypeId }) => eventTypeId === period.eventTypeId);
  const requested = {
    startOn: type?.periodStartOn ?? firstNbaGameOn,
    endOn: type?.periodEndOn ?? '',
  };
  return (
    !declared.coveredTypes.includes(period.eventTypeId) ||
    period.startOn > period.endOn ||
    !isWithin(requested, period.startOn) ||
    !isWithin(requested, period.endOn) ||
    !isWithin(declared, period.startOn) ||
    !isWithin(declared, period.endOn)
  );
}

/**
 * The days that an import's result places wrongly for a requested type, his first NBA
 * game known: a day that its requested period and the declaration both hold must be
 * retained, any other requested day must be a gap, and no other day may be either.
 */
function misplacedDays(
  type: RequestedType,
  { declared, firstNbaGameOn }: Import,
  result: RetainedCoverage,
): readonly string[] {
  const requested = {
    startOn: type.periodStartOn ?? firstNbaGameOn ?? '',
    endOn: type.periodEndOn,
  };
  const isDeclared = declared.coveredTypes.includes(type.eventTypeId);
  const ofType = <T extends Readonly<{ eventTypeId: string }>>(items: readonly T[]): readonly T[] =>
    items.filter(({ eventTypeId }) => eventTypeId === type.eventTypeId);
  return EVERY_DAY.filter((day) => {
    const isKept = isWithin(requested, day) && isDeclared && isWithin(declared, day);
    const isGap = isWithin(requested, day) && !isKept;
    return (
      ofType(result.retainedPeriods).some((period) => isWithin(period, day)) !== isKept ||
      ofType(result.coverageGaps).some((period) => isWithin(period, day)) !== isGap
    );
  });
}

describe('retainedCoverage', () => {
  it('[IMP-10] keeps the whole requested period of each type that a result declares covered over it', () => {
    const request = [
      asked('public-humiliation', FIRST_GAME, CREATED),
      asked('record-approach', FIRST_GAME, CREATED),
    ];
    const declared = declaredAs(['public-humiliation', 'record-approach'], FIRST_GAME, CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention([
        kept('public-humiliation', FIRST_GAME, CREATED),
        kept('record-approach', FIRST_GAME, CREATED),
      ]),
    );
  });

  it("[IMP-10] keeps for each type the days that its own requested period shares with the declared period, which lies within the request's", () => {
    // A supplement: player-conflict from its first uncovered day, media-storm, validated
    // since, over the whole career; the result declares the request's whole period.
    const request = [
      asked('player-conflict', '2022-07-01', CREATED),
      asked('media-storm', FIRST_GAME, CREATED),
    ];
    const declared = declaredAs(['player-conflict', 'media-storm'], FIRST_GAME, CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention([
        kept('player-conflict', '2022-07-01', CREATED),
        kept('media-storm', FIRST_GAME, CREATED),
      ]),
    );
  });

  it('[IMP-10] ignores the declared types outside the request, with one warning that names them as read, in their order', () => {
    const request = [asked('media-storm', FIRST_GAME, CREATED)];
    const declared = declaredAs(['not-a-type', 'media-storm', 'Racist-Abuse'], FIRST_GAME, CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention(
        [kept('media-storm', FIRST_GAME, CREATED)],
        [],
        [ignored('not-a-type', 'Racist-Abuse')],
      ),
    );
  });

  it('[IMP-10] [CL-BKT-03] [CL-IMP-29] never lets a calendar-derived type declared covered into the retained coverage, and warns', () => {
    const request = [asked('media-storm', FIRST_GAME, CREATED)];
    const declared = declaredAs(['birthday', 'media-storm', 'former-team'], FIRST_GAME, CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention(
        [kept('media-storm', FIRST_GAME, CREATED)],
        [],
        [ignored('birthday', 'former-team')],
      ),
    );
  });

  it.each([
    ['before its start', '2019-07-01', CREATED],
    ['after its end', FIRST_GAME, '2026-12-31'],
    ['on both sides', '2019-07-01', '2026-12-31'],
  ])(
    '[IMP-10] brings back a declared period that goes beyond the requested one %s, with a warning',
    (_, startOn, endOn) => {
      const declared = declaredAs(['bereavement'], startOn, endOn);

      expect(
        retainedCoverage([asked('bereavement', FIRST_GAME, CREATED)], declared, FIRST_GAME),
      ).toStrictEqual(retention([kept('bereavement', FIRST_GAME, CREATED)], [], [CLAMPED]));
    },
  );

  it('[IMP-10] gives the requested days before and after the declared period as gaps', () => {
    const declared = declaredAs(['bereavement'], '2020-07-01', '2025-06-30');

    expect(
      retainedCoverage([asked('bereavement', FIRST_GAME, CREATED)], declared, FIRST_GAME),
    ).toStrictEqual(
      retention(
        [kept('bereavement', '2020-07-01', '2025-06-30')],
        [gap('bereavement', FIRST_GAME, '2020-06-30'), gap('bereavement', '2025-07-01', CREATED)],
      ),
    );
  });

  it('[IMP-10] keeps the one day that the two periods share, the requested days before it a gap', () => {
    const declared = declaredAs(['bereavement'], CREATED, '2027-06-30');

    expect(
      retainedCoverage([asked('bereavement', FIRST_GAME, CREATED)], declared, FIRST_GAME),
    ).toStrictEqual(
      retention(
        [kept('bereavement', CREATED, CREATED)],
        [gap('bereavement', FIRST_GAME, '2026-11-10')],
        [CLAMPED],
      ),
    );
  });

  it('[IMP-10] gives the one requested day after the declared period as a gap', () => {
    const declared = declaredAs(['bereavement'], FIRST_GAME, '2026-11-10');

    expect(
      retainedCoverage([asked('bereavement', FIRST_GAME, CREATED)], declared, FIRST_GAME),
    ).toStrictEqual(
      retention(
        [kept('bereavement', FIRST_GAME, '2026-11-10')],
        [gap('bereavement', CREATED, CREATED)],
      ),
    );
  });

  it('[IMP-10] gives a requested type that the result does not declare its whole requested period as a gap', () => {
    const request = [
      asked('media-storm', FIRST_GAME, CREATED),
      asked('bereavement', '2022-07-01', CREATED),
    ];
    const declared = declaredAs(['media-storm'], FIRST_GAME, CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention(
        [kept('media-storm', FIRST_GAME, CREATED)],
        [gap('bereavement', '2022-07-01', CREATED)],
      ),
    );
  });

  it('[IMP-10] retains nothing of a type whose requested period the declared period misses, its whole period a gap', () => {
    // The result of CA-BKT-08, covered up to 2022-06-30, for a request whose bereavement
    // starts after that day.
    const request = [
      asked('bereavement', '2022-07-01', CREATED),
      asked('media-storm', FIRST_GAME, CREATED),
    ];
    const declared = declaredAs(['bereavement', 'media-storm'], FIRST_GAME, '2022-06-30');

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention(
        [kept('media-storm', FIRST_GAME, '2022-06-30')],
        [gap('bereavement', '2022-07-01', CREATED), gap('media-storm', '2022-07-01', CREATED)],
      ),
    );
  });

  it("[IMP-10] reads the request's period from the earliest start of its types to their latest end", () => {
    const request = [
      asked('bereavement', '2022-07-01', '2023-06-14'),
      asked('media-storm', FIRST_GAME, CREATED),
    ];
    const declared = declaredAs(['bereavement', 'media-storm'], FIRST_GAME, CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention([
        kept('bereavement', '2022-07-01', '2023-06-14'),
        kept('media-storm', FIRST_GAME, CREATED),
      ]),
    );
  });

  it("[IMP-10] reads the request's period over the requested types that the result does not declare too", () => {
    // The prompt asked bereavement over the whole career, and media-storm from 2022-07-01.
    const request = [
      asked('bereavement', FIRST_GAME, CREATED),
      asked('media-storm', '2022-07-01', CREATED),
    ];
    const declared = declaredAs(['media-storm'], FIRST_GAME, CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention(
        [kept('media-storm', '2022-07-01', CREATED)],
        [gap('bereavement', FIRST_GAME, CREATED)],
      ),
    );
  });

  it('[IMP-10] [IMP-12] starts a period requested from his first NBA game, its date unknown, on the declared start, and keeps a whole-period gap open', () => {
    const request = [
      asked('media-storm', undefined, CREATED),
      asked('bereavement', undefined, CREATED),
    ];
    const declared = declaredAs(['media-storm'], '2019-10-30', '2025-06-30');

    expect(retainedCoverage(request, declared, undefined)).toStrictEqual(
      retention(
        [kept('media-storm', '2019-10-30', '2025-06-30')],
        [gap('media-storm', '2025-07-01', CREATED), gap('bereavement', undefined, CREATED)],
      ),
    );
  });

  it('[IMP-10] starts a period requested from his first NBA game on that game once the app knows its date', () => {
    const request = [
      asked('media-storm', undefined, CREATED),
      asked('bereavement', undefined, CREATED),
    ];
    const declared = declaredAs(['media-storm'], '2020-07-01', CREATED);

    expect(retainedCoverage(request, declared, FIRST_GAME)).toStrictEqual(
      retention(
        [kept('media-storm', '2020-07-01', CREATED)],
        [gap('media-storm', FIRST_GAME, '2020-06-30'), gap('bereavement', FIRST_GAME, CREATED)],
      ),
    );
  });

  it('[IMP-10] brings a declared start before his first NBA game back to it once the app knows its date, with a warning', () => {
    const declared = declaredAs(['media-storm'], '2019-07-01', CREATED);

    expect(
      retainedCoverage([asked('media-storm', undefined, CREATED)], declared, FIRST_GAME),
    ).toStrictEqual(retention([kept('media-storm', FIRST_GAME, CREATED)], [], [CLAMPED]));
  });

  it('[IMP-10] [CL-IMP-18] retains nothing of a recovered result whose shortened period ends before it starts, every requested day a gap', () => {
    // A supplement while his first NBA game is unknown: public-humiliation from its first
    // uncovered day, racist-abuse over the whole career. The first event recovered is
    // dated on the declared start, so the period ends the day before.
    const request = [
      asked('public-humiliation', '2022-07-01', CREATED),
      asked('racist-abuse', undefined, CREATED),
    ];
    const declared = declaredAs(['public-humiliation', 'racist-abuse'], FIRST_GAME, '2019-10-22');

    expect(retainedCoverage(request, declared, undefined)).toStrictEqual(
      retention(
        [],
        [gap('public-humiliation', '2022-07-01', CREATED), gap('racist-abuse', undefined, CREATED)],
      ),
    );
  });

  it('[IMP-10] never retains a day outside the requested period or the declared period', () => {
    fc.assert(
      fc.property(
        requestedTypes,
        declaredCoverages,
        firstGames,
        (request, declared, firstNbaGameOn) => {
          const testImport = { request, declared, firstNbaGameOn };
          const { retainedPeriods } = retainedCoverage(request, declared, firstNbaGameOn);

          expect(
            retainedPeriods.filter((period) => isBeyondPeriods(period, testImport)),
          ).toStrictEqual([]);
        },
      ),
    );
  });

  it('[IMP-10] retains each requested day that the result declares and leaves each other requested day a gap, once his first NBA game is known', () => {
    fc.assert(
      fc.property(requestedTypes, declaredCoverages, offset, (request, declared, firstGame) => {
        const testImport = { request, declared, firstNbaGameOn: dayAt(firstGame) };
        const result = retainedCoverage(request, declared, testImport.firstNbaGameOn);

        expect(request.flatMap((type) => misplacedDays(type, testImport, result))).toStrictEqual(
          [],
        );
      }),
    );
  });
});

describe('isTypeCovered', () => {
  const UNDER_V1: CoveredPeriod = {
    startOn: FIRST_GAME,
    endOn: '2022-06-30',
    sheetVersionNumber: 1,
  };
  // A period that a type born of a split inherited (CL-BKT-06).
  const INHERITED: CoveredPeriod = {
    startOn: FIRST_GAME,
    endOn: '2024-06-30',
    sheetVersionNumber: 0,
  };

  it.each<readonly [string, TypeCoverage]>([
    [
      'under the version in force',
      { coveredPeriods: [UNDER_V1], latestBroadeningVersion: undefined },
    ],
    [
      'only under a version older than its latest broadening',
      { coveredPeriods: [UNDER_V1], latestBroadeningVersion: 2 },
    ],
    ['by a split, under version 0', { coveredPeriods: [INHERITED], latestBroadeningVersion: 1 }],
  ])(
    '[BKT-10] [CL-BKT-06] includes a type as soon as one period is covered for it, whatever its sheet version: covered %s',
    (_, coverage) => {
      expect(isTypeCovered(coverage)).toBe(true);
    },
  );

  it('[BKT-10] leaves out a type with no covered period', () => {
    expect(isTypeCovered({ coveredPeriods: [], latestBroadeningVersion: undefined })).toBe(false);
  });

  it('[BKT-10] [BKT-23] makes the coverage include each type that an empty result declares, as any other result does', () => {
    // An empty result lists the types and the period it searched, and no event.
    const request = [
      asked('media-storm', FIRST_GAME, CREATED),
      asked('bereavement', FIRST_GAME, CREATED),
    ];
    const { retainedPeriods } = retainedCoverage(
      request,
      declaredAs(['media-storm'], FIRST_GAME, CREATED),
      FIRST_GAME,
    );
    const coverageOf = (eventTypeId: string): TypeCoverage => ({
      coveredPeriods: retainedPeriods
        .filter((period) => period.eventTypeId === eventTypeId)
        .map(({ startOn, endOn }) => ({ startOn, endOn, sheetVersionNumber: 1 })),
      latestBroadeningVersion: undefined,
    });

    expect(isTypeCovered(coverageOf('media-storm'))).toBe(true);
    expect(isTypeCovered(coverageOf('bereavement'))).toBe(false);
  });
});

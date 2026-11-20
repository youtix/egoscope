import { describe, expect, it } from 'vitest';

import { incompleteImportSupplement, isTypeSupplementNeeded } from './proposals';
import { retainedCoverage } from './retained-coverage';

import type { CoveredPeriod, TypeCoverage } from './counting';
import type { CoveredResearchType, ExtentResult, PlannedType, RequestedType } from './extents';

// Player A of spec 05: his first NBA game, and the day of the request in its examples.
const FIRST_GAME = '2019-10-23';
const CREATED = '2026-11-11';

const UNDER_V1: CoveredPeriod = { startOn: FIRST_GAME, endOn: '2022-06-30', sheetVersionNumber: 1 };
const UNDER_V2: CoveredPeriod = {
  startOn: '2022-07-01',
  endOn: '2025-06-30',
  sheetVersionNumber: 2,
};
// A period that a type born of a split inherited (CL-BKT-06).
const INHERITED: CoveredPeriod = {
  startOn: FIRST_GAME,
  endOn: '2024-06-30',
  sheetVersionNumber: 0,
};

/** A type of a request with its period. */
function asked(eventTypeId: string, startOn: string | undefined, endOn: string): RequestedType {
  return { eventTypeId, periodStartOn: startOn, periodEndOn: endOn };
}

function requestedTypes(...types: readonly RequestedType[]): ExtentResult {
  return { ok: true, requestedTypes: types };
}

type Span = readonly [startOn: string, endOn: string];

/** A research type never broadened, its spans researched under version 1. */
function coveredType(eventTypeId: string, ...spans: readonly Span[]): CoveredResearchType {
  return {
    eventTypeId,
    isCalendarDerived: false,
    coveredPeriods: spans.map(([startOn, endOn]) => ({ startOn, endOn, sheetVersionNumber: 1 })),
    latestBroadeningVersion: undefined,
  };
}

// The requested types of the request of CA-BKT-08, created on 2026-11-11.
const REQUESTED: readonly PlannedType[] = [
  { ...asked('public-humiliation', FIRST_GAME, CREATED), isRequested: true },
  { ...asked('record-approach', FIRST_GAME, CREATED), isRequested: true },
];
// A type that a reduction took out of the same request's prompt: it stays planned with
// its period (CL-BKT-07).
const TAKEN_OUT: PlannedType = { ...asked('bereavement', FIRST_GAME, CREATED), isRequested: false };

/**
 * Each planned type with the coverage that the import of CA-BKT-08 gave it: its result
 * declares the requested types covered from his first NBA game to 2022-06-30.
 */
function afterImport(planned: readonly PlannedType[]): readonly CoveredResearchType[] {
  const declared = {
    coveredTypes: ['public-humiliation', 'record-approach'],
    startOn: FIRST_GAME,
    endOn: '2022-06-30',
  };
  const { retainedPeriods } = retainedCoverage(planned, declared, FIRST_GAME);
  return planned.map(({ eventTypeId }) =>
    coveredType(
      eventTypeId,
      ...retainedPeriods
        .filter((period) => period.eventTypeId === eventTypeId)
        .map(({ startOn, endOn }): Span => [startOn, endOn]),
    ),
  );
}

describe('isTypeSupplementNeeded', () => {
  it.each<readonly [string, TypeCoverage]>([
    ['never covered', { coveredPeriods: [], latestBroadeningVersion: undefined }],
    [
      'covered only under a version older than its latest broadening',
      { coveredPeriods: [UNDER_V1], latestBroadeningVersion: 2 },
    ],
    [
      'inherited from a split whose version 1 broadens it',
      { coveredPeriods: [INHERITED], latestBroadeningVersion: 1 },
    ],
  ])(
    '[BKT-05] [CL-BKT-05] [CL-BKT-06] [CL-BKT-26] proposes the supplement of a type with no counting period: %s',
    (_, coverage) => {
      expect(isTypeSupplementNeeded(coverage)).toBe(true);
    },
  );

  it.each<readonly [string, TypeCoverage]>([
    [
      'covered and never broadened',
      { coveredPeriods: [UNDER_V1], latestBroadeningVersion: undefined },
    ],
    [
      'covered under its latest broadening version too',
      { coveredPeriods: [UNDER_V1, UNDER_V2], latestBroadeningVersion: 2 },
    ],
    [
      'inherited from a split that broadens nothing',
      { coveredPeriods: [INHERITED], latestBroadeningVersion: undefined },
    ],
  ])(
    '[BKT-05] [CL-BKT-05] [CL-BKT-06] [CL-BKT-26] proposes no supplement of a type whose coverage counts: %s',
    (_, coverage) => {
      expect(isTypeSupplementNeeded(coverage)).toBe(false);
    },
  );
});

describe('incompleteImportSupplement', () => {
  it('[BKT-06] [CL-BKT-07] [CA-BKT-08] offers the requested types of a result covered to 2022-06-30 from 2022-07-01 to 2026-11-11, accepted on the import day', () => {
    expect(incompleteImportSupplement(afterImport(REQUESTED), FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(
        asked('public-humiliation', '2022-07-01', CREATED),
        asked('record-approach', '2022-07-01', CREATED),
      ),
    );
  });

  it('[BKT-06] [CL-BKT-07] covers again a planned type that a reduction took out of the prompt, over its uncovered days', () => {
    const planned = afterImport([...REQUESTED, TAKEN_OUT]);

    expect(incompleteImportSupplement(planned, FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(
        asked('public-humiliation', '2022-07-01', CREATED),
        asked('record-approach', '2022-07-01', CREATED),
        asked('bereavement', FIRST_GAME, CREATED),
      ),
    );
  });

  it('[BKT-06] [CL-BKT-07] ends every period on the day the owner accepts the supplement', () => {
    const planned = afterImport([...REQUESTED, TAKEN_OUT]);

    expect(incompleteImportSupplement(planned, FIRST_GAME, '2026-11-20')).toStrictEqual(
      requestedTypes(
        asked('public-humiliation', '2022-07-01', '2026-11-20'),
        asked('record-approach', '2022-07-01', '2026-11-20'),
        asked('bereavement', FIRST_GAME, '2026-11-20'),
      ),
    );
  });

  it('[BKT-06] [CL-BKT-07] leaves out a planned type covered up to the acceptance day', () => {
    const planned = [
      coveredType('media-storm', [FIRST_GAME, CREATED]),
      coveredType('player-conflict', [FIRST_GAME, '2022-06-30']),
    ];

    expect(incompleteImportSupplement(planned, FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(asked('player-conflict', '2022-07-01', CREATED)),
    );
  });

  it('[BKT-06] [CL-BKT-07] offers nothing once every planned day is covered', () => {
    const planned = [
      coveredType('media-storm', [FIRST_GAME, CREATED]),
      coveredType('player-conflict', [FIRST_GAME, '2022-06-30'], ['2022-07-01', CREATED]),
    ];

    expect(incompleteImportSupplement(planned, FIRST_GAME, CREATED)).toStrictEqual({
      ok: false,
      error: { kind: 'coverage_complete' },
    });
  });

  it('[BKT-06] [CL-BKT-03] refuses a calendar-derived planned type', () => {
    const planned = [{ ...coveredType('birthday'), isCalendarDerived: true }];

    expect(() => incompleteImportSupplement(planned, FIRST_GAME, CREATED)).toThrow(
      new RangeError(
        'Type "birthday" is derived from the calendar: no backtest request researches it (CL-BKT-03).',
      ),
    );
  });
});

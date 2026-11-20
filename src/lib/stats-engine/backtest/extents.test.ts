import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { initialExtent, reduceExtent, supplementExtent, updateExtent } from './extents';

import type { CoveredPeriod } from './counting';
import type {
  BacktestRequestKind,
  CoveredResearchType,
  ExtentResult,
  PlannedType,
  PlanResult,
  RequestedType,
  ResearchType,
} from './extents';

// Player A of spec 05: his first NBA game, and the day of the request in its examples.
const FIRST_GAME = '2019-10-23';
const CREATED = '2026-11-11';
const UPDATED = '2026-11-20';
// The last playoff game of an invented 2022-23 season (CL-BKT-09, STA-48).
const SEASON_END = '2023-06-14';
// A day after every day of the tests.
const LAST_DAY = '9999-12-31';

type Span = readonly [startOn: string, endOn: string];

function researchType(eventTypeId: string): ResearchType {
  return { eventTypeId, isCalendarDerived: false };
}

/** A research type never broadened, its spans researched under version 1. */
function coveredType(eventTypeId: string, ...spans: readonly Span[]): CoveredResearchType {
  return {
    ...researchType(eventTypeId),
    coveredPeriods: spans.map(([startOn, endOn]) => ({ startOn, endOn, sheetVersionNumber: 1 })),
    latestBroadeningVersion: undefined,
  };
}

function calendarDerived(eventTypeId: string): CoveredResearchType {
  return { ...coveredType(eventTypeId), isCalendarDerived: true };
}

/** A type of a request with its period. */
function asked(eventTypeId: string, startOn: string | undefined, endOn: string): RequestedType {
  return { eventTypeId, periodStartOn: startOn, periodEndOn: endOn };
}

/** A planned type in the prompt. */
function planned(eventTypeId: string, startOn: string | undefined, endOn: string): PlannedType {
  return { ...asked(eventTypeId, startOn, endOn), isRequested: true };
}

/** A planned type out of the prompt. */
function takenOut(eventTypeId: string, startOn: string | undefined, endOn: string): PlannedType {
  return { ...asked(eventTypeId, startOn, endOn), isRequested: false };
}

function requestedTypes(...types: readonly RequestedType[]): ExtentResult {
  return { ok: true, requestedTypes: types };
}

function plannedTypes(...types: readonly PlannedType[]): PlanResult {
  return { ok: true, plannedTypes: types };
}

const COVERAGE_COMPLETE: ExtentResult = { ok: false, error: { kind: 'coverage_complete' } };
const NO_TYPE_LEFT: PlanResult = { ok: false, error: { kind: 'no_type_left' } };

function calendarDerivedRefusal(eventTypeId: string): RangeError {
  return new RangeError(
    `Type "${eventTypeId}" is derived from the calendar: no backtest request researches it (CL-BKT-03).`,
  );
}

// --- Arbitraries and checks of the properties ----------------------------------------

// Two seasons of days, so that random periods often meet, overlap or leave holes.
const FIRST_DATE = new Date(Date.UTC(2019, 9, 1));
const LAST_DATE = new Date(Date.UTC(2021, 5, 30));
const day = fc
  .date({ min: FIRST_DATE, max: LAST_DATE, noInvalidDate: true })
  .map((date) => date.toISOString().slice(0, 10));
const maybeDay = fc.option(day, { nil: undefined });
const span = fc
  .tuple(day, day)
  .map(([one, other]) =>
    one <= other ? { startOn: one, endOn: other } : { startOn: other, endOn: one },
  );
const version = fc.integer({ min: 0, max: 3 });
const kind = fc.constantFrom<BacktestRequestKind>('initial', 'supplement', 'full_redo');

const coveredPeriod: fc.Arbitrary<CoveredPeriod> = fc
  .record({ dates: span, sheetVersionNumber: version })
  .map(({ dates, sheetVersionNumber }) => ({ ...dates, sheetVersionNumber }));
// The types an update may add, which no request below holds yet.
const ADDED_IDS = ['player-conflict', 'public-humiliation', 'racist-abuse'];
const coveredTypes = fc.uniqueArray(
  fc.record({
    eventTypeId: fc.constantFrom(...ADDED_IDS),
    isCalendarDerived: fc.constant(false),
    coveredPeriods: fc.array(coveredPeriod, { maxLength: 4 }),
    latestBroadeningVersion: fc.option(version, { nil: undefined }),
  }),
  { selector: (covered) => covered.eventTypeId, maxLength: ADDED_IDS.length },
);
const plannedType = (eventTypeId: string): fc.Arbitrary<PlannedType> =>
  fc
    .record({ dates: span, isOpen: fc.boolean(), isRequested: fc.boolean() })
    .map(({ dates, isOpen, isRequested }) => ({
      eventTypeId,
      periodStartOn: isOpen ? undefined : dates.startOn,
      periodEndOn: dates.endOn,
      isRequested,
    }));
const PLANNED_IDS = ['bereavement', 'media-storm'];
const plannedOnes = fc.tuple(...PLANNED_IDS.map((eventTypeId) => plannedType(eventTypeId)));
const updates = fc.record({
  kind,
  plannedTypes: plannedOnes,
  addedTypes: coveredTypes,
  updatedOn: day,
  firstNbaGameOn: maybeDay,
});

function typesOf(result: ExtentResult): readonly RequestedType[] {
  return result.ok ? result.requestedTypes : [];
}

function plannedOf(result: PlanResult): readonly PlannedType[] {
  return result.ok ? result.plannedTypes : [];
}

/** The periods that start after they end. */
function reversed(types: readonly RequestedType[]): readonly RequestedType[] {
  return types.filter(({ periodStartOn = '', periodEndOn }) => periodStartOn > periodEndOn);
}

/** The periods that start before the first NBA game. */
function beforeFirstGame(
  types: readonly RequestedType[],
  firstNbaGameOn = '',
): readonly RequestedType[] {
  return types.filter(({ periodStartOn = LAST_DAY }) => periodStartOn < firstNbaGameOn);
}

/** The periods that end after `lastDay`. */
function endingAfter(types: readonly RequestedType[], lastDay: string): readonly RequestedType[] {
  return types.filter(({ periodEndOn }) => periodEndOn > lastDay);
}

describe('initialExtent', () => {
  it('[BKT-08] asks each research type from the first NBA game to the creation day', () => {
    const types = ['player-conflict', 'public-humiliation', 'record-approach'].map((id) =>
      researchType(id),
    );

    expect(initialExtent(types, FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(
        asked('player-conflict', FIRST_GAME, CREATED),
        asked('public-humiliation', FIRST_GAME, CREATED),
        asked('record-approach', FIRST_GAME, CREATED),
      ),
    );
  });

  it('[BKT-08] starts each period on his first NBA game, its date unknown, while the app does not know it', () => {
    const types = [researchType('media-storm'), researchType('racist-abuse')];

    expect(initialExtent(types, undefined, CREATED)).toStrictEqual(
      requestedTypes(
        asked('media-storm', undefined, CREATED),
        asked('racist-abuse', undefined, CREATED),
      ),
    );
  });

  it('[BKT-08] asks the one day of a career whose first NBA game is on the creation day', () => {
    expect(initialExtent([researchType('media-storm')], CREATED, CREATED)).toStrictEqual(
      requestedTypes(asked('media-storm', CREATED, CREATED)),
    );
  });

  it('[BKT-08] leaves nothing to ask while the first NBA game comes after the creation day', () => {
    expect(initialExtent([researchType('media-storm')], '2026-11-12', CREATED)).toStrictEqual(
      COVERAGE_COMPLETE,
    );
  });

  it('[BKT-08] [CL-BKT-03] refuses a calendar-derived type, even among research types', () => {
    const types = [researchType('media-storm'), calendarDerived('birthday')];

    expect(() => initialExtent(types, FIRST_GAME, CREATED)).toThrow(
      calendarDerivedRefusal('birthday'),
    );
  });

  it('[BKT-09] asks every research type over the whole career for a full redo, whatever the coverage', () => {
    const broadened = {
      ...coveredType('player-conflict', [FIRST_GAME, CREATED]),
      latestBroadeningVersion: 2,
    };
    const types = [coveredType('media-storm', [FIRST_GAME, '2025-06-30']), broadened];

    expect(initialExtent(types, FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(
        asked('media-storm', FIRST_GAME, CREATED),
        asked('player-conflict', FIRST_GAME, CREATED),
      ),
    );
  });
});

describe('supplementExtent', () => {
  it("[BKT-09] [CL-BKT-05] asks 2022-07-01 to 2026-11-11 in the ruling's example, the span after the hole included", () => {
    const covered = coveredType(
      'public-humiliation',
      [FIRST_GAME, '2022-06-30'],
      ['2023-07-01', '2025-06-30'],
    );

    expect(supplementExtent([covered], FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(asked('public-humiliation', '2022-07-01', CREATED)),
    );
  });

  it('[BKT-09] fills the gaps of every type covered up to 2025-06-30 from 2025-07-01 to the creation day', () => {
    const types = [
      coveredType('player-conflict', [FIRST_GAME, '2025-06-30']),
      coveredType('record-approach', [FIRST_GAME, '2025-06-30']),
    ];

    expect(supplementExtent(types, FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(
        asked('player-conflict', '2025-07-01', CREATED),
        asked('record-approach', '2025-07-01', CREATED),
      ),
    );
  });

  it.each([
    ['from his first NBA game', FIRST_GAME],
    ['from his first NBA game, its date unknown,', undefined],
  ])('[BKT-09] asks a never-covered type over the whole career, %s', (_, firstNbaGameOn) => {
    expect(supplementExtent([coveredType('bereavement')], firstNbaGameOn, CREATED)).toStrictEqual(
      requestedTypes(asked('bereavement', firstNbaGameOn, CREATED)),
    );
  });

  it('[BKT-09] [CL-BKT-05] asks a type broadened since its last research over the whole career again', () => {
    const broadened = {
      ...coveredType('media-storm', [FIRST_GAME, '2025-06-30']),
      latestBroadeningVersion: 2,
    };

    expect(supplementExtent([broadened], FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(asked('media-storm', FIRST_GAME, CREATED)),
    );
  });

  it('[BKT-09] [CL-BKT-05] leaves out a type complete through the creation day', () => {
    const types = [
      coveredType('media-storm', [FIRST_GAME, CREATED]),
      coveredType('bereavement', [FIRST_GAME, '2025-06-30']),
    ];

    expect(supplementExtent(types, FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(asked('bereavement', '2025-07-01', CREATED)),
    );
  });

  it('[BKT-09] [CL-BKT-05] asks the one day left when the coverage ends the day before the creation', () => {
    const types = [coveredType('media-storm', [FIRST_GAME, '2026-11-10'])];

    expect(supplementExtent(types, FIRST_GAME, CREATED)).toStrictEqual(
      requestedTypes(asked('media-storm', CREATED, CREATED)),
    );
  });

  it('[BKT-09] [CL-BKT-05] finds the coverage complete when every type is complete up to the creation day', () => {
    const types = [
      coveredType('media-storm', [FIRST_GAME, CREATED]),
      coveredType('bereavement', ['2018-10-17', '2026-12-31']),
    ];

    expect(supplementExtent(types, FIRST_GAME, CREATED)).toStrictEqual(COVERAGE_COMPLETE);
  });

  it('[BKT-09] [CL-BKT-03] refuses a calendar-derived type', () => {
    expect(() => supplementExtent([calendarDerived('former-team')], FIRST_GAME, CREATED)).toThrow(
      calendarDerivedRefusal('former-team'),
    );
  });

  it('[BKT-08] [BKT-09] never asks a day before the first NBA game or after the creation day, nor a period that ends before it starts', () => {
    fc.assert(
      fc.property(coveredTypes, maybeDay, day, (types, firstNbaGameOn, createdOn) => {
        const extents = [initialExtent, supplementExtent].flatMap((extent) =>
          typesOf(extent(types, firstNbaGameOn, createdOn)),
        );

        expect(reversed(extents)).toStrictEqual([]);
        expect(beforeFirstGame(extents, firstNbaGameOn)).toStrictEqual([]);
        expect(endingAfter(extents, createdOn)).toStrictEqual([]);
      }),
    );
  });
});

describe('updateExtent', () => {
  const UPDATE = {
    kind: 'supplement',
    addedTypes: [],
    updatedOn: UPDATED,
    firstNbaGameOn: FIRST_GAME,
  } as const;

  it('[CL-BKT-08] ends every planned type on the update day and keeps its start', () => {
    const before = [
      planned('media-storm', FIRST_GAME, CREATED),
      planned('bereavement', undefined, CREATED),
      planned('player-conflict', '2022-07-01', SEASON_END),
      takenOut('record-approach', FIRST_GAME, CREATED),
    ];

    expect(updateExtent({ ...UPDATE, plannedTypes: before })).toStrictEqual(
      plannedTypes(
        planned('media-storm', FIRST_GAME, UPDATED),
        planned('bereavement', undefined, UPDATED),
        planned('player-conflict', '2022-07-01', UPDATED),
        takenOut('record-approach', FIRST_GAME, UPDATED),
      ),
    );
  });

  it.each<BacktestRequestKind>(['initial', 'full_redo'])(
    '[CL-BKT-08] gives a type added to a request of kind %s the whole career on the update day, whatever its coverage',
    (requestKind) => {
      const update = {
        ...UPDATE,
        kind: requestKind,
        plannedTypes: [planned('media-storm', FIRST_GAME, CREATED)],
        addedTypes: [coveredType('bereavement', [FIRST_GAME, '2025-06-30'])],
      };

      expect(updateExtent(update)).toStrictEqual(
        plannedTypes(
          planned('media-storm', FIRST_GAME, UPDATED),
          planned('bereavement', FIRST_GAME, UPDATED),
        ),
      );
    },
  );

  it('[CL-BKT-08] gives a type added to a supplement the days from its first uncovered day, unless it is complete', () => {
    const update = {
      ...UPDATE,
      plannedTypes: [planned('media-storm', '2025-07-01', CREATED)],
      addedTypes: [
        coveredType('bereavement', [FIRST_GAME, '2025-06-30']),
        coveredType('racist-abuse', [FIRST_GAME, UPDATED]),
      ],
    };

    expect(updateExtent(update)).toStrictEqual(
      plannedTypes(
        planned('media-storm', '2025-07-01', UPDATED),
        planned('bereavement', '2025-07-01', UPDATED),
      ),
    );
  });

  it('[CL-BKT-08] [CL-BKT-03] refuses a calendar-derived added type', () => {
    const update = {
      ...UPDATE,
      plannedTypes: [planned('media-storm', FIRST_GAME, CREATED)],
      addedTypes: [calendarDerived('birthday')],
    };

    expect(() => updateExtent(update)).toThrow(calendarDerivedRefusal('birthday'));
  });

  it('[CL-BKT-08] [CL-BKT-09] takes a planned type that starts after the update day out of the prompt, with its period', () => {
    const before = [
      planned('media-storm', FIRST_GAME, '2026-11-12'),
      planned('bereavement', '2026-11-12', '2026-11-12'),
    ];

    expect(updateExtent({ ...UPDATE, updatedOn: CREATED, plannedTypes: before })).toStrictEqual(
      plannedTypes(
        planned('media-storm', FIRST_GAME, CREATED),
        takenOut('bereavement', '2026-11-12', '2026-11-12'),
      ),
    );
  });

  it.each([
    [
      'its one requested type starts after that day',
      planned('bereavement', '2026-11-21', '2026-11-21'),
    ],
    [
      'a reduction took its type out and none is added',
      takenOut('bereavement', FIRST_GAME, CREATED),
    ],
  ])(
    '[CL-BKT-08] [CL-BKT-09] refuses an update that leaves no type to research: %s',
    (_, before) => {
      expect(updateExtent({ ...UPDATE, plannedTypes: [before] })).toStrictEqual(NO_TYPE_LEFT);
    },
  );

  it('[CL-BKT-08] keeps every start, ends the requested types on the update day and starts no added type before the first NBA game', () => {
    fc.assert(
      fc.property(updates, (update) => {
        const after = plannedOf(updateExtent(update));
        const kept = after.slice(0, update.plannedTypes.length);
        const added = after.slice(update.plannedTypes.length);
        const startsMoved = kept.filter(
          ({ periodStartOn }, index) => periodStartOn !== update.plannedTypes[index]?.periodStartOn,
        );
        const endsElsewhere = after.filter(
          ({ isRequested, periodEndOn }) => isRequested && periodEndOn !== update.updatedOn,
        );

        expect(reversed(after)).toStrictEqual([]);
        expect(endsElsewhere).toStrictEqual([]);
        expect(startsMoved).toStrictEqual([]);
        expect(beforeFirstGame(added, update.firstNbaGameOn)).toStrictEqual([]);
      }),
    );
  });
});

describe('reduceExtent', () => {
  const TO_SEASON = { removedTypeIds: [], seasonEndOn: SEASON_END };

  it('[CL-BKT-09] ends every requested type on the end of the season, the earlier day', () => {
    const before = [
      planned('media-storm', FIRST_GAME, CREATED),
      planned('bereavement', undefined, CREATED),
    ];

    expect(reduceExtent(before, TO_SEASON)).toStrictEqual(
      plannedTypes(
        planned('media-storm', FIRST_GAME, SEASON_END),
        planned('bereavement', undefined, SEASON_END),
      ),
    );
  });

  it('[CL-BKT-09] keeps an end that comes before the end of the season', () => {
    const before = [
      planned('media-storm', FIRST_GAME, CREATED),
      planned('bereavement', FIRST_GAME, '2022-06-30'),
    ];

    expect(reduceExtent(before, TO_SEASON)).toStrictEqual(
      plannedTypes(
        planned('media-storm', FIRST_GAME, SEASON_END),
        planned('bereavement', FIRST_GAME, '2022-06-30'),
      ),
    );
  });

  it('[CL-BKT-09] [CL-BKT-07] takes a type whose period would hold no day out of the prompt, planned with its period', () => {
    const before = [
      planned('media-storm', FIRST_GAME, CREATED),
      planned('bereavement', '2023-06-15', CREATED),
    ];

    expect(reduceExtent(before, TO_SEASON)).toStrictEqual(
      plannedTypes(
        planned('media-storm', FIRST_GAME, SEASON_END),
        takenOut('bereavement', '2023-06-15', CREATED),
      ),
    );
  });

  it('[CL-BKT-09] keeps the one day of a type that starts on the end of the season', () => {
    expect(reduceExtent([planned('media-storm', SEASON_END, CREATED)], TO_SEASON)).toStrictEqual(
      plannedTypes(planned('media-storm', SEASON_END, SEASON_END)),
    );
  });

  it.each([
    ['alone', undefined, CREATED],
    ['with a season', SEASON_END, SEASON_END],
  ])(
    '[CL-BKT-09] [CL-BKT-07] takes out the types the owner removes, %s, planned with their period',
    (_, seasonEndOn, endOn) => {
      const before = [
        planned('media-storm', FIRST_GAME, CREATED),
        planned('bereavement', FIRST_GAME, CREATED),
      ];

      expect(reduceExtent(before, { removedTypeIds: ['bereavement'], seasonEndOn })).toStrictEqual(
        plannedTypes(
          planned('media-storm', FIRST_GAME, endOn),
          takenOut('bereavement', FIRST_GAME, CREATED),
        ),
      );
    },
  );

  it('[CL-BKT-09] leaves the types already out of the prompt as they are', () => {
    const before = [
      planned('media-storm', FIRST_GAME, CREATED),
      takenOut('bereavement', FIRST_GAME, CREATED),
    ];

    expect(reduceExtent(before, TO_SEASON)).toStrictEqual(
      plannedTypes(
        planned('media-storm', FIRST_GAME, SEASON_END),
        takenOut('bereavement', FIRST_GAME, CREATED),
      ),
    );
  });

  it.each([
    ['its season ends before every period starts', [], SEASON_END],
    ['it removes every requested type', ['media-storm', 'bereavement'], undefined],
    ['it removes one type and its season empties the other', ['media-storm'], SEASON_END],
  ])(
    '[CL-BKT-09] refuses a reduction that leaves no type to research: %s',
    (_, removedTypeIds, seasonEndOn) => {
      const before = [
        planned('media-storm', '2023-07-01', CREATED),
        planned('bereavement', '2024-07-01', CREATED),
      ];

      expect(reduceExtent(before, { removedTypeIds, seasonEndOn })).toStrictEqual(NO_TYPE_LEFT);
    },
  );

  it('[CL-BKT-09] never moves an end later nor past the end of the season, nor makes a period end before it starts', () => {
    fc.assert(
      fc.property(
        plannedOnes,
        fc.subarray(PLANNED_IDS),
        maybeDay,
        (before, removedTypeIds, seasonEndOn) => {
          const after = plannedOf(reduceExtent(before, { removedTypeIds, seasonEndOn }));
          const requested = after.filter(({ isRequested }) => isRequested);
          const movedLater = after.filter(
            ({ periodEndOn }, index) => periodEndOn > (before[index]?.periodEndOn ?? ''),
          );

          expect(reversed(after)).toStrictEqual([]);
          expect(movedLater).toStrictEqual([]);
          expect(endingAfter(requested, seasonEndOn ?? LAST_DAY)).toStrictEqual([]);
          expect(
            requested.filter(({ eventTypeId }) => removedTypeIds.includes(eventTypeId)),
          ).toStrictEqual([]);
        },
      ),
    );
  });
});

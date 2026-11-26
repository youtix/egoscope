import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { OVERALL_SUBROW_KINDS } from './case-place';
import { validationRows } from './validation-table';

import type { GapStatus } from '../cases/normalized-gap';
import type { EngineParams, EpochMs } from '../types';
import type { GapSummary } from './assessment';
import type { TableForecast, TableTrackedCase, TrackedCaseOutcome } from './case-place';
import type { PostTipOffDecisionEffect } from './decisions';
import type { Forecast } from './forecast';
import type { CaseSetValues, TouchedCount } from './row-values';
import type { TableEventType, TablePlayer, ValidationRowPlace } from './table-rows';
import type {
  RegroupingExit,
  TableHistoricalCase,
  ValidationRow,
  ValidationTableInput,
} from './validation-table';

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
// Raw values are compared to 1e-9 (CL-STA-09).
const DIGITS = 9;
const MINIMUM = DEFAULTS.tracking.minTrackedCasesForAssessment;

// Invented identifiers and instants in milliseconds: every case is created at CREATED_AT,
// before its expected and measured games, which start at START.
const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';
const PLAYER_C = 'player-c';
const PLAYER_D = 'player-d';
const TYPE_X = 'type-x';
const TYPE_Y = 'type-y';
const TYPE_Z = 'type-z';
const CREATED_AT = 1000;
const START = 10_000;
const BEFORE = START - 500;
const AFTER = START + 500;

const TYPES: readonly TableEventType[] = [
  { eventTypeId: TYPE_X, status: 'validated' },
  { eventTypeId: TYPE_Y, status: 'validated' },
  { eventTypeId: TYPE_Z, status: 'validated' },
];
const PLAYERS: readonly TablePlayer[] = [
  { playerId: PLAYER_A, status: 'active' },
  { playerId: PLAYER_B, status: 'active' },
  { playerId: PLAYER_C, status: 'active' },
];
const SUBROWS = [
  'overall_subrow:probable_profile',
  'overall_subrow:possible_profile',
  'overall_subrow:general_trend',
];

function near(value: number): unknown {
  return expect.closeTo(value, DIGITS);
}

function frozen(
  overrides: Partial<Forecast> = {},
  state: TableForecast['state'] = 'frozen',
): TableForecast {
  return {
    state,
    forecast: {
      source: 'player_profile',
      level: 'possible',
      direction: 'increase',
      announcedMeanGap: 0.95,
      caseCount: 12,
      profileConfidence: 'medium',
      ...overrides,
    },
  };
}

function measured(normalizedGap: number, gapStatus: GapStatus = 'final'): TrackedCaseOutcome {
  return { status: 'measured', measuredGameStartAt: START, normalizedGap, gapStatus };
}

function excluded(gapStatus: GapStatus = 'final'): TrackedCaseOutcome {
  return { status: 'excluded', measuredGameStartAt: START, normalizedGap: 0.5, gapStatus };
}

const PENDING: TrackedCaseOutcome = { status: 'awaiting_game', measuredGameStartAt: null };
const NOT_MEASURABLE: TrackedCaseOutcome = { status: 'not_measurable', measuredGameStartAt: null };

function trackedCase(caseId: number, overrides: Partial<TableTrackedCase> = {}): TableTrackedCase {
  return {
    caseId,
    playerId: PLAYER_A,
    eventTypeId: TYPE_X,
    createdAt: CREATED_AT,
    expectedGameStartAt: START,
    outcome: measured(0.5),
    frozenForecast: frozen(),
    isCoOccurring: false,
    decisions: [],
    allEventsDismissedAt: null,
    ...overrides,
  };
}

/** A measured case with a gap of 1, against a late forecast of an increase of 1. */
function lateCase(caseId: number): TableTrackedCase {
  return trackedCase(caseId, {
    outcome: measured(1),
    frozenForecast: frozen({ announcedMeanGap: 1 }, 'late'),
  });
}

/** The decisions of a case touched once after tip-off. */
function decidedAfterTipOff(effect: PostTipOffDecisionEffect): Partial<TableTrackedCase> {
  return { decisions: [{ effect, decidedAt: AFTER }] };
}

function exitOf(overrides: Partial<RegroupingExit> = {}): RegroupingExit {
  return {
    playerEventId: 1,
    playerId: PLAYER_A,
    eventTypeId: TYPE_X,
    overallSubrow: 'possible_profile',
    gapInForecastDirection: 0.6,
    ...overrides,
  };
}

/** A valid historical case whose measured game starts at its identifier. */
function historicalCase(
  caseId: number,
  at: Readonly<{ playerId: string; eventTypeId: string; normalizedGap: number }>,
): TableHistoricalCase {
  return { caseId, measuredGameScheduledStartAt: caseId, ...at };
}

function tableOf(input: Partial<ValidationTableInput>): ValidationRow[] {
  return validationRows(
    {
      eventTypes: TYPES,
      players: PLAYERS,
      trackedCases: [],
      regroupingExits: [],
      historicalCases: [],
      ...input,
    },
    DEFAULTS,
  );
}

function keyOf(place: ValidationRowPlace): string {
  const subrow = 'subrowKind' in place ? [place.subrowKind] : [];
  const player = 'playerId' in place ? [place.playerId] : [];
  const type = 'eventTypeId' in place ? [place.eventTypeId] : [];
  return [place.scope, ...subrow, ...player, ...type].join(':');
}

function pair(playerId: string, eventTypeId: string): string {
  return `player_type_pair:${playerId}:${eventTypeId}`;
}

const PAIR_AX = pair(PLAYER_A, TYPE_X);

function rowAt(rows: readonly ValidationRow[], key: string): ValidationRow {
  const row = rows.find((item) => keyOf(item) === key);
  if (row === undefined) {
    throw new Error(`No row ${key}`);
  }
  return row;
}

/** A gap summary's mean and count. */
function summaryOf(summary: GapSummary | null): readonly number[] | null {
  return summary === null ? null : [summary.meanGap, summary.count];
}

/** A post-tip-off count, its mean gap and the number of gaps behind it. */
function touchedOf({ count, meanGapInForecastDirection: meanGap }: TouchedCount): unknown[] {
  return [count, ...(summaryOf(meanGap) ?? [null, null])];
}

/** Every case a row counts, in its testing set, its late part or its separate counts. */
function totalOf({ categoryCounts, latePart, separateCounts }: ValidationRow): number {
  const { exit, entry, measuredGameChange, ...apart } = separateCounts;
  return [
    ...[categoryCounts, latePart.categoryCounts].map((item) => item.withForecast + item.noForecast),
    ...Object.values(apart),
    ...[exit, entry, measuredGameChange].map(({ count }) => count),
  ].reduce((total, count) => total + count, 0);
}

describe('validationRows', () => {
  it('[SUI-23] [CL-SUI-11] keeps the cases of a withdrawn player and of a withdrawn type in every row they belong to, the archived rows last, and shows a player without a case', () => {
    const rows = tableOf({
      eventTypes: [
        { eventTypeId: TYPE_X, status: 'validated' },
        { eventTypeId: TYPE_Z, status: 'withdrawn' },
      ],
      players: [
        { playerId: PLAYER_A, status: 'active' },
        { playerId: PLAYER_C, status: 'withdrawn' },
        { playerId: PLAYER_D, status: 'paused' },
      ],
      trackedCases: [
        trackedCase(1, { playerId: PLAYER_C }),
        trackedCase(2, { eventTypeId: TYPE_Z }),
      ],
    });
    expect(
      rows.map((row) => [keyOf(row), row.archived, row.categoryCounts.withForecast]),
    ).toStrictEqual([
      ['overall', false, 2],
      [SUBROWS[0], false, 0],
      [SUBROWS[1], false, 2],
      [SUBROWS[2], false, 0],
      [`type:${TYPE_X}`, false, 1],
      [`player:${PLAYER_A}`, false, 1],
      [`player:${PLAYER_D}`, false, 0],
      [`type:${TYPE_Z}`, true, 1],
      [`player:${PLAYER_C}`, true, 1],
      [pair(PLAYER_A, TYPE_Z), true, 1],
      [pair(PLAYER_C, TYPE_X), true, 1],
    ]);
  });

  it('[SUI-23] [SUI-25] [CL-SUI-06] counts a co-occurring case once in each row it belongs to, and gives every row its co-occurring cases and its cases with a provisional gap among all its tracked cases', () => {
    const rows = tableOf({
      trackedCases: [
        trackedCase(1, { outcome: measured(0.5, 'provisional'), isCoOccurring: true }),
        trackedCase(2, { outcome: excluded('provisional') }),
        trackedCase(3, { isCoOccurring: true }),
        trackedCase(4, { outcome: PENDING, isCoOccurring: true }),
        trackedCase(5, {
          playerId: PLAYER_B,
          eventTypeId: TYPE_Y,
          outcome: measured(0.5, 'provisional'),
          isCoOccurring: true,
        }),
      ],
    });
    expect(
      [PAIR_AX, 'overall', `type:${TYPE_Y}`, `player:${PLAYER_C}`].map((key) => {
        const row = rowAt(rows, key);
        return [row.categoryCounts.withForecast, row.coOccurringCount, row.provisionalGapCount];
      }),
    ).toStrictEqual([
      [2, 3, 2],
      [3, 4, 3],
      [1, 1, 1],
      [0, 0, 0],
    ]);
  });

  it('[SUI-24] [SUI-25] [CL-DET-09] counts each case in one place of its row: the testing set, the late-forecast part or a separate count', () => {
    const rows = tableOf({
      trackedCases: [
        trackedCase(1),
        lateCase(2),
        trackedCase(3, { createdAt: START }),
        trackedCase(4, { outcome: excluded() }),
        trackedCase(5, { outcome: NOT_MEASURABLE }),
        trackedCase(6, { outcome: PENDING }),
        trackedCase(7, decidedAfterTipOff('exit')),
        trackedCase(8, { allEventsDismissedAt: AFTER }),
        trackedCase(9, { allEventsDismissedAt: BEFORE }),
        trackedCase(10, decidedAfterTipOff('entry')),
        trackedCase(11, decidedAfterTipOff('measured_game_change')),
      ],
    });
    const { categoryCounts, latePart, separateCounts: counts } = rowAt(rows, PAIR_AX);
    expect({
      testing: categoryCounts.withForecast,
      late: latePart.categoryCounts.withForecast,
      apart: [
        counts.recordedAfterTipOff,
        counts.excluded,
        counts.notMeasurable,
        counts.awaitingGame,
      ],
      touched: [counts.exit.count, counts.entry.count, counts.measuredGameChange.count],
    }).toStrictEqual({ testing: 1, late: 1, apart: [1, 1, 1, 1], touched: [2, 1, 1] });
  });

  it('[SUI-24] [CL-SUI-02] sets each row beside the current mean gap of its valid historical cases, every one for the overall row and none for a sub-row', () => {
    const rows = tableOf({
      trackedCases: [trackedCase(1), trackedCase(2, { playerId: PLAYER_B })],
      historicalCases: [
        historicalCase(101, { playerId: PLAYER_A, eventTypeId: TYPE_X, normalizedGap: 0.5 }),
        historicalCase(102, { playerId: PLAYER_A, eventTypeId: TYPE_Y, normalizedGap: 1 }),
        historicalCase(103, { playerId: PLAYER_B, eventTypeId: TYPE_X, normalizedGap: -0.3 }),
      ],
    });
    const keys = [
      'overall',
      `type:${TYPE_X}`,
      `type:${TYPE_Y}`,
      `player:${PLAYER_A}`,
      PAIR_AX,
      pair(PLAYER_B, TYPE_X),
      `player:${PLAYER_C}`,
      ...SUBROWS,
    ];
    expect(keys.map((key) => summaryOf(rowAt(rows, key).currentHistoricalMeanGap))).toStrictEqual([
      [near(1.2 / 3), 3],
      [near(0.1), 2],
      [1, 1],
      [near(0.75), 2],
      [near(0.5), 1],
      [near(-0.3), 1],
      // Player C, without a historical case, and the three sub-rows.
      ...Array.from({ length: 4 }, () => null),
    ]);
  });

  it('[SUI-24] [CL-STA-09] sums the historical cases in the order of their measured games, to the bit, whatever the input order', () => {
    // (0.1 + 0.2) + 0.3 is 0.6000000000000001 and (0.3 + 0.2) + 0.1 is 0.6.
    const mean = (0.1 + 0.2 + 0.3) / 3;
    // Case 3 holds the latest game: the cases sum from case 1 to case 3.
    const rows = tableOf({
      historicalCases: [0.3, 0.2, 0.1].map((normalizedGap, index) =>
        historicalCase(3 - index, { playerId: PLAYER_A, eventTypeId: TYPE_Y, normalizedGap }),
      ),
    });
    expect(
      ['overall', `player:${PLAYER_A}`].map(
        (key) => rowAt(rows, key).currentHistoricalMeanGap?.meanGap,
      ),
    ).toStrictEqual([mean, mean]);
  });

  it('[SUI-25] [CL-SUI-08] assesses the late-forecast part of each row apart from its testing set, at the same minimum', () => {
    const rows = tableOf({
      trackedCases: [
        ...Array.from({ length: MINIMUM }, (_, index) => lateCase(index + 1)),
        { ...lateCase(MINIMUM + 1), playerId: PLAYER_B },
        trackedCase(MINIMUM + 2, { outcome: measured(0.1) }),
      ],
    });
    expect(
      [PAIR_AX, pair(PLAYER_B, TYPE_X), `player:${PLAYER_C}`].map((key) => {
        const { latePart, assessment } = rowAt(rows, key);
        return [latePart.categoryCounts.withForecast, latePart.assessment, assessment];
      }),
    ).toStrictEqual([
      [MINIMUM, 'confirmed', { tooFew: 1 }],
      [1, { tooFew: 1 }, { tooFew: 0 }],
      [0, { tooFew: 0 }, { tooFew: 0 }],
    ]);
  });

  it('[SUI-25] [CL-SUI-16] counts the regrouping exits among the exits of every row they belong to, each with its stored gap, in no testing set', () => {
    const rows = tableOf({
      regroupingExits: [
        exitOf({ playerEventId: 1 }),
        exitOf({ playerEventId: 2, overallSubrow: null, gapInForecastDirection: null }),
        exitOf({
          playerEventId: 3,
          playerId: PLAYER_B,
          eventTypeId: TYPE_Y,
          overallSubrow: 'general_trend',
          gapInForecastDirection: -0.2,
        }),
      ],
    });
    const keys = ['overall', PAIR_AX, `player:${PLAYER_A}`, `type:${TYPE_X}`, ...SUBROWS];
    expect(
      keys.map((key) => {
        const row = rowAt(rows, key);
        return [...touchedOf(row.separateCounts.exit), row.categoryCounts.withForecast];
      }),
    ).toStrictEqual([
      [3, near(0.2), 2, 0],
      [2, near(0.6), 1, 0],
      [2, near(0.6), 1, 0],
      [2, near(0.6), 1, 0],
      [0, null, null, 0],
      [1, near(0.6), 1, 0],
      [1, near(-0.2), 1, 0],
    ]);
    expect(rows.map((row) => keyOf(row))).toContain(pair(PLAYER_B, TYPE_Y));
  });

  it('[SUI-16] [CA-SUI-13] [CL-DET-09] [CL-DET-15] shows a case dismissed before tip-off nowhere, and one dismissed at or after it only as an exit with its gap', () => {
    const rows = tableOf({
      trackedCases: [
        trackedCase(1, { allEventsDismissedAt: BEFORE }),
        trackedCase(2, { playerId: PLAYER_B, allEventsDismissedAt: BEFORE }),
        trackedCase(3, { outcome: measured(-0.7), allEventsDismissedAt: START }),
      ],
    });
    const overall = rowAt(rows, 'overall');
    expect(rows.map((row) => keyOf(row))).not.toContain(pair(PLAYER_B, TYPE_X));
    expect([totalOf(rowAt(rows, `player:${PLAYER_B}`)), totalOf(overall)]).toStrictEqual([0, 1]);
    expect(touchedOf(overall.separateCounts.exit)).toStrictEqual([1, near(-0.7), 1]);
  });
});

// Arbitrary tables: three players, three types, and every case's games at START, so that a
// case is removed exactly when all of its events were dismissed before START.
const gapArbitrary = fc.double({ min: -3, max: 3, noNaN: true });
const playerId = fc.constantFrom(PLAYER_A, PLAYER_B, PLAYER_C);
const eventTypeId = fc.constantFrom(TYPE_X, TYPE_Y, TYPE_Z);
const forecast = fc.constantFrom(
  frozen(),
  frozen({ level: 'probable', direction: 'decrease' }),
  frozen({ source: 'general_trend' }, 'late'),
  frozen({ level: 'probable' }, 'late'),
);
const outcome = fc.oneof(
  fc.record({
    status: fc.constantFrom<'measured' | 'excluded'>('measured', 'excluded'),
    measuredGameStartAt: fc.constant(START),
    normalizedGap: gapArbitrary,
    gapStatus: fc.constantFrom<'provisional' | 'final'>('provisional', 'final'),
  }),
  fc.record({
    status: fc.constantFrom<'awaiting_game' | 'not_measurable'>('awaiting_game', 'not_measurable'),
    measuredGameStartAt: fc.constantFrom<EpochMs | null>(START, null),
  }),
);
const decision = fc.record({
  effect: fc.constantFrom<PostTipOffDecisionEffect>('exit', 'entry', 'measured_game_change'),
  decidedAt: fc.constantFrom(BEFORE, START, AFTER),
});
const caseSeed = fc.record({
  playerId,
  eventTypeId,
  createdAt: fc.constantFrom(CREATED_AT, START),
  outcome,
  frozenForecast: fc.option(forecast, { nil: null }),
  isCoOccurring: fc.boolean(),
  decisions: fc.array(decision, { maxLength: 3 }),
  allEventsDismissedAt: fc.constantFrom<EpochMs | null>(null, null, BEFORE, AFTER),
});
const trackedCases = fc
  .array(caseSeed, { minLength: 1, maxLength: 30, size: 'max' })
  .map((seeds) => seeds.map((seed, index) => trackedCase(index + 1, seed)));
const removedCases = fc
  .array(caseSeed, { maxLength: 5, size: 'max' })
  .map((seeds) =>
    seeds.map((seed, index) =>
      trackedCase(1000 + index, { ...seed, allEventsDismissedAt: BEFORE }),
    ),
  );
const regroupingExits = fc.array(
  fc.record({
    playerEventId: fc.integer({ min: 1, max: 5 }),
    playerId,
    eventTypeId,
    overallSubrow: fc.constantFrom(null, ...OVERALL_SUBROW_KINDS),
    gapInForecastDirection: fc.option(gapArbitrary, { nil: null }),
  }),
  { maxLength: 8, size: 'max' },
);
const historicalCases = fc
  .array(fc.record({ playerId, eventTypeId, normalizedGap: gapArbitrary }), {
    maxLength: 10,
    size: 'max',
  })
  .map((seeds) => seeds.map((seed, index) => historicalCase(index + 1, seed)));
const tableInput = fc.record({ trackedCases, regroupingExits, historicalCases });
const permutedInput = tableInput.chain((input) =>
  fc.record({
    input: fc.constant(input),
    trackedCases: fc.shuffledSubarray(input.trackedCases, { minLength: input.trackedCases.length }),
    regroupingExits: fc.shuffledSubarray(input.regroupingExits, {
      minLength: input.regroupingExits.length,
    }),
    historicalCases: fc.shuffledSubarray(input.historicalCases, {
      minLength: input.historicalCases.length,
    }),
  }),
);

function scopeTotal(rows: readonly ValidationRow[], scope: ValidationRow['scope']): number {
  return rows.filter((row) => row.scope === scope).reduce((total, row) => total + totalOf(row), 0);
}

function isConsistent({
  categoryCounts: counts,
  chanceExpectedCounts: chance,
}: CaseSetValues): boolean {
  const chanceTotal = chance.confirmed + chance.refuted + chance.neutral;
  return (
    counts.confirmed + counts.refuted + counts.neutral === counts.withForecast &&
    Math.abs(chanceTotal - counts.withForecast) < 10 ** -DIGITS
  );
}

function areConsistent(rows: readonly ValidationRow[]): boolean {
  return rows.every(
    (row) =>
      isConsistent(row) &&
      isConsistent(row.latePart) &&
      row.latePart.categoryCounts.noForecast === 0,
  );
}

/** The tracked cases that show, and the regrouping exits. */
function shownCount(input: Pick<ValidationTableInput, 'trackedCases' | 'regroupingExits'>): number {
  const removed = input.trackedCases.filter(
    ({ allEventsDismissedAt }) => allEventsDismissedAt === BEFORE,
  );
  return input.trackedCases.length - removed.length + input.regroupingExits.length;
}

describe('validationRows, for any table', () => {
  it('[SUI-23] [SUI-24] [SUI-25] adds up every row, its categories and its counts, and splits the overall row exactly by type, player and pair', () => {
    fc.assert(
      fc.property(tableInput, (input) => {
        const rows = tableOf(input);
        const total = shownCount(input);
        expect([
          totalOf(rowAt(rows, 'overall')),
          scopeTotal(rows, 'type'),
          scopeTotal(rows, 'player'),
          scopeTotal(rows, 'player_type_pair'),
        ]).toStrictEqual([total, total, total, total]);
        expect(areConsistent(rows)).toBe(true);
      }),
    );
  });

  it('[SUI-16] [CA-SUI-13] [CL-DET-09] leaves a case dismissed before tip-off in no count of any row', () => {
    fc.assert(
      fc.property(tableInput, removedCases, (input, removed) => {
        const withRemoved = { ...input, trackedCases: [...input.trackedCases, ...removed] };
        expect(tableOf(withRemoved)).toStrictEqual(tableOf(input));
      }),
    );
  });

  it('[SUI-23] [SUI-24] [CL-STA-09] gives the same rows, to the bit, in any order of the cases, exits and historical cases', () => {
    fc.assert(
      fc.property(permutedInput, ({ input, ...permuted }) => {
        expect(tableOf(permuted)).toStrictEqual(tableOf(input));
      }),
    );
  });
});

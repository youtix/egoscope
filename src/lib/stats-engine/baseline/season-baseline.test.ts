import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { baselinePhaseOf, seasonBaseline } from './season-baseline';

import type { PhaseState } from '../schedule/phase-state';
import type { GamePhase } from '../schedule/team-record';
import type { BaselinePhase, EngineParams } from '../types';
import type { BaselineGame, SeasonBaseline, SeasonBaselineInput } from './season-baseline';

// The registry's defaults: 10 games at least, play-in and playoff games compared with the
// postseason, partial above 20 % (STA-18, STA-19, STA-24).
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

const withGames = (games: Partial<EngineParams['games']>): EngineParams => ({
  ...DEFAULTS,
  games: { ...DEFAULTS.games, ...games },
});
// Two games make a baseline, for the tests that need only a few.
const FEW = withGames({ minBaselineGames: 2 });

const RUNNING: PhaseState = { finished: false, lastGameConsolidated: false };
const IN_WINDOW: PhaseState = { finished: true, lastGameConsolidated: false };
const CONSOLIDATED: PhaseState = { finished: true, lastGameConsolidated: true };

const DAY_MS = 86_400_000;
const OPENING_NIGHT = 1_729_641_600_000;

/** The game of `day`, counted from opening night, its id one more than the day. */
function on(day: number, phase: GamePhase = 'regular_season') {
  return { gameId: day + 1, scheduledStartAt: OPENING_NIGHT + day * DAY_MS, phase };
}
const usable = (day: number, performanceIndex: number, phase?: GamePhase): BaselineGame => ({
  ...on(day, phase),
  classification: 'usable',
  performanceIndex,
});
/** A game he played with a complete box score, under the playing-time threshold. */
const underThreshold = (day: number, performanceIndex: number): BaselineGame => ({
  ...on(day),
  classification: 'played_not_usable',
  performanceIndex,
});
/** A game he played whose box score is incomplete or suspect. */
const withoutIndex = (day: number, phase?: GamePhase): BaselineGame => ({
  ...on(day, phase),
  classification: 'played_not_usable',
  performanceIndex: null,
});
const notPlayed = (day: number): BaselineGame => ({
  ...on(day),
  classification: 'not_played',
  performanceIndex: null,
});
/** A game whose lines his team has none of yet, or never will: participation unknown. */
const unknown = (day: number): BaselineGame => ({
  ...on(day),
  classification: null,
  performanceIndex: null,
});
const times = <T>(count: number, make: (offset: number) => T): T[] =>
  Array.from({ length: count }, (_, offset) => make(offset));

/** Usable games of these indices, one a day from `firstDay`. */
function usableGames(
  indices: readonly number[],
  firstDay = 0,
  phase: GamePhase = 'regular_season',
): BaselineGame[] {
  return indices.map((index, offset) => usable(firstDay + offset, index, phase));
}

// The measured game, on day 100: a regular-season game, or a playoff game.
const MEASURED_DAY = 100;
const MEASURED = usable(MEASURED_DAY, 0.8);
const PLAYOFF_GAME = usable(MEASURED_DAY, 0.8, 'playoffs');

// The ten other usable games of a finished season in criterion 2 of file 07, whose
// measured game has an index of 0.80.
const TEN = [0.42, 0.55, 0.61, 0.48, 0.7, 0.52, 0.66, 0.39, 0.58, 0.63];
// A regular season of 60 usable games averaging 0.5, then 2 play-in and 10 playoff games,
// all usable, averaging 0.25 (criterion 7 of file 07).
const REGULAR_SEASON = usableGames(times(30, () => [0.4, 0.6]).flat());
const POSTSEASON_INDICES = times(3, () => [0.2, 0.3, 0.1, 0.4]).flat();
const POSTSEASON = [
  ...usableGames(POSTSEASON_INDICES.slice(0, 2), 70, 'play_in'),
  ...usableGames(POSTSEASON_INDICES.slice(2), 72, 'playoffs'),
];

type Request = Omit<SeasonBaselineInput, 'games'>;

/** The baseline of the measured game among `games`: by default its regular season, over. */
function baselineOf(
  games: readonly BaselineGame[],
  input: Partial<Request> = {},
  params = DEFAULTS,
): SeasonBaseline {
  const of: Request = {
    phase: 'regular_season',
    excludedGameId: MEASURED.gameId,
    phaseState: CONSOLIDATED,
  };
  return seasonBaseline({ games, ...of, ...input }, params);
}

/** The baseline, while its phase runs, of the measured game beside usable games of `indices`. */
const whileRunning = (indices: readonly number[]): SeasonBaseline =>
  baselineOf([...usableGames(indices), MEASURED], { phaseState: RUNNING });

describe('baselinePhaseOf', () => {
  it.each([
    ['regular_season', 'regular_season'],
    ['play_in', 'postseason'],
    ['playoffs', 'postseason'],
  ] as const)(
    '[STA-18] [CL-STA-02] compares a %s game with the %s by default',
    (phase, expected) => {
      expect(baselinePhaseOf(phase, DEFAULTS)).toBe(expected);
    },
  );

  it.each(['regular_season', 'play_in', 'playoffs'] as const)(
    '[STA-18] [CL-STA-02] compares a %s game with the regular season when games.postseasonBaseline says so',
    (phase) => {
      const params = withGames({ postseasonBaseline: 'regular_season' });

      expect(baselinePhaseOf(phase, params)).toBe('regular_season');
    },
  );
});

describe('seasonBaseline', () => {
  it('[STA-16] [STA-17] gives 10 games, 0.554 and 0.102 without the measured game, not the 0.576 and 0.122 it would give kept', () => {
    const games = [...usableGames(TEN), MEASURED];
    const baseline = baselineOf(games);
    // With the measured game kept, as if the excluded game were another one.
    const kept = baselineOf(games, { excludedGameId: 0 });

    expect(baseline).toMatchObject({ gameCount: 10, status: 'final', isPartial: false });
    expect(baseline.mean).toBeCloseTo(0.554, 9);
    // The squared differences to 0.554 add up to 0.09364, divided by 10 − 1.
    expect(baseline.standardDeviation).toBeCloseTo(Math.sqrt(0.09364 / 9), 9);
    expect(kept.mean).toBeCloseTo(0.576, 3);
    expect(kept.standardDeviation).toBeCloseTo(0.122, 3);
  });

  it('[STA-17] keeps the measured games of the other cases of the season in each baseline', () => {
    const other = usable(50, 0.2);
    const games = [...usableGames(TEN), other, MEASURED];
    const ofMeasured = baselineOf(games);
    const ofOther = baselineOf(games, { excludedGameId: other.gameId });

    expect(ofMeasured.gameCount).toBe(11);
    expect(ofMeasured.mean).toBeCloseTo((5.54 + 0.2) / 11, 9);
    expect(ofOther.gameCount).toBe(11);
    expect(ofOther.mean).toBeCloseTo((5.54 + 0.8) / 11, 9);
  });

  it('[STA-14] [STA-16] averages the usable games alone, never a game under the threshold, without an index, not played or of unknown participation', () => {
    const others = [underThreshold(2, 1.5), withoutIndex(3), notPlayed(4), unknown(5)];
    const baseline = baselineOf([...usableGames([0.4, 0.6]), ...others, MEASURED], {}, FEW);

    expect(baseline).toMatchObject({ gameCount: 2, status: 'final' });
    expect(baseline.mean).toBeCloseTo(0.5, 9);
    expect(baseline.standardDeviation).toBeCloseTo(Math.sqrt(0.02), 9);
  });

  it('[STA-20] [STA-21] holds the usable games played before and after the measured game', () => {
    const games = [...usableGames([0.4, 0.6]), MEASURED, usable(101, 0.2), usable(102, 0.8)];
    const baseline = baselineOf(games, { phaseState: RUNNING }, FEW);

    expect(baseline).toMatchObject({ gameCount: 4, status: 'provisional' });
    expect(baseline.mean).toBeCloseTo(0.5, 9);
  });

  it('[STA-18] [CL-STA-02] draws a regular-season baseline from the regular season alone, a postseason one from the play-in and playoffs together', () => {
    const games = [...REGULAR_SEASON, ...POSTSEASON, PLAYOFF_GAME];
    const regular = baselineOf(games, { phase: 'regular_season' });
    const postseason = baselineOf(games, { phase: 'postseason' });

    expect(regular).toMatchObject({ gameCount: 60, status: 'final' });
    expect(regular.mean).toBeCloseTo(0.5, 9);
    expect(postseason).toMatchObject({ gameCount: 12, status: 'final' });
    expect(postseason.mean).toBeCloseTo(0.25, 9);
  });

  it('[CA-STA-07] [STA-18] [STA-19] [STA-20] bases a playoff game on the 12 other usable postseason games, not on the regular season', () => {
    const phase = baselinePhaseOf('playoffs', DEFAULTS);
    const games = [...REGULAR_SEASON, ...POSTSEASON, PLAYOFF_GAME];
    const baseline = baselineOf(games, { phase, phaseState: RUNNING });

    expect(baseline).toMatchObject({ gameCount: 12, status: 'provisional' });
    expect(baseline.mean).toBeCloseTo(0.25, 9);
  });

  it('[CA-STA-07] [STA-19] [STA-20] makes the postseason baseline insufficient with 6 other games once his team is eliminated', () => {
    const games = [...REGULAR_SEASON, ...POSTSEASON.slice(0, 6), PLAYOFF_GAME];

    expect(baselineOf(games, { phase: 'postseason', phaseState: IN_WINDOW })).toMatchObject({
      gameCount: 6,
      status: 'insufficient',
    });
  });

  it('[STA-18] [CL-STA-02] compares a playoff game with the regular-season games alone when games.postseasonBaseline says so', () => {
    const params = withGames({ postseasonBaseline: 'regular_season' });
    const phase = baselinePhaseOf('playoffs', params);
    const baseline = baselineOf(
      [...REGULAR_SEASON, ...POSTSEASON, PLAYOFF_GAME],
      { phase },
      params,
    );

    expect(baseline).toMatchObject({ gameCount: 60, status: 'final' });
    expect(baseline.mean).toBeCloseTo(0.5, 9);
  });

  it('[CA-STA-06] [STA-19] [STA-20] [STA-21] [STA-22] is building at 7 usable games besides the measured game, provisional at 10, final once the phase is over and its last game consolidated', () => {
    const seven = [...usableGames(TEN.slice(0, 7)), MEASURED];
    const ten = [...usableGames(TEN), MEASURED];

    expect(baselineOf(seven, { phaseState: RUNNING })).toMatchObject({
      gameCount: 7,
      status: 'building',
    });
    expect(baselineOf(ten, { phaseState: RUNNING }).status).toBe('provisional');
    expect(baselineOf(ten, { phaseState: IN_WINDOW }).status).toBe('provisional');
    expect(baselineOf(ten, { phaseState: CONSOLIDATED }).status).toBe('final');
  });

  it.each([
    { phase: 'running', phaseState: RUNNING, status: 'building' },
    {
      phase: 'over, its last game in its correction window',
      phaseState: IN_WINDOW,
      status: 'insufficient',
    },
    { phase: 'over, its last game consolidated', phaseState: CONSOLIDATED, status: 'insufficient' },
  ])(
    '[STA-19] [STA-22] is $status with 9 usable games while the phase is $phase',
    ({ phaseState, status }) => {
      const games = [...usableGames(TEN.slice(0, 9)), MEASURED];

      expect(baselineOf(games, { phaseState })).toMatchObject({ gameCount: 9, status });
    },
  );

  it('[STA-19] takes its minimum of games from games.minBaselineGames', () => {
    const params = withGames({ minBaselineGames: 5 });
    const five = [...usableGames(TEN.slice(0, 5)), MEASURED];
    const four = [...usableGames(TEN.slice(0, 4)), MEASURED];

    expect(baselineOf(five, {}, params).status).toBe('final');
    expect(baselineOf(four, {}, params).status).toBe('insufficient');
  });

  it('[STA-16] [STA-22] gives a building baseline its mean from one game on and its deviation from two', () => {
    const none = { gameCount: 0, mean: null, standardDeviation: null };

    expect(whileRunning([])).toStrictEqual({ ...none, status: 'building', isPartial: false });
    expect(whileRunning([0.4])).toMatchObject({ gameCount: 1, mean: 0.4, standardDeviation: null });
    expect(whileRunning([0.4, 0.6])).toMatchObject({ gameCount: 2, status: 'building' });
    expect(whileRunning([0.4, 0.6]).mean).toBeCloseTo(0.5, 9);
    expect(whileRunning([0.4, 0.6]).standardDeviation).toBeCloseTo(Math.sqrt(0.02), 9);
  });

  it.each([
    { phase: 'running', phaseState: RUNNING },
    { phase: 'over', phaseState: CONSOLIDATED },
  ])(
    '[STA-19] [CL-STA-08] makes ten equal indices insufficient, a deviation of exactly zero, while the phase is $phase',
    ({ phaseState }) => {
      const baseline = baselineOf([...usableGames(times(10, () => 0.1)), MEASURED], { phaseState });

      expect(baseline).toMatchObject({ gameCount: 10, standardDeviation: 0 });
      expect(baseline.status).toBe('insufficient');
      expect(baseline.mean).toBeCloseTo(0.1, 9);
    },
  );

  it('[STA-21] [CL-STA-08] becomes provisional again once a new game gives it a deviation', () => {
    const games = [...usableGames(times(10, () => 0.1)), usable(10, 0.2), MEASURED];
    const baseline = baselineOf(games, { phaseState: RUNNING });

    expect(baseline).toMatchObject({ gameCount: 11, status: 'provisional' });
    // The squared differences to 1.2 ÷ 11 add up to 1 ÷ 110.
    expect(baseline.standardDeviation).toBeCloseTo(Math.sqrt(1 / 1100), 9);
  });

  it('[CA-STA-19] [STA-24] [STA-45] keeps usable, and partial, an old season with 40 usable games whose played games are 25 % incomplete', () => {
    // 60 played games: 40 usable, the measured game among them, 5 under the threshold and
    // 15 incomplete.
    const games = [
      ...usableGames(times(39, (day) => 0.3 + 0.01 * day)),
      MEASURED,
      ...times(5, (offset) => underThreshold(40 + offset, 0.2)),
      ...times(15, (offset) => withoutIndex(45 + offset)),
    ];

    expect(baselineOf(games)).toMatchObject({ gameCount: 39, status: 'final', isPartial: true });
  });

  it.each([
    { missing: 2, share: 20, isPartial: false },
    { missing: 3, share: 20, isPartial: true },
    { missing: 3, share: 30, isPartial: false },
  ])(
    '[STA-24] is partial only above games.partialBaselineShare: $missing of 10 played games without an index at $share %, partial $isPartial',
    ({ missing, share, isPartial }) => {
      const games = [
        ...usableGames(TEN.slice(0, 9 - missing)),
        MEASURED,
        ...times(missing, (offset) => withoutIndex(20 + offset)),
      ];

      expect(baselineOf(games, {}, withGames({ partialBaselineShare: share })).isPartial).toBe(
        isPartial,
      );
    },
  );

  // Counted among the games without an index alone, 2 unknown games beside 8 with one
  // would make 2 of 8, 25 %; counted among the played games alone, 3 would make 0 of 10.
  it.each([
    { unknowns: 2, isPartial: false },
    { unknowns: 3, isPartial: true },
  ])(
    '[STA-24] [CL-STA-04] counts $unknowns games of unknown participation among 10 as played without an index, partial $isPartial',
    ({ unknowns, isPartial }) => {
      const games = [
        ...usableGames(TEN.slice(0, 9 - unknowns)),
        MEASURED,
        ...times(unknowns, (offset) => unknown(20 + offset)),
      ];

      expect(baselineOf(games).isPartial).toBe(isPartial);
    },
  );

  // 10 played games, one of them under the threshold, and 5 he did not play. Counted as
  // played, these 5 would make 3 of 15 in the second row; counted as played without an
  // index, 7 of 15 in the first. The game under the threshold, counted without an index,
  // would make 3 of 10 in the first row.
  it.each([
    { missing: 2, isPartial: false },
    { missing: 3, isPartial: true },
  ])(
    '[STA-24] counts no game he did not play and no game under the threshold as missing: $missing of 10 played, partial $isPartial',
    ({ missing, isPartial }) => {
      const games = [
        ...usableGames(TEN.slice(0, 8 - missing)),
        underThreshold(9, 0.2),
        MEASURED,
        ...times(missing, (offset) => withoutIndex(20 + offset)),
        ...times(5, (offset) => notPlayed(30 + offset)),
      ];

      expect(baselineOf(games).isPartial).toBe(isPartial);
    },
  );

  it('[STA-24] counts the measured game among the played games of its season and phase, and no game of another phase', () => {
    // 2 of the 10 other played games lack an index, 20 %; the measured game, without one
    // too, makes 3 of 11.
    const games = [...usableGames(TEN.slice(0, 8)), withoutIndex(8), withoutIndex(9)];
    const playoffs = times(5, (offset) => withoutIndex(70 + offset, 'playoffs'));

    expect(baselineOf([...games, withoutIndex(MEASURED_DAY)]).isPartial).toBe(true);
    expect(baselineOf([...games, MEASURED, ...playoffs]).isPartial).toBe(false);
  });

  // Three indices whose sums end in other bits when they add up in another order.
  it('[CL-STA-09] adds up the indices by scheduled start, whatever the order and the ids of the games', () => {
    const inOrder = [usable(0, 0.1), usable(1, 0.2), usable(2, 0.33)];
    // Given in another order, with ids in yet another.
    const shuffled = [
      { ...usable(1, 0.2), gameId: 3 },
      { ...usable(2, 0.33), gameId: 1 },
      { ...usable(0, 0.1), gameId: 2 },
    ];
    const baseline = baselineOf(inOrder, {}, FEW);

    expect(baseline.mean).toBeCloseTo(0.21, 9);
    expect(baselineOf(shuffled, {}, FEW)).toStrictEqual(baseline);
  });

  it('[CL-STA-09] adds up the indices of games with the same start by game id', () => {
    const apart = baselineOf([usable(0, 0.1), usable(1, 0.2), usable(2, 0.33)], {}, FEW);
    // The last two start together: the lower id comes first, as if it started earlier.
    const lower = usable(1, 0.2);
    const higher = { ...usable(1, 0.33), gameId: 3 };

    expect(baselineOf([usable(0, 0.1), lower, higher], {}, FEW)).toStrictEqual(apart);
    expect(baselineOf([usable(0, 0.1), higher, lower], {}, FEW)).toStrictEqual(apart);
  });
});

const anyIndex = fc.double({ min: -1, max: 3, noNaN: true });
const anyPlace = {
  gameId: fc.nat({ max: 99 }),
  // Few starts, so that games often start together.
  scheduledStartAt: fc.nat({ max: 20 }),
  phase: fc.constantFrom<GamePhase>('regular_season', 'play_in', 'playoffs'),
};
const anyGame: fc.Arbitrary<BaselineGame> = fc.oneof(
  fc.record({ ...anyPlace, classification: fc.constant('usable'), performanceIndex: anyIndex }),
  fc.record({
    ...anyPlace,
    classification: fc.constant('played_not_usable'),
    performanceIndex: fc.option(anyIndex, { nil: null }),
  }),
  fc.record({
    ...anyPlace,
    classification: fc.constantFrom('not_played', null),
    performanceIndex: fc.constant(null),
  }),
);
const anyInput: fc.Arbitrary<SeasonBaselineInput> = fc.record({
  games: fc.uniqueArray(anyGame, { selector: (game) => game.gameId, maxLength: 40 }),
  phase: fc.constantFrom<BaselinePhase>('regular_season', 'postseason'),
  excludedGameId: fc.nat({ max: 99 }),
  phaseState: fc.record({ finished: fc.boolean(), lastGameConsolidated: fc.boolean() }),
});
const anyParams = fc
  .record({
    minBaselineGames: fc.integer({ min: 2, max: 12 }),
    partialBaselineShare: fc.integer({ min: 0, max: 100 }),
  })
  .map((games) => withGames(games));

/** `input` with its measured game made a usable game of `index`. */
function measuredAt(input: SeasonBaselineInput, index: number): SeasonBaselineInput {
  const games = input.games.map((game): BaselineGame =>
    game.gameId === input.excludedGameId
      ? { ...game, classification: 'usable', performanceIndex: index }
      : game,
  );
  return { ...input, games };
}

/** Whether a case could be measured against `baseline` short of its minimum or deviation. */
function isMeasurableShort(baseline: SeasonBaseline, params: EngineParams): boolean {
  return (
    (baseline.status === 'final' || baseline.status === 'provisional') &&
    (baseline.gameCount < params.games.minBaselineGames || baseline.standardDeviation <= 0)
  );
}

describe('seasonBaseline, for any season', () => {
  it('[CL-STA-09] gives the same baseline, to the bit, for any order of the games', () => {
    const anyOrders = anyInput.chain((input) =>
      fc.tuple(
        fc.constant(input),
        fc.shuffledSubarray([...input.games], { minLength: input.games.length }),
      ),
    );

    fc.assert(
      fc.property(anyOrders, anyParams, ([input, shuffled], params) => {
        expect(seasonBaseline({ ...input, games: shuffled }, params)).toStrictEqual(
          seasonBaseline(input, params),
        );
      }),
    );
  });

  it('[STA-17] never lets the measured game weigh on its own baseline, whatever its index', () => {
    fc.assert(
      fc.property(anyInput, anyParams, fc.tuple(anyIndex, anyIndex), (input, params, indices) => {
        const [first, second] = indices;

        expect(seasonBaseline(measuredAt(input, first), params)).toStrictEqual(
          seasonBaseline(measuredAt(input, second), params),
        );
      }),
    );
  });

  it('[STA-19] [STA-20] [STA-22] measures only against the minimum and a deviation, builds only while the phase runs and settles only once its last game is consolidated', () => {
    fc.assert(
      fc.property(anyInput, anyParams, (input, params) => {
        const baseline = seasonBaseline(input, params);
        const { status } = baseline;
        const { finished, lastGameConsolidated } = input.phaseState;

        expect(isMeasurableShort(baseline, params)).toBe(false);
        expect(status === 'building' && finished).toBe(false);
        expect(status === 'final' && !(finished && lastGameConsolidated)).toBe(false);
      }),
    );
  });
});

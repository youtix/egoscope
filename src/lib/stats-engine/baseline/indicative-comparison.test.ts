import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { indicativeComparison } from './indicative-comparison';

import type { PhaseState } from '../schedule/phase-state';
import type { GamePhase } from '../schedule/team-record';
import type { EngineParams } from '../types';
import type { IndicativeComparisonInput, IndicativeSeason } from './indicative-comparison';
import type { BaselineGame, SeasonBaselineStatus } from './season-baseline';

// The registry's defaults: 10 games at least, play-in and playoff games compared with the
// postseason (STA-18, STA-19). JSON gives the baseline phase as a string, which the
// comparison narrows to a BaselinePhase (types.test.ts).
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

const RUNNING: PhaseState = { finished: false, lastGameConsolidated: false };
const IN_WINDOW: PhaseState = { finished: true, lastGameConsolidated: false };
const CONSOLIDATED: PhaseState = { finished: true, lastGameConsolidated: true };

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
// Opening night of 2000-01, from which the seasons of these tests are counted.
const OPENING_NIGHT_2000 = 972_000_000_000;

const firstYearOf = (season: string): number => Number(season.slice(0, 4));
/** The season that starts in `firstYear`: `2024-25` for 2024, `1999-00` for 1999. */
const seasonOf = (firstYear: number): string =>
  `${String(firstYear)}-${String((firstYear + 1) % 100).padStart(2, '0')}`;

/** The game of `day` of `season`, counted from its opening night. */
function on(season: string, day: number, phase: GamePhase) {
  const year = firstYearOf(season);
  return {
    gameId: year * 1000 + day,
    scheduledStartAt: OPENING_NIGHT_2000 + (year - 2000) * YEAR_MS + day * DAY_MS,
    phase,
  };
}

/** The day of a phase's first game, counted from opening night: the postseason's is day 180. */
const firstDayOf = (phase: GamePhase): number => (phase === 'regular_season' ? 0 : 180);

/** Usable games of these indices in `season`, one a day from the phase's first day. */
const usableGames = (
  season: string,
  indices: readonly number[],
  phase: GamePhase = 'regular_season',
): BaselineGame[] =>
  indices.map((performanceIndex, offset) => ({
    ...on(season, firstDayOf(phase) + offset, phase),
    classification: 'usable',
    performanceIndex,
  }));

const regularSeason = (
  season: string,
  indices: readonly number[],
  phaseState: PhaseState = CONSOLIDATED,
): IndicativeSeason => ({ season, games: usableGames(season, indices), phaseState });

// Ten indices of mean 10 and standard deviation 2: four lie 3 away, their squares add up
// to 36, and 36 / 9 = 4. Ten of mean 22 and deviation 2 the same way.
const MEAN_10_DEVIATION_2 = [13, 7, 13, 7, 10, 10, 10, 10, 10, 10];
const MEAN_22_DEVIATION_2 = [25, 19, 25, 19, 22, 22, 22, 22, 22, 22];

type MeasuredGame = IndicativeComparisonInput['measuredGame'];

const regularSeasonGame = (performanceIndex: number): MeasuredGame => ({
  gameId: 1,
  season: '2024-25',
  phase: 'regular_season',
  performanceIndex,
});

function compare(
  measuredGame: MeasuredGame,
  seasons: readonly IndicativeSeason[],
  baselineStatus: SeasonBaselineStatus = 'building',
) {
  return indicativeComparison({ measuredGame, baselineStatus, seasons }, DEFAULTS);
}

const sumOf = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);
const meanOf = (values: readonly number[]): number => sumOf(values) / values.length;
/** The sample standard deviation, which divides by n − 1 (STA-16). */
const deviationOf = (values: readonly number[]): number =>
  Math.sqrt(sumOf(values.map((value) => (value - meanOf(values)) ** 2)) / (values.length - 1));

type DrawnSeason = Readonly<{ year: number; isFinal: boolean; indices: readonly number[] }>;
type DrawnGame = Readonly<{ year: number; phase: GamePhase; performanceIndex: number }>;

/**
 * The comparison expected of the drawn seasons: with the final regular season of the
 * latest year before the game, its own year included for a play-in or playoff game.
 */
function expectedOf(seasons: readonly DrawnSeason[], game: DrawnGame): unknown {
  const isBefore = (year: number) =>
    game.phase === 'regular_season' ? year < game.year : year <= game.year;
  const [latest] = seasons
    .filter(({ year, isFinal }) => isFinal && isBefore(year))
    .toSorted((left, right) => right.year - left.year);
  if (latest === undefined) {
    return null;
  }
  // Within 1e-9 (CL-STA-09).
  const indicativeGap: unknown = expect.closeTo(
    (game.performanceIndex - meanOf(latest.indices)) / deviationOf(latest.indices),
    9,
  );
  return { kind: 'indicative', season: seasonOf(latest.year), indicativeGap };
}

describe('indicativeComparison', () => {
  it('[STA-23] compares a regular-season game with the final baseline of the previous regular season, labeled indicative', () => {
    // 2023-24: ten usable games of mean 10 and deviation 2, beside a game under the
    // playing-time threshold, a game he did not play and one of unknown participation.
    const previous: IndicativeSeason = {
      season: '2023-24',
      games: [
        ...usableGames('2023-24', MEAN_10_DEVIATION_2),
        {
          ...on('2023-24', 20, 'regular_season'),
          classification: 'played_not_usable',
          performanceIndex: 30,
        },
        {
          ...on('2023-24', 21, 'regular_season'),
          classification: 'not_played',
          performanceIndex: null,
        },
        { ...on('2023-24', 22, 'regular_season'), classification: null, performanceIndex: null },
      ],
      phaseState: CONSOLIDATED,
    };

    // (15 − 10) / 2 = 2.5 and (4 − 10) / 2 = −3: comparisons, never a normalized gap
    // with its gap status.
    expect(compare(regularSeasonGame(15), [previous])).toStrictEqual({
      kind: 'indicative',
      season: '2023-24',
      indicativeGap: 2.5,
    });
    expect(compare(regularSeasonGame(4), [previous])?.indicativeGap).toBe(-3);
  });

  it.each<GamePhase>(['play_in', 'playoffs'])(
    '[STA-23] [CL-STA-13] compares a %s game with the regular season of its own season once final',
    (phase) => {
      // The season's own playoff games stay out of a regular-season baseline.
      const ownSeason: IndicativeSeason = {
        season: '2024-25',
        games: [
          ...usableGames('2024-25', MEAN_22_DEVIATION_2),
          ...usableGames('2024-25', [40, 0, 5], 'playoffs'),
        ],
        phaseState: CONSOLIDATED,
      };
      const measuredGame = { gameId: 1, season: '2024-25', phase, performanceIndex: 26 };

      // (26 − 22) / 2 = 2, the 2023-24 baseline left aside.
      expect(
        compare(measuredGame, [regularSeason('2023-24', MEAN_10_DEVIATION_2), ownSeason]),
      ).toStrictEqual({ kind: 'indicative', season: '2024-25', indicativeGap: 2 });
    },
  );

  it.each<GamePhase>(['play_in', 'playoffs'])(
    '[STA-23] [CL-STA-13] compares a %s game with the previous season while its own regular season is not final',
    (phase) => {
      const ownSeason = regularSeason('2024-25', MEAN_22_DEVIATION_2, IN_WINDOW);
      const measuredGame = { gameId: 1, season: '2024-25', phase, performanceIndex: 26 };

      // (26 − 10) / 2 = 8.
      expect(
        compare(measuredGame, [ownSeason, regularSeason('2023-24', MEAN_10_DEVIATION_2)]),
      ).toStrictEqual({ kind: 'indicative', season: '2023-24', indicativeGap: 8 });
    },
  );

  it("[STA-23] [CL-STA-13] never compares a regular-season game with its own season's regular season", () => {
    const seasons = [
      regularSeason('2024-25', MEAN_22_DEVIATION_2),
      regularSeason('2023-24', MEAN_10_DEVIATION_2),
    ];

    expect(compare(regularSeasonGame(15), seasons)?.season).toBe('2023-24');
  });

  it('[STA-23] [CL-STA-13] takes the most recent final baseline before the game, passing over a later season and one short of its games', () => {
    const seasons = [
      regularSeason('2021-22', MEAN_22_DEVIATION_2),
      regularSeason('2022-23', MEAN_10_DEVIATION_2),
      // Five games only: insufficient once its regular season is over.
      regularSeason('2023-24', [10, 12, 14, 16, 18]),
      regularSeason('2025-26', MEAN_22_DEVIATION_2),
    ];

    expect(compare(regularSeasonGame(15), seasons)).toStrictEqual({
      kind: 'indicative',
      season: '2022-23',
      indicativeGap: 2.5,
    });
  });

  it('[STA-23] [CL-STA-13] passes over a previous regular season whose indices are all the same', () => {
    const seasons = [
      regularSeason('2022-23', MEAN_22_DEVIATION_2),
      regularSeason(
        '2023-24',
        Array.from({ length: 12 }, () => 10),
      ),
    ];

    expect(compare(regularSeasonGame(26), seasons)).toStrictEqual({
      kind: 'indicative',
      season: '2022-23',
      indicativeGap: 2,
    });
  });

  it('[STA-23] makes no comparison when no regular season before the game has a final baseline', () => {
    // Nine games, a regular season still in its correction window, and his own season.
    const noneFinalBefore = [
      regularSeason('2023-24', MEAN_10_DEVIATION_2.slice(1)),
      regularSeason('2022-23', MEAN_10_DEVIATION_2, IN_WINDOW),
      regularSeason('2024-25', MEAN_10_DEVIATION_2),
    ];

    expect(compare(regularSeasonGame(15), [])).toBeNull();
    expect(compare(regularSeasonGame(15), noneFinalBefore)).toBeNull();
  });

  it.each<SeasonBaselineStatus>(['final', 'provisional', 'insufficient'])(
    '[STA-23] makes no comparison when the baseline of the measured game is %s',
    (baselineStatus) => {
      const seasons = [regularSeason('2023-24', MEAN_10_DEVIATION_2)];

      expect(compare(regularSeasonGame(15), seasons, baselineStatus)).toBeNull();
      expect(compare(regularSeasonGame(15), seasons, 'building')).not.toBeNull();
    },
  );

  it('[STA-23] [CL-STA-13] compares with the most recent final regular season before the game, whatever the order of the seasons', () => {
    const drawnSeason = fc.record({
      year: fc.integer({ min: 2010, max: 2030 }),
      isFinal: fc.boolean(),
      indices: fc
        .array(fc.integer({ min: -20, max: 60 }), { minLength: 10, maxLength: 14, size: 'max' })
        .filter((values) => values.some((value) => value !== values[0])),
    });
    const drawnSeasons = fc.uniqueArray(drawnSeason, {
      selector: ({ year }) => year,
      maxLength: 8,
      size: 'max',
    });
    const drawnGame = fc.record({
      year: fc.integer({ min: 2010, max: 2030 }),
      phase: fc.constantFrom<GamePhase>('regular_season', 'play_in', 'playoffs'),
      performanceIndex: fc.double({ min: -20, max: 60, noNaN: true }),
    });

    fc.assert(
      fc.property(drawnSeasons, drawnGame, (seasons, game) => {
        const measuredGame = { ...game, gameId: 1, season: seasonOf(game.year) };
        const given = seasons.map(({ year, isFinal, indices }) =>
          regularSeason(seasonOf(year), indices, isFinal ? CONSOLIDATED : RUNNING),
        );

        expect(compare(measuredGame, given)).toStrictEqual(expectedOf(seasons, game));
      }),
    );
  });
});

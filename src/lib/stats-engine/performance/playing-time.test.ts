import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { verifyBoxScore } from './box-score';
import { classifyGame, playingTimeThreshold } from './playing-time';

import type { BoxScoreCheck, BoxScoreLine } from './box-score';
import type { PlayerGame } from './playing-time';
import type { EngineParams } from '../types';

// The registry's defaults: a 15-minute floor and 50 % of the average (STA-14). JSON gives
// the baseline phase as a string, which the comparison narrows to a BaselinePhase
// (types.test.ts).
const PARAMS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

// A complete and consistent whole-minutes line: 10 points, 4 of 8 from the field, 2 of 2
// at the line.
const LINE: BoxScoreLine = {
  minutesPrecision: 'whole_minutes',
  minutes: 30,
  seconds: null,
  points: 10,
  fieldGoalsMade: 4,
  fieldGoalsAttempted: 8,
  threePointersMade: 0,
  freeThrowsMade: 2,
  freeThrowsAttempted: 2,
  offensiveRebounds: 1,
  defensiveRebounds: 3,
  assists: 2,
  steals: 1,
  blocks: 0,
  turnovers: 1,
  personalFouls: 2,
};

const DAY_MS = 86_400_000;
const OPENING_NIGHT = 1_729_641_600_000;

const complete = (minutes: number): BoxScoreCheck => verifyBoxScore({ ...LINE, minutes }, 0);
const incomplete = (minutes: number | null): BoxScoreCheck =>
  verifyBoxScore({ ...LINE, minutes, turnovers: null }, 0);
// 11 points for 4 made field goals and 2 made free throws.
const suspect = (minutes: number): BoxScoreCheck =>
  verifyBoxScore({ ...LINE, minutes, points: 11 }, 0);
const exact = (minutes: number, seconds: number): BoxScoreCheck =>
  verifyBoxScore({ ...LINE, minutesPrecision: 'seconds', minutes, seconds }, 0);

/** The game of `day`, counted from opening night, its id one more than the day. */
function game(
  day: number,
  boxScore: BoxScoreCheck | null,
  phase: PlayerGame['phase'] = 'regular_season',
): PlayerGame {
  return { gameId: day + 1, scheduledStartAt: OPENING_NIGHT + day * DAY_MS, phase, boxScore };
}

/** Regular-season games he played completely for these whole minutes, one a day. */
function season(minutes: readonly number[]): PlayerGame[] {
  return minutes.map((value, day) => game(day, complete(value)));
}

const repeat = (minutes: number, times: number): number[] =>
  Array.from({ length: times }, () => minutes);

// Three exact times whose decimal minutes would add up to other bits in another order;
// half their mean is 17.9361 minutes.
const FIRST = exact(30, 1);
const SECOND = exact(36, 56);
const THIRD = exact(40, 40);
const HALF_MEAN = 17.936111111111;

describe('playingTimeThreshold and classifyGame', () => {
  it('[STA-14] [STA-15] [CA-STA-03] put the threshold at 17.5 minutes for a 35-minute average, so 16 minutes are not usable', () => {
    const measured = game(19, complete(16));
    const threshold = playingTimeThreshold([...season(repeat(36, 19)), measured], PARAMS);

    expect(threshold).toBeCloseTo(17.5, 9);
    expect(classifyGame(measured, threshold)).toBe('played_not_usable');
  });

  it('[STA-14] [STA-15] [CA-STA-03] keep the 15-minute floor for a 24-minute average, so 16 minutes are usable', () => {
    const measured = game(4, complete(16));
    const threshold = playingTimeThreshold([...season(repeat(26, 4)), measured], PARAMS);

    expect(threshold).toBe(15);
    expect(classifyGame(measured, threshold)).toBe('usable');
  });

  it('[STA-14] [CL-STA-06] let 15 whole minutes reach the 15-minute floor, and not 14', () => {
    const games = season([20, 15, 14]);
    const threshold = playingTimeThreshold(games, PARAMS);

    expect(threshold).toBe(15);
    expect(games.map((each) => classifyGame(each, threshold))).toStrictEqual([
      'usable',
      'usable',
      'played_not_usable',
    ]);
  });

  // Both thresholds are whole numbers: rounding 46 ÷ 100, 850 ÷ 23 and their product one
  // by one would land just above 17, and likewise above 16.
  it.each([
    { share: 46, others: [...repeat(38, 19), ...repeat(37, 3)], minutes: 17, average: '850 ÷ 23' },
    { share: 34, others: repeat(48, 33), minutes: 16, average: '1,600 ÷ 34' },
  ])(
    '[STA-14] [CL-STA-06] make a game usable at a threshold of exactly its whole minutes, $minutes minutes, $share % of an average of $average',
    ({ share, others, minutes }) => {
      const params = { ...PARAMS, games: { ...PARAMS.games, minutesAverageShare: share } };
      const measured = game(others.length, complete(minutes));
      const threshold = playingTimeThreshold([...season(others), measured], params);

      expect(threshold).toBeCloseTo(minutes, 9);
      expect(classifyGame(measured, threshold)).toBe('usable');
    },
  );

  it('[STA-15] [CL-STA-07] keep the measured game in the average, the one threshold of every game', () => {
    const measured = game(3, complete(16));
    // 31 minutes on average with the measured game; 36 without it, which would make 18.
    const threshold = playingTimeThreshold([...season(repeat(36, 3)), measured], PARAMS);

    expect(threshold).toBeCloseTo(15.5, 9);
    expect(classifyGame(measured, threshold)).toBe('usable');
  });

  it('[STA-14] [CL-STA-07] average only the regular-season games he played with minutes and a box score that is not suspect', () => {
    const games = [
      game(0, complete(30)),
      game(1, incomplete(40)),
      game(2, suspect(10)),
      game(3, incomplete(null)),
      game(4, incomplete(0)),
      game(5, null),
      game(6, complete(12), 'play_in'),
      game(7, complete(10), 'playoffs'),
    ];

    expect(playingTimeThreshold(games, PARAMS)).toBeCloseTo(17.5, 9);
  });

  it('[STA-14] [CL-STA-07] take the floor alone when no game counts in the average', () => {
    const games = [game(0, null), game(1, suspect(40)), game(2, complete(40), 'playoffs')];
    const params = { ...PARAMS, games: { ...PARAMS.games, minutesFloor: 20 } };

    expect(playingTimeThreshold(games, params)).toBe(20);
  });

  it('[STA-14] take the floor and the share of the average from the parameters', () => {
    const params = {
      ...PARAMS,
      games: { ...PARAMS.games, minutesFloor: 10, minutesAverageShare: 60 },
    };

    expect(playingTimeThreshold(season([30, 30]), params)).toBeCloseTo(18, 9);
  });

  it('[STA-15] [CL-STA-07] give a playoff game the threshold of the regular season', () => {
    const threshold = playingTimeThreshold(season([35, 35]), PARAMS);
    const short = game(9, complete(16), 'playoffs');
    const long = game(10, complete(18), 'playoffs');

    expect(classifyGame(short, threshold)).toBe('played_not_usable');
    expect(classifyGame(long, threshold)).toBe('usable');
  });

  it.each([
    ['he did not play', null, 'not_played'],
    ['his box score is incomplete', incomplete(40), 'played_not_usable'],
    ['his box score is suspect', suspect(40), 'played_not_usable'],
    ['his box score is complete and he reached the threshold', complete(40), 'usable'],
  ] as const)('[STA-13] [STA-14] classify a game where %s', (_situation, boxScore, expected) => {
    expect(classifyGame(game(0, boxScore), 17.5)).toBe(expected);
  });

  it('[CL-STA-09] add up whole seconds, exact in any order: the same threshold, to the bit, whatever the order, the ids and the starts of the games', () => {
    const inOrder = [game(0, FIRST), game(1, SECOND), game(2, THIRD)];
    // Given last first, with ids in yet another order.
    const shuffled = [
      { ...game(2, THIRD), gameId: 2 },
      { ...game(1, SECOND), gameId: 1 },
      { ...game(0, FIRST), gameId: 3 },
    ];
    // The second and the third games start together, the higher id first.
    const tied = [game(0, FIRST), { ...game(1, THIRD), gameId: 3 }, game(1, SECOND)];
    const threshold = playingTimeThreshold(inOrder, PARAMS);

    expect(threshold).toBeCloseTo(HALF_MEAN, 9);
    expect(playingTimeThreshold(shuffled, PARAMS)).toBe(threshold);
    expect(playingTimeThreshold(tied, PARAMS)).toBe(threshold);
  });

  it('[STA-14] [STA-15] [CL-STA-06] [CL-STA-09] make a game usable at a threshold of exactly its time, 15 min 4 s beside 45 min 12 s', () => {
    // Half the mean of 2,712 and 904 seconds is 904 seconds: 15.0666… minutes either way, to
    // the bit.
    const measured = game(1, exact(15, 4));
    const threshold = playingTimeThreshold([game(0, exact(45, 12)), measured], PARAMS);

    expect(threshold).toBeCloseTo(15.066666666667, 9);
    expect(measured.boxScore?.decimalMinutes).toBe(threshold);
    expect(classifyGame(measured, threshold)).toBe('usable');
  });
});

const anyBoxScore: fc.Arbitrary<BoxScoreCheck | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 0, max: 60 }).map((minutes) => complete(minutes)),
  fc.option(fc.integer({ min: 0, max: 48 }), { nil: null }).map((minutes) => incomplete(minutes)),
  fc.integer({ min: 0, max: 48 }).map((minutes) => suspect(minutes)),
  fc
    .tuple(fc.integer({ min: 0, max: 48 }), fc.integer({ min: 0, max: 59 }))
    .map(([minutes, seconds]) => exact(minutes, seconds)),
);
const anyGames = fc.uniqueArray(
  fc.record({
    gameId: fc.nat(),
    scheduledStartAt: fc.nat(),
    phase: fc.constantFrom('regular_season', 'play_in', 'playoffs'),
    boxScore: anyBoxScore,
  }),
  { selector: (each) => each.gameId, maxLength: 30, size: 'max' },
);
const anyParams = fc
  .record({
    minutesFloor: fc.integer({ min: 0, max: 48 }),
    minutesAverageShare: fc.integer({ min: 0, max: 100 }),
  })
  .map((games) => ({ ...PARAMS, games: { ...PARAMS.games, ...games } }));

/**
 * A season whose last game plays exactly `share` percent of the season's average, its
 * times counted in units of a whole minute or of a second, at most `most` a game:
 * share × (rest + time) = 100 × games × time, so the other games add up to
 * time × (100 × games − share) ÷ share units, spread as evenly as they allow, from 1 each.
 */
function anyExactSeason(
  most: number,
): fc.Arbitrary<Readonly<{ share: number; time: number; others: number[] }>> {
  return fc
    .record({
      share: fc.integer({ min: 1, max: 100 }),
      games: fc.integer({ min: 2, max: 82 }),
      time: fc.integer({ min: 1, max: most }),
    })
    .map((drawn) => ({
      ...drawn,
      rest: (drawn.time * (100 * drawn.games - drawn.share)) / drawn.share,
    }))
    .filter(
      ({ games, rest }) =>
        Number.isSafeInteger(rest) && rest >= games - 1 && rest <= most * (games - 1),
    )
    .map(({ share, games, time, rest }) => {
      const low = Math.floor(rest / (games - 1));
      const higher = rest % (games - 1);
      const others = Array.from({ length: games - 1 }, (_, index) =>
        index < higher ? low + 1 : low,
      );
      return { share, time, others };
    });
}

const inSeconds = (seconds: number): BoxScoreCheck => exact(Math.floor(seconds / 60), seconds % 60);

describe('playingTimeThreshold and classifyGame, for any season', () => {
  it.each([
    { unit: 'whole minutes', most: 48, checked: complete },
    { unit: 'seconds', most: 48 * 60, checked: inSeconds },
  ])(
    '[STA-14] [CL-STA-06] [CL-STA-09] make a game usable at a threshold of exactly its time in $unit, and not one below, for any share',
    ({ most, checked }) => {
      fc.assert(
        fc.property(anyExactSeason(most), ({ share, time, others }) => {
          // Without a floor, the share of the average alone makes the threshold.
          const params = {
            ...PARAMS,
            games: { ...PARAMS.games, minutesFloor: 0, minutesAverageShare: share },
          };
          const otherGames = others.map((value, day) => game(day, checked(value)));
          const measured = game(others.length, checked(time));
          const shorter = game(others.length, checked(time - 1), 'playoffs');
          const threshold = playingTimeThreshold([...otherGames, measured], params);

          expect(classifyGame(measured, threshold)).toBe('usable');
          expect(classifyGame(shorter, threshold)).toBe('played_not_usable');
        }),
      );
    },
  );

  it('[STA-14] never put the threshold below the floor', () => {
    fc.assert(
      fc.property(anyGames, anyParams, (games, params) => {
        expect(playingTimeThreshold(games, params)).toBeGreaterThanOrEqual(
          params.games.minutesFloor,
        );
      }),
    );
  });

  it('[STA-14] never make a suspect or incomplete box score usable', () => {
    fc.assert(
      fc.property(anyBoxScore, fc.integer({ min: 0, max: 48 }), (boxScore, threshold) => {
        const classification = classifyGame(game(0, boxScore), threshold);

        expect(boxScore?.status !== 'complete' && classification === 'usable').toBe(false);
      }),
    );
  });

  it('[CL-STA-09] give the same threshold, to the bit, for any order of the games', () => {
    const anyOrders = anyGames.chain((games) =>
      fc.tuple(fc.constant(games), fc.shuffledSubarray(games, { minLength: games.length })),
    );

    fc.assert(
      fc.property(anyOrders, ([games, shuffled]) => {
        expect(playingTimeThreshold(shuffled, PARAMS)).toBe(playingTimeThreshold(games, PARAMS));
      }),
    );
  });
});

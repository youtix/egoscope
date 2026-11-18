import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { gameScore } from './game-score';

import type { GameScoreInput } from './game-score';

// Scores are compared to 10 decimal places: the formula has no rounding
// (STA-12), and binary floating point cannot represent 0.4 or 0.7 exactly.
const PRECISION = 10;

const EMPTY_LINE: GameScoreInput = {
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  steals: 0,
  assists: 0,
  blocks: 0,
  personalFouls: 0,
  turnovers: 0,
};

const count = fc.integer({ min: 0, max: 200 });

const anyLine: fc.Arbitrary<GameScoreInput> = fc.record({
  points: count,
  fieldGoalsMade: count,
  fieldGoalsAttempted: count,
  freeThrowsMade: count,
  freeThrowsAttempted: count,
  offensiveRebounds: count,
  defensiveRebounds: count,
  steals: count,
  assists: count,
  blocks: count,
  personalFouls: count,
  turnovers: count,
});

/** Returns `left + factor × right`, total by total. */
function combine(left: GameScoreInput, right: Partial<GameScoreInput>, factor = 1): GameScoreInput {
  const total = (stat: keyof GameScoreInput): number => left[stat] + factor * (right[stat] ?? 0);
  return {
    points: total('points'),
    fieldGoalsMade: total('fieldGoalsMade'),
    fieldGoalsAttempted: total('fieldGoalsAttempted'),
    freeThrowsMade: total('freeThrowsMade'),
    freeThrowsAttempted: total('freeThrowsAttempted'),
    offensiveRebounds: total('offensiveRebounds'),
    defensiveRebounds: total('defensiveRebounds'),
    steals: total('steals'),
    assists: total('assists'),
    blocks: total('blocks'),
    personalFouls: total('personalFouls'),
    turnovers: total('turnovers'),
  };
}

describe('gameScore', () => {
  it('[STA-11] [H-13] scores 25.9 for the box score of the spec 07 acceptance example', () => {
    // Spec 07, first acceptance criterion: 31 points, 11 of 20 from the field,
    // 7 of 8 at the line, 1 offensive and 6 defensive rebounds, 7 assists,
    // 2 steals, 1 block, 4 turnovers and 3 personal fouls.
    const line: GameScoreInput = {
      points: 31,
      fieldGoalsMade: 11,
      fieldGoalsAttempted: 20,
      freeThrowsMade: 7,
      freeThrowsAttempted: 8,
      offensiveRebounds: 1,
      defensiveRebounds: 6,
      steals: 2,
      assists: 7,
      blocks: 1,
      personalFouls: 3,
      turnovers: 4,
    };

    expect(gameScore(line)).toBeCloseTo(25.9, PRECISION);
  });

  it.each([
    ['points', 1],
    ['fieldGoalsMade', 0.4],
    ['fieldGoalsAttempted', -0.7],
    ['freeThrowsMade', 0.4],
    ['freeThrowsAttempted', -0.4],
    ['offensiveRebounds', 0.7],
    ['defensiveRebounds', 0.3],
    ['steals', 1],
    ['assists', 0.7],
    ['blocks', 0.7],
    ['personalFouls', -0.4],
    ['turnovers', -1],
  ] as const)('[STA-11] [H-13] weighs one unit of %s at %s', (stat, weight) => {
    expect(gameScore({ ...EMPTY_LINE, [stat]: 1 })).toBeCloseTo(weight, PRECISION);
  });

  it('[STA-11] scores an empty box score at exactly zero', () => {
    expect(gameScore(EMPTY_LINE)).toBe(0);
  });

  it('[STA-11] keeps a negative score as it is', () => {
    const scoreless = { ...EMPTY_LINE, fieldGoalsAttempted: 5, turnovers: 2 };

    expect(gameScore(scoreless)).toBeCloseTo(-5.5, PRECISION);
  });

  it('[STA-11] adds up: two box scores summed score the sum of their scores', () => {
    fc.assert(
      fc.property(anyLine, anyLine, (left, right) => {
        const summed = gameScore(combine(left, right));

        expect(summed).toBeCloseTo(gameScore(left) + gameScore(right), PRECISION);
      }),
    );
  });

  it('[STA-11] scales: multiplying every total by k multiplies the score by k', () => {
    fc.assert(
      fc.property(anyLine, fc.integer({ min: 0, max: 5 }), (line, factor) => {
        const scaled = gameScore(combine(EMPTY_LINE, line, factor));

        expect(scaled).toBeCloseTo(factor * gameScore(line), PRECISION);
      }),
    );
  });

  it('[STA-11] values a made free throw at exactly one point', () => {
    const madeFreeThrow = { points: 1, freeThrowsMade: 1, freeThrowsAttempted: 1 };

    fc.assert(
      fc.property(anyLine, (line) => {
        const gain = gameScore(combine(line, madeFreeThrow)) - gameScore(line);

        expect(gain).toBeCloseTo(1, PRECISION);
      }),
    );
  });

  it('[STA-11] values a made two-pointer at 1.7 and a missed shot at -0.7', () => {
    const madeTwo = { points: 2, fieldGoalsMade: 1, fieldGoalsAttempted: 1 };
    const missedShot = { fieldGoalsAttempted: 1 };

    fc.assert(
      fc.property(anyLine, (line) => {
        const base = gameScore(line);

        expect(gameScore(combine(line, madeTwo)) - base).toBeCloseTo(1.7, PRECISION);
        expect(gameScore(combine(line, missedShot)) - base).toBeCloseTo(-0.7, PRECISION);
      }),
    );
  });
});

import { assert, describe, expect, expectTypeOf, it } from 'vitest';

import { verifyBoxScore } from './box-score';
import { gameScore } from './game-score';
import { performanceIndex } from './performance-index';

import type { BoxScoreLine, CheckedBoxScore } from './box-score';
import type { GameScoreInput } from './game-score';

// The box score of CA-STA-01: 34 min 30 s, 31 points, 11 of 20 from the field and 7 of 8
// at the line, 1 offensive and 6 defensive rebounds, 7 assists, 2 steals, 1 block,
// 4 turnovers and 3 personal fouls.
const SPEC_LINE: BoxScoreLine = {
  minutesPrecision: 'seconds',
  minutes: 34,
  seconds: 30,
  points: 31,
  fieldGoalsMade: 11,
  fieldGoalsAttempted: 20,
  threePointersMade: null,
  freeThrowsMade: 7,
  freeThrowsAttempted: 8,
  offensiveRebounds: 1,
  defensiveRebounds: 6,
  assists: 7,
  steals: 2,
  blocks: 1,
  turnovers: 4,
  personalFouls: 3,
};

/** The box score that verifyBoxScore makes of a complete line. */
function checked(line: BoxScoreLine): CheckedBoxScore {
  const check = verifyBoxScore(line, 0);
  assert(check.status === 'complete', 'the line is complete and consistent');
  return check;
}

describe('performanceIndex', () => {
  it('[STA-11] [STA-12] [CA-STA-01] gives the box score of the example a Game Score of 25.9 and an index shown as 0.751', () => {
    const boxScore = checked(SPEC_LINE);

    expect(gameScore(boxScore)).toBeCloseTo(25.9, 9);
    // Unrounded: 25.9 ÷ 34.5, which screens show as 0.751.
    expect(performanceIndex(boxScore)).toBeCloseTo(25.9 / 34.5, 9);
    expect(performanceIndex(boxScore)).toBeCloseTo(0.751, 3);
  });

  it('[STA-12] [CL-STA-06] divides by the whole minutes of a whole-minutes line', () => {
    const line: BoxScoreLine = {
      ...SPEC_LINE,
      minutesPrecision: 'whole_minutes',
      minutes: 35,
      seconds: null,
    };

    expect(performanceIndex(checked(line))).toBeCloseTo(0.74, 9);
  });

  it('[STA-12] keeps a negative index as it is', () => {
    // No point, 0 of 5 from the field and 2 turnovers in 10 minutes: a Game Score of -5.5.
    const line: BoxScoreLine = {
      ...SPEC_LINE,
      minutes: 10,
      seconds: 0,
      points: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 5,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 2,
      personalFouls: 0,
    };

    expect(performanceIndex(checked(line))).toBeCloseTo(-0.55, 9);
  });

  it('[STA-10] [STA-12] [STA-09] [CA-STA-04] takes only a box score that verifyBoxScore found complete and consistent', () => {
    const incomplete = verifyBoxScore({ ...SPEC_LINE, turnovers: null }, 0);
    type Unbranded = GameScoreInput &
      Readonly<{
        status: 'complete';
        hasRoundedMinutes: boolean;
        secondsOnCourt: number;
        decimalMinutes: number;
      }>;

    expectTypeOf(performanceIndex).parameter(0).toEqualTypeOf<CheckedBoxScore>();
    // @ts-expect-error -- a raw line, which no check has seen, has no index
    expectTypeOf(performanceIndex).toBeCallableWith(SPEC_LINE);
    // @ts-expect-error -- neither has a box score that the check found incomplete
    expectTypeOf(performanceIndex).toBeCallableWith(incomplete);
    expectTypeOf<Unbranded>().not.toExtend<CheckedBoxScore>();
    expect(incomplete.status).toBe('incomplete');
  });
});

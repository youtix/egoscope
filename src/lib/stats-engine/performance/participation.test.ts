import { describe, expect, it } from 'vitest';

import { participationOf } from './participation';

import type { BoxScoreLine } from './box-score';

// A whole-minutes line of no minutes and every count at zero.
const ZERO_LINE: BoxScoreLine = {
  minutesPrecision: 'whole_minutes',
  minutes: 0,
  seconds: null,
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  personalFouls: 0,
};

// A did-not-play line: the source gives no minutes and no count.
const BLANK_LINE: BoxScoreLine = {
  ...ZERO_LINE,
  minutes: null,
  points: null,
  fieldGoalsMade: null,
  fieldGoalsAttempted: null,
  threePointersMade: null,
  freeThrowsMade: null,
  freeThrowsAttempted: null,
  offensiveRebounds: null,
  defensiveRebounds: null,
  assists: null,
  steals: null,
  blocks: null,
  turnovers: null,
  personalFouls: null,
};

describe('participationOf', () => {
  it.each([
    ['26 minutes and nothing else', { ...ZERO_LINE, minutes: 26 }],
    [
      '30 seconds from a source in seconds',
      { ...ZERO_LINE, minutesPrecision: 'seconds', seconds: 30 },
    ],
    ['zero minutes and a rebound', { ...ZERO_LINE, defensiveRebounds: 1 }],
    ['no minutes and 2 points', { ...BLANK_LINE, points: 2 }],
  ] as const)('[STA-13] [CL-STA-04] says he played with %s', (_situation, line) => {
    expect(participationOf(line, true)).toBe('played');
  });

  it.each([
    ['no line', null],
    ['a did-not-play line', BLANK_LINE],
    ['zero minutes and nothing else', ZERO_LINE],
  ])(
    "[STA-13] [CL-STA-04] says he did not play with %s once his team's lines are published",
    (_situation, line) => {
      expect(participationOf(line, true)).toBe('not_played');
    },
  );

  it("[STA-13] [CL-STA-04] leaves the participation unknown while his team's lines are not published", () => {
    expect(participationOf(null, false)).toBe('unknown');
  });

  it('[STA-13] [CL-STA-04] says he played whenever his line shows it', () => {
    expect(participationOf({ ...ZERO_LINE, minutes: 12 }, false)).toBe('played');
  });
});

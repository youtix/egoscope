import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { verifyBoxScore } from './box-score';

import type { BoxScoreLine } from './box-score';
import type { GameScoreInput } from './game-score';

// The twelve totals of the Game Score; the type check refuses a list that misses one.
const TOTALS = [
  'points',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'freeThrowsMade',
  'freeThrowsAttempted',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'personalFouls',
] as const;

// The box score of CA-STA-01: 34 min 30 s, 31 points, 11 of 20 from the field and 7 of 8
// at the line, 1 offensive and 6 defensive rebounds, 7 assists, 2 steals, 1 block,
// 4 turnovers and 3 personal fouls. The criterion gives no three-pointers made.
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

// The same game as the chosen source gives it: whole minutes, rounded to the nearest one.
const WHOLE_LINE: BoxScoreLine = {
  ...SPEC_LINE,
  minutesPrecision: 'whole_minutes',
  minutes: 35,
  seconds: null,
};

// A source in seconds with no time on court and every count at zero.
const NOTHING: BoxScoreLine = {
  minutesPrecision: 'seconds',
  minutes: 0,
  seconds: 0,
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

type Value = 'minutes' | 'seconds' | 'threePointersMade' | keyof GameScoreInput;

// What a line can lack (STA-10): its time on court or a total of the Game Score.
type Element = 'minutes' | 'seconds' | keyof GameScoreInput;

/** `line` with one value changed. */
function withValue(line: BoxScoreLine, name: Value, value: number | null): BoxScoreLine {
  return { ...line, [name]: value };
}

/** The twelve totals of the Game Score that `line` gives. */
function totalsOf(line: BoxScoreLine): Partial<Record<keyof GameScoreInput, number | null>> {
  return Object.fromEntries(TOTALS.map((total) => [total, line[total]]));
}

/**
 * `line` without `elements`, each unknown, except whole minutes, which `absentMinutes`
 * may make zero: less than 30 seconds on court, as unknown a time (CL-STA-06).
 */
function without(
  line: BoxScoreLine,
  elements: readonly Element[],
  absentMinutes: 0 | null,
): BoxScoreLine {
  let lacking = line;
  for (const element of elements) {
    lacking = withValue(lacking, element, null);
  }
  return lacking.minutesPrecision === 'whole_minutes' && elements.includes('minutes')
    ? { ...lacking, minutes: absentMinutes }
    : lacking;
}

// A time on court above zero and within regulation, so within any game's length, in whole
// seconds and in decimal minutes.
const anyTimeOnCourt = fc.oneof(
  fc.integer({ min: 1, max: 48 }).map((minutes) => ({
    time: { minutesPrecision: 'whole_minutes' as const, minutes, seconds: null },
    secondsOnCourt: minutes * 60,
    decimalMinutes: minutes,
  })),
  fc.integer({ min: 1, max: 48 * 60 }).map((seconds) => ({
    time: {
      minutesPrecision: 'seconds' as const,
      minutes: Math.floor(seconds / 60),
      seconds: seconds % 60,
    },
    secondsOnCourt: seconds,
    decimalMinutes: seconds / 60,
  })),
);

// Counts that pass every check of STA-09 by construction: none below zero, made within
// attempted, threes within made, and 2 points per made field goal plus 1 per three and
// per made free throw. The three-pointers made may be unknown, which skips the points check.
const anyConsistentCounts = fc
  .record({
    threePointersMade: fc.nat(8),
    twoPointersMade: fc.nat(15),
    fieldGoalsMissed: fc.nat(15),
    freeThrowsMade: fc.nat(12),
    freeThrowsMissed: fc.nat(6),
    offensiveRebounds: fc.nat(8),
    defensiveRebounds: fc.nat(15),
    assists: fc.nat(15),
    steals: fc.nat(6),
    blocks: fc.nat(6),
    turnovers: fc.nat(8),
    personalFouls: fc.nat(6),
    areThreesKnown: fc.boolean(),
  })
  .map(({ twoPointersMade, fieldGoalsMissed, freeThrowsMissed, areThreesKnown, ...counts }) => {
    const fieldGoalsMade = counts.threePointersMade + twoPointersMade;
    return {
      ...counts,
      points: 2 * fieldGoalsMade + counts.threePointersMade + counts.freeThrowsMade,
      fieldGoalsMade,
      fieldGoalsAttempted: fieldGoalsMade + fieldGoalsMissed,
      threePointersMade: areThreesKnown ? counts.threePointersMade : null,
      freeThrowsAttempted: counts.freeThrowsMade + freeThrowsMissed,
    };
  });

type ConsistentLine = Readonly<{
  line: BoxScoreLine;
  secondsOnCourt: number;
  decimalMinutes: number;
}>;

// A line that every check accepts and that lacks nothing, with its time on court.
const anyConsistentLine: fc.Arbitrary<ConsistentLine> = fc
  .tuple(anyTimeOnCourt, anyConsistentCounts)
  .map(([{ time, ...timeOnCourt }, counts]) => ({ line: { ...time, ...counts }, ...timeOnCourt }));

// Such a line and the elements it lacks, in the order of `missing`: a single one in two
// draws out of three, any of them otherwise. A whole-minutes line has no seconds to lack.
const anyLackingLine = anyConsistentLine.chain(({ line }) => {
  const elements: Element[] =
    line.minutesPrecision === 'seconds'
      ? ['minutes', 'seconds', ...TOTALS]
      : ['minutes', ...TOTALS];
  return fc.record({
    line: fc.constant(line),
    lacking: fc.oneof(
      { arbitrary: fc.constantFrom(...elements).map((element) => [element]), weight: 2 },
      { arbitrary: fc.subarray(elements, { minLength: 1 }), weight: 1 },
    ),
    absentMinutes: fc.constantFrom(0, null),
  });
});
const anyOvertimes = fc.option(fc.nat(4), { nil: null });

describe('verifyBoxScore', () => {
  it('[STA-09] [STA-10] [STA-12] [CL-STA-06] finds the box score of CA-STA-01 complete, 34 min 30 s making 2,070 seconds and 34.5 decimal minutes', () => {
    expect(verifyBoxScore(SPEC_LINE, 0)).toMatchObject({
      status: 'complete',
      hasRoundedMinutes: false,
      secondsOnCourt: 2070,
      decimalMinutes: 34.5,
      points: 31,
      fieldGoalsMade: 11,
      fieldGoalsAttempted: 20,
      freeThrowsMade: 7,
      freeThrowsAttempted: 8,
      offensiveRebounds: 1,
      defensiveRebounds: 6,
      assists: 7,
      steals: 2,
      blocks: 1,
      turnovers: 4,
      personalFouls: 3,
    });
  });

  it.each([
    ['complete', WHOLE_LINE],
    ['incomplete', withValue(WHOLE_LINE, 'turnovers', null)],
    ['suspect', withValue(WHOLE_LINE, 'steals', -1)],
  ])(
    '[STA-12] [CL-STA-06] gives a %s whole-minutes line the rounded-minutes mention and its whole minutes',
    (status, line) => {
      expect(verifyBoxScore(line, 0)).toMatchObject({
        status,
        hasRoundedMinutes: true,
        secondsOnCourt: 2100,
        decimalMinutes: 35,
      });
    },
  );

  it('[STA-10] [CA-STA-04] marks a box score without turnovers incomplete, with nothing in their place', () => {
    expect(verifyBoxScore(withValue(SPEC_LINE, 'turnovers', null), 0)).toStrictEqual({
      status: 'incomplete',
      hasRoundedMinutes: false,
      secondsOnCourt: 2070,
      decimalMinutes: 34.5,
      missing: ['turnovers'],
    });
  });

  it.each(TOTALS)('[STA-10] marks a box score without its %s incomplete, naming it', (total) => {
    expectTypeOf<(typeof TOTALS)[number]>().toEqualTypeOf<keyof GameScoreInput>();

    expect(verifyBoxScore(withValue(SPEC_LINE, total, null), 0)).toStrictEqual({
      status: 'incomplete',
      hasRoundedMinutes: false,
      secondsOnCourt: 2070,
      decimalMinutes: 34.5,
      missing: [total],
    });
  });

  it('[STA-10] lists every missing element, the time on court first', () => {
    const line: BoxScoreLine = { ...WHOLE_LINE, minutes: null, points: null, personalFouls: null };

    expect(verifyBoxScore(line, 0)).toStrictEqual({
      status: 'incomplete',
      hasRoundedMinutes: true,
      secondsOnCourt: null,
      decimalMinutes: null,
      missing: ['minutes', 'points', 'personalFouls'],
    });
  });

  it.each([
    [null, 30, ['minutes']],
    [34, null, ['seconds']],
    [48, null, ['seconds']],
    [null, null, ['minutes', 'seconds']],
  ])(
    '[STA-10] [STA-09] [CL-STA-03] marks incomplete a line of a source in seconds at %s min %s s, within 48 minutes',
    (minutes, seconds, missing) => {
      expect(verifyBoxScore({ ...SPEC_LINE, minutes, seconds }, 0)).toStrictEqual({
        status: 'incomplete',
        hasRoundedMinutes: false,
        secondsOnCourt: null,
        decimalMinutes: null,
        missing,
      });
    },
  );

  it('[STA-10] [CL-STA-06] marks incomplete, not suspect, a whole-minutes line of zero minutes with a statistic', () => {
    const line: BoxScoreLine = {
      ...NOTHING,
      minutesPrecision: 'whole_minutes',
      seconds: null,
      defensiveRebounds: 1,
    };

    expect(verifyBoxScore(line, 0)).toStrictEqual({
      status: 'incomplete',
      hasRoundedMinutes: true,
      secondsOnCourt: null,
      decimalMinutes: null,
      missing: ['minutes'],
    });
  });

  it('[STA-09] marks suspect a statistic without minutes from a source in seconds', () => {
    expect(verifyBoxScore(withValue(NOTHING, 'defensiveRebounds', 1), 0)).toStrictEqual({
      status: 'suspect',
      hasRoundedMinutes: false,
      secondsOnCourt: null,
      decimalMinutes: null,
      failedChecks: ['statistic_without_minutes'],
    });
  });

  it.each([
    ['every count at zero', NOTHING, ['minutes']],
    ['an unknown count', withValue(NOTHING, 'turnovers', null), ['minutes', 'turnovers']],
  ])(
    '[STA-10] [STA-12] never finds complete a line without time on court and with %s',
    (_situation, line, missing) => {
      expect(verifyBoxScore(line, 0)).toStrictEqual({
        status: 'incomplete',
        hasRoundedMinutes: false,
        secondsOnCourt: null,
        decimalMinutes: null,
        missing,
      });
    },
  );

  it('[STA-09] [CA-STA-05] marks suspect 30 points for 10 made field goals, 2 of them threes, and 4 made free throws', () => {
    const line: BoxScoreLine = {
      ...SPEC_LINE,
      points: 30,
      fieldGoalsMade: 10,
      threePointersMade: 2,
      freeThrowsMade: 4,
    };

    expect(verifyBoxScore(line, 0)).toStrictEqual({
      status: 'suspect',
      hasRoundedMinutes: false,
      secondsOnCourt: 2070,
      decimalMinutes: 34.5,
      failedChecks: ['points_mismatch'],
    });
  });

  it('[STA-09] accepts 2 points per made field goal plus 1 per three and per free throw, and makes equal to attempts', () => {
    // 31 = 2 × 11 + 2 + 7, and 7 of 7 at the line.
    const line: BoxScoreLine = { ...SPEC_LINE, threePointersMade: 2, freeThrowsAttempted: 7 };

    expect(verifyBoxScore(line, 0)).toMatchObject({ status: 'complete', freeThrowsAttempted: 7 });
  });

  it.each([
    ['points', 'incomplete'],
    ['fieldGoalsMade', 'incomplete'],
    ['threePointersMade', 'complete'],
    ['freeThrowsMade', 'incomplete'],
  ] as const)('[STA-09] skips the points check while %s is unknown', (unknown, status) => {
    const line: BoxScoreLine = {
      ...SPEC_LINE,
      points: 30,
      fieldGoalsMade: 10,
      threePointersMade: 2,
      freeThrowsMade: 4,
    };

    expect(verifyBoxScore(withValue(line, unknown, null), 0).status).toBe(status);
  });

  it.each([
    ['minutes', ['negative_value']],
    ['seconds', ['negative_value']],
    ['threePointersMade', ['negative_value', 'points_mismatch']],
    ['fieldGoalsAttempted', ['negative_value', 'made_above_attempted']],
    ['freeThrowsAttempted', ['negative_value', 'made_above_attempted']],
    ...TOTALS.filter((total) => !total.endsWith('Attempted')).map(
      (total) => [total, ['negative_value']] as const,
    ),
  ] as const)('[STA-09] marks suspect a negative %s', (name, failedChecks) => {
    expect(verifyBoxScore(withValue(SPEC_LINE, name, -1), 0)).toMatchObject({
      status: 'suspect',
      failedChecks,
    });
  });

  it.each([
    ['field goals', withValue(SPEC_LINE, 'fieldGoalsMade', 21)],
    ['free throws', withValue(SPEC_LINE, 'freeThrowsMade', 9)],
  ])('[STA-09] marks suspect more %s made than attempted', (_shots, line) => {
    expect(verifyBoxScore(line, 0)).toMatchObject({
      status: 'suspect',
      failedChecks: ['made_above_attempted'],
    });
  });

  it('[STA-09] compares made and attempted only when both are known', () => {
    const unknownMade: BoxScoreLine = {
      ...SPEC_LINE,
      fieldGoalsMade: null,
      fieldGoalsAttempted: -1,
    };

    expect(verifyBoxScore(unknownMade, 0)).toMatchObject({ failedChecks: ['negative_value'] });
    expect(verifyBoxScore(withValue(SPEC_LINE, 'freeThrowsAttempted', null), 0)).toMatchObject({
      status: 'incomplete',
      missing: ['freeThrowsAttempted'],
    });
  });

  it.each([
    ['48 whole minutes', 0, withValue(WHOLE_LINE, 'minutes', 48)],
    ['58 whole minutes', 2, withValue(WHOLE_LINE, 'minutes', 58)],
  ])(
    '[STA-09] [CL-STA-03] accepts %s with %s overtimes, within 48 minutes plus 5 per overtime',
    (_time, overtimes, line) => {
      expect(verifyBoxScore(line, overtimes).status).toBe('complete');
    },
  );

  it.each([
    ['49 whole minutes', 0, withValue(WHOLE_LINE, 'minutes', 49)],
    ['59 whole minutes', 2, withValue(WHOLE_LINE, 'minutes', 59)],
    ['48 min 1 s', 0, { ...SPEC_LINE, minutes: 48, seconds: 1 }],
    ['49 minutes and unknown seconds', 0, { ...SPEC_LINE, minutes: 49, seconds: null }],
  ])(
    '[STA-09] [CL-STA-03] marks suspect %s with %s overtimes, above 48 minutes plus 5 per overtime',
    (_time, overtimes, line) => {
      expect(verifyBoxScore(line, overtimes)).toMatchObject({
        status: 'suspect',
        failedChecks: ['minutes_above_game_length'],
      });
    },
  );

  it('[STA-09] [CL-STA-03] skips the bound on the minutes when the number of overtimes is unknown', () => {
    expect(verifyBoxScore(withValue(WHOLE_LINE, 'minutes', 60), null)).toMatchObject({
      status: 'complete',
      secondsOnCourt: 3600,
      decimalMinutes: 60,
    });
    expect(verifyBoxScore({ ...SPEC_LINE, minutes: 60, seconds: null }, null)).toMatchObject({
      status: 'incomplete',
      missing: ['seconds'],
    });
  });

  it('[STA-09] lists every check a line fails, in the order of the stored checks', () => {
    const line: BoxScoreLine = {
      ...WHOLE_LINE,
      minutes: 60,
      steals: -1,
      fieldGoalsMade: 21,
      threePointersMade: 0,
    };

    expect(verifyBoxScore(line, 0)).toMatchObject({
      failedChecks: [
        'negative_value',
        'made_above_attempted',
        'points_mismatch',
        'minutes_above_game_length',
      ],
    });
  });

  it('[STA-09] [STA-10] marks suspect, not incomplete, a line that fails a check and lacks a total', () => {
    const line: BoxScoreLine = { ...SPEC_LINE, steals: -1, turnovers: null };

    expect(verifyBoxScore(line, 0)).toStrictEqual({
      status: 'suspect',
      hasRoundedMinutes: false,
      secondsOnCourt: 2070,
      decimalMinutes: 34.5,
      failedChecks: ['negative_value'],
    });
  });

  it('[STA-09] [STA-10] [STA-12] finds complete a consistent line that lacks nothing, and keeps the values it is given', () => {
    fc.assert(
      fc.property(anyConsistentLine, anyOvertimes, ({ line, ...timeOnCourt }, overtimes) => {
        // The decimal minutes are the whole seconds divided by 60 once, to the bit.
        expect(verifyBoxScore(line, overtimes)).toMatchObject({
          status: 'complete',
          hasRoundedMinutes: line.minutesPrecision === 'whole_minutes',
          ...timeOnCourt,
          ...totalsOf(line),
        });
      }),
    );
  });

  it('[STA-10] [CL-STA-06] never finds complete a line that lacks an element, and lists every element it lacks', () => {
    fc.assert(
      fc.property(anyLackingLine, anyOvertimes, ({ line, lacking, absentMinutes }, overtimes) => {
        const check = verifyBoxScore(without(line, lacking, absentMinutes), overtimes);

        expect(check).toMatchObject({ status: 'incomplete', missing: lacking });
      }),
    );
  });
});

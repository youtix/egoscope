import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { decisionStanding, isPostTipOff } from './decisions';

import type { DecisionStandingInput, PostTipOffDecisionEffect, TipOffGames } from './decisions';

// Instants in milliseconds: an expected game at 1,000 and, once established, a measured game
// at 5,000, the tip-off that counts then.
const EXPECTED_START = 1000;
const MEASURED_START = 5000;
const GAMES: TipOffGames = {
  measuredGameStartAt: MEASURED_START,
  expectedGameStartAt: EXPECTED_START,
};

function standingOf(input: Partial<DecisionStandingInput>): ReturnType<typeof decisionStanding> {
  return decisionStanding({ ...GAMES, decisions: [], allEventsDismissedAt: null, ...input });
}

const effect = fc.constantFrom<PostTipOffDecisionEffect>('exit', 'entry', 'measured_game_change');

describe('isPostTipOff', () => {
  it('[SUI-17] [CL-DET-15] places an instant against the measured game once established, at its start included', () => {
    expect(isPostTipOff(MEASURED_START, GAMES)).toBe(true);
    expect(isPostTipOff(MEASURED_START - 1, GAMES)).toBe(false);
    // The expected game's start no longer counts once the measured game is established.
    expect(isPostTipOff(EXPECTED_START, GAMES)).toBe(false);
  });

  it('[SUI-17] [CL-DET-15] places an instant against the expected game while no measured game is established', () => {
    const games: TipOffGames = { measuredGameStartAt: null, expectedGameStartAt: EXPECTED_START };
    expect(isPostTipOff(EXPECTED_START, games)).toBe(true);
    expect(isPostTipOff(EXPECTED_START - 1, games)).toBe(false);
  });

  it('[SUI-16] [CL-DET-15] places every instant before tip-off while no game is known', () => {
    const games: TipOffGames = { measuredGameStartAt: null, expectedGameStartAt: null };
    fc.assert(
      fc.property(fc.integer(), (instant) => {
        expect(isPostTipOff(instant, games)).toBe(false);
      }),
    );
  });
});

describe('decisionStanding', () => {
  it('[SUI-16] [CL-DET-09] removes a case whose last undismissed event was dismissed before tip-off', () => {
    expect(standingOf({ allEventsDismissedAt: MEASURED_START - 1 })).toBe('removed');
  });

  it('[SUI-16] [CL-DET-15] judges the dismissal that left no event against the measured game, else the expected one', () => {
    // Dismissed after the expected game's start, but before the later measured game's: a
    // dismissal before tip-off once the measured game is established.
    expect(standingOf({ allEventsDismissedAt: EXPECTED_START + 1 })).toBe('removed');
    expect(
      standingOf({ measuredGameStartAt: null, allEventsDismissedAt: EXPECTED_START + 1 }),
    ).toBe('exit');
    expect(
      standingOf({
        measuredGameStartAt: null,
        expectedGameStartAt: null,
        allEventsDismissedAt: EXPECTED_START + 1,
      }),
    ).toBe('removed');
  });

  it('[SUI-16] [CL-DET-09] shows a case whose last undismissed event was dismissed at or after tip-off as an exit, whatever its decisions', () => {
    expect(standingOf({ allEventsDismissedAt: MEASURED_START })).toBe('exit');
    expect(
      standingOf({
        allEventsDismissedAt: MEASURED_START + 1,
        decisions: [{ effect: 'entry', decidedAt: MEASURED_START + 2 }],
      }),
    ).toBe('exit');
  });

  it('[SUI-16] [CL-DET-09] removes a case all of whose events were dismissed before tip-off, even after a later decision', () => {
    expect(
      standingOf({
        allEventsDismissedAt: MEASURED_START - 1,
        decisions: [{ effect: 'entry', decidedAt: MEASURED_START + 1 }],
      }),
    ).toBe('removed');
  });

  it('[SUI-17] leaves a case without a decision, or with decisions before tip-off only, untouched', () => {
    expect(standingOf({})).toBe('untouched');
    expect(
      standingOf({
        decisions: [
          { effect: 'exit', decidedAt: EXPECTED_START },
          { effect: 'entry', decidedAt: MEASURED_START - 1 },
        ],
      }),
    ).toBe('untouched');
  });

  it.each(['exit', 'entry', 'measured_game_change'] as const)(
    '[SUI-17] [CL-SUI-10] stands a case by the effect %s of a decision at tip-off',
    (decisionEffect) => {
      expect(
        standingOf({ decisions: [{ effect: decisionEffect, decidedAt: MEASURED_START }] }),
      ).toBe(decisionEffect);
    },
  );

  it('[SUI-17] [CL-SUI-10] [CA-SUI-14] stands a case dismissed before tip-off and reinstated after it as an entry', () => {
    expect(
      standingOf({
        decisions: [
          { effect: 'exit', decidedAt: MEASURED_START - 1 },
          { effect: 'entry', decidedAt: MEASURED_START + 1 },
        ],
      }),
    ).toBe('entry');
  });

  it('[SUI-17] [CL-SUI-10] stands a case touched several times by its latest decision, in any order', () => {
    const decisions = [
      { effect: 'entry', decidedAt: MEASURED_START + 3 },
      { effect: 'measured_game_change', decidedAt: MEASURED_START + 9 },
      { effect: 'exit', decidedAt: MEASURED_START + 5 },
    ] as const;
    expect(standingOf({ decisions })).toBe('measured_game_change');
    expect(standingOf({ decisions: decisions.toReversed() })).toBe('measured_game_change');
  });

  it('[SUI-17] [CL-SUI-10] counts an exit, then an entry, as the later of two decisions at one instant', () => {
    const at = MEASURED_START + 1;
    expect(
      standingOf({
        decisions: [
          { effect: 'entry', decidedAt: at },
          { effect: 'exit', decidedAt: at },
        ],
      }),
    ).toBe('exit');
    expect(
      standingOf({
        decisions: [
          { effect: 'measured_game_change', decidedAt: at },
          { effect: 'entry', decidedAt: at },
        ],
      }),
    ).toBe('entry');
  });

  it('[SUI-17] [CL-DET-15] reclassifies a decision when a later measured game is established', () => {
    const decisions = [{ effect: 'exit', decidedAt: EXPECTED_START + 1 }] as const;
    expect(standingOf({ measuredGameStartAt: null, decisions })).toBe('exit');
    expect(standingOf({ decisions })).toBe('untouched');
  });

  it('[SUI-17] [CL-SUI-10] stands any set of decisions by the latest one when it is after tip-off, untouched otherwise', () => {
    const decision = fc.record({ effect, decidedAt: fc.integer({ min: 0, max: 10_000 }) });
    fc.assert(
      fc.property(fc.array(decision, { size: 'medium' }), (decisions) => {
        const latestAt = Math.max(...decisions.map(({ decidedAt }) => decidedAt));
        const latest = new Set(
          decisions.filter(({ decidedAt }) => decidedAt === latestAt).map((item) => item.effect),
        );
        const expected =
          latestAt >= MEASURED_START
            ? (['exit', 'entry', 'measured_game_change'] as const).find((item) => latest.has(item))
            : 'untouched';
        expect(standingOf({ decisions })).toBe(expected ?? 'untouched');
      }),
    );
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { applyManualDecisions, effectiveDecision } from './manual-decisions';

import type { DecidableCase, DecidedCase, ManualDecision } from './manual-decisions';

const HOUR = 3_600_000;
// The instant of the first decision of the examples, 10 January 2024 at noon UTC.
const FIRST_DECISION_AT = Date.UTC(2024, 0, 10, 12);

// The game a case was first measured on, and the one that a corrected date moved it to
// (CL-SEN-12).
const FIRST_GAME = 501;
const NEW_GAME = 502;

/** The decision `id` of `kind`, made `hours` after the first one, on the first game. */
const decision = (id: number, kind: ManualDecision['kind'], hours: number): ManualDecision => ({
  id,
  kind,
  decidedAt: FIRST_DECISION_AT + hours * HOUR,
  measuredGameId: FIRST_GAME,
});

/** `made` as made on the new game. */
const onNewGame = (made: ManualDecision): ManualDecision => ({ ...made, measuredGameId: NEW_GAME });

/** The case on `measuredGameId` with the status its automatic rules give it. */
const onGame = (
  status: DecidableCase['status'],
  measuredGameId: number | null = FIRST_GAME,
): DecidableCase => ({ status, measuredGameId });

describe('applyManualDecisions', () => {
  it('[SEN-17] [CL-SEN-12] makes a measured case excluded by an exclusion made on its measured game', () => {
    const exclusion = decision(1, 'exclude', 0);
    expect(applyManualDecisions(onGame('measured'), [exclusion])).toStrictEqual({
      status: 'excluded',
      decision: exclusion,
    });
  });

  it('[SEN-17] [CL-SEN-12] makes a case that its criteria exclude measured by a reinstatement made on its measured game', () => {
    const reinstatement = decision(1, 'reinstate', 0);
    expect(applyManualDecisions(onGame('excluded'), [reinstatement])).toStrictEqual({
      status: 'measured',
      decision: reinstatement,
    });
  });

  it.each([
    { kind: 'exclude', automatic: 'measured', expected: 'excluded' },
    { kind: 'exclude', automatic: 'excluded', expected: 'excluded' },
    { kind: 'reinstate', automatic: 'measured', expected: 'measured' },
    { kind: 'reinstate', automatic: 'excluded', expected: 'measured' },
  ] as const)(
    '[SEN-17] keeps a decision to $kind ruling whatever its criteria say after a recalculation: $automatic gives $expected',
    ({ kind, automatic, expected }) => {
      const ruling = decision(1, kind, 0);
      expect(applyManualDecisions(onGame(automatic), [ruling])).toStrictEqual({
        status: expected,
        decision: ruling,
      });
    },
  );

  it('[SEN-17] [CL-SEN-12] applies the latest decision made on the measured game, whatever their order', () => {
    const decisions = [
      decision(1, 'exclude', 0),
      decision(2, 'reinstate', 5),
      decision(3, 'exclude', 9),
    ];
    const [, reinstatement, lastExclusion] = decisions;
    expect(applyManualDecisions(onGame('measured'), decisions.toReversed())).toStrictEqual({
      status: 'excluded',
      decision: lastExclusion,
    });
    expect(applyManualDecisions(onGame('measured'), decisions.slice(0, 2))).toStrictEqual({
      status: 'measured',
      decision: reinstatement,
    });
  });

  it('[CL-SEN-12] lets a decision made on another game rule nothing: the status of the criteria stands', () => {
    const decisions = [decision(1, 'exclude', 0)];
    expect(applyManualDecisions(onGame('measured', NEW_GAME), decisions)).toStrictEqual({
      status: 'measured',
      decision: null,
    });
    expect(
      applyManualDecisions(onGame('excluded', NEW_GAME), [decision(2, 'reinstate', 1)]),
    ).toStrictEqual({ status: 'excluded', decision: null });
  });

  it('[CL-SEN-12] applies a decision again once the case comes back to the game it was made on', () => {
    const exclusion = decision(1, 'exclude', 0);
    expect(applyManualDecisions(onGame('measured', NEW_GAME), [exclusion])).toStrictEqual({
      status: 'measured',
      decision: null,
    });
    expect(applyManualDecisions(onGame('measured', FIRST_GAME), [exclusion])).toStrictEqual({
      status: 'excluded',
      decision: exclusion,
    });
  });

  it('[CL-SEN-12] applies the latest decision made on the measured game, whatever was decided on another game since', () => {
    const exclusion = decision(1, 'exclude', 0);
    const reinstatement = onNewGame(decision(2, 'reinstate', 5));
    const decisions = [exclusion, reinstatement];
    expect(applyManualDecisions(onGame('measured', FIRST_GAME), decisions)).toStrictEqual({
      status: 'excluded',
      decision: exclusion,
    });
    expect(applyManualDecisions(onGame('excluded', NEW_GAME), decisions)).toStrictEqual({
      status: 'measured',
      decision: reinstatement,
    });
  });

  it.each(['awaiting_game', 'not_measurable'] as const)(
    '[SEN-17] rules no case whose gap is not computed, %s, even on the game it was made on',
    (status) => {
      expect(applyManualDecisions(onGame(status), [decision(1, 'exclude', 0)])).toStrictEqual({
        status,
        decision: null,
      });
    },
  );

  it('[SEN-17] keeps the status of the criteria when the owner has decided nothing', () => {
    expect(applyManualDecisions(onGame('excluded'), [])).toStrictEqual({
      status: 'excluded',
      decision: null,
    });
  });
});

describe('effectiveDecision', () => {
  it('[CL-SEN-12] is null for a case whose walk reached no game, or on a game where nothing was decided', () => {
    const decisions = [decision(1, 'exclude', 0)];
    expect(effectiveDecision(decisions, null)).toBeNull();
    expect(effectiveDecision(decisions, NEW_GAME)).toBeNull();
  });

  it('[SEN-17] [CL-SEN-12] takes of two decisions of one instant the one of the greater id', () => {
    const decisions = [decision(4, 'reinstate', 3), decision(7, 'exclude', 3)];
    const [, later] = decisions;
    expect(effectiveDecision(decisions, FIRST_GAME)).toBe(later);
    expect(effectiveDecision(decisions.toReversed(), FIRST_GAME)).toBe(later);
  });

  it('[SEN-17] [CL-SEN-12] orders the decisions by their instant first, whatever their ids', () => {
    const decisions = [decision(9, 'exclude', 0), decision(3, 'reinstate', 1)];
    const [, later] = decisions;
    expect(effectiveDecision(decisions, FIRST_GAME)).toBe(later);
    expect(effectiveDecision(decisions.toReversed(), FIRST_GAME)).toBe(later);
  });
});

const KINDS: readonly ManualDecision['kind'][] = ['exclude', 'reinstate'];

// From 1 to 8 decisions with distinct ids on two games, some of them at one instant, with
// a shuffled copy and the status that the criteria give the case.
const anyDecision = fc.record({
  id: fc.nat({ max: 50 }),
  kind: fc.constantFrom(...KINDS),
  hours: fc.nat({ max: 3 }),
  isOnFirstGame: fc.boolean(),
});
const anyDecisions = fc
  .uniqueArray(anyDecision, { minLength: 1, maxLength: 8, selector: ({ id }) => id })
  .chain((drawn) => {
    const decisions = drawn.map(({ id, kind, hours, isOnFirstGame }) =>
      isOnFirstGame ? decision(id, kind, hours) : onNewGame(decision(id, kind, hours)),
    );
    return fc.record({
      decisions: fc.constant(decisions),
      shuffled: fc.shuffledSubarray(decisions, {
        minLength: decisions.length,
        maxLength: decisions.length,
      }),
      automatic: fc.constantFrom('measured' as const, 'excluded' as const),
    });
  });

/** Whether `other` comes after `made`: a later instant, or the same one and a greater id. */
const isLater = (other: ManualDecision, made: ManualDecision): boolean =>
  other.decidedAt > made.decidedAt || (other.decidedAt === made.decidedAt && other.id > made.id);

/** The decision made on the first game that no other decision made on it follows. */
const lastOnFirstGame = (decisions: readonly ManualDecision[]): ManualDecision | null =>
  decisions.find(
    (made) =>
      made.measuredGameId === FIRST_GAME &&
      decisions.every((other) => other.measuredGameId !== FIRST_GAME || !isLater(other, made)),
  ) ?? null;

/** What a case on the first game becomes, from the definitions of SEN-17 and CL-SEN-12. */
function expectedOf(
  automatic: 'excluded' | 'measured',
  decisions: readonly ManualDecision[],
): DecidedCase<ManualDecision> {
  const ruling = lastOnFirstGame(decisions);
  const decided = ruling?.kind === 'exclude' ? 'excluded' : 'measured';
  return { status: ruling === null ? automatic : decided, decision: ruling };
}

describe('applyManualDecisions, whatever the decisions', () => {
  it('[SEN-17] [CL-SEN-12] applies the same decision whatever their order', () => {
    fc.assert(
      fc.property(anyDecisions, ({ decisions, shuffled, automatic }) => {
        expect(applyManualDecisions(onGame(automatic), shuffled)).toStrictEqual(
          applyManualDecisions(onGame(automatic), decisions),
        );
      }),
    );
  });

  it('[SEN-17] [CL-SEN-12] rules with the decision made on the measured game that no decision made on it follows', () => {
    fc.assert(
      fc.property(anyDecisions, ({ decisions, automatic }) => {
        expect(applyManualDecisions(onGame(automatic), decisions)).toStrictEqual(
          expectedOf(automatic, decisions),
        );
      }),
    );
  });
});

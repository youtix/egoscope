import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { tallyProfile } from './tally';

import type { ProfileCase, TallyExitReason } from './tally';

type Outcome<S extends ProfileCase['status']> = Extract<ProfileCase, { status: S }>;
type ProfileCaseEvent = ProfileCase['events'][number];

// The glossary's values (CaseStatusReason, DoubtfulCaseCriterion, TallyExitReason).
const AWAITING_GAME_REASONS = [
  'game_not_played_yet',
  'statistics_pending',
  'mapping_not_established',
  'baseline_building',
  'precedence_to_verify',
  'dating_to_verify',
] as const;
const NOT_MEASURABLE_REASONS = [
  'no_game_within_window',
  'box_score_incomplete',
  'box_score_suspect',
  'box_score_unavailable',
  'insufficient_baseline',
  'season_not_covered',
  'precedence_not_established',
  'derived_game_missed',
] as const;
const CRITERIA = [
  'playing_time_too_low',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'co_occurring',
  'manual',
] as const;
const EXIT_REASONS = [
  'dismissed',
  'merged',
  'deleted',
  'replaced_at_import',
  'erased',
  'no_longer_derived',
] as const;

const DAY_MS = 86_400_000;
const HISTORICAL: ProfileCaseEvent = { researchConfidence: 'high' };
const LOW_CONFIDENCE: ProfileCaseEvent = { researchConfidence: 'low' };
const NO_CONFIDENCE: ProfileCaseEvent = { researchConfidence: null };

/** A valid case with one historical event, its game on day `caseId`. */
function measured(caseId: number, normalizedGap: number): Outcome<'measured'> {
  return {
    caseId,
    events: [HISTORICAL],
    isCoOccurring: false,
    status: 'measured',
    measuredGameScheduledStartAt: caseId * DAY_MS,
    normalizedGap,
    gapStatus: 'final',
  };
}

function excluded(
  caseId: number,
  triggeredCriteria: Outcome<'excluded'>['triggeredCriteria'],
  normalizedGap = 0,
): Outcome<'excluded'> {
  return { ...measured(caseId, normalizedGap), status: 'excluded', triggeredCriteria };
}

function awaiting(
  caseId: number,
  statusReason: Outcome<'awaiting_game'>['statusReason'],
): Outcome<'awaiting_game'> {
  return {
    caseId,
    events: [HISTORICAL],
    isCoOccurring: false,
    status: 'awaiting_game',
    statusReason,
  };
}

function notMeasurable(
  caseId: number,
  statusReason: Outcome<'not_measurable'>['statusReason'],
): Outcome<'not_measurable'> {
  return {
    caseId,
    events: [HISTORICAL],
    isCoOccurring: false,
    status: 'not_measurable',
    statusReason,
  };
}

/** Counts as the tally gives them, from [value, count] pairs, since values are snake_case. */
function counts(...entries: readonly (readonly [string, number])[]): Record<string, number> {
  return Object.fromEntries(entries);
}

const anyEvent: fc.Arbitrary<ProfileCaseEvent> = fc.record({
  researchConfidence: fc.constantFrom('high', 'medium', 'low', null),
});
const anyGap = fc.record({
  measuredGameScheduledStartAt: fc.nat(),
  normalizedGap: fc.double({ min: -5, max: 5, noNaN: true }),
  gapStatus: fc.constantFrom('provisional', 'final'),
});
const anyCriteria = fc
  .tuple(fc.constantFrom(...CRITERIA), fc.array(fc.constantFrom(...CRITERIA), { maxLength: 3 }))
  .map(([first, rest]): Outcome<'excluded'>['triggeredCriteria'] => [first, ...rest]);
const anyOutcome = fc.oneof(
  fc.record({
    status: fc.constant('awaiting_game'),
    statusReason: fc.constantFrom(...AWAITING_GAME_REASONS),
  }),
  fc.record({
    status: fc.constant('not_measurable'),
    statusReason: fc.constantFrom(...NOT_MEASURABLE_REASONS),
  }),
  anyGap.map((gap) => ({ ...gap, status: 'measured' as const })),
  fc.tuple(anyGap, anyCriteria).map(([gap, triggeredCriteria]) => ({
    ...gap,
    status: 'excluded' as const,
    triggeredCriteria,
  })),
);
const anyProfileCase = fc
  .tuple(fc.nat(), anyEvent, fc.array(anyEvent, { maxLength: 3 }), fc.boolean(), anyOutcome)
  .map(([caseId, first, rest, isCoOccurring, outcome]): ProfileCase => ({
    caseId,
    events: [first, ...rest],
    isCoOccurring,
    ...outcome,
  }));
const anyCases = fc.array(anyProfileCase, { maxLength: 12 });
const anyExits = fc.array(fc.constantFrom(...EXIT_REASONS), { maxLength: 8 });

const sumOf = (values: Readonly<Record<string, number>>): number =>
  Object.values(values).reduce((total, count) => total + count, 0);

describe('tallyProfile', () => {
  it('[SEN-20] [SEN-32] tallies step 1 of the 08 worked example: 12 events, 11 cases, one event grouped', () => {
    // E1 to E12: C4 excluded for playing time, C6 not measurable with no game within
    // the window, C9 excluded for unusual stakes, and E10 and E11 one case, C10.
    const cases: ProfileCase[] = [
      measured(1, 1.16),
      measured(2, -0.43),
      measured(3, 0.95),
      excluded(4, ['playing_time_too_low'], -1.9),
      measured(5, 0.55),
      notMeasurable(6, 'no_game_within_window'),
      measured(7, 1.81),
      measured(8, -0.2),
      excluded(9, ['unusual_stakes'], 0.63),
      { ...measured(10, 1.13), events: [HISTORICAL, HISTORICAL] },
      measured(11, 1.43),
    ];

    expect(tallyProfile(cases, [])).toStrictEqual({
      eventCount: 12,
      caseCount: 11,
      groupedEventCount: 1,
      awaitingCount: 0,
      validCount: 8,
      excludedCount: 2,
      manuallyExcludedCount: 0,
      notMeasurableCount: 1,
      coOccurringCount: 0,
      provisionalGapCount: 0,
      lowResearchConfidenceCount: 0,
      tallyReasons: {
        awaitingGame: {},
        notMeasurable: counts(['no_game_within_window', 1]),
        excluded: counts(['playing_time_too_low', 1], ['unusual_stakes', 1]),
      },
      exitCounts: {},
    });
  });

  it('[SEN-32] [CA-SEN-17] keeps events = cases + grouped events and cases = awaiting + valid + excluded + not measurable', () => {
    fc.assert(
      fc.property(anyCases, anyExits, (cases, exits) => {
        const tally = tallyProfile(cases, exits);

        expect(tally.eventCount).toBe(tally.caseCount + tally.groupedEventCount);
        expect(tally.caseCount).toBe(
          tally.awaitingCount + tally.validCount + tally.excludedCount + tally.notMeasurableCount,
        );
      }),
    );
  });

  it('[SEN-20] [SEN-33] counts every awaiting or not-measurable case under its reason, and every exit under its own', () => {
    fc.assert(
      fc.property(anyCases, anyExits, (cases, exits) => {
        const tally = tallyProfile(cases, exits);

        expect(sumOf(tally.tallyReasons.awaitingGame)).toBe(tally.awaitingCount);
        expect(sumOf(tally.tallyReasons.notMeasurable)).toBe(tally.notMeasurableCount);
        expect(sumOf(tally.exitCounts)).toBe(exits.length);
      }),
    );
  });

  it('[SEN-20] gives the cases of each reason and criterion in the glossary order, whatever the order of the cases', () => {
    const cases: ProfileCase[] = [
      ...NOT_MEASURABLE_REASONS.map((reason, index) => notMeasurable(index, reason)),
      ...AWAITING_GAME_REASONS.map((reason, index) => awaiting(10 + index, reason)),
      ...CRITERIA.map((criterion, index) => excluded(20 + index, [criterion])),
      awaiting(30, 'statistics_pending'),
      notMeasurable(31, 'season_not_covered'),
      excluded(32, ['opponent_strength', 'injury_return']),
    ].toReversed();
    const { tallyReasons } = tallyProfile(cases, []);

    expect(Object.entries(tallyReasons.awaitingGame)).toStrictEqual([
      ['game_not_played_yet', 1],
      ['statistics_pending', 2],
      ['mapping_not_established', 1],
      ['baseline_building', 1],
      ['precedence_to_verify', 1],
      ['dating_to_verify', 1],
    ]);
    expect(Object.entries(tallyReasons.notMeasurable)).toStrictEqual([
      ['no_game_within_window', 1],
      ['box_score_incomplete', 1],
      ['box_score_suspect', 1],
      ['box_score_unavailable', 1],
      ['insufficient_baseline', 1],
      ['season_not_covered', 2],
      ['precedence_not_established', 1],
      ['derived_game_missed', 1],
    ]);
    expect(Object.entries(tallyReasons.excluded)).toStrictEqual([
      ['playing_time_too_low', 1],
      ['injury_return', 2],
      ['unusual_stakes', 1],
      ['opponent_strength', 2],
      ['co_occurring', 1],
      ['manual', 1],
    ]);
  });

  it('[SEN-20] counts a case once under a criterion that both of its conditions trigger', () => {
    // A return from injury both flagged and calculated is one criterion of the case (SEN-13).
    const tally = tallyProfile([excluded(1, ['injury_return', 'injury_return', 'manual'])], []);

    expect(tally.tallyReasons.excluded).toStrictEqual(counts(['injury_return', 1], ['manual', 1]));
  });

  it('[SEN-20] counts among the excluded cases those excluded by hand, alone or with other criteria', () => {
    const cases = [
      excluded(1, ['manual']),
      excluded(2, ['unusual_stakes', 'manual']),
      excluded(3, ['playing_time_too_low']),
      measured(4, 0.3),
    ];

    expect(tallyProfile(cases, [])).toMatchObject({ excludedCount: 3, manuallyExcludedCount: 2 });
  });

  it('[SEN-20] counts the co-occurring cases in every status, and the measured or excluded cases with a provisional gap', () => {
    const cases: ProfileCase[] = [
      { ...measured(1, 0.4), isCoOccurring: true, gapStatus: 'provisional' },
      { ...excluded(2, ['co_occurring'], 0.1), isCoOccurring: true, gapStatus: 'provisional' },
      { ...awaiting(3, 'game_not_played_yet'), isCoOccurring: true },
      measured(4, -0.6),
      excluded(5, ['opponent_strength'], 1.2),
    ];

    expect(tallyProfile(cases, [])).toMatchObject({ coOccurringCount: 3, provisionalGapCount: 2 });
  });

  it('[SEN-43] counts the valid cases resting on an event of low research confidence, and those only', () => {
    const cases: ProfileCase[] = [
      { ...measured(1, 0.2), events: [HISTORICAL, LOW_CONFIDENCE] },
      { ...measured(2, 0.5), events: [LOW_CONFIDENCE] },
      { ...measured(3, -0.1), events: [{ researchConfidence: 'medium' }, HISTORICAL] },
      { ...excluded(4, ['playing_time_too_low']), events: [LOW_CONFIDENCE] },
      { ...awaiting(5, 'baseline_building'), events: [LOW_CONFIDENCE] },
    ];

    expect(tallyProfile(cases, []).lowResearchConfidenceCount).toBe(2);
  });

  it('[SEN-43] [CL-SEN-03] never counts a calendar-derived or a detected case there, its events having no research confidence', () => {
    const cases: ProfileCase[] = [
      { ...measured(1, 0.8), events: [NO_CONFIDENCE] },
      { ...measured(2, -0.4), events: [NO_CONFIDENCE, NO_CONFIDENCE] },
    ];

    expect(tallyProfile(cases, [])).toMatchObject({ validCount: 2, lowResearchConfidenceCount: 0 });
  });

  it('[SEN-33] [CL-SEN-25] counts the events that left the tally by reason, in the glossary order, apart from the counted ones', () => {
    const exits: TallyExitReason[] = [
      'no_longer_derived',
      'dismissed',
      'erased',
      'replaced_at_import',
      'dismissed',
      'deleted',
      'merged',
      'replaced_at_import',
      'dismissed',
    ];
    const tally = tallyProfile([measured(1, 0.1)], exits);

    expect(Object.entries(tally.exitCounts)).toStrictEqual([
      ['dismissed', 3],
      ['merged', 1],
      ['deleted', 1],
      ['replaced_at_import', 2],
      ['erased', 1],
      ['no_longer_derived', 1],
    ]);
    expect(tally).toMatchObject({ eventCount: 1, caseCount: 1, groupedEventCount: 0 });
  });

  it('[SEN-33] [CL-SEN-26] tallies a profile whose events all left it: no event and no case, only its exits', () => {
    const tally = tallyProfile([], ['deleted', 'dismissed']);

    expect(tally).toMatchObject({
      eventCount: 0,
      caseCount: 0,
      groupedEventCount: 0,
      validCount: 0,
    });
    expect(tally.exitCounts).toStrictEqual({ dismissed: 1, deleted: 1 });
  });

  it('[SEN-33] [CL-SEN-25] takes the six exit reasons of the glossary, and leaves no trace of a withdrawal', () => {
    expectTypeOf<TallyExitReason>().toEqualTypeOf<(typeof EXIT_REASONS)[number]>();
    expectTypeOf<'withdrawn'>().not.toExtend<TallyExitReason>();

    // @ts-expect-error: a withdrawal is no exit reason, which an untyped caller may still pass
    expect(tallyProfile([], ['withdrawn']).exitCounts).toStrictEqual({});
  });
});

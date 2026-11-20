import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { profileChecks } from './checks';
import { profileVerdict, verdictQuantities } from './verdict';

import type { EngineParams } from '../types';
import type { ManuallyDecidedCase, ProfileChecks } from './checks';
import type { ProfileCase } from './tally';
import type { Verdict } from './verdict';

// The registry's defaults.
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

// The worked example's values compare at their printed precision, and those it gives as
// « environ » within 0.05 (CL-SEN-24).
const ABOUT = 1;
const DAY_MS = 86_400_000;
const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };

/** The registry's defaults with other thresholds of SEN-23. */
function withThresholds(thresholds: Partial<EngineParams['sensitivity']>): EngineParams {
  return { ...DEFAULTS, sensitivity: { ...DEFAULTS.sensitivity, ...thresholds } };
}

/** A valid case whose measured game starts on `day`, by default its identifier. */
function valid(
  caseId: number,
  normalizedGap: number,
  day = caseId,
): Extract<ProfileCase, { status: 'measured' }> {
  return {
    caseId,
    events: [{ researchConfidence: 'high' }],
    isCoOccurring: false,
    status: 'measured',
    measuredGameScheduledStartAt: day * DAY_MS,
    normalizedGap,
    gapStatus: 'final',
  };
}

/** A case excluded by hand, whose measured game starts on `day`, by default its identifier. */
function excludedByHand(caseId: number, normalizedGap: number, day = caseId): ProfileCase {
  return {
    ...valid(caseId, normalizedGap, day),
    status: 'excluded',
    triggeredCriteria: ['manual'],
  };
}

/** A case that is not measurable, or awaiting its game: it has no gap. */
function withoutGap(caseId: number, status: 'awaiting_game' | 'not_measurable'): ProfileCase {
  return status === 'awaiting_game'
    ? {
        caseId,
        events: [{ researchConfidence: null }],
        isCoOccurring: false,
        status,
        statusReason: 'statistics_pending',
      }
    : {
        caseId,
        events: [{ researchConfidence: 'high' }],
        isCoOccurring: false,
        status,
        statusReason: 'no_game_within_window',
      };
}

/** Cases with these identifiers, all ruled by a decision that undone leaves them `status`. */
function decided(
  caseIds: readonly number[],
  statusWithoutDecision: ManuallyDecidedCase['statusWithoutDecision'],
): ManuallyDecidedCase[] {
  return caseIds.map((caseId) => ({ caseId, statusWithoutDecision }));
}

/** The same cases with gaps of the opposite sign. */
function mirrored(cases: readonly ProfileCase[]): ProfileCase[] {
  return cases.map((caseItem) =>
    'normalizedGap' in caseItem
      ? { ...caseItem, normalizedGap: -caseItem.normalizedGap }
      : caseItem,
  );
}

/** Ids from 1 on, one per gap, each case built by `build` on the day of its id. */
function casesOf(
  gaps: readonly number[],
  build: (caseId: number, gap: number) => ProfileCase,
  firstId = 1,
): ProfileCase[] {
  return gaps.map((gap, index) => build(firstId + index, gap));
}

// The 08 worked example, cases C1 to C11 in the order of their games, with the gaps it
// prints (CL-SEN-24): C4 and C9 are excluded, for playing time and unusual stakes, and
// C6 is not measurable.
const WORKED_EXAMPLE_CASES: ProfileCase[] = [
  valid(1, 1.16),
  valid(2, -0.43),
  valid(3, 0.95),
  { ...valid(4, -1.9), status: 'excluded', triggeredCriteria: ['playing_time_too_low'] },
  valid(5, 0.55),
  withoutGap(6, 'not_measurable'),
  valid(7, 1.81),
  valid(8, -0.2),
  { ...valid(9, 0.63), status: 'excluded', triggeredCriteria: ['unusual_stakes'] },
  valid(10, 1.13),
  valid(11, 1.43),
];
// The same profile had the owner excluded C4 and C9 by hand, no criterion applying.
const EXCLUDED_BY_HAND = WORKED_EXAMPLE_CASES.map((caseItem) =>
  caseItem.status === 'excluded'
    ? excludedByHand(caseItem.caseId, caseItem.normalizedGap)
    : caseItem,
);
const WORKED_EXAMPLE_VALID = WORKED_EXAMPLE_CASES.filter(
  (caseItem) => caseItem.status === 'measured',
);

// Up to 15 cases with distinct identifiers, measured, excluded or not measurable, with
// gaps in halves, several of them on one day; then manual decisions on some of the cases
// with a gap, and the cases in another order.
const anyCases = fc
  .uniqueArray(
    fc.tuple(
      fc.nat({ max: 1000 }),
      fc.integer({ min: -6, max: 6 }),
      fc.nat({ max: 5 }),
      fc.constantFrom('measured', 'excluded', 'not_measurable'),
    ),
    { maxLength: 15, selector: ([caseId]) => caseId },
  )
  .map((rows) =>
    rows.map(([caseId, halves, day, status]): ProfileCase => {
      if (status === 'not_measurable') {
        return withoutGap(caseId, status);
      }
      return status === 'measured'
        ? valid(caseId, halves / 2, day)
        : excludedByHand(caseId, halves / 2, day);
    }),
  );
const anyProfile = anyCases.chain((cases) =>
  fc.record({
    cases: fc.constant(cases),
    shuffled: fc.shuffledSubarray(cases, { minLength: cases.length, maxLength: cases.length }),
    decisions: fc
      .subarray(cases.filter((caseItem) => caseItem.status !== 'not_measurable'))
      .chain((ruled) =>
        fc.tuple(
          ...ruled.map((caseItem) =>
            fc.record({
              caseId: fc.constant(caseItem.caseId),
              statusWithoutDecision: fc.constantFrom('measured' as const, 'excluded' as const),
            }),
          ),
        ),
      ),
  }),
);

describe('profileChecks', () => {
  it('[CA-SEN-11] [SEN-27] [CL-SEN-24] gives the worked example a control mean gap of +0.51 over 10 cases, a ratio of about 1.5: inconclusive', () => {
    const checks = profileChecks(WORKED_EXAMPLE_CASES, [], DEFAULTS);

    expect(checks.controlCaseCount).toBe(10);
    expect(checks.controlQuantities?.meanGap).toBeCloseTo(0.51, 2);
    expect(checks.controlQuantities?.gapDispersion).toBeCloseTo(1.09, 2);
    expect(checks.controlQuantities?.signalToNoise).toBeCloseTo(1.5, ABOUT);
    expect(checks.controlVerdict).toStrictEqual(INCONCLUSIVE);
  });

  it('[SEN-27] [CL-SEN-24] shows no manual-exclusion warning on the worked example, whose exclusions are automatic', () => {
    const checks = profileChecks(WORKED_EXAMPLE_CASES, [], DEFAULTS);

    // The control differs from the verdict: the verdict depends on automatic exclusions.
    expect(profileVerdict(WORKED_EXAMPLE_CASES, DEFAULTS).verdict).not.toStrictEqual(
      checks.controlVerdict,
    );
    expect(checks.dependsOnManualExclusions).toBe(false);
  });

  it('[CA-SEN-16] [SEN-27] warns that the verdict depends on manual exclusions when undoing two of them leaves "possible" inconclusive', () => {
    const checks = profileChecks(EXCLUDED_BY_HAND, decided([4, 9], 'measured'), DEFAULTS);

    expect(profileVerdict(EXCLUDED_BY_HAND, DEFAULTS).verdict).toStrictEqual({
      level: 'possible',
      direction: 'increase',
    });
    expect(checks.dependsOnManualExclusions).toBe(true);
  });

  it('[SEN-27] [SEN-17] undoes a reinstatement too: the case goes back to excluded', () => {
    // C7 reinstated by hand: without it, the 7 other valid cases are inconclusive.
    const checks = profileChecks(WORKED_EXAMPLE_CASES, decided([7], 'excluded'), DEFAULTS);

    expect(checks.dependsOnManualExclusions).toBe(true);
  });

  it('[SEN-27] [SEN-17] keeps an undone exclusion excluded when the automatic criteria exclude the case too', () => {
    const repeatedByCriteria = EXCLUDED_BY_HAND.map((caseItem) =>
      caseItem.status === 'excluded'
        ? { ...caseItem, triggeredCriteria: ['manual', 'unusual_stakes'] as const }
        : caseItem,
    );

    expect(
      profileChecks(repeatedByCriteria, decided([4, 9], 'excluded'), DEFAULTS)
        .dependsOnManualExclusions,
    ).toBe(false);
  });

  it('[SEN-27] warns when undoing the manual decisions changes the level of the verdict alone', () => {
    // Two gaps of +2 excluded by hand: with them, "probable, increase" (a ratio of 3.29).
    const cases = [...WORKED_EXAMPLE_VALID, ...casesOf([2, 2], excludedByHand, 20)];
    const checks = profileChecks(cases, decided([20, 21], 'measured'), DEFAULTS);

    expect(profileVerdict(cases, DEFAULTS).verdict.level).toBe('possible');
    expect(checks.controlVerdict).toStrictEqual({ level: 'probable', direction: 'increase' });
    expect(checks.dependsOnManualExclusions).toBe(true);
  });

  it('[SEN-27] warns when undoing the manual decisions changes the direction of the verdict alone', () => {
    // Five gaps of +1 are "possible, increase"; with fifteen of −1 excluded by hand, a mean
    // gap of −0.5 and a ratio of about −2.24 give "possible, decrease".
    const minusOnes = casesOf(
      Array.from({ length: 15 }, () => -1),
      excludedByHand,
      6,
    );
    const cases = [...casesOf([1, 1, 1, 1, 1], valid), ...minusOnes];
    const checks = profileChecks(
      cases,
      decided(
        minusOnes.map((caseItem) => caseItem.caseId),
        'measured',
      ),
      DEFAULTS,
    );

    expect(profileVerdict(cases, DEFAULTS).verdict).toStrictEqual({
      level: 'possible',
      direction: 'increase',
    });
    expect(checks.controlVerdict).toStrictEqual({ level: 'possible', direction: 'decrease' });
    expect(checks.dependsOnManualExclusions).toBe(true);
  });

  it('[SEN-27] [SEN-23] warns when undoing a manual exclusion brings the profile to the valid-case threshold', () => {
    // Four valid gaps of 1.5 are below the threshold; five give a ratio of about 3.35.
    const cases = [...casesOf([1.5, 1.5, 1.5, 1.5], valid), excludedByHand(5, 1.5)];

    expect(profileChecks(cases, decided([5], 'measured'), DEFAULTS)).toMatchObject({
      controlVerdict: { level: 'probable', direction: 'increase' },
      dependsOnManualExclusions: true,
    });
  });

  it('[SEN-27] [SEN-23] warns when undoing a reinstatement takes the profile below the valid-case threshold', () => {
    // Five valid gaps of 1.5, the last one reinstated: four remain, a ratio of exactly 3.
    const cases = casesOf([1.5, 1.5, 1.5, 1.5, 1.5], valid);

    expect(profileVerdict(cases, DEFAULTS).verdict).toStrictEqual({
      level: 'probable',
      direction: 'increase',
    });
    expect(profileChecks(cases, decided([5], 'excluded'), DEFAULTS).dependsOnManualExclusions).toBe(
      true,
    );
  });

  it('[SEN-27] [SEN-23] gives the control the verdict that SEN-23 would give, valid-case threshold included', () => {
    // Three valid gaps of 1.5 and an excluded one: a ratio of exactly 3 on four cases.
    const cases = [...casesOf([1.5, 1.5, 1.5], valid), excludedByHand(4, 1.5)];

    expect(profileChecks(cases, [], DEFAULTS).controlVerdict).toStrictEqual(INCONCLUSIVE);
    expect(
      profileChecks(cases, [], withThresholds({ minValidCases: 4 })).controlVerdict,
    ).toStrictEqual({ level: 'probable', direction: 'increase' });
  });

  it('[SEN-27] [SEN-10] [CL-SEN-08] takes the valid and the excluded cases into the control, never an awaiting or a not-measurable one', () => {
    const cases = [
      valid(1, 0.2),
      excludedByHand(2, 0.4),
      withoutGap(3, 'not_measurable'),
      withoutGap(4, 'awaiting_game'),
    ];
    const checks = profileChecks(cases, decided([3, 4], 'measured'), DEFAULTS);

    expect(checks).toStrictEqual({
      controlCaseCount: 2,
      controlQuantities: verdictQuantities([0.2, 0.4]),
      controlVerdict: INCONCLUSIVE,
      dependsOnManualExclusions: false,
    });
  });

  it('[SEN-27] [CL-STA-09] sums the control gaps, valid and excluded together, in the order of their measured games', () => {
    // Added in another order, 0.1, 0.2 and 0.3 give a mean that differs in its last bit.
    const cases = [valid(10, 0.2, 2), valid(20, 0.3, 3), excludedByHand(30, 0.1, 1)];
    const inGameOrder = verdictQuantities([0.1, 0.2, 0.3]);

    expect(verdictQuantities([0.2, 0.3, 0.1])).not.toStrictEqual(inGameOrder);
    expect(profileChecks(cases, [], DEFAULTS).controlQuantities).toStrictEqual(inGameOrder);
  });

  it('[SEN-27] [CL-SEN-15] gives a profile without a valid or an excluded case no control mean gap and no warning', () => {
    const cases = [withoutGap(1, 'not_measurable'), withoutGap(2, 'awaiting_game')];
    const none: ProfileChecks = {
      controlCaseCount: 0,
      controlQuantities: null,
      controlVerdict: INCONCLUSIVE,
      dependsOnManualExclusions: false,
    };

    expect(profileChecks(cases, [], DEFAULTS)).toStrictEqual(none);
    expect(profileChecks([], [], DEFAULTS)).toStrictEqual(none);
  });

  it('[SEN-24] [H-04] gives the mirrored worked example the mirrored control and the same warnings', () => {
    const checks = profileChecks(mirrored(WORKED_EXAMPLE_CASES), [], DEFAULTS);
    const byHand = profileChecks(mirrored(EXCLUDED_BY_HAND), decided([4, 9], 'measured'), DEFAULTS);

    expect(checks.controlQuantities?.meanGap).toBeCloseTo(-0.51, 2);
    expect(checks.controlQuantities?.signalToNoise).toBeCloseTo(-1.5, ABOUT);
    expect(checks).toMatchObject({
      controlVerdict: INCONCLUSIVE,
      dependsOnManualExclusions: false,
    });
    expect(byHand.dependsOnManualExclusions).toBe(true);
  });

  it('[SEN-27] never warns about a profile without a manual decision', () => {
    fc.assert(
      fc.property(anyCases, (cases) => {
        expect(profileChecks(cases, [], DEFAULTS).dependsOnManualExclusions).toBe(false);
      }),
    );
  });

  it('[SEN-27] [CL-STA-09] gives the same checks for the same cases in any order', () => {
    fc.assert(
      fc.property(anyProfile, ({ cases, shuffled, decisions }) => {
        expect(profileChecks(shuffled, decisions, DEFAULTS)).toStrictEqual(
          profileChecks(cases, decisions, DEFAULTS),
        );
      }),
    );
  });
});

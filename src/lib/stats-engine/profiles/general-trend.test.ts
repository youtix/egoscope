import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { profileChecks } from './checks';
import { profileConfidence } from './confidence';
import { generalTrend, topContributorShare } from './general-trend';
import { runRobustnessTest } from './robustness';
import { tallyProfile } from './tally';
import { profileVerdict } from './verdict';

import type { EngineParams } from '../types';
import type { ManuallyDecidedCase } from './checks';
import type { ConfidenceStepDownReason, ConfidenceValues, ProfileConfidence } from './confidence';
import type { GeneralTrendValues, TrendCase } from './general-trend';
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

// Raw values are compared to 1e-9, the worked example's at their printed precision
// (CL-STA-09, CL-SEN-24).
const PRECISION = 9;
const DAY_MS = 86_400_000;
const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };
const POSSIBLE_INCREASE: Verdict = { level: 'possible', direction: 'increase' };
const PROBABLE_INCREASE: Verdict = { level: 'probable', direction: 'increase' };
// Invented players, by their identifiers.
const [A, B, C, D] = ['player-a', 'player-b', 'player-c', 'player-d'] as const;

type ValidCase = Extract<TrendCase, { status: 'measured' }>;

/** The registry's defaults with other values of the sensitivity parameters. */
function withSensitivity(changes: Partial<EngineParams['sensitivity']>): EngineParams {
  return { ...DEFAULTS, sensitivity: { ...DEFAULTS.sensitivity, ...changes } };
}

/** A valid case of `playerId`, whose measured game starts on the day of its identifier. */
function valid(caseId: number, playerId: string, normalizedGap: number): ValidCase {
  return {
    caseId,
    playerId,
    events: [{ researchConfidence: 'high' }],
    isCoOccurring: false,
    status: 'measured',
    measuredGameScheduledStartAt: caseId * DAY_MS,
    normalizedGap,
    gapStatus: 'final',
  };
}

/** The same case excluded, for playing time or, `isManual`, by a manual decision. */
function excluded(caseItem: ValidCase, isManual = false): TrendCase {
  return {
    ...caseItem,
    status: 'excluded',
    triggeredCriteria: [isManual ? 'manual' : 'playing_time_too_low'],
  };
}

/** A case of `playerId` awaiting its game's statistics. */
function awaiting(caseId: number, playerId: string): TrendCase {
  return {
    caseId,
    playerId,
    events: [{ researchConfidence: null }],
    isCoOccurring: false,
    status: 'awaiting_game',
    statusReason: 'statistics_pending',
  };
}

/** Valid cases of `playerId` with these gaps, their identifiers from `firstId` on. */
function casesOf(playerId: string, gaps: readonly number[], firstId: number): ValidCase[] {
  return gaps.map((gap, index) => valid(firstId + index, playerId, gap));
}

/** `count` gaps of `gap`. */
function repeated(gap: number, count: number): number[] {
  return Array.from({ length: count }, () => gap);
}

/** The case that a manual decision rules, with the status it would have without it. */
function decided(
  caseId: number,
  statusWithoutDecision: ManuallyDecidedCase['statusWithoutDecision'],
): ManuallyDecidedCase[] {
  return [{ caseId, statusWithoutDecision }];
}

/** The general trend of these cases, with no exit. */
function trendOf(
  cases: readonly TrendCase[],
  params = DEFAULTS,
  manuallyDecidedCases: readonly ManuallyDecidedCase[] = [],
): GeneralTrendValues {
  return generalTrend({ cases, exitReasons: [], manuallyDecidedCases }, params);
}

/** A profile confidence and its reasons. */
function confidence(
  level: ProfileConfidence,
  confidenceStepDownReasons: readonly ConfidenceStepDownReason[] = [],
): ConfidenceValues {
  return { profileConfidence: level, confidenceStepDownReasons };
}

// A gap of +0.1 for every case: an inconclusive verdict that no case tips, and no dispersion.
const FLAT = 0.1;

/** The trend of `count` flat cases, two thirds of them from one player and one from a third. */
function twoThirdsFromOne(count: number): GeneralTrendValues {
  return trendOf([
    ...casesOf(A, repeated(FLAT, (count * 2) / 3), 1),
    ...casesOf(B, repeated(FLAT, count / 3 - 1), 100),
    valid(200, C, FLAT),
  ]);
}

/** Cases with these gaps: the last one a third player's, the two before a second's, the rest a first's. */
function mostlyFromOne(gaps: readonly number[]): TrendCase[] {
  return [
    ...casesOf(A, gaps.slice(0, -3), 1),
    ...casesOf(B, gaps.slice(-3, -1), 20),
    ...casesOf(C, gaps.slice(-1), 30),
  ];
}

// Twenty gaps of +1 from two players: "probable, increase" for a profile, a ratio of 4.47.
const TWO_PLAYERS = [...casesOf(A, repeated(1, 10), 1), ...casesOf(B, repeated(1, 10), 11)];
// The 08 variant (« trop peu de cas »), fed the values it prints (CL-SEN-24): 63 valid gaps
// of 11 players around a mean gap of +0.31 with a dispersion of 1.12, 31 of them at
// 0.31 + 1.12, 31 at 0.31 − 1.12 and one at 0.31, the players taking turns.
const VARIANT_CASES = [...repeated(1.43, 31), ...repeated(-0.81, 31), 0.31].map((gap, index) =>
  valid(index + 1, `player-${String((index % 11) + 1)}`, gap),
);

describe('topContributorShare', () => {
  it('[SEN-28] [SEN-29] divides the valid cases of the player who brings the most by all the valid cases', () => {
    expect(topContributorShare(6, 10)).toBeCloseTo(0.6, PRECISION);
    expect(topContributorShare(5, 10)).toBe(0.5);
  });

  it('[SEN-28] [CL-SEN-15] gives no share without a valid case', () => {
    expect(topContributorShare(0, 0)).toBeNull();
  });
});

describe('generalTrend', () => {
  it('[SEN-28] [Q-SEN-02] weighs each valid case the same, whoever brings it: its mean gap is that of all the valid gaps', () => {
    // Per player, the mean gaps +1, −1 and 0 would average 0; per case, (8 − 2 + 0) ÷ 12.
    const cases = [
      ...casesOf(A, repeated(1, 8), 1),
      ...casesOf(B, repeated(-1, 2), 9),
      ...casesOf(C, repeated(0, 2), 11),
    ];

    expect(trendOf(cases).quantities?.meanGap).toBeCloseTo(0.5, PRECISION);
    expect(trendOf(cases).quantities).toStrictEqual(profileVerdict(cases, DEFAULTS).quantities);
  });

  it('[SEN-28] counts the distinct players with a valid case and the valid cases of the one who brings the most', () => {
    const cases = [
      ...casesOf(A, [0.5, 0.2, -0.1], 1),
      excluded(valid(4, A, 2)),
      ...casesOf(B, [0.4, 0.3], 5),
      excluded(valid(7, C, 1)),
      awaiting(8, C),
    ];
    const trend = trendOf(cases);

    expect(trend).toMatchObject({ distinctPlayerCount: 2, topContributorValidCount: 3 });
    expect(trend.tally).toMatchObject({ validCount: 5, excludedCount: 2, awaitingCount: 1 });
    expect(topContributorShare(trend.topContributorValidCount, trend.tally.validCount)).toBeCloseTo(
      0.6,
      PRECISION,
    );
  });

  it('[CA-SEN-15] [SEN-29] is inconclusive on 30 valid cases from 2 players only, however strong their signal', () => {
    // Gaps of +1.6 and 0 in turn: a mean gap of +0.80 and a ratio of 4.38.
    const gaps = Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 1.6 : 0));
    const fromTwo = gaps.map((gap, index) => valid(index + 1, index < 15 ? A : B, gap));
    const fromThree = gaps.map((gap, index) => valid(index + 1, [A, B, C][index % 3] ?? A, gap));

    expect(profileVerdict(fromTwo, DEFAULTS).verdict).toStrictEqual(PROBABLE_INCREASE);
    expect(trendOf(fromTwo)).toMatchObject({ verdict: INCONCLUSIVE, distinctPlayerCount: 2 });
    expect(trendOf(fromTwo).quantities?.signalToNoise).toBeCloseTo(4.38, 2);
    expect(trendOf(fromThree)).toMatchObject({
      verdict: PROBABLE_INCREASE,
      distinctPlayerCount: 3,
    });
  });

  it('[SEN-29] gives a verdict from exactly sensitivity.trendMinPlayers distinct players on', () => {
    const fromThree = [...TWO_PLAYERS, valid(21, C, 1)];

    expect(trendOf(fromThree).verdict).toStrictEqual(PROBABLE_INCREASE);
    expect(trendOf(fromThree, withSensitivity({ trendMinPlayers: 4 })).verdict).toStrictEqual(
      INCONCLUSIVE,
    );
    expect(trendOf(TWO_PLAYERS, withSensitivity({ trendMinPlayers: 2 })).verdict).toStrictEqual(
      PROBABLE_INCREASE,
    );
  });

  it('[SEN-29] counts a player towards the 3 through his valid cases only', () => {
    const cases = [...TWO_PLAYERS, excluded(valid(21, C, 1)), awaiting(22, C)];

    expect(trendOf(cases)).toMatchObject({ verdict: INCONCLUSIVE, distinctPlayerCount: 2 });
  });

  it('[SEN-28] [SEN-22] [CL-SEN-24] gives the 08 variant a mean gap of +0.31 on 63 valid cases of 11 players, a dispersion of 1.12 and a noise of 0.141', () => {
    const trend = trendOf(VARIANT_CASES);

    expect(trend).toMatchObject({ distinctPlayerCount: 11, tally: { validCount: 63 } });
    expect(trend.quantities?.meanGap).toBeCloseTo(0.31, 2);
    expect(trend.quantities?.gapDispersion).toBeCloseTo(1.12, 2);
    expect(trend.quantities?.expectedNoise).toBeCloseTo(0.141, 3);
  });

  it('[SEN-28] [SEN-29] [SEN-23] [CL-SEN-24] gives the 08 variant a ratio of 2.2: "possible, increase" for all the observed players', () => {
    const trend = trendOf(VARIANT_CASES);

    expect(trend.quantities?.signalToNoise).toBeCloseTo(2.2, 1);
    expect(trend.verdict).toStrictEqual(POSSIBLE_INCREASE);
  });

  it('[SEN-29] [SEN-25] steps the profile confidence down once more when one player brings more than 50 % of the valid cases, not exactly 50 %', () => {
    // Ten valid cases start medium; six from one player step down, five do not.
    const sixOfTen = [...casesOf(A, repeated(FLAT, 6), 1), ...casesOf(B, repeated(FLAT, 2), 7)];
    const fiveOfTen = [...casesOf(A, repeated(FLAT, 5), 1), ...casesOf(B, repeated(FLAT, 3), 6)];
    const third = casesOf(C, repeated(FLAT, 2), 9);

    expect(trendOf([...sixOfTen, ...third])).toMatchObject(confidence('low', ['dominant_player']));
    expect(trendOf([...fiveOfTen, ...third])).toMatchObject(confidence('medium'));
  });

  it('[SEN-29] compares the top-contributor share with sensitivity.trendMaxTopShare, in percent', () => {
    const cases = [
      ...casesOf(A, repeated(FLAT, 6), 1),
      ...casesOf(B, repeated(FLAT, 2), 7),
      ...casesOf(C, repeated(FLAT, 2), 9),
    ];

    expect(trendOf(cases, withSensitivity({ trendMaxTopShare: 60 }))).toMatchObject(
      confidence('medium'),
    );
    expect(trendOf(cases, withSensitivity({ trendMaxTopShare: 59 }))).toMatchObject(
      confidence('low', ['dominant_player']),
    );
  });

  it('[SEN-29] [SEN-25] takes the dominant-player step from every level, never below low, the reason kept at the floor', () => {
    // 15, 9 and 6 valid cases start high, medium and low.
    expect(twoThirdsFromOne(15)).toMatchObject(confidence('medium', ['dominant_player']));
    expect(twoThirdsFromOne(9)).toMatchObject(confidence('low', ['dominant_player']));
    expect(twoThirdsFromOne(6)).toMatchObject(confidence('low', ['dominant_player']));
  });

  it('[SEN-29] [SEN-25] gives the dominant-player reason after the other reasons of SEN-25', () => {
    // Gaps of −2 and +2 in turn disagree, a dispersion of 2.1; the worked example's gaps
    // give a fragile "possible, increase" (CA-SEN-11). Most of them from one player.
    const disagreeing = [-2, 2, -2, 2, -2, 2, -2, 2, -2, 2];
    const workedExample = [1.16, -0.43, 0.95, 0.55, 1.81, -0.2, 1.13, 1.43];

    expect(trendOf(mostlyFromOne(disagreeing))).toMatchObject(
      confidence('low', ['high_dispersion', 'dominant_player']),
    );
    expect(trendOf(mostlyFromOne(workedExample))).toMatchObject({
      verdict: POSSIBLE_INCREASE,
      isFragile: true,
      ...confidence('low', ['fragile_verdict', 'dominant_player']),
    });
  });

  it('[SEN-26] [CL-SEN-14] leaves the player rule out of the robustness test: one case less, from two players, keeps the verdict', () => {
    // The highest gap is the third player's only case; the other 20 cases stay probable.
    const trend = trendOf([...TWO_PLAYERS, valid(21, C, 2)]);

    expect(trend).toMatchObject({ verdict: PROBABLE_INCREASE, isFragile: false });
    expect(trend).toMatchObject(confidence('high'));
  });

  it('[SEN-26] [CL-SEN-14] finds a trend that the player rule alone holds inconclusive fragile, one case less giving a verdict without that rule', () => {
    const trend = trendOf(TWO_PLAYERS);

    expect(trend).toMatchObject({ verdict: INCONCLUSIVE, isFragile: true });
    expect(trend).toMatchObject(confidence('medium', ['fragile_verdict']));
  });

  it('[SEN-27] [SEN-29] gives the control the trend rules: the excluded cases of a third player complete its players', () => {
    const cases = [...TWO_PLAYERS, excluded(valid(21, C, 2)), excluded(valid(22, C, 2))];
    const trend = trendOf(cases);

    expect(trend.verdict).toStrictEqual(INCONCLUSIVE);
    expect(trend).toMatchObject({ controlCaseCount: 22, controlVerdict: PROBABLE_INCREASE });
    expect(trend.controlQuantities?.meanGap).toBeCloseTo(24 / 22, PRECISION);
  });

  it('[SEN-27] [SEN-29] keeps the control inconclusive on the cases of 2 players, however strong their signal', () => {
    const cases = [...TWO_PLAYERS, excluded(valid(21, A, 2))];

    expect(profileChecks(cases, [], DEFAULTS).controlVerdict).toStrictEqual(PROBABLE_INCREASE);
    expect(trendOf(cases)).toMatchObject({ controlCaseCount: 21, controlVerdict: INCONCLUSIVE });
  });

  it('[SEN-27] [SEN-29] warns that the verdict depends on manual exclusions when undoing a reinstatement leaves 2 players', () => {
    // The third player's case is reinstated by hand: without it, 2 players are left.
    const cases = [...TWO_PLAYERS, valid(21, C, 1)];
    const decisions = decided(21, 'excluded');

    expect(trendOf(cases, DEFAULTS, decisions)).toMatchObject({
      verdict: PROBABLE_INCREASE,
      dependsOnManualExclusions: true,
    });
    expect(profileChecks(cases, decisions, DEFAULTS).dependsOnManualExclusions).toBe(false);
  });

  it('[SEN-27] [SEN-29] does not warn when the player rule holds the verdict inconclusive with and without the manual decisions', () => {
    // Undoing the exclusion of a gap of −10 would make a profile inconclusive.
    const cases = [...TWO_PLAYERS, excluded(valid(21, A, -10), true)];
    const decisions = decided(21, 'measured');

    expect(trendOf(cases, DEFAULTS, decisions)).toMatchObject({
      verdict: INCONCLUSIVE,
      dependsOnManualExclusions: false,
    });
    expect(profileChecks(cases, decisions, DEFAULTS).dependsOnManualExclusions).toBe(true);
  });

  it('[SEN-27] [SEN-17] does not warn when undoing a manual decision leaves the verdict to 3 players or more', () => {
    const cases = [...TWO_PLAYERS, valid(21, C, 1), valid(22, D, 1)];

    expect(trendOf(cases, DEFAULTS, decided(22, 'excluded'))).toMatchObject({
      verdict: PROBABLE_INCREASE,
      dependsOnManualExclusions: false,
    });
  });

  it('[SEN-20] [SEN-32] [SEN-33] tallies the cases and the exits of every player together', () => {
    const cases = [valid(1, A, 0.4), excluded(valid(2, A, -1)), awaiting(3, B), valid(4, C, 0.2)];
    const trend = generalTrend(
      { cases, exitReasons: ['dismissed', 'deleted', 'dismissed'], manuallyDecidedCases: [] },
      DEFAULTS,
    );

    expect(trend.tally).toMatchObject({
      eventCount: 4,
      caseCount: 4,
      awaitingCount: 1,
      validCount: 2,
      excludedCount: 1,
      exitCounts: { dismissed: 2, deleted: 1 },
    });
  });

  it('[SEN-28] [CL-SEN-15] gives a trend without a valid case no mean, no player, no control and a low profile confidence', () => {
    const cases = [awaiting(1, A), awaiting(2, B)];
    const trend = generalTrend(
      { cases, exitReasons: ['merged'], manuallyDecidedCases: [] },
      DEFAULTS,
    );

    expect(trend).toStrictEqual({
      tally: tallyProfile(cases, ['merged']),
      quantities: null,
      aboveZeroCount: 0,
      belowZeroCount: 0,
      verdict: INCONCLUSIVE,
      isFragile: false,
      ...confidence('low'),
      controlCaseCount: 0,
      controlQuantities: null,
      controlVerdict: INCONCLUSIVE,
      dependsOnManualExclusions: false,
      distinctPlayerCount: 0,
      topContributorValidCount: 0,
    });
  });
});

// How a case of the properties stands: valid or excluded, by a manual decision or not.
const STANDINGS = ['valid', 'excluded', 'excluded by hand', 'reinstated by hand'] as const;
type Standing = (typeof STANDINGS)[number];
// A case as it stands, with the manual decision that rules it, if any.
type RuledCase = Readonly<{ caseItem: TrendCase; decisions: readonly ManuallyDecidedCase[] }>;

/** The valid case as it stands: excluded by playing time or by hand, or valid, reinstated or not. */
function ruled(caseItem: ValidCase, standing: Standing): RuledCase {
  if (standing === 'excluded') {
    return { caseItem: excluded(caseItem), decisions: [] };
  }
  if (standing === 'excluded by hand') {
    return { caseItem: excluded(caseItem, true), decisions: decided(caseItem.caseId, 'measured') };
  }
  return {
    caseItem,
    decisions: standing === 'reinstated by hand' ? decided(caseItem.caseId, 'excluded') : [],
  };
}

/** The cases and the manual decisions of these ruled cases. */
function casesAndDecisions(ruledCases: readonly RuledCase[]): Readonly<{
  cases: TrendCase[];
  decisions: ManuallyDecidedCase[];
}> {
  return {
    cases: ruledCases.map(({ caseItem }) => caseItem),
    decisions: ruledCases.flatMap(({ decisions }) => decisions),
  };
}

/** Valid gaps, in halves, brought in turn by `playerCount` players, and other cases besides. */
function sharedTrend({
  playerCount,
  validHalves,
  others,
}: Readonly<{
  playerCount: number;
  validHalves: readonly number[];
  others: readonly Readonly<{ isExcluded: boolean; halves: number }>[];
}>): Readonly<{ cases: TrendCase[]; playerCount: number; validCount: number }> {
  const playerOf = (index: number): string => `player-${String(index % playerCount)}`;
  const otherCases = others.map(({ isExcluded, halves }, index) =>
    isExcluded
      ? excluded(valid(100 + index, playerOf(index), halves / 2))
      : awaiting(100 + index, playerOf(index)),
  );
  return {
    cases: [
      ...validHalves.map((halves, index) => valid(index + 1, playerOf(index), halves / 2)),
      ...otherCases,
    ],
    playerCount,
    validCount: validHalves.length,
  };
}

const anyHalves = fc.integer({ min: -6, max: 6 });
// From 3 to 5 players who bring 5 to 20 valid cases in turn, so that none brings more than
// half, with excluded or awaiting cases of any of them besides.
const anyOtherCase = fc.record({ isExcluded: fc.boolean(), halves: anyHalves });
const anySharedTrend = fc
  .record({
    playerCount: fc.integer({ min: 3, max: 5 }),
    validHalves: fc.array(anyHalves, { minLength: 5, maxLength: 20 }),
    others: fc.array(anyOtherCase, { maxLength: 6 }),
  })
  .map((drawn) => sharedTrend(drawn));
// From 5 to 30 cases of at most 2 players around a shared shift of up to ±1.5, so that
// their signals reach every level, in every standing.
const anyTwoPlayerCase = fc.record({
  isFirstPlayer: fc.boolean(),
  hundredths: fc.integer({ min: -100, max: 100 }),
  standing: fc.constantFrom(...STANDINGS),
});
const anyTwoPlayerTrend = fc
  .tuple(
    fc.integer({ min: -150, max: 150 }),
    fc.array(anyTwoPlayerCase, { minLength: 5, maxLength: 30 }),
  )
  .map(([shift, rows]) =>
    casesAndDecisions(
      rows.map(({ isFirstPlayer, hundredths, standing }, index) =>
        ruled(valid(index + 1, isFirstPlayer ? A : B, (shift + hundredths) / 100), standing),
      ),
    ),
  );
// From 1 to 15 cases of 4 players, in every standing or awaiting their game, several on
// one day and several of one gap, with a shuffled copy.
const anyCaseRow = fc.record({
  caseId: fc.nat({ max: 1000 }),
  player: fc.constantFrom(A, B, C, D),
  halves: anyHalves,
  day: fc.nat({ max: 3 }),
  standing: fc.option(fc.constantFrom(...STANDINGS), { nil: undefined }),
});
const anyTrendAndShuffle = fc
  .uniqueArray(anyCaseRow, { minLength: 1, maxLength: 15, selector: ({ caseId }) => caseId })
  .chain((rows) => {
    const { cases, decisions } = casesAndDecisions(
      rows.map(({ caseId, player, halves, day, standing }) =>
        standing === undefined
          ? { caseItem: awaiting(caseId, player), decisions: [] }
          : ruled(
              { ...valid(caseId, player, halves / 2), measuredGameScheduledStartAt: day * DAY_MS },
              standing,
            ),
      ),
    );
    return fc.record({
      cases: fc.constant(cases),
      shuffled: fc.shuffledSubarray(cases, { minLength: cases.length, maxLength: cases.length }),
      decisions: fc.constant(decisions),
    });
  });

describe('generalTrend, whatever its cases', () => {
  it('[SEN-28] is the profile of its cases when 3 players or more bring them and none brings more than half', () => {
    fc.assert(
      fc.property(anySharedTrend, ({ cases, playerCount, validCount }) => {
        const tally = tallyProfile(cases, []);
        const verdictValues = profileVerdict(cases, DEFAULTS);
        const { isFragile } = runRobustnessTest(cases, verdictValues.verdict, DEFAULTS);
        const confidenceInputs = {
          validCount: tally.validCount,
          excludedCount: tally.excludedCount,
          gapDispersion: verdictValues.quantities?.gapDispersion ?? null,
          isFragile,
        };

        expect(trendOf(cases)).toStrictEqual({
          tally,
          ...verdictValues,
          isFragile,
          ...profileConfidence(confidenceInputs, DEFAULTS),
          ...profileChecks(cases, [], DEFAULTS),
          distinctPlayerCount: playerCount,
          topContributorValidCount: Math.ceil(validCount / playerCount),
        });
      }),
    );
  });

  it('[CA-SEN-15] [SEN-29] [SEN-27] is inconclusive, its control too, and never depends on manual exclusions with fewer than 3 players', () => {
    fc.assert(
      fc.property(anyTwoPlayerTrend, ({ cases, decisions }) => {
        expect(trendOf(cases, DEFAULTS, decisions)).toMatchObject({
          verdict: INCONCLUSIVE,
          controlVerdict: INCONCLUSIVE,
          dependsOnManualExclusions: false,
        });
      }),
    );
  });

  it('[SEN-28] [SEN-36] [CL-STA-09] gives the same trend for the same cases in any order', () => {
    fc.assert(
      fc.property(anyTrendAndShuffle, ({ cases, shuffled, decisions }) => {
        expect(trendOf(shuffled, DEFAULTS, decisions)).toStrictEqual(
          trendOf(cases, DEFAULTS, decisions),
        );
      }),
    );
  });
});

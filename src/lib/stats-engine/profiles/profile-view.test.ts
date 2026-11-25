import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { dayCount, MS_PER_DAY } from '../calendar-days';
import { NO_GAME } from './evaluate-game';
import { casesByView } from './evaluate-trend';
import { profileViewValues } from './profile-view';

import type { EngineParams } from '../types';
import type { EvaluatedCase, OriginCase } from './evaluate-cases';
import type { CaseOrigin, EvaluatedTrend } from './evaluate-trend';
import type { ProfileViewValues } from './profile-view';

// The registry's defaults. JSON gives the baseline phase as a string, which the comparison
// narrows to a BaselinePhase (types.test.ts).
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};
// The same, with a threshold of 4 valid cases instead of 5 (SEN-20, SEN-31, H-03).
const AT_FOUR: EngineParams = {
  ...DEFAULTS,
  sensitivity: { ...DEFAULTS.sensitivity, minValidCases: 4 },
};
// The game of case `n` starts `n` days after the first.
const FIRST_START = dayCount('2024-11-01') * MS_PER_DAY;

/** What every case holds besides its outcome: its origin and one event. */
function baseOf(caseId: number, origin: CaseOrigin) {
  return { caseId, origin, events: [{ researchConfidence: null }], isCoOccurring: false } as const;
}

/** The final gap of case `caseId`. */
function gapOf(caseId: number, normalizedGap: number) {
  return {
    measuredGameScheduledStartAt: FIRST_START + caseId * MS_PER_DAY,
    normalizedGap,
    gapStatus: 'final',
  } as const;
}

/** A valid case of gap `normalizedGap`. */
function validCase(caseId: number, origin: CaseOrigin, normalizedGap: number): OriginCase {
  return { ...baseOf(caseId, origin), ...gapOf(caseId, normalizedGap), status: 'measured' };
}

type Draw = Readonly<{ origin: CaseOrigin; status: OriginCase['status']; normalizedGap: number }>;

/** The case `caseId` of `draw`'s origin and status, of gap `normalizedGap` when it has one. */
function drawnCase(caseId: number, { origin, status, normalizedGap }: Draw): OriginCase {
  switch (status) {
    case 'awaiting_game': {
      return { ...baseOf(caseId, origin), status, statusReason: 'statistics_pending' };
    }
    case 'measured': {
      return validCase(caseId, origin, normalizedGap);
    }
    case 'excluded': {
      return {
        ...baseOf(caseId, origin),
        ...gapOf(caseId, normalizedGap),
        status,
        triggeredCriteria: ['playing_time_too_low'],
      };
    }
    case 'not_measurable': {
      return { ...baseOf(caseId, origin), status, statusReason: 'insufficient_baseline' };
    }
  }
}

/** The cases of `draws`, their ids given by their places. */
function drawnCases(draws: readonly Draw[]): readonly OriginCase[] {
  return draws.map((draw, caseId) => drawnCase(caseId, draw));
}

// Any cases of a player's profile, of either origin and any status and gap.
const anyCases = fc
  .array(
    fc.record({
      origin: fc.constantFrom<CaseOrigin>('historical', 'tracked'),
      status: fc.constantFrom<OriginCase['status']>(
        'awaiting_game',
        'measured',
        'excluded',
        'not_measurable',
      ),
      normalizedGap: fc.double({ min: -3, max: 3, noNaN: true }),
    }),
    { size: 'medium' },
  )
  .map(drawnCases);

/** Each view of a profile of `cases`, with no exit and no manual decision. */
function viewsOf(cases: readonly OriginCase[], params: EngineParams): readonly ProfileViewValues[] {
  return casesByView(cases, []).map((part) =>
    profileViewValues({ ...part, manuallyDecidedCases: [] }, params),
  );
}

describe('profileViewValues', () => {
  it('[SEN-21] [CL-SEN-19] counts in every view as many valid cases as its historical and tracked valid cases together, none of the other origin in a view of one origin', () => {
    fc.assert(
      fc.property(anyCases, (cases) => {
        const views = viewsOf(cases, DEFAULTS);
        expect(
          views.map(
            ({ tally, historicalValidCount, trackedValidCount }) =>
              tally.validCount - historicalValidCount - trackedValidCount,
          ),
        ).toStrictEqual([0, 0, 0]);
        expect([views[1]?.trackedValidCount, views[2]?.historicalValidCount]).toStrictEqual([0, 0]);
      }),
    );
  });

  it('[SEN-21] [CL-SEN-19] gives each view its valid cases of each origin, the cases awaiting, excluded or not measurable counted in none', () => {
    const cases = [
      ...[1.2, 1.4, 1.6].map((gap, caseId) => validCase(caseId, 'historical', gap)),
      ...[0.4, 0.8].map((gap, index) => validCase(3 + index, 'tracked', gap)),
      drawnCase(5, { origin: 'tracked', status: 'awaiting_game', normalizedGap: 0 }),
      drawnCase(6, { origin: 'historical', status: 'excluded', normalizedGap: 0.9 }),
      drawnCase(7, { origin: 'tracked', status: 'not_measurable', normalizedGap: 0 }),
    ];
    const views = viewsOf(cases, DEFAULTS).map(
      ({ view, tally, historicalValidCount, trackedValidCount }) => [
        view,
        tally.caseCount,
        historicalValidCount,
        trackedValidCount,
      ],
    );
    expect(views).toStrictEqual([
      ['all_cases', 8, 3, 2],
      ['historical_only', 4, 3, 0],
      ['tracked_only', 4, 0, 2],
    ]);
  });

  it('[SEN-20] [SEN-31] [H-03] gives each view the threshold of valid cases in force that its verdict applied: 4 valid cases are inconclusive at the default 5 and probable at 4', () => {
    const cases = [1.6, 1.8, 1.7, 1.5].map((gap, caseId) => validCase(caseId, 'historical', gap));
    const verdictsAt = (params: EngineParams) =>
      viewsOf(cases, params).map(({ view, tally, verdict, validCaseThreshold }) => [
        view,
        tally.validCount,
        verdict.level,
        validCaseThreshold,
      ]);
    expect(verdictsAt(DEFAULTS)).toStrictEqual([
      ['all_cases', 4, 'inconclusive', 5],
      ['historical_only', 4, 'inconclusive', 5],
      ['tracked_only', 0, 'inconclusive', 5],
    ]);
    expect(verdictsAt(AT_FOUR)).toStrictEqual([
      ['all_cases', 4, 'probable', 4],
      ['historical_only', 4, 'probable', 4],
      ['tracked_only', 0, 'inconclusive', 4],
    ]);
  });
});

// The values that the stores write from an evaluation, column by column and in the order
// of the data model: `cases` and its child rows (events-and-cases.md 1.7), then
// `sensitivity_profiles` and `general_trends` (sensitivity-and-profiles.md 1.1 to 1.3),
// whose values `profile_value_versions` copies (1.5). The identities, keys, instants of
// the database and the parameter snapshot are not the engine's.
describe('the stored values of an evaluation', () => {
  it('[SEN-07] [SEN-08] [SEN-10] [SEN-11] [SEN-16] [STA-12] gives a case every value of its row and of its child rows, and a case without a game null in each value of one', () => {
    // The type check verifies the values; the names of the nested rows read the case's.
    type Baseline = Exclude<EvaluatedCase['baseline'], null>;
    type Criterion = EvaluatedCase['triggeredCriteria'][number];
    expectTypeOf<EvaluatedCase>().toHaveProperty('eventTypeId').toExtend<string>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('origin').toExtend<string>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('status').toExtend<string>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('statusReason').toExtend<string | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('referenceInstantAt').toExtend<number | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('referenceInstantOrigin').toExtend<string>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('measuredGameId').toExtend<number | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('teamGamesMissedBefore').toExtend<number | null>();
    expectTypeOf<EvaluatedCase>()
      .toHaveProperty('playingTimeThresholdMinutes')
      .toExtend<number | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('measuredMinutes').toExtend<number | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('hasRoundedMinutes').toExtend<boolean | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('measuredGameScore').toExtend<number | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('performanceIndex').toExtend<number | null>();
    expectTypeOf<Baseline>().toHaveProperty('season').toExtend<string>();
    expectTypeOf<Baseline>().toHaveProperty('phase').toExtend<string>();
    expectTypeOf<Baseline>().toHaveProperty('gameCount').toExtend<number>();
    expectTypeOf<Baseline>().toHaveProperty('mean').toExtend<number | null>();
    expectTypeOf<Baseline>().toHaveProperty('standardDeviation').toExtend<number | null>();
    expectTypeOf<Baseline>().toHaveProperty('status').toExtend<string>();
    expectTypeOf<Baseline>().toHaveProperty('isPartial').toExtend<boolean>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('normalizedGap').toExtend<number | null>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('gapStatus').toExtend<string | null>();
    expectTypeOf<EvaluatedCase>()
      .toHaveProperty('opponentStrengthNotEvaluable')
      .toExtend<boolean>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('stakesNotEvaluable').toExtend<boolean>();
    expectTypeOf<Criterion>().toHaveProperty('criterion').toExtend<string>();
    expectTypeOf<Criterion>().toHaveProperty('condition').toExtend<string | null>();
    expectTypeOf<Criterion>()
      .toHaveProperty('triggeringValues')
      .toExtend<Readonly<Record<string, unknown>>>();
    expectTypeOf<EvaluatedCase>().toHaveProperty('reviewFlags').items.toExtend<string>();

    expect(NO_GAME.values).toStrictEqual({
      teamGamesMissedBefore: null,
      playingTimeThresholdMinutes: null,
      measuredMinutes: null,
      hasRoundedMinutes: null,
      measuredGameScore: null,
      performanceIndex: null,
      baseline: null,
    });
  });

  it('[SEN-20] [SEN-21] [SEN-28] [SEN-31] [CL-SEN-19] gives each view of a profile and of a general trend every value of its row, and a view without a case no quantities and the threshold in force', () => {
    // The type check verifies the values. A view of a profile or of a general trend: what
    // holds for both holds for each.
    type TrendView = EvaluatedTrend['views'][number];
    type View = ProfileViewValues | TrendView;
    type Tally = View['tally'];
    type Quantities = Exclude<View['quantities'], null>;
    type Control = Exclude<View['controlQuantities'], null>;
    expectTypeOf<View>().toHaveProperty('view').toExtend<string>();
    expectTypeOf<Tally>().toHaveProperty('eventCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('caseCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('groupedEventCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('awaitingCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('validCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('excludedCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('manuallyExcludedCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('notMeasurableCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('coOccurringCount').toExtend<number>();
    expectTypeOf<Tally>().toHaveProperty('provisionalGapCount').toExtend<number>();
    expectTypeOf<View>().toHaveProperty('historicalValidCount').toExtend<number>();
    expectTypeOf<View>().toHaveProperty('trackedValidCount').toExtend<number>();
    expectTypeOf<Tally>()
      .toHaveProperty('tallyReasons')
      .toExtend<Readonly<Record<string, unknown>>>();
    expectTypeOf<Tally>()
      .toHaveProperty('exitCounts')
      .toExtend<Readonly<Record<string, unknown>>>();
    expectTypeOf<Tally>().toHaveProperty('lowResearchConfidenceCount').toExtend<number>();
    expectTypeOf<Quantities>().toHaveProperty('meanGap').toExtend<number>();
    expectTypeOf<Quantities>().toHaveProperty('gapDispersion').toExtend<number | null>();
    expectTypeOf<Quantities>().toHaveProperty('retainedDispersion').toExtend<number>();
    expectTypeOf<Quantities>().toHaveProperty('expectedNoise').toExtend<number>();
    expectTypeOf<Quantities>().toHaveProperty('signalToNoise').toExtend<number>();
    expectTypeOf<Quantities>().toHaveProperty('rangeLow').toExtend<number>();
    expectTypeOf<Quantities>().toHaveProperty('rangeHigh').toExtend<number>();
    expectTypeOf<View>().toHaveProperty('aboveZeroCount').toExtend<number>();
    expectTypeOf<View>().toHaveProperty('belowZeroCount').toExtend<number>();
    expectTypeOf<View>().toHaveProperty('verdict').toHaveProperty('level').toExtend<string>();
    expectTypeOf<View>()
      .toHaveProperty('verdict')
      .toHaveProperty('direction')
      .toExtend<string | null>();
    expectTypeOf<View>().toHaveProperty('isFragile').toExtend<boolean>();
    expectTypeOf<View>().toHaveProperty('profileConfidence').toExtend<string>();
    expectTypeOf<View>().toHaveProperty('confidenceStepDownReasons').toExtend<readonly string[]>();
    expectTypeOf<View>().toHaveProperty('controlCaseCount').toExtend<number>();
    expectTypeOf<Control>().toHaveProperty('meanGap').toExtend<number>();
    expectTypeOf<Control>().toHaveProperty('rangeLow').toExtend<number>();
    expectTypeOf<Control>().toHaveProperty('rangeHigh').toExtend<number>();
    expectTypeOf<View>()
      .toHaveProperty('controlVerdict')
      .toHaveProperty('level')
      .toExtend<string>();
    expectTypeOf<View>()
      .toHaveProperty('controlVerdict')
      .toHaveProperty('direction')
      .toExtend<string | null>();
    expectTypeOf<View>().toHaveProperty('dependsOnManualExclusions').toExtend<boolean>();
    expectTypeOf<View>().toHaveProperty('validCaseThreshold').toExtend<number>();
    expectTypeOf<TrendView>().toHaveProperty('distinctPlayerCount').toExtend<number>();
    expectTypeOf<TrendView>().toHaveProperty('topContributorValidCount').toExtend<number>();

    expect(
      viewsOf([], DEFAULTS).map(({ quantities, controlQuantities, validCaseThreshold }) => [
        quantities,
        controlQuantities,
        validCaseThreshold,
      ]),
    ).toStrictEqual([
      [null, null, 5],
      [null, null, 5],
      [null, null, 5],
    ]);
  });
});

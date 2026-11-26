import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { dayCount, MS_PER_DAY } from '../calendar-days';
import { casesByView, evaluateTrend, hasProfiles, hasTallyEvent } from './evaluate-trend';
import { generalTrend } from './general-trend';

import type { EngineParams, PlayerId } from '../types';
import type { CaseOrigin, TrendEvaluationInput, TypeStatus } from './evaluate-trend';

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

// Three invented followed players, the third of them withdrawn.
const FIRST = '1a2b3c4d-0000-4000-8000-000000000001';
const SECOND = '1a2b3c4d-0000-4000-8000-000000000002';
const WITHDRAWN = '1a2b3c4d-0000-4000-8000-000000000003';
// The game of case `n` starts `n` days after the first.
const FIRST_START = dayCount('2024-11-01') * MS_PER_DAY;

type Case = TrendEvaluationInput['cases'][number];
type Owner = readonly [PlayerId, CaseOrigin];

/** What every case holds besides its outcome: its player, origin and one event. */
function baseOf(caseId: number, [playerId, origin]: Owner) {
  return {
    caseId,
    playerId,
    origin,
    events: [{ researchConfidence: null }],
    isCoOccurring: false,
  } satisfies Partial<Case>;
}

/** The gap of case `caseId`, final. */
function gapOf(caseId: number, normalizedGap: number) {
  return {
    measuredGameScheduledStartAt: FIRST_START + caseId * MS_PER_DAY,
    normalizedGap,
    gapStatus: 'final',
  } as const;
}

/** A valid case of gap `normalizedGap`. */
function validCase(caseId: number, owner: Owner, normalizedGap: number): Case {
  return { ...baseOf(caseId, owner), ...gapOf(caseId, normalizedGap), status: 'measured' };
}

const VALID = [
  validCase(0, [FIRST, 'historical'], 1.4),
  validCase(1, [FIRST, 'historical'], 1.6),
  validCase(2, [FIRST, 'tracked'], 1.5),
  validCase(3, [SECOND, 'historical'], 1.3),
  validCase(4, [SECOND, 'tracked'], 1.7),
  validCase(5, [WITHDRAWN, 'historical'], 1.2),
  validCase(6, [WITHDRAWN, 'tracked'], 1.8),
];
// A case of each origin that counts in no calculation (CL-SEN-08), and one excluded by hand.
const AWAITING: Case = {
  ...baseOf(7, [SECOND, 'tracked']),
  status: 'awaiting_game',
  statusReason: 'precedence_to_verify',
};
const NOT_MEASURABLE: Case = {
  ...baseOf(8, [WITHDRAWN, 'historical']),
  status: 'not_measurable',
  statusReason: 'precedence_not_established',
};
const MANUALLY_EXCLUDED: Case = {
  ...baseOf(9, [FIRST, 'tracked']),
  ...gapOf(9, 0.2),
  status: 'excluded',
  triggeredCriteria: ['manual'],
};
const INPUT: TrendEvaluationInput = {
  typeStatus: 'validated',
  cases: [...VALID, AWAITING, NOT_MEASURABLE, MANUALLY_EXCLUDED],
  exitReasons: ['merged', 'erased', 'merged'],
  manuallyDecidedCases: [{ caseId: 9, statusWithoutDecision: 'measured' }],
};

type Draw = Readonly<{ owner: Owner; status: Case['status']; normalizedGap: number }>;

/** The case `caseId` of `draw`'s owner and status, of gap `normalizedGap` when it has one. */
function drawnCase(caseId: number, { owner, status, normalizedGap }: Draw): Case {
  switch (status) {
    case 'awaiting_game': {
      return { ...baseOf(caseId, owner), status, statusReason: 'game_not_played_yet' };
    }
    case 'measured': {
      return validCase(caseId, owner, normalizedGap);
    }
    case 'excluded': {
      return {
        ...baseOf(caseId, owner),
        ...gapOf(caseId, normalizedGap),
        status,
        triggeredCriteria: ['opponent_strength'],
      };
    }
    case 'not_measurable': {
      return { ...baseOf(caseId, owner), status, statusReason: 'box_score_suspect' };
    }
  }
}

/** The cases of `draws`, their ids given by their places. */
function drawnCases(draws: readonly Draw[]): readonly Case[] {
  return draws.map((draw, caseId) => drawnCase(caseId, draw));
}

// Any of the three players with either origin.
const anyOwner = fc.tuple(
  fc.constantFrom(FIRST, SECOND, WITHDRAWN),
  fc.constantFrom<CaseOrigin>('historical', 'tracked'),
);
// Any cases of the three players, of either origin and any status and gap.
const anyCases = fc
  .array(
    fc.record({
      owner: anyOwner,
      status: fc.constantFrom<Case['status']>(
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

/** Each view of a trend as its valid cases, distinct players and verdict level. */
function summaryOf(input: TrendEvaluationInput) {
  return evaluateTrend(input, DEFAULTS)?.views.map((view) => [
    view.view,
    view.tally.validCount,
    view.distinctPlayerCount,
    view.verdict.level,
  ]);
}

/** Each view of the trend of INPUT at `params` as its valid cases, verdict and threshold. */
function verdictsOf(params: EngineParams) {
  return evaluateTrend(INPUT, params)?.views.map(({ view, tally, verdict, validCaseThreshold }) => [
    view,
    tally.validCount,
    verdict.level,
    validCaseThreshold,
  ]);
}

describe('evaluateTrend', () => {
  it('[SEN-28] [SEN-21] [CL-SEN-19] gives the trend of a type in its three views, each from the cases of every player of its origins with its valid cases of each origin, the exits counted in all cases alone', () => {
    const trend = evaluateTrend(INPUT, DEFAULTS);
    const { manuallyDecidedCases } = INPUT;
    const historical = INPUT.cases.filter(({ origin }) => origin === 'historical');
    const tracked = INPUT.cases.filter(({ origin }) => origin === 'tracked');
    expect(trend).toStrictEqual({
      isArchived: false,
      views: [
        {
          view: 'all_cases',
          ...generalTrend({ ...INPUT, cases: INPUT.cases }, DEFAULTS),
          historicalValidCount: 4,
          trackedValidCount: 3,
          validCaseThreshold: 5,
        },
        {
          view: 'historical_only',
          ...generalTrend({ cases: historical, exitReasons: [], manuallyDecidedCases }, DEFAULTS),
          historicalValidCount: 4,
          trackedValidCount: 0,
          validCaseThreshold: 5,
        },
        {
          view: 'tracked_only',
          ...generalTrend({ cases: tracked, exitReasons: [], manuallyDecidedCases }, DEFAULTS),
          historicalValidCount: 0,
          trackedValidCount: 3,
          validCaseThreshold: 5,
        },
      ],
    });
    expect(
      trend?.views.map(({ view, tally }) => [view, tally.eventCount, tally.exitCounts]),
    ).toStrictEqual([
      ['all_cases', 10, { merged: 2, erased: 1 }],
      ['historical_only', 5, {}],
      ['tracked_only', 5, {}],
    ]);
    expect(summaryOf(INPUT)).toStrictEqual([
      ['all_cases', 7, 3, 'probable'],
      ['historical_only', 4, 3, 'inconclusive'],
      ['tracked_only', 3, 3, 'inconclusive'],
    ]);
  });

  it('[SEN-21] [CL-SEN-19] counts in every view as many valid cases as its historical and tracked valid cases together, none of the other origin in a view of one origin', () => {
    fc.assert(
      fc.property(anyCases, (cases) => {
        const views = evaluateTrend({ ...INPUT, cases }, DEFAULTS)?.views ?? [];
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

  it('[SEN-20] [SEN-31] [SEN-28] gives each view the threshold of valid cases that its verdict applied, the parameter in force at this calculation', () => {
    const atFour = { ...DEFAULTS, sensitivity: { ...DEFAULTS.sensitivity, minValidCases: 4 } };
    expect(verdictsOf(DEFAULTS)).toStrictEqual([
      ['all_cases', 7, 'probable', 5],
      ['historical_only', 4, 'inconclusive', 5],
      ['tracked_only', 3, 'inconclusive', 5],
    ]);
    expect(verdictsOf(atFour)).toStrictEqual([
      ['all_cases', 7, 'probable', 4],
      ['historical_only', 4, 'possible', 4],
      ['tracked_only', 3, 'inconclusive', 4],
    ]);
  });

  it('[CL-SEN-08] [SEN-32] [SEN-44] keeps a case that counts in no calculation in the tally alone: no verdict, check, robustness test or confidence reads it', () => {
    const withoutThem = evaluateTrend(
      {
        ...INPUT,
        cases: INPUT.cases.filter((each) => each !== AWAITING && each !== NOT_MEASURABLE),
      },
      DEFAULTS,
    );
    const trend = evaluateTrend(INPUT, DEFAULTS);
    const [all, without] = [trend?.views[0], withoutThem?.views[0]];
    expect({ ...all, tally: null }).toStrictEqual({ ...without, tally: null });
    expect(all?.tally).toStrictEqual({
      ...without?.tally,
      eventCount: 10,
      caseCount: 10,
      awaitingCount: 1,
      notMeasurableCount: 1,
      tallyReasons: {
        ...without?.tally.tallyReasons,
        awaitingGame: Object.fromEntries([['precedence_to_verify', 1]]),
        notMeasurable: Object.fromEntries([['precedence_not_established', 1]]),
      },
    });
  });

  it('[CA-JOU-13] [JOU-19] [H-JOU-07] [SEN-29] counts the valid cases of a withdrawn player in the trend of the type', () => {
    const withoutHim: TrendEvaluationInput = {
      ...INPUT,
      cases: INPUT.cases.filter(({ playerId }) => playerId !== WITHDRAWN),
    };
    expect(summaryOf(withoutHim)?.[0]).toStrictEqual(['all_cases', 5, 2, 'inconclusive']);
    expect(summaryOf(INPUT)?.[0]).toStrictEqual(['all_cases', 7, 3, 'probable']);
  });

  it('[SEN-19] [CL-SEN-26] archives the trend of a withdrawn type and still computes it, and gives none to a proposed or rejected type or to a type whose tally holds no event', () => {
    const trend = evaluateTrend(INPUT, DEFAULTS);
    expect(evaluateTrend({ ...INPUT, typeStatus: 'withdrawn' }, DEFAULTS)).toStrictEqual({
      ...trend,
      isArchived: true,
    });
    expect(evaluateTrend({ ...INPUT, typeStatus: 'proposed' }, DEFAULTS)).toBeNull();
    expect(evaluateTrend({ ...INPUT, typeStatus: 'rejected' }, DEFAULTS)).toBeNull();
    const empty: TrendEvaluationInput = { ...INPUT, cases: [], exitReasons: [] };
    expect(evaluateTrend(empty, DEFAULTS)).toBeNull();
    const exitsOnly = evaluateTrend({ ...empty, exitReasons: ['dismissed'] }, DEFAULTS);
    expect(exitsOnly?.views.map(({ tally }) => [tally.eventCount, tally.exitCounts])).toStrictEqual(
      [
        [0, { dismissed: 1 }],
        [0, {}],
        [0, {}],
      ],
    );
  });
});

describe('hasProfiles', () => {
  it('[SEN-19] gives profiles and a trend to a validated or withdrawn type alone', () => {
    const statuses: readonly TypeStatus[] = ['proposed', 'validated', 'rejected', 'withdrawn'];
    expect(statuses.map((status) => hasProfiles(status))).toStrictEqual([false, true, false, true]);
  });
});

describe('hasTallyEvent', () => {
  it('[SEN-19] [CL-SEN-26] holds while a case or an exit is in the tally', () => {
    expect(hasTallyEvent([], [])).toBe(false);
    expect(hasTallyEvent([AWAITING], [])).toBe(true);
    expect(hasTallyEvent([], ['erased'])).toBe(true);
  });
});

describe('casesByView', () => {
  it('[SEN-21] [CL-SEN-19] puts each case in the views of its origin and the exits in all cases alone', () => {
    const first = validCase(0, [FIRST, 'historical'], 1.4);
    const second = validCase(2, [FIRST, 'tracked'], 1.5);
    expect(casesByView([first, second], ['merged'])).toStrictEqual([
      { view: 'all_cases', cases: [first, second], exitReasons: ['merged'] },
      { view: 'historical_only', cases: [first], exitReasons: [] },
      { view: 'tracked_only', cases: [second], exitReasons: [] },
    ]);
  });
});

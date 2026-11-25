import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { forecastAt, forecastVersions, frozenForecast, isAwaitingLateForecast } from './forecast';

import type { ProfileConfidence } from '../profiles/confidence';
import type { VerdictDirection } from '../profiles/verdict';
import type { EngineParams, EpochMs } from '../types';
import type {
  Forecast,
  ForecastHistory,
  ForecastVersion,
  ProfileValueVersion,
  ThresholdChange,
} from './forecast';

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
const THRESHOLD = DEFAULTS.sensitivity.minValidCases;

type ConclusiveVersion = Extract<ProfileValueVersion, { verdictLevel: 'possible' | 'probable' }>;
type ConclusiveValues = Partial<Omit<ConclusiveVersion, 'effectiveAt' | 'validCount'>>;

/** An inconclusive version of the historical-only view. */
function inconclusive(effectiveAt: EpochMs, validCount: number): ProfileValueVersion {
  return {
    effectiveAt,
    validCount,
    verdictLevel: 'inconclusive',
    verdictDirection: null,
    meanGap: validCount === 0 ? null : 0.12,
    profileConfidence: 'low',
  };
}

/** A possible or probable version, "possible, increase, +0.85, medium" unless named. */
function conclusive(
  effectiveAt: EpochMs,
  validCount: number,
  values: ConclusiveValues = {},
): ConclusiveVersion {
  return {
    effectiveAt,
    validCount,
    verdictLevel: 'possible',
    verdictDirection: 'increase',
    meanGap: 0.85,
    profileConfidence: 'medium',
    ...values,
  };
}

/** The forecast that `version` gives from `source`. */
function forecastFrom(source: Forecast['source'], version: ConclusiveVersion): Forecast {
  return {
    source,
    level: version.verdictLevel,
    direction: version.verdictDirection,
    announcedMeanGap: version.meanGap,
    caseCount: version.validCount,
    profileConfidence: version.profileConfidence,
  };
}

/** A history, each list empty unless named. */
function history(parts: Partial<ForecastHistory>): ForecastHistory {
  return { pairVersions: [], trendVersions: [], thresholdChanges: [], ...parts };
}

/** The defaults with another case threshold in force. */
function withThreshold(minValidCases: number): EngineParams {
  return { ...DEFAULTS, sensitivity: { ...DEFAULTS.sensitivity, minValidCases } };
}

const TREND = conclusive(0, 24, { meanGap: 0.42 });
const TREND_FORECAST = forecastFrom('general_trend', TREND);
const PAIR_POSSIBLE = conclusive(0, 6, { meanGap: 0.6, profileConfidence: 'low' });
const PAIR_FORECAST = forecastFrom('player_profile', PAIR_POSSIBLE);

describe('forecastAt', () => {
  it("[SUI-08] gives the pair's own possible or probable verdict once it has the case threshold of valid historical cases", () => {
    const atThreshold = conclusive(0, THRESHOLD, { profileConfidence: 'low' });
    const probable = conclusive(0, 12, {
      verdictLevel: 'probable',
      verdictDirection: 'decrease',
      meanGap: -0.61,
      profileConfidence: 'high',
    });

    expect(
      forecastAt(history({ pairVersions: [atThreshold], trendVersions: [TREND] }), 10, DEFAULTS),
    ).toStrictEqual({
      source: 'player_profile',
      level: 'possible',
      direction: 'increase',
      announcedMeanGap: 0.85,
      caseCount: 5,
      profileConfidence: 'low',
    });
    expect(
      forecastAt(history({ pairVersions: [probable], trendVersions: [TREND] }), 10, DEFAULTS),
    ).toStrictEqual({
      source: 'player_profile',
      level: 'probable',
      direction: 'decrease',
      announcedMeanGap: -0.61,
      caseCount: 12,
      profileConfidence: 'high',
    });
  });

  it('[SUI-08] [SEN-31] gives no forecast to a pair that reaches the threshold with an inconclusive verdict, whatever the trend', () => {
    const trend = conclusive(0, 30, { verdictLevel: 'probable' });
    const pair = inconclusive(0, THRESHOLD);

    expect(
      forecastAt(history({ pairVersions: [pair], trendVersions: [trend] }), 10, DEFAULTS),
    ).toBeNull();
  });

  it("[CA-SUI-06] gives no forecast to a pair of 9 valid cases and an inconclusive verdict beside a 'possible, increase' trend, and the trend's to a pair of 3", () => {
    const nine = history({ pairVersions: [inconclusive(0, 9)], trendVersions: [TREND] });
    const three = history({ pairVersions: [inconclusive(0, 3)], trendVersions: [TREND] });

    expect(forecastAt(nine, 10, DEFAULTS)).toBeNull();
    expect(forecastAt(three, 10, DEFAULTS)).toStrictEqual({
      source: 'general_trend',
      level: 'possible',
      direction: 'increase',
      announcedMeanGap: 0.42,
      caseCount: 24,
      profileConfidence: 'medium',
    });
  });

  it("[SUI-08] below the threshold, or without a profile, gives the type's historical trend when possible or probable, and no forecast otherwise", () => {
    const belowThreshold = conclusive(0, THRESHOLD - 1);
    const trend = conclusive(0, 31, {
      verdictLevel: 'probable',
      verdictDirection: 'decrease',
      meanGap: -0.47,
      profileConfidence: 'high',
    });
    const inconclusiveTrend = inconclusive(0, 31);

    expect(
      forecastAt(history({ pairVersions: [belowThreshold], trendVersions: [trend] }), 10, DEFAULTS),
    ).toStrictEqual(forecastFrom('general_trend', trend));
    expect(forecastAt(history({ trendVersions: [trend] }), 10, DEFAULTS)).toStrictEqual(
      forecastFrom('general_trend', trend),
    );
    expect(
      forecastAt(
        history({ pairVersions: [belowThreshold], trendVersions: [inconclusiveTrend] }),
        10,
        DEFAULTS,
      ),
    ).toBeNull();
    expect(forecastAt(history({ pairVersions: [belowThreshold] }), 10, DEFAULTS)).toBeNull();
  });

  it('[SUI-08] takes the versions in force at the instant, the last at or before it, given in any order', () => {
    const trend = conclusive(50, 30, { meanGap: 0.3 });
    const pairHistory = history({
      pairVersions: [
        conclusive(300, 7, { verdictLevel: 'probable' }),
        inconclusive(100, 3),
        { ...PAIR_POSSIBLE, effectiveAt: 200 },
      ],
      trendVersions: [trend],
    });

    expect(forecastAt(pairHistory, 40, DEFAULTS)).toBeNull();
    expect(forecastAt(pairHistory, 100, DEFAULTS)).toStrictEqual(
      forecastFrom('general_trend', trend),
    );
    expect(forecastAt(pairHistory, 200, DEFAULTS)).toStrictEqual(PAIR_FORECAST);
    expect(forecastAt(pairHistory, 299, DEFAULTS)).toStrictEqual(PAIR_FORECAST);
    expect(forecastAt(pairHistory, 300, DEFAULTS)?.level).toBe('probable');
  });

  it('[SUI-08] applies the case threshold in force at the instant, as the parameter history gives it', () => {
    const lowered: ThresholdChange = { changedAt: 200, oldValue: 3, newValue: 4 };
    const three = history({
      pairVersions: [conclusive(0, 3)],
      trendVersions: [TREND],
      thresholdChanges: [lowered],
    });
    const changes: ThresholdChange[] = [
      { changedAt: 400, oldValue: 5, newValue: 4 },
      { changedAt: 200, oldValue: 3, newValue: 5 },
    ];
    const four = history({
      pairVersions: [conclusive(0, 4)],
      trendVersions: [TREND],
      thresholdChanges: changes,
    });

    expect(forecastAt(three, 100, withThreshold(4))?.source).toBe('player_profile');
    expect(forecastAt(three, 200, withThreshold(4))?.source).toBe('general_trend');
    expect(forecastAt(four, 399, withThreshold(4))?.source).toBe('general_trend');
    expect(forecastAt(four, 400, withThreshold(4))?.source).toBe('player_profile');
  });

  it('[SUI-11] reads versions of the historical-only view alone, which admit no tracked count', () => {
    const version: ProfileValueVersion = {
      effectiveAt: 0,
      validCount: 3,
      verdictLevel: 'inconclusive',
      verdictDirection: null,
      meanGap: 0.12,
      profileConfidence: 'low',
      // @ts-expect-error -- a version counts historical valid cases only, never tracked ones
      trackedValidCount: 40,
    };
    const withoutTracked = history({ pairVersions: [inconclusive(0, 3)], trendVersions: [TREND] });

    expect(
      forecastAt(history({ pairVersions: [version], trendVersions: [TREND] }), 10, DEFAULTS),
    ).toStrictEqual(forecastAt(withoutTracked, 10, DEFAULTS));
    expect(forecastAt(withoutTracked, 10, DEFAULTS)?.source).toBe('general_trend');
  });

  it.each([
    ['pair', history({ pairVersions: [inconclusive(5, 1), inconclusive(5, 2)] })],
    ['trend', history({ trendVersions: [inconclusive(5, 1), inconclusive(5, 2)] })],
    [
      'threshold',
      history({
        thresholdChanges: [
          { changedAt: 5, oldValue: 5, newValue: 6 },
          { changedAt: 5, oldValue: 6, newValue: 7 },
        ],
      }),
    ],
  ])('[CL-SUI-03] refuses a %s history with two entries at one instant', (_list, twoAtOnce) => {
    expect(() => forecastAt(twoAtOnce, 10, DEFAULTS)).toThrow(
      'Two entries of one forecast history share an instant.',
    );
  });
});

describe('forecastVersions', () => {
  it('[CL-SUI-03] gives the first version at the creation instant, from the values in force then', () => {
    const earlier = history({
      pairVersions: [inconclusive(0, 2), { ...PAIR_POSSIBLE, effectiveAt: 50 }],
      trendVersions: [TREND],
    });

    expect(forecastVersions(earlier, 100, DEFAULTS)).toStrictEqual([
      { effectiveAt: 100, forecast: PAIR_FORECAST },
    ]);
  });

  it('[CL-SUI-03] [SUI-08] adds a version at each change of the pair, the trend or the threshold that changes the forecast, at its instant', () => {
    const trend = conclusive(150, 42, { meanGap: 0.3 });
    const pair = conclusive(200, 5, { meanGap: 0.6 });
    const changing = history({
      pairVersions: [pair, inconclusive(0, 3), inconclusive(120, 4), conclusive(170, 4)],
      trendVersions: [inconclusive(400, 43), inconclusive(0, 40), trend],
      thresholdChanges: [{ changedAt: 300, oldValue: 5, newValue: 6 }],
    });

    expect(forecastVersions(changing, 100, withThreshold(6))).toStrictEqual([
      { effectiveAt: 100, forecast: null },
      { effectiveAt: 150, forecast: forecastFrom('general_trend', trend) },
      { effectiveAt: 200, forecast: forecastFrom('player_profile', pair) },
      { effectiveAt: 300, forecast: forecastFrom('general_trend', trend) },
      { effectiveAt: 400, forecast: null },
    ]);
  });

  it.each([
    ['level', conclusive(100, 6, { meanGap: 0.5, verdictLevel: 'probable' })],
    ['direction', conclusive(100, 6, { meanGap: 0.5, verdictDirection: 'decrease' })],
    ['announced mean gap', conclusive(100, 6, { meanGap: 0.55 })],
    ['case count', conclusive(100, 7, { meanGap: 0.5 })],
    ['profile confidence', conclusive(100, 6, { meanGap: 0.5, profileConfidence: 'high' })],
  ])('[CL-SUI-03] adds a version when the forecast changes its %s alone', (_value, later) => {
    const pair = history({ pairVersions: [conclusive(0, 6, { meanGap: 0.5 }), later] });

    expect(forecastVersions(pair, 0, DEFAULTS).map((version) => version.effectiveAt)).toStrictEqual(
      [0, 100],
    );
  });

  it('[CL-SUI-03] [SUI-08] adds a version when the forecast changes its source alone', () => {
    const trend = conclusive(0, THRESHOLD, { meanGap: 0.5 });
    const pair = conclusive(0, THRESHOLD, { meanGap: 0.5 });
    const lowered = history({
      pairVersions: [pair],
      trendVersions: [trend],
      thresholdChanges: [{ changedAt: 100, oldValue: THRESHOLD + 1, newValue: THRESHOLD }],
    });

    expect(forecastVersions(lowered, 0, DEFAULTS)).toStrictEqual([
      { effectiveAt: 0, forecast: forecastFrom('general_trend', trend) },
      { effectiveAt: 100, forecast: forecastFrom('player_profile', pair) },
    ]);
  });
});

describe('frozenForecast', () => {
  const versions: ForecastVersion[] = [
    { effectiveAt: 300, forecast: TREND_FORECAST },
    { effectiveAt: 100, forecast: null },
    { effectiveAt: 200, forecast: PAIR_FORECAST },
  ];

  it('[CL-SUI-03] [CL-SUI-13] freezes the forecast of the last version strictly before the scheduled start', () => {
    expect(frozenForecast(versions, 250)).toStrictEqual({
      state: 'frozen',
      forecast: PAIR_FORECAST,
      frozenAt: 250,
    });
    expect(frozenForecast(versions, 300)).toStrictEqual({
      state: 'frozen',
      forecast: PAIR_FORECAST,
      frozenAt: 300,
    });
    expect(frozenForecast(versions, 301)).toStrictEqual({
      state: 'frozen',
      forecast: TREND_FORECAST,
      frozenAt: 301,
    });
  });

  it('[CL-SUI-03] freezes no forecast, source none, when the last version before the start gives none', () => {
    expect(frozenForecast(versions, 150)).toStrictEqual({
      state: 'none',
      source: 'none',
      frozenAt: 150,
    });
  });

  it('[CL-SUI-18] freezes no forecast, source none, when no version precedes the start', () => {
    expect(frozenForecast(versions, 100)).toStrictEqual({
      state: 'none',
      source: 'none',
      frozenAt: 100,
    });
    expect(frozenForecast([], 100)).toStrictEqual({ state: 'none', source: 'none', frozenAt: 100 });
  });

  it('[CL-SUI-03] [SUI-08] freezes the profile that a backtest made possible before tip-off, whatever follows', () => {
    const imported = history({
      pairVersions: [inconclusive(350, 7), inconclusive(0, 0), conclusive(200, 6)],
      trendVersions: [inconclusive(0, 30)],
    });

    expect(frozenForecast(forecastVersions(imported, 100, DEFAULTS), 300)).toStrictEqual({
      state: 'frozen',
      forecast: {
        source: 'player_profile',
        level: 'possible',
        direction: 'increase',
        announcedMeanGap: 0.85,
        caseCount: 6,
        profileConfidence: 'medium',
      },
      frozenAt: 300,
    });
  });
});

describe('isAwaitingLateForecast', () => {
  const noneLast: ForecastVersion[] = [
    { effectiveAt: 200, forecast: null },
    { effectiveAt: 100, forecast: PAIR_FORECAST },
    { effectiveAt: 300, forecast: TREND_FORECAST },
  ];

  it('[CL-SUI-05] awaits a late forecast when the last version before the start gives none and the historical data was not yet available', () => {
    expect(isAwaitingLateForecast(noneLast, 300, false)).toBe(true);
    expect(isAwaitingLateForecast(noneLast, 300, true)).toBe(false);
  });

  it('[CL-SUI-05] never awaits one when the last version before the start gives a forecast', () => {
    expect(isAwaitingLateForecast(noneLast, 200, false)).toBe(false);
    expect(isAwaitingLateForecast(noneLast, 301, false)).toBe(false);
  });

  it('[CL-SUI-18] never awaits one when no version precedes the start', () => {
    expect(isAwaitingLateForecast([{ effectiveAt: 300, forecast: null }], 300, false)).toBe(false);
    expect(isAwaitingLateForecast([], 300, false)).toBe(false);
  });
});

// --- Properties ------------------------------------------------------------------------

/** Past every instant that the properties draw. */
const END = 2000;
const anyInstant = fc.integer({ min: 0, max: 1000 });
const anyInconclusive = fc
  .record({ effectiveAt: anyInstant, validCount: fc.integer({ min: 0, max: 9 }) })
  .map(({ effectiveAt, validCount }) => inconclusive(effectiveAt, validCount));
const anyConclusive: fc.Arbitrary<ConclusiveVersion> = fc.record({
  effectiveAt: anyInstant,
  validCount: fc.integer({ min: 1, max: 9 }),
  verdictLevel: fc.constantFrom<ConclusiveVersion['verdictLevel']>('possible', 'probable'),
  verdictDirection: fc.constantFrom<VerdictDirection>('increase', 'decrease'),
  meanGap: fc.constantFrom(-0.6, 0.45, 0.85),
  profileConfidence: fc.constantFrom<ProfileConfidence>('low', 'medium', 'high'),
});
const anyVersion: fc.Arbitrary<ProfileValueVersion> = fc.oneof(anyInconclusive, anyConclusive);
const anyVersions = fc.uniqueArray(anyVersion, {
  selector: (version) => version.effectiveAt,
  maxLength: 6,
  size: 'max',
});

/** The case threshold before any change, and its changes in the order of their instants. */
type ThresholdHistory = Readonly<{ initial: number; changes: ThresholdChange[] }>;

const anyThresholdValue = fc.integer({ min: 3, max: 7 });
const anyThresholdHistory: fc.Arbitrary<ThresholdHistory> = fc
  .record({
    initial: anyThresholdValue,
    steps: fc.uniqueArray(fc.record({ changedAt: anyInstant, value: anyThresholdValue }), {
      selector: (step) => step.changedAt,
      maxLength: 4,
      size: 'max',
    }),
  })
  .map(({ initial, steps }) => {
    const sorted = steps.toSorted((left, right) => left.changedAt - right.changedAt);
    const changes = sorted.map((step, index) => ({
      changedAt: step.changedAt,
      oldValue: sorted[index - 1]?.value ?? initial,
      newValue: step.value,
    }));
    return { initial, changes };
  });

/** The parameters in force at `instant`: the threshold after the changes made by then. */
function paramsAt(threshold: ThresholdHistory, instant: EpochMs): EngineParams {
  const last = threshold.changes.findLast((change) => change.changedAt <= instant);
  return withThreshold(last?.newValue ?? threshold.initial);
}

const anyScenario = fc.record({
  pairVersions: anyVersions,
  trendVersions: anyVersions,
  threshold: anyThresholdHistory,
  createdAt: anyInstant,
});

type Scenario = typeof anyScenario extends fc.Arbitrary<infer S> ? S : never;

/** The whole history of a scenario. */
function historyOf(scenario: Scenario): ForecastHistory {
  return {
    pairVersions: scenario.pairVersions,
    trendVersions: scenario.trendVersions,
    thresholdChanges: scenario.threshold.changes,
  };
}

/** `items` in any order. */
function shuffled<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

// A scenario read at an instant after the start: what had arrived by then, in any order.
const anyReading = fc
  .record({ scenario: anyScenario, startAt: anyInstant, readAfter: fc.nat({ max: 1000 }) })
  .chain(({ scenario, startAt, readAfter }) => {
    const readAt = startAt + readAfter;
    return fc
      .record({
        pairVersions: shuffled(scenario.pairVersions.filter((v) => v.effectiveAt <= readAt)),
        trendVersions: shuffled(scenario.trendVersions.filter((v) => v.effectiveAt <= readAt)),
        thresholdChanges: shuffled(scenario.threshold.changes.filter((c) => c.changedAt <= readAt)),
      })
      .map((arrived) => ({ scenario, startAt, readAt, arrived }));
  });

describe('forecast properties', () => {
  it('[CL-SUI-03] gives versions that follow the forecast in force, from the creation instant on', () => {
    fc.assert(
      fc.property(anyScenario, fc.nat({ max: 1000 }), (scenario, offset) => {
        const params = paramsAt(scenario.threshold, END);
        const versions = forecastVersions(historyOf(scenario), scenario.createdAt, params);
        const instants = versions.map((version) => version.effectiveAt);
        const probe = scenario.createdAt + offset;
        const repeated = versions
          .slice(1)
          .filter((v, i) => JSON.stringify(v.forecast) === JSON.stringify(versions[i]?.forecast));

        expect(instants[0]).toBe(scenario.createdAt);
        expect(instants).toStrictEqual([...new Set(instants)].toSorted((a, b) => a - b));
        expect(repeated).toStrictEqual([]);
        expect(
          versions.findLast((version) => version.effectiveAt <= probe)?.forecast,
        ).toStrictEqual(forecastAt(historyOf(scenario), probe, params));
      }),
    );
  });

  it('[CL-SUI-03] freezes the same forecast whenever after the start, and in whatever order, the history is read', () => {
    fc.assert(
      fc.property(anyReading, ({ scenario, startAt, readAt, arrived }) => {
        const { createdAt, threshold } = scenario;
        const final = forecastVersions(historyOf(scenario), createdAt, paramsAt(threshold, END));
        const read = forecastVersions(arrived, createdAt, paramsAt(threshold, readAt));

        expect(frozenForecast(read.toReversed(), startAt)).toStrictEqual(
          frozenForecast(final, startAt),
        );
      }),
    );
  });

  it('[SUI-08] [SEN-31] lets the trend decide only for a pair below the threshold', () => {
    fc.assert(
      fc.property(anyVersion, anyVersion, (pair, trend) => {
        const reaching = { ...pair, validCount: THRESHOLD + pair.validCount };
        const below = { ...pair, validCount: Math.min(pair.validCount, THRESHOLD - 1) };

        expect(
          forecastAt(history({ pairVersions: [reaching], trendVersions: [trend] }), END, DEFAULTS),
        ).toStrictEqual(forecastAt(history({ pairVersions: [reaching] }), END, DEFAULTS));
        expect(
          forecastAt(history({ pairVersions: [below], trendVersions: [trend] }), END, DEFAULTS),
        ).toStrictEqual(forecastAt(history({ trendVersions: [trend] }), END, DEFAULTS));
      }),
    );
  });

  it('[CL-SUI-05] [CL-SUI-18] awaits a late forecast only without a frozen forecast, after a version, the data missing', () => {
    const anyForecastVersions = fc.uniqueArray(
      fc.record({ effectiveAt: anyInstant, forecast: fc.constantFrom(null, PAIR_FORECAST) }),
      { selector: (version) => version.effectiveAt, maxLength: 6, size: 'max' },
    );

    fc.assert(
      fc.property(anyForecastVersions, anyInstant, (versions, startAt) => {
        const isNone = frozenForecast(versions, startAt).state === 'none';
        const hasVersion = versions.some((version) => version.effectiveAt < startAt);

        expect(isAwaitingLateForecast(versions, startAt, true)).toBe(false);
        expect(isAwaitingLateForecast(versions, startAt, false)).toBe(isNone && hasVersion);
      }),
    );
  });
});

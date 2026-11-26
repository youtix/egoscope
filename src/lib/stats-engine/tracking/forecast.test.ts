import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { forecastAt, forecastVersions, frozenForecast, isAwaitingLateForecast } from './forecast';

import type { ProfileConfidence } from '../profiles/confidence';
import type { VerdictDirection } from '../profiles/verdict';
import type { EpochMs } from '../types';
import type {
  Forecast,
  ForecastFreeze,
  ForecastHistory,
  ForecastVersion,
  PairValueVersion,
  TrendValueVersion,
} from './forecast';

/** The case threshold of the calculation that gave a pair's version, unless named. */
const THRESHOLD = 5;

type ConclusiveVersion = Extract<TrendValueVersion, { verdictLevel: 'possible' | 'probable' }>;
type ConclusiveValues = Partial<Omit<ConclusiveVersion, 'effectiveAt' | 'validCount'>>;

/** An inconclusive version of the historical-only view, its identifier its instant unless named. */
function inconclusive(
  effectiveAt: EpochMs,
  validCount: number,
  id: number = effectiveAt,
): TrendValueVersion {
  return {
    id,
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
    id: effectiveAt,
    effectiveAt,
    validCount,
    verdictLevel: 'possible',
    verdictDirection: 'increase',
    meanGap: 0.85,
    profileConfidence: 'medium',
    ...values,
  };
}

/** `version` as a pair's version, calculated with the case threshold `validCaseThreshold`. */
function pair(version: TrendValueVersion, validCaseThreshold = THRESHOLD): PairValueVersion {
  return { ...version, validCaseThreshold };
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
  return { pairVersions: [], trendVersions: [], ...parts };
}

/** `forecast` frozen against a start at `frozenAt`. */
function frozen(forecast: Forecast, frozenAt: EpochMs): ForecastFreeze {
  return { state: 'frozen', forecast, frozenAt };
}

/** No forecast, source none, frozen against a start at `frozenAt`. */
function none(frozenAt: EpochMs): ForecastFreeze {
  return { state: 'none', source: 'none', frozenAt };
}

const TREND = conclusive(0, 24, { meanGap: 0.42 });
const TREND_FORECAST = forecastFrom('general_trend', TREND);
const PAIR_POSSIBLE = conclusive(0, 6, { meanGap: 0.6, profileConfidence: 'low' });
const PAIR_FORECAST = forecastFrom('player_profile', PAIR_POSSIBLE);

describe('forecastAt', () => {
  it("[SUI-08] gives the pair's own possible or probable verdict once it has the case threshold of valid historical cases", () => {
    const atThreshold = pair(conclusive(0, THRESHOLD, { profileConfidence: 'low' }));
    const probable = conclusive(0, 12, {
      verdictLevel: 'probable',
      verdictDirection: 'decrease',
      meanGap: -0.61,
      profileConfidence: 'high',
    });

    expect(
      forecastAt(history({ pairVersions: [atThreshold], trendVersions: [TREND] }), 10),
    ).toStrictEqual({
      source: 'player_profile',
      level: 'possible',
      direction: 'increase',
      announcedMeanGap: 0.85,
      caseCount: THRESHOLD,
      profileConfidence: 'low',
    });
    const probableHistory = history({ pairVersions: [pair(probable)], trendVersions: [TREND] });
    expect(forecastAt(probableHistory, 10)).toStrictEqual(forecastFrom('player_profile', probable));
  });

  it.each([
    { validCount: 4, validCaseThreshold: 4, source: 'player_profile' },
    { validCount: 3, validCaseThreshold: 4, source: 'general_trend' },
    { validCount: 7, validCaseThreshold: 7, source: 'player_profile' },
    { validCount: 6, validCaseThreshold: 7, source: 'general_trend' },
  ])(
    "[SUI-08] [CL-SEN-16] reads a pair of $validCount valid cases by its version's own threshold of $validCaseThreshold",
    ({ validCount, validCaseThreshold, source }) => {
      const version = pair(conclusive(0, validCount), validCaseThreshold);

      expect(
        forecastAt(history({ pairVersions: [version], trendVersions: [TREND] }), 10)?.source,
      ).toBe(source);
    },
  );

  it('[SUI-08] [SEN-31] gives no forecast to a pair that reaches the threshold with an inconclusive verdict, whatever the trend', () => {
    const trend = conclusive(0, 30, { verdictLevel: 'probable' });
    const reaching = pair(inconclusive(0, THRESHOLD));

    expect(
      forecastAt(history({ pairVersions: [reaching], trendVersions: [trend] }), 10),
    ).toBeNull();
  });

  it("[CA-SUI-06] gives no forecast to a pair of 9 valid cases and an inconclusive verdict beside a 'possible, increase' trend, and the trend's to a pair of 3", () => {
    const nine = history({ pairVersions: [pair(inconclusive(0, 9))], trendVersions: [TREND] });
    const three = history({ pairVersions: [pair(inconclusive(0, 3))], trendVersions: [TREND] });

    expect(forecastAt(nine, 10)).toBeNull();
    expect(forecastAt(three, 10)).toStrictEqual({
      source: 'general_trend',
      level: 'possible',
      direction: 'increase',
      announcedMeanGap: 0.42,
      caseCount: 24,
      profileConfidence: 'medium',
    });
  });

  it("[SUI-08] below the threshold, or without a profile, gives the type's historical trend when possible or probable, and no forecast otherwise", () => {
    const below = [pair(conclusive(0, THRESHOLD - 1))];
    const trend = conclusive(0, 31, {
      verdictLevel: 'probable',
      verdictDirection: 'decrease',
      meanGap: -0.47,
      profileConfidence: 'high',
    });
    const trendForecast = forecastFrom('general_trend', trend);

    expect(forecastAt(history({ pairVersions: below, trendVersions: [trend] }), 10)).toStrictEqual(
      trendForecast,
    );
    expect(forecastAt(history({ trendVersions: [trend] }), 10)).toStrictEqual(trendForecast);
    const inconclusiveTrend = [inconclusive(0, 31)];
    expect(
      forecastAt(history({ pairVersions: below, trendVersions: inconclusiveTrend }), 10),
    ).toBeNull();
    expect(forecastAt(history({ pairVersions: below }), 10)).toBeNull();
  });

  it('[SUI-08] takes the versions in force at the instant, the last at or before it, given in any order', () => {
    const trend = conclusive(50, 30, { meanGap: 0.3 });
    const pairHistory = history({
      pairVersions: [
        pair(conclusive(300, 7, { verdictLevel: 'probable' })),
        pair(inconclusive(100, 3)),
        pair({ ...PAIR_POSSIBLE, id: 200, effectiveAt: 200 }),
      ],
      trendVersions: [trend],
    });

    expect(forecastAt(pairHistory, 40)).toBeNull();
    expect(forecastAt(pairHistory, 100)).toStrictEqual(forecastFrom('general_trend', trend));
    expect(forecastAt(pairHistory, 200)).toStrictEqual(PAIR_FORECAST);
    expect(forecastAt(pairHistory, 299)).toStrictEqual(PAIR_FORECAST);
    expect(forecastAt(pairHistory, 300)?.level).toBe('probable');
  });

  it('[SUI-11] reads versions of the historical-only view alone, which admit no tracked count', () => {
    const version: PairValueVersion = {
      id: 1,
      effectiveAt: 0,
      validCount: 3,
      validCaseThreshold: THRESHOLD,
      verdictLevel: 'inconclusive',
      verdictDirection: null,
      meanGap: 0.12,
      profileConfidence: 'low',
      // @ts-expect-error -- a version counts historical valid cases only, never tracked ones
      trackedValidCount: 40,
    };
    const plain = history({ pairVersions: [pair(inconclusive(0, 3))], trendVersions: [TREND] });

    expect(
      forecastAt(history({ pairVersions: [version], trendVersions: [TREND] }), 10),
    ).toStrictEqual(forecastAt(plain, 10));
    expect(forecastAt(plain, 10)?.source).toBe('general_trend');
  });
});

describe('a change of the case threshold', () => {
  it("[SUI-08] [SUI-09] [CL-SEN-16] keeps the trend's forecast after the threshold is lowered at 100, until the pair is recomputed as possible at 150", () => {
    const lowered = history({
      pairVersions: [pair(conclusive(150, 4), 4), pair(inconclusive(0, 4), 5)],
      trendVersions: [TREND],
    });
    const recomputed = forecastFrom('player_profile', conclusive(150, 4));
    const versions = forecastVersions(lowered, 0);

    expect(forecastAt(lowered, 120)).toStrictEqual(TREND_FORECAST);
    expect(forecastAt(lowered, 150)).toStrictEqual(recomputed);
    expect(versions).toStrictEqual([
      { effectiveAt: 0, forecast: TREND_FORECAST },
      { effectiveAt: 150, forecast: recomputed },
    ]);
    expect(frozenForecast(versions, 120)).toStrictEqual(frozen(TREND_FORECAST, 120));
  });

  it("[SUI-08] [CL-SEN-16] keeps the pair's forecast after the threshold is raised, until the pair is recomputed at 150", () => {
    const raised = history({
      pairVersions: [pair(conclusive(150, 4), 5), pair(conclusive(0, 4), 4)],
      trendVersions: [TREND],
    });

    expect(forecastAt(raised, 149)).toStrictEqual(forecastFrom('player_profile', conclusive(0, 4)));
    expect(forecastAt(raised, 150)).toStrictEqual(TREND_FORECAST);
  });
});

describe('two versions at one instant', () => {
  const possible = forecastFrom('player_profile', conclusive(100, 6));
  const possibleSeven = pair(conclusive(100, 6, { id: 7 }));
  const possibleNine = pair(conclusive(100, 6, { id: 9 }));
  const inconclusiveSeven = pair(inconclusive(100, 6, 7));
  const inconclusiveNine = pair(inconclusive(100, 6, 9));

  it.each([
    { winner: '9 possible', first: inconclusiveSeven, second: possibleNine, forecast: possible },
    { winner: '9 possible', first: possibleNine, second: inconclusiveSeven, forecast: possible },
    { winner: '9 inconclusive', first: possibleSeven, second: inconclusiveNine, forecast: null },
    { winner: '9 inconclusive', first: inconclusiveNine, second: possibleSeven, forecast: null },
  ])(
    '[CL-SUI-03] takes the pair version of the greater identifier, $winner, in either order of arrival',
    ({ first, second, forecast }) => {
      const shared = history({ pairVersions: [first, second], trendVersions: [TREND] });

      expect(forecastAt(shared, 99)).toStrictEqual(TREND_FORECAST);
      expect(forecastAt(shared, 100)).toStrictEqual(forecast);
      expect(forecastVersions(shared, 0)).toStrictEqual([
        { effectiveAt: 0, forecast: TREND_FORECAST },
        { effectiveAt: 100, forecast },
      ]);
    },
  );

  it('[CL-SUI-03] orders versions by their instants first, whatever their identifiers', () => {
    const later = conclusive(100, 6, { id: 3, meanGap: 0.5 });
    const crossed = history({
      pairVersions: [pair(later), pair(inconclusive(50, 6, 8))],
      trendVersions: [TREND],
    });

    expect(forecastAt(crossed, 60)).toBeNull();
    expect(forecastAt(crossed, 100)).toStrictEqual(forecastFrom('player_profile', later));
    expect(forecastVersions(crossed, 0).map((version) => version.effectiveAt)).toStrictEqual([
      0, 50, 100,
    ]);
  });

  it.each([
    { first: conclusive(100, 30, { id: 4, meanGap: 0.3 }), second: inconclusive(100, 31, 3) },
    { first: inconclusive(100, 31, 3), second: conclusive(100, 30, { id: 4, meanGap: 0.3 }) },
  ])(
    '[CL-SUI-03] takes the trend version of the greater identifier at a shared instant, in either order',
    ({ first, second }) => {
      const shared = history({ trendVersions: [first, second] });
      const four = forecastFrom('general_trend', conclusive(100, 30, { meanGap: 0.3 }));

      expect(forecastAt(shared, 100)).toStrictEqual(four);
      expect(forecastVersions(shared, 0)).toStrictEqual([
        { effectiveAt: 0, forecast: null },
        { effectiveAt: 100, forecast: four },
      ]);
    },
  );

  it('[CL-SUI-03] gives one forecast version at an instant that a pair version and a trend version share, of one identifier', () => {
    const trend = conclusive(100, 40, { id: 5, meanGap: 0.3 });
    const below = pair(conclusive(100, THRESHOLD - 1, { id: 5 }));
    const reaching = pair(conclusive(100, THRESHOLD, { id: 5 }));

    expect(
      forecastVersions(history({ pairVersions: [below], trendVersions: [trend] }), 0),
    ).toStrictEqual([
      { effectiveAt: 0, forecast: null },
      { effectiveAt: 100, forecast: forecastFrom('general_trend', trend) },
    ]);
    expect(
      forecastAt(history({ pairVersions: [reaching], trendVersions: [trend] }), 100)?.source,
    ).toBe('player_profile');
  });
});

describe('forecastVersions', () => {
  it('[CL-SUI-03] gives the first version at the creation instant, from the values in force then', () => {
    const earlier = history({
      pairVersions: [pair(inconclusive(0, 2)), pair({ ...PAIR_POSSIBLE, id: 50, effectiveAt: 50 })],
      trendVersions: [TREND],
    });

    expect(forecastVersions(earlier, 100)).toStrictEqual([
      { effectiveAt: 100, forecast: PAIR_FORECAST },
    ]);
  });

  it('[CL-SUI-03] [SUI-08] adds a version at each change of the pair or the trend that changes the forecast, at its instant', () => {
    const trend = conclusive(150, 42, { meanGap: 0.3 });
    const reaching = conclusive(200, 6, { meanGap: 0.6 });
    const changing = history({
      pairVersions: [
        pair(reaching, 6),
        pair(inconclusive(0, 3), 6),
        pair(inconclusive(120, 4), 6),
        pair(conclusive(170, 4), 6),
        pair(conclusive(300, 6, { meanGap: 0.6 }), 7),
      ],
      trendVersions: [inconclusive(400, 43), inconclusive(0, 40), trend],
    });

    expect(forecastVersions(changing, 100)).toStrictEqual([
      { effectiveAt: 100, forecast: null },
      { effectiveAt: 150, forecast: forecastFrom('general_trend', trend) },
      { effectiveAt: 200, forecast: forecastFrom('player_profile', reaching) },
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
    const changing = history({
      pairVersions: [pair(conclusive(0, 6, { meanGap: 0.5 })), pair(later)],
    });

    expect(forecastVersions(changing, 0).map((version) => version.effectiveAt)).toStrictEqual([
      0, 100,
    ]);
  });

  it('[CL-SUI-03] [SUI-08] adds a version when the forecast changes its source alone', () => {
    const trend = conclusive(0, THRESHOLD, { meanGap: 0.5 });
    const reaching = conclusive(100, THRESHOLD, { meanGap: 0.5 });
    const recomputed = history({
      pairVersions: [
        pair(conclusive(0, THRESHOLD, { meanGap: 0.5 }), THRESHOLD + 1),
        pair(reaching),
      ],
      trendVersions: [trend],
    });

    expect(forecastVersions(recomputed, 0)).toStrictEqual([
      { effectiveAt: 0, forecast: forecastFrom('general_trend', trend) },
      { effectiveAt: 100, forecast: forecastFrom('player_profile', reaching) },
    ]);
  });
});

describe('frozenForecast', () => {
  const versions: ForecastVersion[] = [
    { effectiveAt: 300, forecast: TREND_FORECAST },
    { effectiveAt: 100, forecast: null },
    { effectiveAt: 200, forecast: PAIR_FORECAST },
  ];

  it('[SUI-09] [CL-SUI-03] [CL-SUI-13] freezes the forecast of the last version strictly before the scheduled start', () => {
    expect(frozenForecast(versions, 250)).toStrictEqual(frozen(PAIR_FORECAST, 250));
    expect(frozenForecast(versions, 300)).toStrictEqual(frozen(PAIR_FORECAST, 300));
    expect(frozenForecast(versions, 301)).toStrictEqual(frozen(TREND_FORECAST, 301));
  });

  it('[CL-SUI-03] [CL-SUI-18] freezes no forecast, source none, when the last version before the start gives none or no version precedes it', () => {
    expect(frozenForecast(versions, 150)).toStrictEqual(none(150));
    expect(frozenForecast(versions, 100)).toStrictEqual(none(100));
    expect(frozenForecast([], 90)).toStrictEqual(none(90));
  });

  it('[SUI-09] [CL-SUI-03] [SUI-08] freezes the profile that a backtest made possible before tip-off, whatever follows', () => {
    const possible = conclusive(200, 6);
    const imported = history({
      pairVersions: [pair(inconclusive(350, 7)), pair(inconclusive(0, 0)), pair(possible)],
      trendVersions: [inconclusive(0, 30)],
    });
    const forecast = forecastFrom('player_profile', possible);

    expect(frozenForecast(forecastVersions(imported, 100), 300)).toStrictEqual(
      frozen(forecast, 300),
    );
  });

  it('[CL-SUI-03] refuses two forecast versions at one instant, a bug of the caller', () => {
    const twoAtOnce: ForecastVersion[] = [
      { effectiveAt: 100, forecast: null },
      { effectiveAt: 100, forecast: PAIR_FORECAST },
    ];

    expect(() => frozenForecast(twoAtOnce, 200)).toThrow('Two forecast versions share an instant.');
    expect(() => isAwaitingLateForecast(twoAtOnce, 200, false)).toThrow(
      'Two forecast versions share an instant.',
    );
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
/** The instants of the versions, narrow so that two versions of one list often share one. */
const anyInstant = fc.integer({ min: 0, max: 12 });
const anyId = fc.nat({ max: 1000 });
const anyInconclusive = fc
  .record({ id: anyId, effectiveAt: anyInstant, validCount: fc.integer({ min: 0, max: 9 }) })
  .map(({ id, effectiveAt, validCount }) => inconclusive(effectiveAt, validCount, id));
const anyConclusive: fc.Arbitrary<ConclusiveVersion> = fc.record({
  id: anyId,
  effectiveAt: anyInstant,
  validCount: fc.integer({ min: 1, max: 9 }),
  verdictLevel: fc.constantFrom<ConclusiveVersion['verdictLevel']>('possible', 'probable'),
  verdictDirection: fc.constantFrom<VerdictDirection>('increase', 'decrease'),
  meanGap: fc.constantFrom(-0.6, 0.45, 0.85),
  profileConfidence: fc.constantFrom<ProfileConfidence>('low', 'medium', 'high'),
});
const anyTrendVersion: fc.Arbitrary<TrendValueVersion> = fc.oneof(anyInconclusive, anyConclusive);
const anyPairVersion: fc.Arbitrary<PairValueVersion> = fc
  .tuple(anyTrendVersion, fc.integer({ min: 1, max: 7 }))
  .map(([version, validCaseThreshold]) => pair(version, validCaseThreshold));

/** Versions of one list, their identifiers distinct, their instants often shared. */
function anyList<V extends TrendValueVersion | PairValueVersion>(
  version: fc.Arbitrary<V>,
): fc.Arbitrary<V[]> {
  return fc.uniqueArray(version, { selector: (v) => v.id, maxLength: 6, size: 'max' });
}

const anyScenario = fc.record({
  pairVersions: anyList(anyPairVersion),
  trendVersions: anyList(anyTrendVersion),
  createdAt: anyInstant,
});

/** `items` in any order. */
function shuffled<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

// A scenario read at an instant after the start: what had arrived by then, in any order.
const anyReading = fc
  .record({ scenario: anyScenario, startAt: anyInstant, readAfter: fc.nat({ max: 12 }) })
  .chain(({ scenario, startAt, readAfter }) => {
    const readAt = startAt + readAfter;
    return fc
      .record({
        pairVersions: shuffled(scenario.pairVersions.filter((v) => v.effectiveAt <= readAt)),
        trendVersions: shuffled(scenario.trendVersions.filter((v) => v.effectiveAt <= readAt)),
      })
      .map((arrived) => ({ scenario, startAt, arrived }));
  });

describe('forecast properties', () => {
  it('[CL-SUI-03] gives versions that follow the forecast in force, from the creation instant on', () => {
    fc.assert(
      fc.property(anyScenario, fc.nat({ max: 20 }), (scenario, offset) => {
        const versions = forecastVersions(scenario, scenario.createdAt);
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
        ).toStrictEqual(forecastAt(scenario, probe));
      }),
    );
  });

  it('[SUI-09] [CL-SUI-03] freezes the same forecast whenever after the start, and in whatever order, the history is read, versions at a shared instant included', () => {
    fc.assert(
      fc.property(anyReading, ({ scenario, startAt, arrived }) => {
        const final = forecastVersions(scenario, scenario.createdAt);
        const read = forecastVersions(arrived, scenario.createdAt);

        expect(frozenForecast(read.toReversed(), startAt)).toStrictEqual(
          frozenForecast(final, startAt),
        );
      }),
    );
  });

  it('[SUI-08] [SEN-31] lets the trend decide only for a pair below its threshold', () => {
    fc.assert(
      fc.property(anyPairVersion, anyTrendVersion, (version, trend) => {
        const { validCount, validCaseThreshold } = version;
        const reaching = { ...version, validCount: validCaseThreshold + validCount };
        const below = { ...version, validCount: Math.min(validCount, validCaseThreshold - 1) };

        expect(
          forecastAt(history({ pairVersions: [reaching], trendVersions: [trend] }), END),
        ).toStrictEqual(forecastAt(history({ pairVersions: [reaching] }), END));
        expect(
          forecastAt(history({ pairVersions: [below], trendVersions: [trend] }), END),
        ).toStrictEqual(forecastAt(history({ trendVersions: [trend] }), END));
      }),
    );
  });

  it('[CL-SUI-05] [CL-SUI-18] awaits a late forecast only without a frozen forecast, after a version, the data missing', () => {
    const anyStart = fc.integer({ min: 0, max: 1000 });
    const anyForecastVersions = fc.uniqueArray(
      fc.record({ effectiveAt: anyStart, forecast: fc.constantFrom(null, PAIR_FORECAST) }),
      { selector: (version) => version.effectiveAt, maxLength: 6, size: 'max' },
    );

    fc.assert(
      fc.property(anyForecastVersions, anyStart, (versions, startAt) => {
        const isNone = frozenForecast(versions, startAt).state === 'none';
        const hasVersion = versions.some((version) => version.effectiveAt < startAt);

        expect(isAwaitingLateForecast(versions, startAt, true)).toBe(false);
        expect(isAwaitingLateForecast(versions, startAt, false)).toBe(isNone && hasVersion);
      }),
    );
  });
});

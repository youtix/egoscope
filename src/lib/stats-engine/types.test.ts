import { describe, expect, expectTypeOf, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import type {
  BacktestRequestId,
  BaselinePhase,
  CaseId,
  EngineParams,
  EpochMs,
  EventTypeId,
  GameId,
  IsoDate,
  PlayerEventId,
  PlayerId,
  SeriesId,
  TeamId,
} from './types';

// The keys the parameter registry marks as influencing calculations (module map,
// section 6), in its order, but `taxonomy.switchedOffCriterion`: that one has no value
// of its own, since the switch lives on each type sheet.
const CALC_KEYS = [
  'games.minutesFloor',
  'games.minutesAverageShare',
  'games.minBaselineGames',
  'games.postseasonBaseline',
  'games.partialBaselineShare',
  'games.dailyUpdateDelayHours',
  'games.correctionWindowDays',
  'games.boxScoreUnavailableAfterDays',
  'games.retryFirstDelayHours',
  'games.retryIntervalHours',
  'games.incidentAfterHours',
  'games.quotaReserveShare',
  'sensitivity.maxAttachmentDays',
  'sensitivity.coOccurringCasesDoubtful',
  'sensitivity.injuryReturnMinGamesMissed',
  'sensitivity.injuryReturnFirstGames',
  'sensitivity.allPlayoffGamesUnusualStakes',
  'sensitivity.opponentWinShareLow',
  'sensitivity.opponentWinShareHigh',
  'sensitivity.opponentMinGames',
  'sensitivity.minValidCases',
  'sensitivity.possibleSignalToNoise',
  'sensitivity.possibleMeanGap',
  'sensitivity.probableSignalToNoise',
  'sensitivity.probableMeanGap',
  'sensitivity.confidenceMediumFromCases',
  'sensitivity.confidenceHighFromCases',
  'sensitivity.confidenceDispersionDrop',
  'sensitivity.confidenceDoubtfulShareDrop',
  'sensitivity.trendMinPlayers',
  'sensitivity.trendMaxTopShare',
  'sensitivity.countsBelowCases',
  'tracking.categoryThreshold',
  'tracking.minTrackedCasesForAssessment',
];

// The two baseline phases, which a JSON string must be one of.
const BASELINE_PHASES: readonly BaselinePhase[] = ['postseason', 'regular_season'];

// The registry's defaults, held once in data/fixtures/stats-engine/engine-params.json for
// every test of the engine. JSON gives the baseline phase as a string, which the comparison
// narrows to a BaselinePhase, so the type check holds the whole fixture to EngineParams and
// refuses it when an EngineParams key is missing; the test below refuses an added key.
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

/** The registry key of each value of `params`: its family, a dot, its name. */
const keysOf = (params: Readonly<Record<string, object>>): readonly string[] =>
  Object.entries(params).flatMap(([family, values]) =>
    Object.keys(values).map((name) => `${family}.${name}`),
  );

describe('the shared engine types', () => {
  it('take instants, dates and identifiers as plain values, and each calculation parameter under its registry key, its default held once', () => {
    // The type check verifies these: the core receives plain numbers and strings, which
    // the time module's branded values are too, a brand being a property of the type only.
    type Branded<T> = T & { readonly brand: true };

    expectTypeOf<[EpochMs, IsoDate]>().toEqualTypeOf<[number, string]>();
    expectTypeOf<[Branded<number>, Branded<string>]>().toExtend<[EpochMs, IsoDate]>();
    expectTypeOf<[PlayerId, EventTypeId]>().toEqualTypeOf<[string, string]>();
    expectTypeOf<
      [PlayerEventId, CaseId, GameId, TeamId, SeriesId, BacktestRequestId]
    >().toEqualTypeOf<[number, number, number, number, number, number]>();
    expectTypeOf<BaselinePhase>().toEqualTypeOf<'postseason' | 'regular_season'>();

    // The fixture's own keys, in the registry's order: one more or one less fails.
    expect(keysOf(engineParams)).toStrictEqual(CALC_KEYS);
    expect(keysOf(DEFAULTS)).toStrictEqual(CALC_KEYS);
    expect(BASELINE_PHASES).toContain(engineParams.games.postseasonBaseline);
    expect(DEFAULTS.games.postseasonBaseline).toBe(engineParams.games.postseasonBaseline);
  });
});

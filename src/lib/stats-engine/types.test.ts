import { describe, expect, expectTypeOf, it } from 'vitest';

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

// The registry's defaults. The type check refuses a key that EngineParams lacks, and an
// EngineParams key missing here.
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

/** The registry key of each value of `params`: its family, a dot, its name. */
const keysOf = (params: EngineParams): readonly string[] =>
  Object.entries(params).flatMap(([family, values]) =>
    Object.keys(values).map((name) => `${family}.${name}`),
  );

describe('the shared engine types', () => {
  it('take instants, dates and identifiers as plain values, and each calculation parameter under its registry key', () => {
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

    expect(keysOf(DEFAULTS)).toStrictEqual(CALC_KEYS);
  });
});

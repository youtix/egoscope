// The calculation parameters as the engine reads them (TRV-35, SEN-36): those in force,
// and those of a parameter snapshot, the values that a stored profile or trend was
// computed with, so that a result is reproduced on read with the values that made it.
import { z } from 'zod';

import { getParams, storedValueOf } from '@/lib/params';

import type { Database, Transaction } from '@/lib/db';
import type { ParamReader } from '@/lib/params';
import type { EngineParams } from '@/lib/stats-engine';

// A snapshot's values, by registry key (snapshotCalculationParams of `@/lib/params`).
const SNAPSHOT_VALUES = z.record(z.string(), z.unknown());

/** The engine's parameters, grouped and named by registry key, from `params` (TRV-35). */
function engineParamsOf(params: ParamReader): EngineParams {
  return {
    games: {
      minutesFloor: params.get('games.minutesFloor'),
      minutesAverageShare: params.get('games.minutesAverageShare'),
      minBaselineGames: params.get('games.minBaselineGames'),
      postseasonBaseline: params.get('games.postseasonBaseline'),
      partialBaselineShare: params.get('games.partialBaselineShare'),
      dailyUpdateDelayHours: params.get('games.dailyUpdateDelayHours'),
      correctionWindowDays: params.get('games.correctionWindowDays'),
      boxScoreUnavailableAfterDays: params.get('games.boxScoreUnavailableAfterDays'),
      retryFirstDelayHours: params.get('games.retryFirstDelayHours'),
      retryIntervalHours: params.get('games.retryIntervalHours'),
      incidentAfterHours: params.get('games.incidentAfterHours'),
      quotaReserveShare: params.get('games.quotaReserveShare'),
    },
    sensitivity: {
      maxAttachmentDays: params.get('sensitivity.maxAttachmentDays'),
      coOccurringCasesDoubtful: params.get('sensitivity.coOccurringCasesDoubtful'),
      injuryReturnMinGamesMissed: params.get('sensitivity.injuryReturnMinGamesMissed'),
      injuryReturnFirstGames: params.get('sensitivity.injuryReturnFirstGames'),
      allPlayoffGamesUnusualStakes: params.get('sensitivity.allPlayoffGamesUnusualStakes'),
      opponentWinShareLow: params.get('sensitivity.opponentWinShareLow'),
      opponentWinShareHigh: params.get('sensitivity.opponentWinShareHigh'),
      opponentMinGames: params.get('sensitivity.opponentMinGames'),
      minValidCases: params.get('sensitivity.minValidCases'),
      possibleSignalToNoise: params.get('sensitivity.possibleSignalToNoise'),
      possibleMeanGap: params.get('sensitivity.possibleMeanGap'),
      probableSignalToNoise: params.get('sensitivity.probableSignalToNoise'),
      probableMeanGap: params.get('sensitivity.probableMeanGap'),
      confidenceMediumFromCases: params.get('sensitivity.confidenceMediumFromCases'),
      confidenceHighFromCases: params.get('sensitivity.confidenceHighFromCases'),
      confidenceDispersionDrop: params.get('sensitivity.confidenceDispersionDrop'),
      confidenceDoubtfulShareDrop: params.get('sensitivity.confidenceDoubtfulShareDrop'),
      trendMinPlayers: params.get('sensitivity.trendMinPlayers'),
      trendMaxTopShare: params.get('sensitivity.trendMaxTopShare'),
      countsBelowCases: params.get('sensitivity.countsBelowCases'),
    },
    tracking: {
      categoryThreshold: params.get('tracking.categoryThreshold'),
      minTrackedCasesForAssessment: params.get('tracking.minTrackedCasesForAssessment'),
    },
  };
}

/** The engine's parameters in force: the owner's overrides, else the registry's defaults (TRV-34, TRV-35). */
export async function paramsInForce(db: Database | Transaction): Promise<EngineParams> {
  return engineParamsOf(await getParams(db));
}

/**
 * The engine's parameters that a snapshot holds, the `values` of a `parameter_snapshots`
 * row (SEN-36, TRV-35): a value that the snapshot lacks, or that the registry no longer
 * accepts, is the registry's default.
 */
export function snapshotParams(values: unknown): EngineParams {
  const stored = SNAPSHOT_VALUES.parse(values);
  return engineParamsOf({ get: (key) => storedValueOf(key, stored[key]) });
}

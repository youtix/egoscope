import { getParams, listRegistry, setParam } from '@/lib/params';

import { firstRow, present } from '../rows';

import type { Database } from '@/lib/db';
import type { Lot, OverridableKey, ParamValue } from '@/lib/params';
import type { EngineParams } from '@/lib/stats-engine';

// The last lot, whose registry lists every key.
const EVERY_LOT: Lot = 2;

/**
 * Saves `value` as the owner's value of `key`, as the parameters screen saves it (TRV-35):
 * through the registry, from the version in force, in a transaction of its own that nests
 * in the caller's when `db` is one, so that the history of the parameter and the journal
 * record the change. A refusal can only be a bug of the caller, and is thrown.
 */
export async function setOwnerParam<K extends OverridableKey>(
  db: Database,
  key: K,
  value: ParamValue<K>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await listRegistry(tx, EVERY_LOT);
    const row = firstRow(
      rows.filter((entry) => entry.key === key),
      `the parameter ${key}`,
    );
    const { version } = present(row.setting, `the setting of ${key}`);
    const saved = await setParam(tx, { key, value, expectedVersion: version });
    if (!saved.ok) {
      throw new Error(
        `The registry refused ${key} = ${JSON.stringify(value)}: ${JSON.stringify(saved.error)}`,
      );
    }
  });
}

/**
 * The engine's parameters in force in `db`, in the shape the engine reads them: the
 * owner's overrides over the registry's defaults (TRV-34, TRV-36), so that what the
 * factories measure agrees with the engine's inputs whatever the database holds.
 */
export async function engineParamsOf(db: Database): Promise<EngineParams> {
  const params = await getParams(db);
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

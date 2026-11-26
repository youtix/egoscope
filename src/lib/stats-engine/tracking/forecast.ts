// The forecast of a tracked case (SUI-08 to SUI-11, CL-SUI-03, CL-SUI-05, CL-SUI-18): the
// forecast it would get at an instant from the historical-only profile of its pair and the
// historical-only trend of its type, the forecast versions that their histories imply, the
// choice of a forecast against the measured game's scheduled start, and whether the case
// awaits a late forecast. Every input is a version of the historical-only view, whose rows
// are never updated, so a version takes the instant of the change that made it, whatever
// the timing of the run that reads it. A pair's version carries the case threshold of the
// calculation that gave it, so a change of the threshold reaches a forecast only through the
// versions that the recalculation writes (CL-SEN-16).

import type { ProfileConfidence } from '../profiles/confidence';
import type { VerdictDirection, VerdictLevel } from '../profiles/verdict';
import type { EpochMs } from '../types';

/** A possible or probable verdict's level, the only levels that give a forecast (SUI-08). */
type ConclusiveLevel = Exclude<VerdictLevel, 'inconclusive'>;

/**
 * The values of a version of the historical-only view, one row of `profile_value_versions`
 * (SUI-08, SUI-11, CL-SUI-03): its row identifier, an increasing integer, and the values in
 * force from its instant on. Its valid cases are historical ones only, and it holds no count
 * of tracked cases, so neither the case nor any other tracked case can enter a forecast.
 */
type ValueVersion = Readonly<{
  id: number;
  effectiveAt: EpochMs;
  validCount: number;
  profileConfidence: ProfileConfidence;
}> &
  (
    | Readonly<{ verdictLevel: 'inconclusive'; verdictDirection: null; meanGap: number | null }>
    | Readonly<{
        verdictLevel: ConclusiveLevel;
        verdictDirection: VerdictDirection;
        meanGap: number;
      }>
  );

/**
 * A version of a pair's historical-only profile (SUI-08, SUI-11, CL-SUI-03, CL-SEN-16): its
 * values, and `validCaseThreshold`, the case threshold in force at the calculation that gave
 * them, which decides whether the pair reaches the threshold.
 */
export type PairValueVersion = ValueVersion & Readonly<{ validCaseThreshold: number }>;

/**
 * A version of a type's historical-only general trend (SUI-08, SUI-11, CL-SUI-03): its values
 * alone, and never a case threshold, since a trend's verdict decides without one.
 */
export type TrendValueVersion = ValueVersion & Readonly<{ validCaseThreshold?: never }>;

/**
 * What a tracked case's forecast is drawn from (SUI-08, SUI-11, CL-SUI-03, CL-SEN-16): the
 * versions of the pair's historical-only profile and of the type's historical-only trend,
 * each list in any order, its identifiers distinct. Of two versions of one list at one
 * instant, the one with the greater identifier is in force, and the other is shadowed.
 */
export type ForecastHistory = Readonly<{
  pairVersions: readonly PairValueVersion[];
  trendVersions: readonly TrendValueVersion[];
}>;

/** Where a forecast comes from, the glossary's `ForecastSource` (SUI-08). */
export type ForecastSource = 'player_profile' | 'general_trend' | 'none';

/**
 * A forecast (SUI-08): a possible or probable verdict of historical cases only, from the
 * pair's profile or the type's general trend, with its direction, its mean gap, announced to
 * the case, its valid cases and its profile confidence.
 */
export type Forecast = Readonly<{
  source: Exclude<ForecastSource, 'none'>;
  level: ConclusiveLevel;
  direction: VerdictDirection;
  announcedMeanGap: number;
  caseCount: number;
  profileConfidence: ProfileConfidence;
}>;

/** A forecast version (SUI-09, CL-SUI-03): the forecast in force from its instant on, null for none. */
export type ForecastVersion = Readonly<{ effectiveAt: EpochMs; forecast: Forecast | null }>;

/**
 * The choice made against the measured game's scheduled start (SUI-09, CL-SUI-03, CL-SUI-18):
 * the forecast of the last version strictly before that start, or no forecast, source `none`,
 * when that version gives none or no version precedes the start. The record that the tracking
 * service stores, the domain model's frozen forecast with its late forecast, is another,
 * later type.
 */
export type ForecastFreeze =
  | Readonly<{ state: 'frozen'; forecast: Forecast; frozenAt: EpochMs }>
  | Readonly<{ state: 'none'; source: 'none'; frozenAt: EpochMs }>;

/** `versions` in the order of their instants, then of their identifiers. */
function inHistoryOrder<V extends ValueVersion>(versions: readonly V[]): V[] {
  return versions.toSorted((left, right) =>
    left.effectiveAt === right.effectiveAt
      ? left.id - right.id
      : left.effectiveAt - right.effectiveAt,
  );
}

/** The history with each list in its order. */
function sortedHistory(history: ForecastHistory): ForecastHistory {
  return {
    pairVersions: inHistoryOrder(history.pairVersions),
    trendVersions: inHistoryOrder(history.trendVersions),
  };
}

/** The version in force at `instant`, from versions in their order: the last at or before it. */
function versionAt<V extends ValueVersion>(
  versions: readonly V[],
  instant: EpochMs,
): V | undefined {
  return versions.findLast((version) => version.effectiveAt <= instant);
}

/** The forecast that a version of `source` gives: its verdict when possible or probable. */
function forecastOf(
  source: Forecast['source'],
  version: ValueVersion | undefined,
): Forecast | null {
  return version === undefined || version.verdictLevel === 'inconclusive'
    ? null
    : {
        source,
        level: version.verdictLevel,
        direction: version.verdictDirection,
        announcedMeanGap: version.meanGap,
        caseCount: version.validCount,
        profileConfidence: version.profileConfidence,
      };
}

/** The forecast in force at `instant`, from a history in its order. */
function forecastInForce(history: ForecastHistory, instant: EpochMs): Forecast | null {
  const pair = versionAt(history.pairVersions, instant);
  return pair !== undefined && pair.validCount >= pair.validCaseThreshold
    ? forecastOf('player_profile', pair)
    : forecastOf('general_trend', versionAt(history.trendVersions, instant));
}

/**
 * Gives the forecast that a tracked case would get at `instant` (SUI-08, SUI-11, SEN-31,
 * CL-SEN-16), from the versions of the historical-only view in force then: when the pair's
 * version has at least its own case threshold of valid historical cases, its profile's
 * verdict if possible or probable, and no forecast otherwise; below that threshold, or with
 * no profile, the type's historical trend's verdict if possible or probable, and no forecast
 * otherwise. A trend never replaces the verdict of a pair that reaches the threshold.
 */
export function forecastAt(history: ForecastHistory, instant: EpochMs): Forecast | null {
  return forecastInForce(sortedHistory(history), instant);
}

/** Whether two forecasts, or their absence, are the same. */
function isSameForecast(left: Forecast | null, right: Forecast | null): boolean {
  return left === null || right === null
    ? left === right
    : left.source === right.source &&
        left.level === right.level &&
        left.direction === right.direction &&
        left.announcedMeanGap === right.announcedMeanGap &&
        left.caseCount === right.caseCount &&
        left.profileConfidence === right.profileConfidence;
}

/** The case's creation instant and each later instant at which the history changed, in order. */
function changeInstants(history: ForecastHistory, createdAt: EpochMs): Set<EpochMs> {
  const instants = [
    createdAt,
    ...history.pairVersions.map((version) => version.effectiveAt),
    ...history.trendVersions.map((version) => version.effectiveAt),
  ].filter((instant) => instant >= createdAt);
  return new Set(instants.toSorted((left, right) => left - right));
}

/**
 * Gives a tracked case's forecast versions from its creation instant on (SUI-09, CL-SUI-03,
 * CL-SEN-16): the first at that instant, with the forecast in force then, and one at each
 * later change of the pair's profile or of the type's trend that changes the forecast, at
 * the instant of that change. A change of the case threshold gives one only through the
 * profile versions that the recalculation writes. The versions depend on the history alone,
 * never on when or in which order its entries arrived.
 */
export function forecastVersions(history: ForecastHistory, createdAt: EpochMs): ForecastVersion[] {
  const sorted = sortedHistory(history);
  const versions: ForecastVersion[] = [];
  for (const instant of changeInstants(sorted, createdAt)) {
    const forecast = forecastInForce(sorted, instant);
    const previous = versions.at(-1);
    if (previous === undefined || !isSameForecast(previous.forecast, forecast)) {
      versions.push({ effectiveAt: instant, forecast });
    }
  }
  return versions;
}

/**
 * The last of `versions`, in any order, strictly before `instant`, if any. Forecast versions
 * are unique by instant, so two at one instant are a bug of the caller.
 */
function lastVersionBefore(
  versions: readonly ForecastVersion[],
  instant: EpochMs,
): ForecastVersion | undefined {
  if (new Set(versions.map((version) => version.effectiveAt)).size !== versions.length) {
    throw new Error('Two forecast versions share an instant.');
  }
  return versions
    .toSorted((left, right) => left.effectiveAt - right.effectiveAt)
    .findLast((version) => version.effectiveAt < instant);
}

/**
 * Gives a tracked case's forecast chosen against its measured game's scheduled start, as
 * first established (SUI-09, CL-SUI-03, CL-SUI-13, CL-SUI-18): the forecast of its last
 * version strictly before that start; no forecast, source `none`, when that version gives
 * none or when no version precedes that start, as for a case created at or after it. A later
 * change of measured game never chooses it again.
 */
export function frozenForecast(
  versions: readonly ForecastVersion[],
  scheduledStartAt: EpochMs,
): ForecastFreeze {
  const forecast = lastVersionBefore(versions, scheduledStartAt)?.forecast ?? null;
  return forecast === null
    ? { state: 'none', source: 'none', frozenAt: scheduledStartAt }
    : { state: 'frozen', forecast, frozenAt: scheduledStartAt };
}

/**
 * Says whether a tracked case awaits a late forecast (SUI-10, CL-SUI-05, CL-SUI-18): its last
 * version strictly before its measured game's scheduled start gives no forecast, and the
 * pair's historical data was not yet available at that start, its research type not yet
 * covered for the player, its derivation not yet run or none of its historical cases yet
 * measured, as the caller knows. A case with no version before that start never awaits one.
 */
export function isAwaitingLateForecast(
  versions: readonly ForecastVersion[],
  scheduledStartAt: EpochMs,
  wasHistoricalDataAvailable: boolean,
): boolean {
  const last = lastVersionBefore(versions, scheduledStartAt);
  return last?.forecast === null && !wasHistoricalDataAvailable;
}

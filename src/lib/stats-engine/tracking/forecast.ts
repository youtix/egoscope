// The forecast of a tracked case (SUI-08 to SUI-11, CL-SUI-03, CL-SUI-05, CL-SUI-18): the
// forecast it would get at an instant from the historical-only profile of its pair and the
// historical-only trend of its type, the forecast versions that their histories imply, the
// frozen forecast chosen against the measured game's scheduled start, and whether the case
// awaits a late forecast. Every input is a version of the historical-only view, whose rows
// are never updated, so a version takes the instant of the change that made it, whatever
// the timing of the run that reads it.

import type { ProfileConfidence } from '../profiles/confidence';
import type { VerdictDirection, VerdictLevel } from '../profiles/verdict';
import type { EngineParams, EpochMs } from '../types';

/** A possible or probable verdict's level, the only levels that give a forecast (SUI-08). */
type ConclusiveLevel = Exclude<VerdictLevel, 'inconclusive'>;

/**
 * A version of the historical-only view of a pair's profile or of a type's general trend,
 * one row of `profile_value_versions` (SUI-08, SUI-11, CL-SUI-03): the values in force from
 * its instant on. Its valid cases are historical ones only, and it holds no count of tracked
 * cases, so neither the case nor any other tracked case can enter a forecast (SUI-11).
 */
export type ProfileValueVersion = Readonly<{
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

/** A change of the case threshold, as the parameter history records it (TRV-35, SUI-08). */
export type ThresholdChange = Readonly<{
  changedAt: EpochMs;
  oldValue: number;
  newValue: number;
}>;

/**
 * What a tracked case's forecast is drawn from (SUI-08, SUI-11, CL-SUI-03), each list in any
 * order and with one entry at most per instant: the versions of the pair's historical-only
 * profile and of the type's historical-only trend, and the changes of the case threshold.
 */
export type ForecastHistory = Readonly<{
  pairVersions: readonly ProfileValueVersion[];
  trendVersions: readonly ProfileValueVersion[];
  thresholdChanges: readonly ThresholdChange[];
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
 * The forecast frozen against the measured game's scheduled start (SUI-09, CL-SUI-03,
 * CL-SUI-18): the forecast of the last version strictly before that start, or no forecast,
 * source `none`, when that version gives none or no version precedes the start.
 */
export type FrozenForecast =
  | Readonly<{ state: 'frozen'; forecast: Forecast; frozenAt: EpochMs }>
  | Readonly<{ state: 'none'; source: 'none'; frozenAt: EpochMs }>;

/** `items` in the order of their instants, which must all differ, or the order would decide. */
function inInstantOrder<T>(items: readonly T[], instantOf: (item: T) => EpochMs): T[] {
  if (new Set(items.map((item) => instantOf(item))).size !== items.length) {
    throw new Error('Two entries of one forecast history share an instant.');
  }
  return items.toSorted((left, right) => instantOf(left) - instantOf(right));
}

/** The history with each list in the order of its instants. */
function sortedHistory(history: ForecastHistory): ForecastHistory {
  return {
    pairVersions: inInstantOrder(history.pairVersions, (version) => version.effectiveAt),
    trendVersions: inInstantOrder(history.trendVersions, (version) => version.effectiveAt),
    thresholdChanges: inInstantOrder(history.thresholdChanges, (change) => change.changedAt),
  };
}

/** The version in force at `instant`, from versions in the order of their instants. */
function versionAt(
  versions: readonly ProfileValueVersion[],
  instant: EpochMs,
): ProfileValueVersion | undefined {
  return versions.findLast((version) => version.effectiveAt <= instant);
}

/**
 * The case threshold in force at `instant`, as the parameter history gives it (TRV-35): the
 * new value of the last change made by then, else the old value of the first one, made
 * after, else the value in force, which never changed.
 */
function thresholdAt(
  changes: readonly ThresholdChange[],
  instant: EpochMs,
  params: EngineParams,
): number {
  const lastChange = changes.findLast((change) => change.changedAt <= instant);
  return lastChange === undefined
    ? (changes[0]?.oldValue ?? params.sensitivity.minValidCases)
    : lastChange.newValue;
}

/** The forecast that a version of `source` gives: its verdict when possible or probable. */
function forecastOf(
  source: Forecast['source'],
  version: ProfileValueVersion | undefined,
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

/** The forecast in force at `instant`, from a history in the order of its instants. */
function forecastInForce(
  history: ForecastHistory,
  instant: EpochMs,
  params: EngineParams,
): Forecast | null {
  const pair = versionAt(history.pairVersions, instant);
  return pair !== undefined &&
    pair.validCount >= thresholdAt(history.thresholdChanges, instant, params)
    ? forecastOf('player_profile', pair)
    : forecastOf('general_trend', versionAt(history.trendVersions, instant));
}

/**
 * Gives the forecast that a tracked case would get at `instant` (SUI-08, SUI-11, SEN-31),
 * from the values of the historical-only view in force then and the case threshold in force
 * then: when the pair has at least the threshold of valid historical cases, its profile's
 * verdict if possible or probable, and no forecast otherwise; below the threshold, or with
 * no profile, the type's historical trend's verdict if possible or probable, and no forecast
 * otherwise. A trend never replaces the verdict of a pair that reaches the threshold.
 */
export function forecastAt(
  history: ForecastHistory,
  instant: EpochMs,
  params: EngineParams,
): Forecast | null {
  return forecastInForce(sortedHistory(history), instant, params);
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
    ...history.thresholdChanges.map((change) => change.changedAt),
  ].filter((instant) => instant >= createdAt);
  return new Set(instants.toSorted((left, right) => left - right));
}

/**
 * Gives a tracked case's forecast versions from its creation instant on (SUI-09, CL-SUI-03):
 * the first at that instant, with the forecast in force then, and one at each later change
 * of the pair's profile, of the type's trend or of the case threshold that changes the
 * forecast, at the instant of that change. The versions depend on the history alone, never
 * on when or in which order its entries arrived.
 */
export function forecastVersions(
  history: ForecastHistory,
  createdAt: EpochMs,
  params: EngineParams,
): ForecastVersion[] {
  const sorted = sortedHistory(history);
  const versions: ForecastVersion[] = [];
  for (const instant of changeInstants(sorted, createdAt)) {
    const forecast = forecastInForce(sorted, instant, params);
    const previous = versions.at(-1);
    if (previous === undefined || !isSameForecast(previous.forecast, forecast)) {
      versions.push({ effectiveAt: instant, forecast });
    }
  }
  return versions;
}

/** The last of `versions`, in any order, strictly before `instant`, if any. */
function lastVersionBefore(
  versions: readonly ForecastVersion[],
  instant: EpochMs,
): ForecastVersion | undefined {
  return inInstantOrder(versions, (version) => version.effectiveAt).findLast(
    (version) => version.effectiveAt < instant,
  );
}

/**
 * Gives a tracked case's frozen forecast against its measured game's scheduled start, as
 * first established (SUI-09, CL-SUI-03, CL-SUI-13, CL-SUI-18): the forecast of its last
 * version strictly before that start; no forecast, source `none`, when that version gives
 * none or when no version precedes that start, as for a case created at or after it. A later
 * change of measured game never chooses it again.
 */
export function frozenForecast(
  versions: readonly ForecastVersion[],
  scheduledStartAt: EpochMs,
): FrozenForecast {
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

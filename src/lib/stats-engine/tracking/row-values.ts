// The values of a row of the validation table (SUI-24, SUI-25, CL-SUI-08, CL-SUI-10,
// CL-SUI-15, CL-SUI-16): those of its testing set and of its late-forecast part, and its
// separate counts. Sums run in the fixed order of CL-STA-09, by the measured games' scheduled
// starts then the case identifiers, and the stored gaps of the regrouping exits, which have no
// game, smallest first, so that the same cases give the same bits in any order. Nothing is
// rounded: rounding is a display matter.

import { compareCasesInFixedOrder } from '../profiles/verdict';
import { assessCases, gapSummary } from './assessment';
import { caseCategory, chanceExpectedCounts, gapInForecastDirection } from './category';

import type { EngineParams } from '../types';
import type { CaseSetAssessment, GapSummary } from './assessment';
import type { CaseGap, CasePlace } from './case-place';
import type { CaseCategory, ChanceExpectedCounts } from './category';
import type { PostTipOffDecisionEffect } from './decisions';
import type { Forecast } from './forecast';

/**
 * The category counts of a set of tracked cases (SUI-24, glossary 3.11): with a forecast, and
 * among them confirmed, refuted and neutral; without a forecast.
 */
export type CategoryCounts = Readonly<{
  withForecast: number;
  confirmed: number;
  refuted: number;
  neutral: number;
  noForecast: number;
}>;

/**
 * What SUI-24 shows of a set of tracked cases, the testing set or the late-forecast part
 * (SUI-25, CL-SUI-08): the category counts beside the chance-expected counts of its cases
 * with a forecast, their mean gap in the forecast direction with its count and range, the
 * announced gap and the assessment, and the mean normalized gap of all its cases.
 */
export type CaseSetValues = CaseSetAssessment &
  Readonly<{
    categoryCounts: CategoryCounts;
    chanceExpectedCounts: ChanceExpectedCounts;
    trackedMeanGap: GapSummary | null;
  }>;

/**
 * A post-tip-off count (SUI-17, CL-SUI-10): its cases, and their mean gap in the forecast
 * direction over those that have both a measured gap and a forecast, null without one.
 */
export type TouchedCount = Readonly<{
  count: number;
  meanGapInForecastDirection: GapSummary | null;
}>;

/**
 * The separate counts of a row (SUI-25, CL-SUI-10): the cases recorded after tip-off; the
 * excluded, not measurable and pending cases; and the three post-tip-off counts, by effect,
 * `exit` also counting the row's regrouping exits.
 */
export type SeparateCounts = Readonly<{
  recordedAfterTipOff: number;
  excluded: number;
  notMeasurable: number;
  awaitingGame: number;
  exit: TouchedCount;
  entry: TouchedCount;
  measuredGameChange: TouchedCount;
}>;

/** A tracked case of a row: its place, and the forecast frozen or late at its start. */
export type PlacedCase = Readonly<{ place: CasePlace; forecast: Forecast | null }>;

/** The part of a row whose cases are assessed (SUI-24, SUI-25, CL-SUI-08). */
export type CaseSetPart = 'testing' | 'late';

function byFixedOrder(left: Readonly<{ gap: CaseGap }>, right: Readonly<{ gap: CaseGap }>): number {
  return compareCasesInFixedOrder(left.gap, right.gap);
}

function countOf(categories: readonly CaseCategory[], category: CaseCategory): number {
  return categories.filter((item) => item === category).length;
}

/**
 * Computes what SUI-24 shows of the cases of one part of a row, its testing set or its
 * late-forecast part (SUI-24, SUI-25, CL-SUI-08, CL-SUI-15, CL-STA-09): their category counts
 * beside the chance-expected counts of those with a forecast, the assessment of those, with
 * the same minimum for both parts, and the mean normalized gap of all of them.
 */
export function caseSetValues(
  cases: readonly PlacedCase[],
  part: CaseSetPart,
  params: EngineParams,
): CaseSetValues {
  const ordered = cases
    .flatMap(({ place, forecast }) => (place.kind === part ? { gap: place.gap, forecast } : []))
    .toSorted(byFixedOrder);
  const withForecast = ordered.flatMap(({ gap, forecast }) =>
    forecast === null ? [] : { ...forecast, normalizedGap: gap.normalizedGap },
  );
  const categories = ordered.map(({ gap, forecast }) =>
    caseCategory(forecast?.direction ?? null, gap.normalizedGap, params),
  );
  return {
    categoryCounts: {
      withForecast: withForecast.length,
      confirmed: countOf(categories, 'confirmed'),
      refuted: countOf(categories, 'refuted'),
      neutral: countOf(categories, 'neutral'),
      noForecast: countOf(categories, 'no_forecast'),
    },
    chanceExpectedCounts: chanceExpectedCounts(withForecast.length, params),
    ...assessCases(withForecast, params),
    trackedMeanGap: gapSummary(ordered.map(({ gap }) => gap.normalizedGap)),
  };
}

function touchedCount(
  cases: readonly PlacedCase[],
  effect: PostTipOffDecisionEffect,
  exitGaps: readonly (number | null)[],
): TouchedCount {
  const touched = cases.filter(({ place }) => place.kind === effect);
  const caseGaps = touched
    .flatMap(({ place: { gap }, forecast }) =>
      forecast === null || gap === null
        ? []
        : { gap, directed: gapInForecastDirection(gap.normalizedGap, forecast.direction) },
    )
    .toSorted(byFixedOrder)
    .map(({ directed }) => directed);
  const storedGaps = exitGaps.flatMap((gap) => gap ?? []).toSorted((left, right) => left - right);
  return {
    count: touched.length + exitGaps.length,
    meanGapInForecastDirection: gapSummary([...caseGaps, ...storedGaps]),
  };
}

/**
 * Computes the separate counts of a row (SUI-17, SUI-25, CL-SUI-10, CL-SUI-16, CL-STA-09):
 * its cases recorded after tip-off, excluded, not measurable and pending, and those that a
 * decision after tip-off touched, by its effect, each with the mean gap in the forecast
 * direction of those with a measured gap and a forecast. The exits also count the row's
 * regrouping exits, given by their stored gap in the forecast direction, null without one.
 */
export function separateCounts(
  cases: readonly PlacedCase[],
  exitGaps: readonly (number | null)[],
): SeparateCounts {
  const countIn = (kind: CasePlace['kind']): number =>
    cases.filter(({ place }) => place.kind === kind).length;
  return {
    recordedAfterTipOff: countIn('recorded_after_tip_off'),
    excluded: countIn('excluded'),
    notMeasurable: countIn('not_measurable'),
    awaitingGame: countIn('awaiting_game'),
    exit: touchedCount(cases, 'exit', exitGaps),
    entry: touchedCount(cases, 'entry', []),
    measuredGameChange: touchedCount(cases, 'measured_game_change', []),
  };
}

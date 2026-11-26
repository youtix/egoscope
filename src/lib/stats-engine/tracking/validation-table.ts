// The rows of the validation table (SUI-16, SUI-23 to SUI-28, CL-SUI-02, CL-SUI-06,
// CL-SUI-11, CL-SUI-16, CL-DET-09), as a pure function of the stored tracked cases, the
// regrouping exits and the valid historical cases: the tracking service reads them and adds
// the table's header. The rows and their order come from table-rows.ts; each tracked case that
// shows counts once in each row it belongs to, in the one place that case-place.ts gives it;
// each row carries the values of row-values.ts. The table informs and stops nothing (SUI-29).

import { compareCasesInFixedOrder } from '../profiles/verdict';
import { gapSummary } from './assessment';
import { casePlace, overallSubrowOf } from './case-place';
import { caseSetValues, separateCounts } from './row-values';
import { isInRow, tableRows } from './table-rows';

import type { CaseId, EngineParams, EpochMs, EventTypeId, PlayerEventId, PlayerId } from '../types';
import type { GapSummary } from './assessment';
import type { OverallSubrowKind, TableTrackedCase } from './case-place';
import type { CaseSetValues, PlacedCase, SeparateCounts } from './row-values';
import type { PlacedRow, RowMember, TableRoster, ValidationRowPlace } from './table-rows';

/**
 * What remains of a tracked case that a regrouping or a merge removed after tip-off
 * (CL-SUI-16): its player and type, the sub-row of the forecast it had at that start, and its
 * gap in the forecast direction when it had both a measured gap and a forecast.
 */
export type RegroupingExit = Readonly<{
  playerEventId: PlayerEventId;
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  overallSubrow: OverallSubrowKind | null;
  gapInForecastDirection: number | null;
}>;

/** A valid historical case, with its measured game's scheduled start (SUI-24, CL-SUI-02). */
export type TableHistoricalCase = Readonly<{
  caseId: CaseId;
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  measuredGameScheduledStartAt: EpochMs;
  normalizedGap: number;
}>;

/**
 * What the table is computed from (SUI-23 to SUI-25): the event types and the followed
 * players, in the order their rows take; every tracked case, in any order; the regrouping
 * exits; and the valid historical cases, every player and type.
 */
export type ValidationTableInput = TableRoster &
  Readonly<{
    trackedCases: readonly TableTrackedCase[];
    regroupingExits: readonly RegroupingExit[];
    historicalCases: readonly TableHistoricalCase[];
  }>;

/**
 * A row of the validation table (SUI-23 to SUI-25): its place, whether it belongs to the
 * archived part, the values of its testing set, the current mean gap of its valid historical
 * cases, its late-forecast part, its separate counts, and how many of its tracked cases are
 * co-occurring and have a provisional gap.
 */
export type ValidationRow = ValidationRowPlace &
  CaseSetValues &
  Readonly<{
    archived: boolean;
    currentHistoricalMeanGap: GapSummary | null;
    latePart: CaseSetValues;
    separateCounts: SeparateCounts;
    coOccurringCount: number;
    provisionalGapCount: number;
  }>;

type ShownCase = RowMember & PlacedCase & Readonly<{ isCoOccurring: boolean }>;

type TableMembers = Readonly<{
  shown: readonly ShownCase[];
  exits: readonly RegroupingExit[];
  historical: readonly (TableHistoricalCase & RowMember)[];
}>;

function shownCases(trackedCases: readonly TableTrackedCase[]): ShownCase[] {
  return trackedCases.flatMap((item) => {
    const place = casePlace(item);
    const forecast = item.frozenForecast?.forecast ?? null;
    const { playerId, eventTypeId, isCoOccurring } = item;
    const overallSubrow = overallSubrowOf(forecast);
    return place === null
      ? []
      : { playerId, eventTypeId, overallSubrow, place, forecast, isCoOccurring };
  });
}

function rowOf(row: PlacedRow, members: TableMembers, params: EngineParams): ValidationRow {
  const { place, archived } = row;
  const cases = members.shown.filter((member) => isInRow(place, member));
  const exitGaps = members.exits
    .filter((exit) => isInRow(place, exit))
    .map(({ gapInForecastDirection }) => gapInForecastDirection);
  const historicalGaps = members.historical
    .filter((member) => isInRow(place, member))
    .map(({ normalizedGap }) => normalizedGap);
  return {
    ...place,
    archived,
    ...caseSetValues(cases, 'testing', params),
    currentHistoricalMeanGap: gapSummary(historicalGaps),
    latePart: caseSetValues(cases, 'late', params),
    separateCounts: separateCounts(cases, exitGaps),
    coOccurringCount: cases.filter(({ isCoOccurring }) => isCoOccurring).length,
    provisionalGapCount: cases.filter(({ place: { gap } }) => gap?.gapStatus === 'provisional')
      .length,
  };
}

/**
 * Computes the rows of the validation table (SUI-16, SUI-23 to SUI-25, SUI-28, CL-SUI-02,
 * CL-SUI-06, CL-SUI-08, CL-SUI-10, CL-SUI-11, CL-SUI-16, CL-DET-09, CL-DET-15), in the order of
 * `tableRows`. A tracked case counts once in each of its rows, a co-occurring one in the rows of
 * its own type, in the place that `casePlace` gives it: its testing set, the late-forecast part,
 * with its own assessment at the same minimum, or one of the separate counts, with the row's
 * regrouping exits among the cases now out of the counts. A case all of whose events were
 * dismissed before tip-off shows nowhere, and the cases of a withdrawn player or type stay in
 * every other row they belong to. Beside each row's tracked cases, the current mean gap of its
 * valid historical cases, every one for the overall row and none for a sub-row, summed in the
 * order of their measured games' scheduled starts, then of their identifiers (CL-STA-09).
 */
export function validationRows(input: ValidationTableInput, params: EngineParams): ValidationRow[] {
  const members: TableMembers = {
    shown: shownCases(input.trackedCases),
    exits: input.regroupingExits,
    historical: input.historicalCases
      .toSorted(compareCasesInFixedOrder)
      .map((item) => ({ ...item, overallSubrow: null })),
  };
  return tableRows(input, [...members.shown, ...members.exits]).map((row) =>
    rowOf(row, members, params),
  );
}

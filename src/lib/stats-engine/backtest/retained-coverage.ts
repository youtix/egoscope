// What an import retains of the coverage that a research result declares (IMP-10), and
// when a player's coverage, the union of what his imports retained, includes a type
// (BKT-10). A result declares one covered period for every type it lists (CL-BKT-04):
// each type both declared and requested keeps the days that its own requested period
// and that period both hold, and the requested days left out are the import's gaps.
// Dates are calendar dates written YYYY-MM-DD, compared as written (CL-IMP-09), here as
// days counted from 1970-01-01.

import { dateOf, dayCount } from '../calendar-days';

import type { EventTypeId, IsoDate } from '../types';
import type { TypeCoverage } from './counting';
import type { PlannedType, RequestedType } from './extents';

/**
 * The coverage that a research result declares (IMP-10): its covered types as the
 * reader gives them, each once (CL-IMP-23) and in the request's spelling when it names
 * a requested type (CL-IMP-22), and its covered period, both days included. Once the
 * recovery of a cut result has shortened it, the period may end before it starts
 * (CL-IMP-18).
 */
export type DeclaredCoverage = Readonly<{
  coveredTypes: readonly string[];
  startOn: IsoDate;
  endOn: IsoDate;
}>;

/**
 * Days that an import retains for a type, both included (IMP-10): saved, a row of
 * `backtest_coverage_periods` under the sheet version of the request's prompt (BKT-10).
 */
export type RetainedPeriod = Readonly<{
  eventTypeId: EventTypeId;
  startOn: IsoDate;
  endOn: IsoDate;
}>;

/**
 * Requested days of a type that an import leaves uncovered, both included (IMP-10), an
 * item of `imports.coverage_gaps`: from `startOn`, or from his first NBA game while its
 * date is unknown (`undefined`), as the requested period itself then starts, to `endOn`.
 */
export type CoverageGap = Readonly<{
  eventTypeId: EventTypeId;
  startOn: IsoDate | undefined;
  endOn: IsoDate;
}>;

/**
 * A whole-result warning on the declared coverage (IMP-10), an item of
 * `imports.result_warnings`: the declared types outside the request, as read, which are
 * ignored, or a declared period brought back to the requested period.
 */
export type CoverageWarning =
  | Readonly<{ kind: 'declared_type_not_requested'; detail: readonly string[] }>
  | Readonly<{ kind: 'covered_period_clamped' }>;

/**
 * What an import retains of a declared coverage, in the order of the requested types:
 * the retained periods, the requested days it leaves uncovered, and the whole-result
 * warnings (IMP-10).
 */
export type RetainedCoverage = Readonly<{
  retainedPeriods: readonly RetainedPeriod[];
  coverageGaps: readonly CoverageGap[];
  resultWarnings: readonly CoverageWarning[];
}>;

// Days counted from 1970-01-01, both included.
type Days = Readonly<{ startDay: number; endDay: number }>;

// The days a requested type asks for: from `startDay`, or from his first NBA game while
// its date is unknown (`undefined`), to `endDay`.
type RequestedDays = Readonly<{
  eventTypeId: EventTypeId;
  startDay: number | undefined;
  endDay: number;
}>;

// What an import keeps of one requested type.
type TypeRetention = Pick<RetainedCoverage, 'retainedPeriods' | 'coverageGaps'>;

// The date of a day, or his first NBA game, its date unknown (`undefined`).
function dateOrUnknown(day: number | undefined): IsoDate | undefined {
  return day === undefined ? undefined : dateOf(day);
}

// The days of a requested type: from its start or, for a period that starts from his
// first NBA game, its date unknown when the request was made, from that game's US date
// once the app knows it (STA-47), to its end.
function requestedDaysOf(type: RequestedType, firstNbaGameOn: IsoDate | undefined): RequestedDays {
  const startOn = type.periodStartOn ?? firstNbaGameOn;
  return {
    eventTypeId: type.eventTypeId,
    startDay: startOn === undefined ? undefined : dayCount(startOn),
    endDay: dayCount(type.periodEndOn),
  };
}

// The gap of a type from `startDay` to `endDay`, both included: none when it would start
// after it ends, which an unknown start never does.
function gapsOf(
  eventTypeId: EventTypeId,
  startDay: number | undefined,
  endDay: number,
): readonly CoverageGap[] {
  return (startDay ?? endDay) > endDay
    ? []
    : [{ eventTypeId, startOn: dateOrUnknown(startDay), endOn: dateOf(endDay) }];
}

// A requested type of which the import retains nothing, being undeclared or outside the
// declared period: its whole requested period is a gap.
function nothingRetained(requested: RequestedDays): TypeRetention {
  const { eventTypeId, startDay, endDay } = requested;
  return { retainedPeriods: [], coverageGaps: gapsOf(eventTypeId, startDay, endDay) };
}

// A type both declared and requested keeps the days that its requested period and the
// declared period share, and the requested days before and after them are gaps. While
// his first NBA game's date is unknown, the declared start stands for it (IMP-12).
function declaredRetention(requested: RequestedDays, declared: Days): TypeRetention {
  const { eventTypeId } = requested;
  const lowerDay = requested.startDay ?? declared.startDay;
  const startDay = Math.max(lowerDay, declared.startDay);
  const endDay = Math.min(requested.endDay, declared.endDay);
  if (startDay > endDay) {
    return nothingRetained(requested);
  }
  return {
    retainedPeriods: [{ eventTypeId, startOn: dateOf(startDay), endOn: dateOf(endDay) }],
    coverageGaps: [
      ...gapsOf(eventTypeId, lowerDay, startDay - 1),
      ...gapsOf(eventTypeId, endDay + 1, requested.endDay),
    ],
  };
}

// Whether the declared period goes beyond the request's period, from the earliest start
// of its requested types to their latest end, which the covered period of format 1.0
// lies within (05 « Données manipulées »): the retained periods are brought back to it.
// A start from his first NBA game, its date unknown, never lies after the declared one,
// which stands for it (IMP-12). A request without a requested type has no period, and
// so brings nothing back.
function isClamped(requested: readonly RequestedDays[], declared: Days): boolean {
  if (requested.length === 0) {
    return false;
  }
  const requestStart = Math.min(...requested.map(({ startDay }) => startDay ?? declared.startDay));
  const requestEnd = Math.max(...requested.map(({ endDay }) => endDay));
  return (
    Math.max(requestStart, declared.startDay) !== declared.startDay ||
    Math.min(requestEnd, declared.endDay) !== declared.endDay
  );
}

// The whole-result warnings, in the order of IMP-10: the ignored types, then the period.
function warningsOf(
  notRequested: readonly string[],
  isPeriodClamped: boolean,
): readonly CoverageWarning[] {
  const typeWarnings: readonly CoverageWarning[] =
    notRequested.length === 0
      ? []
      : [{ kind: 'declared_type_not_requested', detail: notRequested }];
  const periodWarnings: readonly CoverageWarning[] = isPeriodClamped
    ? [{ kind: 'covered_period_clamped' }]
    : [];
  return [...typeWarnings, ...periodWarnings];
}

/**
 * What an import retains of the coverage that a research result declares (IMP-10): for
 * each requested type that the result declares covered, the days that its requested
 * period and the declared period share, which the save adds to the player's coverage
 * (IMP-30, BKT-10); the requested days left out, as gaps, among them the whole requested
 * period of a requested type that the result does not declare; and a warning for the
 * declared types outside the request, which are ignored, a calendar-derived one among
 * them (CL-IMP-29), and one for a declared period that goes beyond the request's.
 * `plannedTypes` are the planned types of the request, as it stores them, and only those
 * in its prompt are requested (CL-BKT-07): a type that a reduction took out retains
 * nothing, leaves no gap, adds nothing to the request's period and is ignored when the
 * result declares it. A period that starts from his first NBA game, its date unknown at
 * the request, starts on that game's US date once the app knows it (STA-47); while it
 * does not, the declared start stands for it (IMP-12), and a gap over the whole period
 * keeps the unknown start. A recovered cut result whose shortened period ends before it
 * starts retains nothing (CL-IMP-18). The result's events play no part: an empty result
 * retains like any other (BKT-23).
 */
export function retainedCoverage(
  plannedTypes: readonly PlannedType[],
  declared: DeclaredCoverage,
  firstNbaGameOn: IsoDate | undefined,
): RetainedCoverage {
  const declaredDays = { startDay: dayCount(declared.startOn), endDay: dayCount(declared.endOn) };
  const requested = plannedTypes
    .filter((type) => type.isRequested)
    .map((type) => requestedDaysOf(type, firstNbaGameOn));
  const retentions = requested.map((days) =>
    declared.coveredTypes.includes(days.eventTypeId)
      ? declaredRetention(days, declaredDays)
      : nothingRetained(days),
  );
  const requestedIds = new Set(requested.map(({ eventTypeId }) => eventTypeId));
  const notRequested = declared.coveredTypes.filter((id) => !requestedIds.has(id));
  return {
    retainedPeriods: retentions.flatMap(({ retainedPeriods }) => retainedPeriods),
    coverageGaps: retentions.flatMap(({ coverageGaps }) => coverageGaps),
    resultWarnings: warningsOf(notRequested, isClamped(requested, declaredDays)),
  };
}

/**
 * Whether a player's coverage includes a research type, "coverage includes the type"
 * (BKT-10): as soon as one period is covered for it, whatever its sheet version, so a
 * type broadened since its last research stays covered, and a period inherited at a
 * merge or a split counts like any other (CL-BKT-06). The coverage is the union of what
 * each import retained, in any order (CL-BKT-20), an empty result's included (BKT-23).
 * The routing of Lot 2 (BKT-30) and the alert sheet (ALE-14) read it; a calendar-derived
 * type is never covered (CL-BKT-03).
 */
export function isTypeCovered(coverage: TypeCoverage): boolean {
  return coverage.coveredPeriods.length > 0;
}

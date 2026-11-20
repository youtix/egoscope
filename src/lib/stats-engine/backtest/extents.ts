// The extents of a backtest request: the research types it asks for and the days of
// each (BKT-08, BKT-09). A period ends on the day the request is created or updated,
// in the owner's calendar (CL-BKT-10), or on the end of the season that a reduction
// chose (CL-BKT-09); it starts on the player's first NBA game, a US date (CL-TRV-03),
// or on the first day his coverage leaves uncovered (CL-BKT-05). Creation, update and
// reduction share one rule: a period never ends before it starts, and a type left with
// no day is not requested. Dates are compared as written (CL-IMP-09).

import { firstUncoveredOn } from './counting';

import type { EventTypeId, IsoDate } from '../types';
import type { TypeCoverage } from './counting';

/** The kind of a backtest request (BKT-01, BKT-08, BKT-09). */
export type BacktestRequestKind = 'initial' | 'supplement' | 'full_redo';

/**
 * A type that the caller gives a request to research: a research type, that is a
 * validated type whose dating rule is not derived from the calendar (CL-BKT-03). Its
 * mark lets the extents refuse a calendar-derived type passed by mistake.
 */
export type ResearchType = Readonly<{ eventTypeId: EventTypeId; isCalendarDerived: boolean }>;

/** A research type with the player's coverage of it, which a supplement reads (CL-BKT-05). */
export type CoveredResearchType = ResearchType & TypeCoverage;

/**
 * A type of a request with the days it asks for, both included (BKT-08, BKT-09): from
 * `periodStartOn`, or from his first NBA game while its date is unknown (`undefined`),
 * to `periodEndOn`.
 */
export type RequestedType = Readonly<{
  eventTypeId: EventTypeId;
  periodStartOn: IsoDate | undefined;
  periodEndOn: IsoDate;
}>;

/**
 * A planned type of a request (CL-BKT-07): in its prompt while `isRequested`, and kept
 * with its period once a reduction takes it out, so that the supplement offered after
 * the import covers it again.
 */
export type PlannedType = RequestedType & Readonly<{ isRequested: boolean }>;

/**
 * The requested types of a new request, or `coverage_complete` when no type has a day
 * left to research up to that day (CL-BKT-05 rule 6).
 */
export type ExtentResult =
  | Readonly<{ ok: true; requestedTypes: readonly RequestedType[] }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'coverage_complete' }> }>;

/**
 * The planned types after an update or a reduction, or `no_type_left` when it would
 * leave no type requested (CL-BKT-09).
 */
export type PlanResult =
  | Readonly<{ ok: true; plannedTypes: readonly PlannedType[] }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'no_type_left' }> }>;

/**
 * An update of a request to do (CL-BKT-08), as its caller prepares it: the request's
 * kind; its planned types, those no longer validated taken out (step 2); the research
 * types it adds, with the player's coverage of them (step 1); and the update day in the
 * owner's calendar (CL-BKT-10), with his first NBA game's US date when the app knows it.
 */
export type RequestUpdate = Readonly<{
  kind: BacktestRequestKind;
  plannedTypes: readonly PlannedType[];
  addedTypes: readonly CoveredResearchType[];
  updatedOn: IsoDate;
  firstNbaGameOn: IsoDate | undefined;
}>;

/**
 * A reduction that the owner chose (CL-BKT-09): the types he takes out of the prompt,
 * and the end of the season he brings the periods back to, the US date of that season's
 * last playoff game league-wide read from the stored schedule (STA-48), or `undefined`
 * when he only takes types out. Both forms may be combined.
 */
export type Reduction = Readonly<{
  removedTypeIds: readonly EventTypeId[];
  seasonEndOn: IsoDate | undefined;
}>;

type Period = Omit<RequestedType, 'eventTypeId'>;

const COVERAGE_COMPLETE: ExtentResult = { ok: false, error: { kind: 'coverage_complete' } };
const NO_TYPE_LEFT: PlanResult = { ok: false, error: { kind: 'no_type_left' } };

// Callers give research types only (CL-BKT-03), so a calendar-derived one is a bug.
function checkResearchType(type: ResearchType): void {
  if (type.isCalendarDerived) {
    throw new RangeError(
      `Type "${type.eventTypeId}" is derived from the calendar: no backtest request researches it (CL-BKT-03).`,
    );
  }
}

// The days from `startOn`, or from his first NBA game while its date is unknown, to
// `endOn`; none when a known start comes after the end, which an unknown one never does.
function periodOf(startOn: IsoDate | undefined, endOn: IsoDate): Period | undefined {
  return (startOn ?? endOn) > endOn ? undefined : { periodStartOn: startOn, periodEndOn: endOn };
}

// The requested types of a new request on `day`: each type from `startOf(type)` to
// `day`; a type left with no day is not requested (CL-BKT-05 rule 4), and none at all
// means that the coverage is complete up to that day (rule 6).
function requestedOn<T extends ResearchType>(
  types: readonly T[],
  startOf: (type: T) => IsoDate | undefined,
  day: IsoDate,
): ExtentResult {
  const requestedTypes = types.flatMap((type) => {
    checkResearchType(type);
    const period = periodOf(startOf(type), day);
    return period === undefined ? [] : { eventTypeId: type.eventTypeId, ...period };
  });
  return requestedTypes.length === 0 ? COVERAGE_COMPLETE : { ok: true, requestedTypes };
}

/**
 * The extent of an initial request (BKT-08), and of a full redo, which researches every
 * research type again in the same way (BKT-09): each research type given over the
 * player's whole NBA career (H-05, H-06), from his first NBA game's US date (STA-47,
 * H-BKT-01) to the creation day in the owner's calendar (CL-BKT-10), both included, or
 * from his first NBA game, its date unknown, while the app does not know it. His
 * coverage changes nothing. A first NBA game after the creation day, which only an
 * owner's time zone behind US Eastern time allows, leaves his career no day yet: the
 * result is then `coverage_complete`, as for a supplement. Throws a RangeError for a
 * calendar-derived type (CL-BKT-03).
 */
export function initialExtent(
  types: readonly ResearchType[],
  firstNbaGameOn: IsoDate | undefined,
  createdOn: IsoDate,
): ExtentResult {
  return requestedOn(types, () => firstNbaGameOn, createdOn);
}

/**
 * The extent of a supplement (BKT-09, CL-BKT-05 rules 4 to 6): each research type given
 * from its first uncovered day to the creation day in the owner's calendar (CL-BKT-10),
 * the covered spans after a hole searched again rather than each hole apart (rule 5);
 * the whole career for a type with no counting period, whether never covered or
 * broadened since its last research (rule 1). A type whose first uncovered day comes
 * after the creation day is complete and not requested; when every type is, the result
 * is `coverage_complete` and no request is created (rule 6). The trigger chooses the
 * types (BKT-04 to BKT-06, "Fill gaps"). Throws a RangeError for a calendar-derived type
 * (CL-BKT-03).
 */
export function supplementExtent(
  types: readonly CoveredResearchType[],
  firstNbaGameOn: IsoDate | undefined,
  createdOn: IsoDate,
): ExtentResult {
  return requestedOn(types, (type) => firstUncoveredOn(type, firstNbaGameOn), createdOn);
}

// The planned type with its period ended on `endOn` or, when that day comes before its
// start, taken out of the requested types with its period kept (CL-BKT-09).
function endedOn(type: PlannedType, endOn: IsoDate): PlannedType {
  const period = periodOf(type.periodStartOn, endOn);
  return period === undefined ? { ...type, isRequested: false } : { ...type, ...period };
}

// The planned types, or the refusal of a change that leaves none requested (CL-BKT-09).
function planOf(plannedTypes: readonly PlannedType[]): PlanResult {
  return plannedTypes.some((type) => type.isRequested) ? { ok: true, plannedTypes } : NO_TYPE_LEFT;
}

// What a new request of the update's kind would ask for the added types on the update
// day (CL-BKT-08 step 5): the initial extent for an initial request or a full redo
// (BKT-08), the extent of a supplement for a supplement (CL-BKT-05).
function addedExtent(update: RequestUpdate): ExtentResult {
  const { kind, addedTypes, firstNbaGameOn, updatedOn } = update;
  return kind === 'supplement'
    ? supplementExtent(addedTypes, firstNbaGameOn, updatedOn)
    : initialExtent(addedTypes, firstNbaGameOn, updatedOn);
}

/**
 * An update of a request to do (BKT-15, CL-BKT-08 steps 4 to 6): every planned type
 * keeps its start and ends on the update day, and each added type gets the period that
 * a new request of the same kind would give it on that day, one with no day left to
 * research not being added. A planned type that starts after the update day, which only
 * an owner's time zone moved back allows, leaves the requested types and keeps its
 * period, as in a reduction; an update that would leave no type requested is refused
 * (CL-BKT-09). Throws a RangeError for a calendar-derived added type (CL-BKT-03).
 */
export function updateExtent(update: RequestUpdate): PlanResult {
  const kept = update.plannedTypes.map((type) => endedOn(type, update.updatedOn));
  const added = addedExtent(update);
  const addedTypes = added.ok
    ? added.requestedTypes.map((type) => ({ ...type, isRequested: true }))
    : [];
  return planOf([...kept, ...addedTypes]);
}

// A day written YYYY-MM-DD as the number its digits make, which grows with the day.
function dayNumber(day: IsoDate): number {
  return Number(day.replaceAll('-', ''));
}

// The earlier of two days of one calendar.
function earlierDay(day: IsoDate, other: IsoDate): IsoDate {
  return Math.min(dayNumber(day), dayNumber(other)) === dayNumber(day) ? day : other;
}

// A planned type after a reduction (CL-BKT-09): taken out of the requested types when
// the owner removes it, its end brought back to the season's end when that comes
// earlier, and left as it is once out of the prompt.
function reducedType(type: PlannedType, reduction: Reduction): PlannedType {
  if (!type.isRequested) {
    return type;
  }
  if (reduction.removedTypeIds.includes(type.eventTypeId)) {
    return { ...type, isRequested: false };
  }
  return endedOn(type, earlierDay(type.periodEndOn, reduction.seasonEndOn ?? type.periodEndOn));
}

/**
 * A reduction of a request to do (BKT-15, CL-BKT-09): the types that the owner takes out
 * leave the requested types and, reduced to a season, every requested type ends on the
 * earlier of its end and that season's end. A type whose period would then hold no day
 * leaves the requested types too. Every type stays planned with its period (CL-BKT-07),
 * for the supplement offered after the import. A reduction that would leave no type
 * requested is refused.
 */
export function reduceExtent(
  plannedTypes: readonly PlannedType[],
  reduction: Reduction,
): PlanResult {
  return planOf(plannedTypes.map((type) => reducedType(type, reduction)));
}

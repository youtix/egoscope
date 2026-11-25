// The general trend of a type in its three views (SEN-19, SEN-21, SEN-28, CL-SEN-19), from
// the stored outcomes of the cases of every followed player, a withdrawn player's included
// (H-JOU-07), and the rules that profiles and trends share: which types have them, which
// cases and exits each view counts, and when they exist (SEN-19, CL-SEN-26).

import { generalTrend } from './general-trend';

import type { EngineParams } from '../types';
import type { ManuallyDecidedCase } from './checks';
import type { GeneralTrendValues, TrendCase } from './general-trend';
import type { ProfileCase, TallyExitReason } from './tally';

/** The status of an event type (TAX-10), as it is stored. */
export type TypeStatus = 'proposed' | 'validated' | 'rejected' | 'withdrawn';

/** The origin of a case (SEN-21, CL-VUE-13), as it is stored. */
export type CaseOrigin = 'historical' | 'tracked';

/** A view of a profile or a general trend (SEN-21, CL-SEN-19), as it is stored. */
export type ProfileView = 'all_cases' | 'historical_only' | 'tracked_only';

/**
 * The cases and the exits that one view counts (SEN-21, CL-SEN-19): the cases of its
 * origins, and the events that left the tally in the view of all cases alone, since an
 * exit keeps no origin (`tally_exits`).
 */
type ViewPart<C> = Readonly<{
  view: ProfileView;
  cases: readonly C[];
  exitReasons: readonly TallyExitReason[];
}>;

/**
 * What the general trend of a type is computed from (SEN-19, SEN-28): the type's status;
 * the stored outcome of each of its cases, every followed player's, with its origin; the
 * reasons of its events that left the tally, one per event (SEN-33); and its cases that a
 * manual decision rules (SEN-17, SEN-27).
 */
export type TrendEvaluationInput = Readonly<{
  typeStatus: TypeStatus;
  cases: readonly (TrendCase & Readonly<{ origin: CaseOrigin }>)[];
  exitReasons: readonly TallyExitReason[];
  manuallyDecidedCases: readonly ManuallyDecidedCase[];
}>;

/**
 * The general trend of a type (SEN-19, SEN-21, SEN-28, SEN-31): archived when the type is
 * withdrawn, and in each view, in the glossary's order of the views, its values, its valid
 * cases of each origin and the threshold of valid cases that its verdict applied.
 */
export type EvaluatedTrend = Readonly<{
  isArchived: boolean;
  views: readonly (GeneralTrendValues &
    Readonly<{
      view: ProfileView;
      historicalValidCount: number;
      trackedValidCount: number;
      validCaseThreshold: number;
    }>)[];
}>;

// The views in the glossary's order, with the origins of the cases each counts.
const VIEWS: readonly Readonly<{ view: ProfileView; origins: readonly CaseOrigin[] }>[] = [
  { view: 'all_cases', origins: ['historical', 'tracked'] },
  { view: 'historical_only', origins: ['historical'] },
  { view: 'tracked_only', origins: ['tracked'] },
];

/**
 * Says whether a type of `typeStatus` has profiles and a general trend (SEN-19): a
 * validated type, and a withdrawn one, whose profiles and trend are archived and still
 * computed; a proposed or rejected type has none.
 */
export function hasProfiles(typeStatus: TypeStatus): boolean {
  return typeStatus === 'validated' || typeStatus === 'withdrawn';
}

/**
 * Says whether a profile or a general trend of a type that has them exists (SEN-19,
 * CL-SEN-26): while its tally holds at least one event, the events that left it included.
 * A withdrawn event is none of them: it counts nowhere (CL-SEN-18).
 */
export function hasTallyEvent(
  cases: readonly unknown[],
  exitReasons: readonly TallyExitReason[],
): boolean {
  return cases.length > 0 || exitReasons.length > 0;
}

/**
 * How many valid cases of `origin` there are among the cases of a view of a profile or a
 * general trend (SEN-21): with those of the other origin, they make its valid cases.
 */
export function validCountOf(
  cases: readonly (ProfileCase & Readonly<{ origin: CaseOrigin }>)[],
  origin: CaseOrigin,
): number {
  return cases.filter((caseItem) => caseItem.status === 'measured' && caseItem.origin === origin)
    .length;
}

/**
 * Splits the cases of a profile or a general trend into its views, in the glossary's
 * order (SEN-21, CL-SEN-19): all cases, the historical cases only and the tracked cases
 * only, each case in the views of its origin. The events that left the tally count in
 * the view of all cases alone, since an exit keeps no origin.
 */
export function casesByView<C extends Readonly<{ origin: CaseOrigin }>>(
  cases: readonly C[],
  exitReasons: readonly TallyExitReason[],
): readonly ViewPart<C>[] {
  return VIEWS.map(({ view, origins }) => ({
    view,
    cases: cases.filter((caseItem) => origins.includes(caseItem.origin)),
    exitReasons: exitReasons.filter(() => view === 'all_cases'),
  }));
}

/**
 * Evaluates the general trend of a type (SEN-19, SEN-21, SEN-28 to SEN-31, CL-SEN-08,
 * CL-SEN-19, H-JOU-07): in each of its three views, the values of generalTrend over the
 * cases of every player of the view's origins, each case weighing the same, a withdrawn
 * player's valid cases counting as any others, with its valid cases of each origin and
 * the threshold of valid cases in force at this calculation. A case awaiting its game or
 * not measurable, such as one with no counted case, stays in the tally and enters no
 * verdict, check, robustness test or confidence. A withdrawn type's trend is archived and
 * still computed; a proposed or rejected type has none, nor a type whose tally holds no
 * event.
 */
export function evaluateTrend(
  input: TrendEvaluationInput,
  params: EngineParams,
): EvaluatedTrend | null {
  const { typeStatus, cases, exitReasons, manuallyDecidedCases } = input;
  if (!hasProfiles(typeStatus) || !hasTallyEvent(cases, exitReasons)) {
    return null;
  }
  return {
    isArchived: typeStatus === 'withdrawn',
    views: casesByView(cases, exitReasons).map((part) => ({
      view: part.view,
      ...generalTrend(
        { cases: part.cases, exitReasons: part.exitReasons, manuallyDecidedCases },
        params,
      ),
      historicalValidCount: validCountOf(part.cases, 'historical'),
      trackedValidCount: validCountOf(part.cases, 'tracked'),
      validCaseThreshold: params.sensitivity.minValidCases,
    })),
  };
}

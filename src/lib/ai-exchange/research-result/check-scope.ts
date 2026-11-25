// The scope of an event of a research result (IMP-11, IMP-12): its type, taken from the
// taxonomy and the request, and its public date, set against its own type's requested
// period and the player's first NBA game. An event outside the request is ignored, never
// refused; a missing or unknown type and an invalid public date refuse it (H-IMP-01).
import { canonicalValue } from '../conventions';

import type { ExchangeDate } from '../conventions';
import type { DateReading, DateReadingError } from './dates';
import type { ResearchEvent } from './format';

/** Calendar dates from a start to an end, both included (CL-IMP-09). */
type Period = Readonly<{ startOn: string; endOn: string }>;

/**
 * What the taxonomy says today of a type identifier (IMP-11, ADR 0015): a research type
 * and its status, the glossary's `EventTypeStatus`; a type absorbed by a merge, with the
 * type that survives it, the version of the merged sheet and whether the owner declared
 * that it covers the union (TAX-27, CL-IMP-21); a split type, with each type it was split
 * into and the version of that type in force (TAX-30); or a calendar-derived type.
 */
export type TaxonomyType = Readonly<{ id: string }> &
  (
    | Readonly<{
        standing: 'research';
        status: 'proposed' | 'validated' | 'rejected' | 'withdrawn';
      }>
    | Readonly<{
        standing: 'merged';
        survivorId: string;
        mergeVersion: number;
        mergeCoversUnion: boolean;
      }>
    | Readonly<{
        standing: 'split';
        resultingTypes: readonly Readonly<{ id: string; version: number }>[];
      }>
    | Readonly<{ standing: 'calendar_derived' }>
  );

/** A type of the request: its identifier, its own requested period (CL-IMP-09) and the version of its sheet that the prompt used (IMP-30). */
export type RequestedType = Readonly<{ id: string; period: Period; sheetVersion: number }>;

/** The owner's answer for the event of a split type at a position (IMP-11, TAX-30): one of the resulting types, or to ignore the event. */
export type SplitChoice = Readonly<{
  position: number;
  choice: 'ignore' | Readonly<{ typeId: string }>;
}>;

/**
 * What the scope of an event depends on: the taxonomy today; the request's types; the
 * covered types and the covered period that the result declares; the US date of the
 * player's first NBA game, when it is known (CL-IMP-09); the owner's split choices. A
 * correction (IMP-32) gives the career up to its day as the periods (CL-IMP-31).
 */
export type ScopeFacts = Readonly<{
  taxonomy: readonly TaxonomyType[];
  requestedTypes: readonly RequestedType[];
  coveredTypes: readonly string[];
  declaredPeriod: Period;
  firstNbaGameOn: string | undefined;
  splitChoices: readonly SplitChoice[];
}>;

/** A defect of the type or of the public date that refuses an event (IMP-11, IMP-12), a code of the glossary's `ImportRefusalReason`. */
export type ScopeRefusal = Readonly<{
  reason:
    | 'type_missing'
    | 'type_unknown'
    | 'public_date_missing'
    | 'public_date_malformed'
    | 'public_date_nonexistent';
}>;

/** Why an event is ignored, outside the request and never a refusal (IMP-11, IMP-12, CL-IMP-29), the glossary's `ImportIgnoreReason`. */
export type ImportIgnoreReason =
  | 'type_not_validated'
  | 'type_not_requested'
  | 'outside_requested_period'
  | 'before_first_nba_game'
  | 'calendar_derived_type'
  | 'split_type_ignored';

/** A warning that the type or the public date of an event gives (IMP-11, IMP-12, CL-IMP-08), an event-scope code of the glossary's `ImportWarningKind`. */
export type ScopeWarning =
  | Readonly<{
      kind:
        | 'type_not_declared_covered'
        | 'outside_declared_period'
        | 'non_standard_date'
        | 'time_ignored';
    }>
  | Readonly<{ kind: 'attached_to_surviving_type'; typeId: string }>;

/**
 * The type of an event in scope (IMP-11, CL-IMP-21): a type, with the sheet version that
 * the event is qualified under and whether it joins the events to requalify (TAX-25); or,
 * for a split type that the owner has not answered for, the types to choose from.
 */
export type CheckedEventType =
  | Readonly<{ kind: 'type'; typeId: string; sheetVersion: number; toRequalify: boolean }>
  | Readonly<{ kind: 'split_choice'; splitTypeId: string; resultingTypeIds: readonly string[] }>;

/**
 * The scope of an event: ignored, with its reason; valid, with its type, its public date
 * and their warnings; or refused, with the defects of its type and its public date, and
 * their warnings.
 */
export type Scope =
  | Readonly<{ kind: 'ignored'; reason: ImportIgnoreReason }>
  | Readonly<{
      kind: 'valid';
      type: CheckedEventType;
      publicDate: ExchangeDate;
      warnings: readonly ScopeWarning[];
    }>
  | Readonly<{
      kind: 'refused';
      refusals: readonly ScopeRefusal[];
      warnings: readonly ScopeWarning[];
    }>;

type TypeResolution =
  | Readonly<{ kind: 'refused'; refusal: ScopeRefusal }>
  | Readonly<{ kind: 'ignored'; reason: ImportIgnoreReason }>
  | Readonly<{
      kind: 'taken';
      type: CheckedEventType;
      period: Period;
      warnings: readonly ScopeWarning[];
    }>;

type DateCheck =
  | Readonly<{ kind: 'refused'; refusal: ScopeRefusal }>
  | Readonly<{ kind: 'ignored'; reason: ImportIgnoreReason }>
  | Readonly<{ kind: 'dated'; date: ExchangeDate; warnings: readonly ScopeWarning[] }>;

const PUBLIC_DATE_REFUSALS: Readonly<Record<DateReadingError['kind'], ScopeRefusal>> = {
  missing: { reason: 'public_date_missing' },
  malformed: { reason: 'public_date_malformed' },
  nonexistent: { reason: 'public_date_nonexistent' },
};

/** The type that an event of a split type takes (TAX-30): the owner's choice, or the choice to make. */
function splitType(
  type: Extract<TaxonomyType, Readonly<{ standing: 'split' }>>,
  choice: SplitChoice['choice'] | undefined,
): CheckedEventType | ImportIgnoreReason {
  if (choice === 'ignore') {
    return 'split_type_ignored';
  }
  const chosen = type.resultingTypes.find(({ id }) => id === choice?.typeId);
  const resultingTypeIds = type.resultingTypes.map(({ id }) => id);
  return chosen === undefined
    ? { kind: 'split_choice', splitTypeId: type.id, resultingTypeIds }
    : { kind: 'type', typeId: chosen.id, sheetVersion: chosen.version, toRequalify: false };
}

/**
 * The type that an event takes under the type of the request that judges it (IMP-11,
 * CL-IMP-21): for a merge, the survivor, with the version of the merged sheet when the
 * owner declared that it covers the union, and otherwise the version of the request;
 * or why it is ignored.
 */
function takeType(
  type: Exclude<TaxonomyType, Readonly<{ standing: 'calendar_derived' }>>,
  requested: RequestedType,
  choice: SplitChoice['choice'] | undefined,
): CheckedEventType | ImportIgnoreReason {
  const { sheetVersion } = requested;
  switch (type.standing) {
    case 'merged': {
      const { survivorId, mergeVersion, mergeCoversUnion } = type;
      const version = mergeCoversUnion ? mergeVersion : sheetVersion;
      return {
        kind: 'type',
        typeId: survivorId,
        sheetVersion: version,
        toRequalify: !mergeCoversUnion,
      };
    }
    case 'split': {
      return splitType(type, choice);
    }
    case 'research': {
      return type.status === 'validated'
        ? { kind: 'type', typeId: type.id, sheetVersion, toRequalify: false }
        : 'type_not_validated';
    }
  }
}

/**
 * The type of the request that judges an event of a type (IMP-11, CL-IMP-21): the type
 * itself when the request holds it. An event of a type absorbed by a merge is first
 * attached to the surviving type, so that, when the request holds the survivor and not
 * the absorbed type, the survivor judges it; when the request holds neither, nothing
 * does, since the request gives no period and no version to judge it by.
 */
function judgingType(
  type: Exclude<TaxonomyType, Readonly<{ standing: 'calendar_derived' }>>,
  requestedTypes: readonly RequestedType[],
): RequestedType | undefined {
  const own = requestedTypes.find(({ id }) => id === type.id);
  switch (type.standing) {
    case 'merged': {
      return own ?? requestedTypes.find(({ id }) => id === type.survivorId);
    }
    case 'split':
    case 'research': {
      return own;
    }
  }
}

/**
 * The type of an event (IMP-11, CL-IMP-21, CL-IMP-22, CL-IMP-29): missing or of no type of
 * the taxonomy, it refuses the event; calendar-derived, not in the request, or not
 * validated today, it ignores it. A type absorbed by a merge attaches to the survivor with
 * a warning, when the request holds either, and a requested split type takes the owner's
 * choice, both in the requested period of the type of the request that judges the event
 * (CL-IMP-09). That type, when the result does not declare it covered, gives a warning.
 */
function resolveType(
  eventType: string | undefined,
  position: number,
  facts: ScopeFacts,
): TypeResolution {
  const typeId = canonicalValue(
    eventType,
    facts.taxonomy.map(({ id }) => id),
  );
  const type = facts.taxonomy.find(({ id }) => id === typeId);
  if (type === undefined) {
    return {
      kind: 'refused',
      refusal: { reason: eventType === undefined ? 'type_missing' : 'type_unknown' },
    };
  }
  if (type.standing === 'calendar_derived') {
    return { kind: 'ignored', reason: 'calendar_derived_type' };
  }
  const requested = judgingType(type, facts.requestedTypes);
  if (requested === undefined) {
    return { kind: 'ignored', reason: 'type_not_requested' };
  }
  const choice = facts.splitChoices.find((answer) => answer.position === position)?.choice;
  const taken = takeType(type, requested, choice);
  if (typeof taken === 'string') {
    return { kind: 'ignored', reason: taken };
  }
  const warnings: readonly ScopeWarning[] = [
    ...(type.standing === 'merged'
      ? [{ kind: 'attached_to_surviving_type', typeId: type.survivorId } as const]
      : []),
    ...(facts.coveredTypes.includes(requested.id)
      ? []
      : [{ kind: 'type_not_declared_covered' } as const]),
  ];
  return { kind: 'taken', type: taken, period: requested.period, warnings };
}

/** Whether a calendar date lies outside a period, whose bounds are inside it (CL-IMP-09). */
function isOutside(on: string, period: Period): boolean {
  return on < period.startOn || on > period.endOn;
}

/**
 * Why a calendar date leaves its event outside the request (IMP-12, CL-IMP-09), if it
 * does: outside the requested period of the event's type, when it has a type to take,
 * then before the player's first NBA game, whatever its type.
 */
function ignoreReason(
  on: string,
  type: TypeResolution,
  facts: ScopeFacts,
): ImportIgnoreReason | undefined {
  if (type.kind === 'taken' && isOutside(on, type.period)) {
    return 'outside_requested_period';
  }
  const lowerBound = facts.firstNbaGameOn ?? facts.declaredPeriod.startOn;
  return on < lowerBound ? 'before_first_nba_game' : undefined;
}

/**
 * The public date of an event (IMP-12, CL-IMP-08, CL-IMP-09): missing, malformed or
 * nonexistent, it refuses the event. Its calendar date outside the requested period of
 * the event's type, or before the US date of the player's first NBA game (before the
 * start of the declared period when that date is unknown), ignores it; outside the
 * declared period, it gives a warning, as its spelling may (CL-IMP-08). An event without
 * a type to take has no requested period to compare, but no type would bring it before
 * the first NBA game into the request.
 */
function checkPublicDate(reading: DateReading, type: TypeResolution, facts: ScopeFacts): DateCheck {
  if (!reading.ok) {
    return { kind: 'refused', refusal: PUBLIC_DATE_REFUSALS[reading.error.kind] };
  }
  const { on } = reading.date;
  const reason = ignoreReason(on, type, facts);
  if (reason !== undefined) {
    return { kind: 'ignored', reason };
  }
  const isUndeclared = isOutside(on, facts.declaredPeriod);
  const warnings: readonly ScopeWarning[] = [
    ...(reading.warning === undefined ? [] : [{ kind: reading.warning }]),
    ...(isUndeclared ? [{ kind: 'outside_declared_period' } as const] : []),
  ];
  return { kind: 'dated', date: reading.date, warnings };
}

/**
 * The scope of an event at its 1-based position (IMP-11, IMP-12, CL-IMP-09, CL-IMP-21,
 * CL-IMP-29): ignored when its type is calendar-derived, not in the request (nor, for a
 * type absorbed by a merge, its survivor), not validated today or a split type that the
 * owner chose to ignore, or when its public date lies outside the requested period of
 * the type of the request that judges it or before the player's first NBA game; refused,
 * with every defect found, when its type is missing or unknown or its public date
 * missing, malformed or nonexistent; valid otherwise, with the type it takes: its own,
 * the survivor of a merge with the CL-IMP-21 version, the owner's choice for a split
 * type, or that choice still to make.
 */
export function checkScope(event: ResearchEvent, position: number, facts: ScopeFacts): Scope {
  const type = resolveType(event.eventType, position, facts);
  if (type.kind === 'ignored') {
    return type;
  }
  const date = checkPublicDate(event.publicDate, type, facts);
  if (date.kind === 'ignored') {
    return date;
  }
  const warnings = [
    ...(type.kind === 'taken' ? type.warnings : []),
    ...(date.kind === 'dated' ? date.warnings : []),
  ];
  if (type.kind === 'taken' && date.kind === 'dated') {
    return { kind: 'valid', type: type.type, publicDate: date.date, warnings };
  }
  const refusals = [
    ...(type.kind === 'refused' ? [type.refusal] : []),
    ...(date.kind === 'refused' ? [date.refusal] : []),
  ];
  return { kind: 'refused', refusals, warnings };
}

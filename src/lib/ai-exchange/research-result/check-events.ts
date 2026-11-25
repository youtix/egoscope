// The checks of each event of a research result read in format 1.0 (IMP-11 to IMP-15,
// IMP-17, IMP-19): its scope, its type and its public date (check-scope.ts), then its
// description, its sources (check-sources.ts), its context, its research confidence and
// its unverified note. Each event gets exactly one outcome, and only the defects of
// IMP-11 to IMP-14 refuse it (H-IMP-01); the import adds duplicates and the events
// declined for sensitive data (IMP-25, IMP-37). Everything that the checks need from
// outside, the taxonomy, the request, the parameters and the instant, is an input.
import { checkText, textLength } from '../text-rules';
import { checkScope } from './check-scope';
import { checkSources, isTooEarly, oldestFirst } from './check-sources';
import { hasPossibleCitationMarker, hasPossibleStatistics } from './text-signals';

import type { ExchangeDate } from '../conventions';
import type {
  CheckedEventType,
  ImportIgnoreReason,
  ScopeFacts,
  ScopeRefusal,
  ScopeWarning,
} from './check-scope';
import type { CheckedSource, SourceCheckRules, SourceWarning } from './check-sources';
import type { GameStakes, InjuryReturn, ResearchConfidence, ResearchEvent } from './format';

/**
 * What the event checks take from their caller: the facts of their scope, the parameters
 * `events.maxDescriptionLength`, `backtests.maxSourcesPerEvent` and
 * `imports.maxSourceLeadDays`, and the rules of the source checks (IMP-14, CL-IMP-10).
 */
export type EventCheckContext = ScopeFacts &
  Readonly<{
    maxDescriptionLength: number;
    maxSourcesPerEvent: number;
    maxSourceLeadDays: number;
    sourceRules: SourceCheckRules;
  }>;

/**
 * A defect that refuses an event (IMP-11 to IMP-14, H-IMP-01), a code of the glossary's
 * `ImportRefusalReason`, with what its message needs (CL-IMP-02, CL-IMP-05): the length and
 * the maximum of a description too long, the quotation mark found, the position of the
 * source published too far before the public date.
 */
export type ImportRefusal =
  | ScopeRefusal
  | Readonly<{ reason: 'description_missing' | 'no_valid_source' }>
  | Readonly<{ reason: 'description_too_long'; length: number; maxLength: number }>
  | Readonly<{ reason: 'description_quotation_mark'; character: string }>
  | Readonly<{ reason: 'source_before_public_date'; sourcePosition: number }>;

/** The format 1.0 key of a text of the event itself that a warning names (CL-IMP-02, CL-IMP-07). */
type EventTextField = 'description' | 'unverified_note' | 'detail';

/**
 * A warning on an event (IMP-11 to IMP-17), an event-scope code of the glossary's
 * `ImportWarningKind`, with the surviving type, the source, the text or the other event
 * citing the same link that it names, and what its message needs (CL-IMP-02, CL-IMP-05):
 * the length and the maximum of a text too long, the quotation mark found. A warning
 * raised on a source, on its outlet, its title or its publication date, carries the
 * source's 1-based position in the event's sources; the same kind raised on the event's
 * own text or public date carries none (CL-IMP-02).
 */
export type ImportWarning =
  | ScopeWarning
  | SourceWarning
  | Readonly<{ kind: 'confidence_defaulted' | 'context_defaulted' }>
  | Readonly<{ kind: 'possible_statistics' | 'possible_citation_marker'; field: EventTextField }>
  | Readonly<{
      kind: 'possible_citation_marker';
      field: 'outlet' | 'title';
      sourcePosition: number;
    }>
  | Readonly<{ kind: 'non_standard_date' | 'time_ignored'; sourcePosition: number }>
  | Readonly<{
      kind: 'text_too_long_ignored';
      field: 'unverified_note' | 'detail';
      length: number;
      maxLength: number;
    }>
  | Readonly<{ kind: 'text_quotation_mark_ignored'; field: 'unverified_note'; character: string }>
  | Readonly<{ kind: 'shared_link'; otherPosition: number }>;

/** An event that its checks accept: its type, its values with their defaults, its texts trimmed and its sources kept, oldest first (IMP-13 to IMP-15). */
export type AcceptedEvent = Readonly<{
  type: CheckedEventType;
  publicDate: ExchangeDate;
  description: string;
  sources: readonly CheckedSource[];
  context: Readonly<{
    injuryReturn: InjuryReturn;
    gameStakes: GameStakes;
    detail: string | undefined;
  }>;
  researchConfidence: ResearchConfidence;
  unverifiedNote: string | undefined;
}>;

/**
 * The one outcome of the event at a 1-based position (IMP-19): added, with warnings or
 * not; ignored, with its reason; or refused, with every defect found, in the order of the
 * format's fields, and its warnings.
 */
export type EventCheck = Readonly<{ position: number }> &
  (
    | Readonly<{
        outcome: 'added' | 'added_with_warning';
        event: AcceptedEvent;
        warnings: readonly ImportWarning[];
      }>
    | Readonly<{ outcome: 'ignored'; reason: ImportIgnoreReason }>
    | Readonly<{
        outcome: 'refused';
        refusals: readonly ImportRefusal[];
        warnings: readonly ImportWarning[];
      }>
  );

// An event that its checks accept, before the links of the others are compared.
type Accepted = Readonly<{
  position: number;
  outcome: 'accepted';
  event: AcceptedEvent;
  warnings: readonly ImportWarning[];
}>;

// An accepted event, by its position, and another that cites one of its cleaned links.
type LinkPair = Readonly<{ position: number; other: number }>;

// What the check of a part of an event keeps of it, and its warnings.
type PartCheck<T> = Readonly<{ value: T; warnings: readonly ImportWarning[] }>;

// The description kept, or the defects that refuse the event, with the warnings.
type DescriptionCheck =
  | Readonly<{ ok: true; value: string; warnings: readonly ImportWarning[] }>
  | Readonly<{ ok: false; refusals: readonly ImportRefusal[]; warnings: readonly ImportWarning[] }>;

// The sources kept and their warnings, with the defects that refuse the event.
type SourcesCheck = PartCheck<readonly CheckedSource[]> &
  Readonly<{ refusals: readonly ImportRefusal[] }>;

/** The one item when it is given, none otherwise. */
const when = <T>(isGiven: boolean, item: T): readonly T[] => (isGiven ? [item] : []);

function statisticsWarning(text: string, field: EventTextField): readonly ImportWarning[] {
  return when(hasPossibleStatistics(text), { kind: 'possible_statistics', field });
}

function markerWarning(text: string, field: EventTextField): readonly ImportWarning[] {
  return when(hasPossibleCitationMarker(text), { kind: 'possible_citation_marker', field });
}

/**
 * The warnings on a kept source, each with its position (CL-IMP-02, CL-IMP-07, CL-IMP-08):
 * of its publication date written in a non-standard form or whose time is ignored, then
 * of a possible citation marker in its outlet and in its title.
 */
function sourceWarnings(source: CheckedSource): readonly ImportWarning[] {
  const { position: sourcePosition, dateWarning } = source;
  const marked = (field: 'outlet' | 'title'): readonly ImportWarning[] => {
    const text = source[field];
    // Stryker disable next-line ConditionalExpression: a missing text holds no marker, and a pattern tests undefined as the text undefined, which holds none either
    const isMarked = text !== undefined && hasPossibleCitationMarker(text);
    return when(isMarked, { kind: 'possible_citation_marker', field, sourcePosition });
  };
  return [
    ...(dateWarning === undefined ? [] : [{ kind: dateWarning, sourcePosition }]),
    ...marked('outlet'),
    ...marked('title'),
  ];
}

/**
 * The description (IMP-13, DSN-24, CL-IMP-05): missing, longer than the maximum in code
 * points once trimmed, or holding a quotation mark of CL-DSN-03, it refuses the event; a
 * possible statistic or citation marker only warns (CL-IMP-03, CL-IMP-07).
 */
function checkDescription(text: string | undefined, maxLength: number): DescriptionCheck {
  if (text === undefined) {
    return { ok: false, refusals: [{ reason: 'description_missing' }], warnings: [] };
  }
  const refusals = checkText(text, maxLength).map((breach): ImportRefusal =>
    breach.kind === 'too_long'
      ? { reason: 'description_too_long', length: breach.length, maxLength }
      : { reason: 'description_quotation_mark', character: breach.character },
  );
  const warnings = [
    ...statisticsWarning(text, 'description'),
    ...markerWarning(text, 'description'),
  ];
  return refusals.length === 0
    ? { ok: true, value: text.trim(), warnings }
    : { ok: false, refusals, warnings };
}

/**
 * The unverified note (IMP-15, CL-IMP-05): too long or holding a quotation mark, it is
 * ignored with a warning, since it is stored; kept, it may warn of statistics or of a
 * citation marker (CL-IMP-03, CL-IMP-07).
 */
function checkNote(text: string | undefined, maxLength: number): PartCheck<string | undefined> {
  const breaches = text === undefined ? [] : checkText(text, maxLength);
  if (text === undefined || breaches.length > 0) {
    const field = 'unverified_note';
    const warnings = breaches.map((breach): ImportWarning =>
      breach.kind === 'too_long'
        ? { kind: 'text_too_long_ignored', field, length: breach.length, maxLength }
        : { kind: 'text_quotation_mark_ignored', field, character: breach.character },
    );
    return { value: undefined, warnings };
  }
  const warnings = [
    ...statisticsWarning(text, 'unverified_note'),
    ...markerWarning(text, 'unverified_note'),
  ];
  return { value: text.trim(), warnings };
}

/**
 * The context (IMP-15): a value that is missing or not of its list becomes `unknown`,
 * with one warning; a detail too long is ignored with a warning, and is checked no
 * further, since it is never stored (CL-IMP-05, CL-IMP-07).
 */
function checkContext(
  context: ResearchEvent['context'],
  maxLength: number,
): PartCheck<AcceptedEvent['context']> {
  const { injuryReturn, gameStakes, detail } = context;
  const length = detail === undefined ? 0 : textLength(detail);
  const isDetailTooLong = length > maxLength;
  const isDefaulted = injuryReturn === undefined || gameStakes === undefined;
  const warnings = [
    ...when<ImportWarning>(isDefaulted, { kind: 'context_defaulted' }),
    ...when<ImportWarning>(isDetailTooLong, {
      kind: 'text_too_long_ignored',
      field: 'detail',
      length,
      maxLength,
    }),
  ];
  const value = {
    injuryReturn: injuryReturn ?? 'unknown',
    gameStakes: gameStakes ?? 'unknown',
    detail: isDetailTooLong ? undefined : detail?.trim(),
  };
  return { value, warnings };
}

/**
 * The sources of an event (IMP-14, CL-IMP-11, CL-IMP-16): checked one by one, the event
 * refused when none is kept or when one is published too far before its public date, if
 * that date is valid; the oldest kept up to the maximum, which alone warn of their
 * outlet, title or date.
 */
function checkEventSources(event: ResearchEvent, context: EventCheckContext): SourcesCheck {
  const { kept, warnings } = checkSources(event.sources, context.sourceRules);
  const reading = event.publicDate;
  const tooEarly = reading.ok
    ? kept.filter(({ publicationDate }) =>
        isTooEarly(publicationDate, reading.date, context.maxSourceLeadDays),
      )
    : [];
  const refusals: readonly ImportRefusal[] = [
    ...when(kept.length === 0, { reason: 'no_valid_source' } as const),
    ...tooEarly.map(({ position }): ImportRefusal => ({
      reason: 'source_before_public_date',
      sourcePosition: position,
    })),
  ];
  const sources = oldestFirst(kept).slice(0, context.maxSourcesPerEvent);
  const positions = new Set(sources.map(({ position }) => position));
  const allWarnings = [
    ...warnings.filter(
      (warning) => warning.kind === 'source_dropped' || positions.has(warning.position),
    ),
    ...sources.flatMap((source) => sourceWarnings(source)),
  ];
  return { value: sources, refusals, warnings: allWarnings };
}

/** The checks of one event (IMP-11 to IMP-15, IMP-19), before the links of the others are compared. */
function checkEvent(
  event: ResearchEvent,
  position: number,
  context: EventCheckContext,
): EventCheck | Accepted {
  const scope = checkScope(event, position, context);
  if (scope.kind === 'ignored') {
    return { position, outcome: 'ignored', reason: scope.reason };
  }
  const maxLength = context.maxDescriptionLength;
  const description = checkDescription(event.description, maxLength);
  const sources = checkEventSources(event, context);
  const eventContext = checkContext(event.context, maxLength);
  const note = checkNote(event.unverifiedNote, maxLength);
  const isConfidenceMissing = event.researchConfidence === undefined;
  // One warning per kind and field of the event, and per kind, field and source
  // (CL-IMP-02): each check raises a kind once on a field, and a source's warnings carry
  // its position, so that none repeats another.
  const warnings = [
    ...scope.warnings,
    ...description.warnings,
    ...sources.warnings,
    ...eventContext.warnings,
    ...when(isConfidenceMissing, { kind: 'confidence_defaulted' } as const),
    ...note.warnings,
  ];
  if (scope.kind === 'valid' && description.ok && sources.refusals.length === 0) {
    const accepted: AcceptedEvent = {
      type: scope.type,
      publicDate: scope.publicDate,
      description: description.value,
      sources: sources.value,
      context: eventContext.value,
      researchConfidence: event.researchConfidence ?? 'low',
      unverifiedNote: note.value,
    };
    return { position, outcome: 'accepted', event: accepted, warnings };
  }
  const refusals = [
    ...(scope.kind === 'refused' ? scope.refusals : []),
    ...(description.ok ? [] : description.refusals),
    ...sources.refusals,
  ];
  return { position, outcome: 'refused', refusals, warnings };
}

/**
 * For each accepted event that shares a cleaned link with another (IMP-17, CL-IMP-13), by
 * its position, the positions of the others that cite one of its links: the events that
 * cite each link are grouped once, so that the work grows with the citations and the
 * pairs of events that share a link, never with the square of the events.
 */
function sharingPositions(accepted: readonly Accepted[]): ReadonlyMap<number, readonly LinkPair[]> {
  const citations = accepted.flatMap(({ position, event }) =>
    event.sources.map(({ cleanedUrl }) => ({ position, cleanedUrl })),
  );
  const citing = Map.groupBy(citations, ({ cleanedUrl }) => cleanedUrl);
  const pairs = Array.from(citing.values(), (group) =>
    group.flatMap(({ position }) =>
      group
        .filter((citation) => citation.position !== position)
        .map((citation) => ({ position, other: citation.position })),
    ),
  ).flat();
  return Map.groupBy(pairs, ({ position }) => position);
}

/**
 * An accepted event with the warning of IMP-17 for each other accepted event that cites
 * one of its links once cleaned (CL-IMP-13), once each, in the order of the events, and
 * its outcome: added with warning when it has any warning, added otherwise.
 */
function settle(check: Accepted, sharing: ReadonlyMap<number, readonly LinkPair[]>): EventCheck {
  const pairs = sharing.get(check.position) ?? [];
  const others = new Set(pairs.map(({ other }) => other));
  const warnings = [
    ...check.warnings,
    ...[...others]
      .toSorted((left, right) => left - right)
      .map((otherPosition): ImportWarning => ({ kind: 'shared_link', otherPosition })),
  ];
  const outcome = warnings.length > 0 ? 'added_with_warning' : 'added';
  return { position: check.position, outcome, event: check.event, warnings };
}

/**
 * Checks each event of a research result and gives it exactly one outcome (IMP-11 to
 * IMP-15, IMP-17, IMP-19, DSN-01, DSN-03, DSN-24), in the order of `events`, its 1-based
 * position its place there (CL-IMP-02). Ignored, it gives the one reason of `checkScope`.
 * Refused, it lists every defect of IMP-11 to IMP-14 that it has, and nothing else
 * refuses (H-IMP-01): a missing or unknown type; a missing, malformed or nonexistent
 * public date; a description missing, too long or holding a quotation mark; no source
 * that `checkSources` keeps, or one published more than `imports.maxSourceLeadDays`
 * before the public date (CL-IMP-11). Added, it takes its type, the sources kept, the
 * oldest up to `backtests.maxSourcesPerEvent` (CL-IMP-16), its texts trimmed and its
 * defaults: confidence `low` and context `unknown` when missing or unknown, a note or a
 * detail too long dropped (IMP-15, CL-IMP-05); with any warning, among them one for
 * each other accepted event that cites one of its cleaned links (IMP-17), it is added
 * with warning.
 */
export function checkEvents(
  events: readonly ResearchEvent[],
  context: EventCheckContext,
): readonly EventCheck[] {
  const checks = events.map((event, index) => checkEvent(event, index + 1, context));
  const accepted = checks.filter((check): check is Accepted => check.outcome === 'accepted');
  const sharing = sharingPositions(accepted);
  return checks.map((check) => (check.outcome === 'accepted' ? settle(check, sharing) : check));
}

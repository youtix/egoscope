// Reading a research result in format 1.0 (IMP-04 to IMP-06, IMP-09, IMP-16, BKT-23,
// BKT-24): the JSON object isolated from the pasted text, a cut one recovered as far as
// the recovery allows (IMP-05), then its format and its version, its members checked as a
// whole and every field typed. Each event's own checks (IMP-11 to IMP-15) take this
// output; tying its reference and its player to a request is the import's (IMP-07).
import { canonicalValue, fold, isAbsent, isRecord } from '../conventions';
import { EXPLORATION_FORMAT } from '../exploration/format';
import { extractJson } from '../extract-json';
import { calendarDate, firstUnsorted, readDate } from './dates';
import {
  BACKTEST_FORMAT,
  FORMAT_VERSION,
  GAME_STAKES,
  INJURY_RETURNS,
  RESEARCH_CONFIDENCES,
  RESULT_SCHEMA,
  stripUnknownFields,
} from './format';
import { recoverCut } from './recover-cut';

import type { ExtractJsonError, JsonPath } from '../extract-json';
import type {
  ContextIndications,
  ResearchEvent,
  ResearchResult,
  ResearchSource,
  UnverifiedLead,
} from './format';
import type { CutRecovery } from './recover-cut';

/**
 * What the recovery of a cut result says of it (IMP-05, CL-IMP-18): how many events it
 * recovered, whether the cut fell after the events list, which lists the cut lost, and
 * whether the shortened covered period ends before it starts. A result read takes it to
 * the preview's notice and the import trace; a result refused once recovered keeps it for
 * the correction message, whose paragraph for a cut answer names the event being written
 * at the cut (IMP-21, CL-IMP-04).
 */
export type TruncationRecovery = Omit<CutRecovery, 'value'>;

/**
 * Why the whole result is refused, nothing being saved (IMP-04 to IMP-06, IMP-09), a code
 * of the glossary's `BlockingErrorKind`: the text holds no JSON object, several different
 * ones, a syntax error at `path`, or a cut at `path` that allows no recovery (IMP-05);
 * the object is not a backtest result, nor is a text whose objects name the exploration
 * format and not this one, whether cut, broken or pasted twice, or the result is of an
 * unknown version (IMP-06); its covered types, its covered period or its events are
 * missing or invalid (IMP-09). It never names the formats that JSON isolation found. The
 * import adds the size of the text (IMP-02) and the request and the player (IMP-07).
 */
export type ReadResultError =
  | Readonly<{
      kind:
        | 'no_result_found'
        | 'several_results'
        | 'not_a_backtest_result'
        | 'unknown_version'
        | 'covered_types_invalid'
        | 'covered_period_invalid'
        | 'events_missing';
    }>
  | Readonly<{ kind: 'syntax_error' | 'cut_not_recoverable'; path: JsonPath }>;

/**
 * A warning on the whole result (IMP-06, IMP-09, IMP-16, CL-IMP-06, CL-IMP-08, CL-IMP-19,
 * CL-IMP-23), a result-scope code of the glossary's `ImportWarningKind`. `detail` is the
 * number of unknown fields, or the position of the first event out of order, which only
 * the preview shows (the import trace stores no position).
 */
export type ReadResultWarning =
  | Readonly<{
      kind:
        | 'format_or_version_missing'
        | 'version_normalized'
        | 'covered_type_repeated'
        | 'covered_period_time_ignored'
        | 'lists_missing';
    }>
  | Readonly<{ kind: 'unknown_fields' | 'events_not_sorted'; detail: number }>;

/**
 * A research result read in format 1.0 with its whole-result warnings; or the blocking
 * errors that refuse it, every one that its covered types, its covered period and its
 * events give (IMP-09), with the warnings found until then. Either one, when the result
 * was recovered from a cut answer, carries what the recovery says of it: a refused one
 * too, since an IMP-06 or IMP-09 error alone does not say that the answer was cut, and
 * the correction message then asks for the rest (IMP-21, CL-IMP-04).
 */
export type ReadResultOutcome =
  | Readonly<{
      ok: true;
      result: ResearchResult;
      resultWarnings: readonly ReadResultWarning[];
      recovery: TruncationRecovery | undefined;
    }>
  | Readonly<{
      ok: false;
      errors: readonly ReadResultError[];
      resultWarnings: readonly ReadResultWarning[];
      recovery: TruncationRecovery | undefined;
    }>;

type Members = Readonly<Record<string, unknown>>;

// A member of the result checked as a whole (IMP-06, IMP-09): its value with its
// warnings, or why the whole result is refused.
type MemberReading<T> =
  | Readonly<{ ok: true; value: T; warnings: readonly ReadResultWarning[] }>
  | Readonly<{ ok: false; error: ReadResultError }>;

type Lists = Pick<ResearchResult, 'unverifiedLeads' | 'declaredLimitations'> &
  Readonly<{ warnings: readonly ReadResultWarning[] }>;

const NO_MEMBERS: Members = {};
const NO_WARNINGS: readonly ReadResultWarning[] = [];
// The members whose keys make the structure of a result recognized (CL-IMP-06).
const STRUCTURE_KEYS = ['covered_types', 'covered_period', 'events'];
// The lists that a result may leave out, which read as empty with a warning (IMP-09).
const RESULT_LISTS: TruncationRecovery['lostLists'] = ['unverified_leads', 'limitations'];
// Version 1.0 written as 1, as a text or as a number, as which JSON also reads 1.0 (CL-IMP-06).
const VERSION_ONE_TEXT = '1';
const VERSION_ONE_NUMBER = 1;

/** The members of an object; a value of another kind has none, so all its fields are missing. */
function membersOf(value: unknown): Members {
  return isRecord(value) ? value : NO_MEMBERS;
}

/** The elements of a list; a value of another kind has none. */
function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A field's text as written, or undefined when it is left out, `null`, blank or no text (CL-IMP-06). */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && !isAbsent(value) ? value : undefined;
}

/**
 * Whether an object is a research result (IMP-06, CL-IMP-06, CL-IMP-22): it names the
 * format, or names none and has the structure of a result. Any other format, an
 * exploration response's among them, of any kind, makes it no backtest result.
 */
function isResult(root: Members): boolean {
  const hasStructure = STRUCTURE_KEYS.every((key) => Object.hasOwn(root, key));
  return (
    canonicalValue(root['format'], [BACKTEST_FORMAT]) !== undefined ||
    (isAbsent(root['format']) && hasStructure)
  );
}

/**
 * The version of a result in format 1.0 (IMP-06, CL-IMP-06, CL-IMP-22), with its
 * warnings: version 1.0, 1.0 written as 1, as a text or as a number, or no version, which
 * assumes 1.0; or why the result is refused, as not a backtest result or of an unknown
 * version.
 */
function identify(root: Members): MemberReading<typeof FORMAT_VERSION> {
  if (!isResult(root)) {
    return { ok: false, error: { kind: 'not_a_backtest_result' } };
  }
  const version = root['format_version'];
  const isWrittenOne =
    version === VERSION_ONE_NUMBER || canonicalValue(version, [VERSION_ONE_TEXT]) !== undefined;
  const isVersionMissing = isAbsent(version);
  if (
    !isWrittenOne &&
    !isVersionMissing &&
    canonicalValue(version, [FORMAT_VERSION]) === undefined
  ) {
    return { ok: false, error: { kind: 'unknown_version' } };
  }
  const missing: readonly ReadResultWarning[] =
    isVersionMissing || isAbsent(root['format']) ? [{ kind: 'format_or_version_missing' }] : [];
  const normalized: readonly ReadResultWarning[] = isWrittenOne
    ? [{ kind: 'version_normalized' }]
    : [];
  return { ok: true, value: FORMAT_VERSION, warnings: [...missing, ...normalized] };
}

/**
 * The covered types (IMP-09, CL-IMP-22, CL-IMP-23): each declared type once, in the
 * request's spelling when it names a requested type and as written otherwise, an
 * element that is no text left out. A type repeats one kept before it when they fold
 * alike, which one set of the folds kept tells in one pass. Missing, empty or holding no
 * requested type, they refuse the result.
 */
function readCoveredTypes(
  value: unknown,
  requestedTypes: readonly string[],
): MemberReading<readonly string[]> {
  const declared = listOf(value)
    .map((element) => textOf(element))
    .filter((text) => text !== undefined)
    .map((text) => canonicalValue(text, requestedTypes) ?? text);
  const kept = new Set<string>();
  const types = declared.filter((type) => {
    const folded = fold(type);
    const isFirst = !kept.has(folded);
    kept.add(folded);
    return isFirst;
  });
  if (types.every((type) => !requestedTypes.includes(type))) {
    return { ok: false, error: { kind: 'covered_types_invalid' } };
  }
  const warnings: readonly ReadResultWarning[] =
    types.length < declared.length ? [{ kind: 'covered_type_repeated' }] : NO_WARNINGS;
  return { ok: true, value: types, warnings };
}

/**
 * The covered period (IMP-09, CL-IMP-08): the calendar dates of its bounds as written, a
 * bound written with a time keeping its date, with a warning. Missing, with a bound that
 * is missing or invalid, or starting after its end, it refuses the result, a recovered
 * one too, whose recovery leaves such a period as written; except once the recovery of a
 * cut result has ended a valid period before its start (CL-IMP-18).
 */
function readCoveredPeriod(
  value: unknown,
  isRetainedCoverageEmpty: boolean,
): MemberReading<ResearchResult['coveredPeriod']> {
  const period = membersOf(value);
  const start = readDate(period['start']);
  const end = readDate(period['end']);
  if (!start.ok || !end.ok || (!isRetainedCoverageEmpty && start.date.on > end.date.on)) {
    return { ok: false, error: { kind: 'covered_period_invalid' } };
  }
  // A bound written with no more than its date had no time.
  const warnings: readonly ReadResultWarning[] =
    start.text === start.date.on && end.text === end.date.on
      ? NO_WARNINGS
      : [{ kind: 'covered_period_time_ignored' }];
  return { ok: true, value: { startOn: start.date.on, endOn: end.date.on }, warnings };
}

function readSource(value: unknown): ResearchSource {
  const source = membersOf(value);
  return {
    url: textOf(source['url']),
    outlet: textOf(source['outlet']),
    title: textOf(source['title']),
    publicationDate: readDate(source['publication_date']),
  };
}

function readContext(value: unknown): ContextIndications {
  const context = membersOf(value);
  return {
    injuryReturn: canonicalValue(context['injury_return'], INJURY_RETURNS),
    gameStakes: canonicalValue(context['game_stakes'], GAME_STAKES),
    detail: textOf(context['detail']),
  };
}

function readEvent(value: unknown): ResearchEvent {
  const event = membersOf(value);
  return {
    eventType: textOf(event['event_type']),
    publicDate: readDate(event['public_date']),
    description: textOf(event['description']),
    sources: listOf(event['sources']).map((source) => readSource(source)),
    context: readContext(event['context']),
    researchConfidence: canonicalValue(event['confidence'], RESEARCH_CONFIDENCES),
    unverifiedNote: textOf(event['unverified_note']),
  };
}

/**
 * The events (IMP-09, CL-IMP-19): every element in its place, read. Missing or not a list,
 * they refuse the result; not sorted by the calendar dates of their public dates
 * (CL-BKT-15), they give a warning with the position of the first event out of order.
 */
function readEvents(value: unknown): MemberReading<readonly ResearchEvent[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: { kind: 'events_missing' } };
  }
  const events: readonly unknown[] = value;
  const days = events.map((event) => calendarDate(membersOf(event)['public_date']));
  const unsorted = firstUnsorted(days);
  const warnings: readonly ReadResultWarning[] =
    unsorted === undefined ? NO_WARNINGS : [{ kind: 'events_not_sorted', detail: unsorted + 1 }];
  return { ok: true, value: events.map((event) => readEvent(event)), warnings };
}

function readLead(value: unknown): UnverifiedLead {
  const lead = membersOf(value);
  return {
    eventType: textOf(lead['event_type']),
    approximatePeriod: textOf(lead['approximate_period']),
    description: textOf(lead['description']),
    reason: textOf(lead['reason']),
  };
}

/**
 * The leads and limitations (IMP-09): a list that is missing or not a list reads as
 * empty, with one warning for both lists, unless the cut of a recovered result lost it
 * (CL-IMP-18).
 */
function readLists(root: Members, recovery: TruncationRecovery | undefined): Lists {
  const isMissing = RESULT_LISTS.some(
    (list) => recovery?.lostLists.includes(list) !== true && !Array.isArray(root[list]),
  );
  return {
    unverifiedLeads: listOf(root['unverified_leads']).map((lead) => readLead(lead)),
    declaredLimitations: listOf(root['limitations']).map((limitation) => textOf(limitation)),
    warnings: isMissing ? [{ kind: 'lists_missing' }] : NO_WARNINGS,
  };
}

function unknownFieldsWarning(unknownFieldCount: number): readonly ReadResultWarning[] {
  return unknownFieldCount > 0 ? [{ kind: 'unknown_fields', detail: unknownFieldCount }] : [];
}

/**
 * The outcome that refuses the whole result, with the warnings found until then and what
 * the recovery says of a cut answer that it allowed.
 */
function refused(
  errors: readonly ReadResultError[],
  recovery?: TruncationRecovery,
  resultWarnings: readonly ReadResultWarning[] = NO_WARNINGS,
): ReadResultOutcome {
  return { ok: false, errors, resultWarnings, recovery };
}

function readPlayer(value: unknown): ResearchResult['player'] {
  const player = membersOf(value);
  return { id: textOf(player['id']), name: textOf(player['name']) };
}

/** Reads the isolated object, whole or recovered from a cut answer, as a result in format 1.0. */
function readObject(
  value: unknown,
  requestedTypes: readonly string[],
  recovery: TruncationRecovery | undefined,
): ReadResultOutcome {
  const stripped = stripUnknownFields(value, RESULT_SCHEMA);
  const root = membersOf(stripped.value);
  const version = identify(root);
  if (!version.ok) {
    return refused([version.error], recovery);
  }
  const coveredTypes = readCoveredTypes(root['covered_types'], requestedTypes);
  const coveredPeriod = readCoveredPeriod(
    root['covered_period'],
    recovery?.retainedCoverageEmpty === true,
  );
  const events = readEvents(root['events']);
  const lists = readLists(root, recovery);
  const checked = [coveredTypes, coveredPeriod, events];
  const resultWarnings = [
    ...version.warnings,
    ...checked.flatMap((member) => (member.ok ? member.warnings : [])),
    ...lists.warnings,
    ...unknownFieldsWarning(stripped.unknownFieldCount),
  ];
  if (!coveredTypes.ok || !coveredPeriod.ok || !events.ok) {
    const errors = checked.flatMap((member) => (member.ok ? [] : [member.error]));
    return refused(errors, recovery, resultWarnings);
  }
  return {
    ok: true,
    result: {
      formatVersion: version.value,
      reference: textOf(root['request_reference']),
      player: readPlayer(root['player']),
      coveredTypes: coveredTypes.value,
      coveredPeriod: coveredPeriod.value,
      events: events.value,
      unverifiedLeads: lists.unverifiedLeads,
      declaredLimitations: lists.declaredLimitations,
    },
    resultWarnings,
    recovery,
  };
}

/**
 * Whether no single object was isolated from a text whose objects name the exploration
 * format and not this one (IMP-06, CL-IMP-06): an exploration response cut, broken or
 * pasted twice, which is no backtest result, whatever its fault.
 */
function isExplorationText(error: ExtractJsonError): boolean {
  return error.formats.includes(EXPLORATION_FORMAT) && !error.formats.includes(BACKTEST_FORMAT);
}

/**
 * Reads a research result in format 1.0 from the text pasted for a request (IMP-04 to
 * IMP-06, IMP-09, IMP-16, BKT-23, BKT-24, CL-BKT-02). The JSON object is isolated from the
 * text (IMP-04), a result kept over an exploration response pasted with it; a text whose
 * objects name the exploration format and not this one is refused as not a backtest
 * result before any recovery, cut, broken or pasted twice (IMP-06), as CL-IMP-06 rules.
 * Otherwise a cut answer goes to the recovery of IMP-05, which, when it allows, gives the
 * result read like a whole one, every recovered event included, its covered period as
 * the recovery leaves it (CL-IMP-18); read or refused, it keeps what the recovery says of
 * the cut, which the correction message needs (IMP-21, CL-IMP-04). The result names
 * format egoscope-backtest and version 1.0; a missing format or version assumes 1.0 with
 * a warning when the structure is recognized (CL-IMP-06), and version 1 does with a
 * warning. Its covered
 * types, which must hold one of `requestedTypes`, the request's types, count each once
 * (CL-IMP-23); its covered period keeps the calendar dates of its bounds (CL-IMP-08); its
 * events are a list, maybe empty (BKT-23), whose order the warning of CL-IMP-19 checks;
 * missing leads and limitations read as empty with a warning. Identifiers, enumerated
 * values, the format and its version compare trimmed, without case or accents
 * (CL-IMP-22); a key that the format does not define is dropped, and counted in one
 * warning (IMP-16); `null` or a blank text is a missing field (CL-IMP-06). The reference
 * and the player come back as written, for the import to tie to the request (IMP-07).
 */
export function readResult(
  pastedText: string,
  requestedTypes: readonly string[],
): ReadResultOutcome {
  const isolated = extractJson(pastedText, BACKTEST_FORMAT);
  if (isolated.ok) {
    return readObject(isolated.value, requestedTypes, undefined);
  }
  const { error } = isolated;
  if (isExplorationText(error)) {
    return refused([{ kind: 'not_a_backtest_result' }]);
  }
  if (error.kind === 'syntax_error') {
    return refused([{ kind: error.kind, path: error.path }]);
  }
  if (error.kind !== 'cut') {
    return refused([{ kind: error.kind }]);
  }
  const recovered = recoverCut(error.partialText);
  if (!recovered.ok) {
    return refused([{ kind: 'cut_not_recoverable', path: error.path }]);
  }
  const { value, ...recovery } = recovered.recovery;
  return readObject(value, requestedTypes, recovery);
}

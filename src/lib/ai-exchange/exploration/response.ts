// The exploration response of TAX-17, in format egoscope-exploration 1.0 (CL-TAX-04),
// read as the research import reads a result (CL-IMP-06). The pasted text is bounded in
// UTF-8 bytes (IMP-02, CL-IMP-27), then extractJson isolates its JSON object, this format
// preferred among several (IMP-04). A text that holds no single readable response is
// refused whole, with a plain message that says what is wrong and how to fix it; a cut
// response is never recovered, unlike a research result (CL-IMP-18). Otherwise each
// element of each proposed type is read in its form or reported missing, unknown fields
// are ignored and flagged once (IMP-16), and a possible citation marker in a text that a
// proposal would store is flagged, never rewritten (CL-IMP-07). Nothing else is repaired,
// and every text stays as written. The source checks of IMP-14 on the illustration
// sources are the taxonomy's (taxonomy/exploration.ts).
import { canonicalValue, isAbsent } from '../conventions';
import { extractJson } from '../extract-json';
import { hasPossibleCitationMarker } from '../research-result/text-signals';

import type { ExtractJsonError, JsonPath } from '../extract-json';

// The elements of a proposed type, by their keys, in the order of the format (CL-TAX-04,
// glossary section 6.2).
const PROPOSED_TYPE_ELEMENTS = [
  'name',
  'definition',
  'inclusion_criteria',
  'exclusion_criteria',
  'dating_rule',
  'known_in_advance',
  'generic_example',
  'documentation_difficulty',
  'possible_overlaps',
  'illustration_sources',
] as const;

/** An element of a proposed type, by its key in the format (CL-TAX-04). */
export type ProposedTypeElement = (typeof PROPOSED_TYPE_ELEMENTS)[number];

// The elements whose texts a proposal stores in its sheet, in the order of the format,
// which a citation marker is looked for in (CL-IMP-07).
const SHEET_TEXTS = [
  'name',
  'definition',
  'inclusion_criteria',
  'exclusion_criteria',
  'dating_rule',
  'generic_example',
] as const;
type SheetText = (typeof SHEET_TEXTS)[number];

// How hard a type is to document (TAX-08), in the glossary's values.
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
type DocumentationDifficulty = (typeof DIFFICULTIES)[number];

/**
 * An illustration source as the response writes it, with the keys of a research-result
 * source (CL-TAX-04), before the source checks of IMP-14: each field its text, or
 * undefined when it is left out, null, empty or not a text (CL-IMP-06). `citationMarkers`
 * names the outlet or the title when it holds a possible citation marker, kept as written
 * (CL-IMP-07).
 */
export type IllustrationSource = Readonly<{
  url: string | undefined;
  outlet: string | undefined;
  title: string | undefined;
  publicationDate: string | undefined;
  citationMarkers: readonly ('outlet' | 'title')[];
}>;

/**
 * A proposed type as read (TAX-17, CL-TAX-04). An element is undefined when it is
 * missing: left out, null, an empty text or a value of another form (CL-IMP-06). Texts
 * stay as written; the documentation difficulty is the glossary's value (CL-IMP-22);
 * `knownInAdvance` is the "known in advance" mark only, never "derived from the calendar"
 * (CL-TAX-20); a list keeps its texts or its sources, possibly none. An item without a
 * name cannot become a proposal. `missingElements` lists the missing elements in the
 * order of the format, and `citationMarkers` the texts of the sheet that hold a possible
 * citation marker (CL-IMP-07); the possible overlaps, which are never stored, are not
 * looked at.
 */
export type ProposedType = (
  | Readonly<{ canBecomeProposal: true; name: string }>
  | Readonly<{ canBecomeProposal: false; name: undefined }>
) &
  Readonly<{
    definition: string | undefined;
    inclusionCriteria: string | undefined;
    exclusionCriteria: string | undefined;
    datingRule: string | undefined;
    knownInAdvance: boolean | undefined;
    genericExample: string | undefined;
    documentationDifficulty: DocumentationDifficulty | undefined;
    possibleOverlaps: readonly string[] | undefined;
    illustrationSources: readonly IllustrationSource[] | undefined;
    missingElements: readonly ProposedTypeElement[];
    citationMarkers: readonly SheetText[];
  }>;

/**
 * A warning on the whole response, with its plain message (CL-TAX-04, CL-IMP-06): the
 * import's codes and labels (glossary section 4.1, `ImportWarningKind`).
 */
export type ExplorationWarning = Readonly<{
  kind: 'format_or_version_missing' | 'version_normalized' | 'unknown_fields';
  message: string;
}>;

/**
 * The response as read: its proposed types, in the order of the response, none when the
 * AI proposed none, and its warnings.
 */
export type ExplorationResponse = Readonly<{
  proposedTypes: readonly ProposedType[];
  warnings: readonly ExplorationWarning[];
}>;

/**
 * Why the response was refused whole, nothing being read from it (TAX-17, CL-TAX-04), with
 * the plain message that says what is wrong and how to fix it.
 */
export type ExplorationResponseError = Readonly<{
  kind:
    | 'text_too_large'
    | 'no_result_found'
    | 'several_results'
    | 'syntax_error'
    | 'cut_not_recoverable'
    | 'unknown_version'
    | 'not_an_exploration_response'
    | 'proposed_types_missing';
  message: string;
}>;

/** The response as read, or why it was refused. */
export type ExplorationResponseResult =
  | Readonly<{ ok: true; response: ExplorationResponse }>
  | Readonly<{ ok: false; error: ExplorationResponseError }>;

// The members of a JSON object, by key.
type Fields = ReadonlyMap<string, unknown>;

// How a value of the response's header differs from the one expected, compared as
// CL-IMP-22 says: it is missing, or it is another value. The version written 1 reads as
// normalized.
type Deviation = 'missing' | 'other';
type VersionDeviation = Deviation | 'normalized';

// The header as read, neither its format nor its version refused: how each one differs
// from the one expected, if it does.
type Header = Readonly<{ format: Deviation | undefined; version: VersionDeviation | undefined }>;

// The name and the version of the format (TAX-17, CL-TAX-04), and the version written 1,
// as a text or a number, which reads as 1.0 with a warning (CL-IMP-06); JSON reads the
// number 1.0 as 1.
const EXPLORATION_FORMAT = 'egoscope-exploration';
const FORMAT_VERSION = '1.0';
const SHORT_VERSION = '1';
const SHORT_VERSION_NUMBER = 1;

// The keys of the format at the root and in a source (glossary section 6.2): any other
// is an unknown field. The outlet and the title are the texts of a source that a
// proposal stores, which a citation marker is looked for in (CL-IMP-07).
const RESPONSE_KEYS: readonly string[] = ['format', 'format_version', 'proposed_types'];
const SOURCE_KEYS: readonly string[] = ['url', 'outlet', 'title', 'publication_date'];
const SOURCE_TEXTS: readonly ('outlet' | 'title')[] = ['outlet', 'title'];

// A megabyte is 1,000,000 bytes of UTF-8 (CL-IMP-27). A size is written in MB to the
// hundredth above, so that a text over the limit never reads as one at the limit.
const BYTES_PER_MEGABYTE = 1_000_000;
const HUNDREDTHS = 100;
// encodeURIComponent writes each byte of a character's UTF-8 encoding that is no
// unreserved ASCII character as %XX: three characters, two more than the byte.
const EXTRA_CHARACTERS_PER_ESCAPE = 2;

// The plain messages, worded like the import's (glossary section 7.3, CL-IMP-02): the
// place, what is wrong, how to fix it. The refusal of another format is the glossary's
// own sentence (CA-TAX-17), and so are the warnings' labels (section 4.1).
const NO_RESPONSE_FOUND = "No recognizable response: check that you copied the AI's whole answer.";
const SEVERAL_RESPONSES =
  'The text holds several different JSON objects. Paste only one exploration response.';
const SYNTAX_ERROR_FIX =
  'Ask the AI to send the whole response again as strict JSON: straight quotation marks, no comment, no citation marker and no comma after the last item of a list.';
const CUT_FIX = 'Copy the whole answer again, or ask the AI for fewer types.';
const UNKNOWN_VERSION =
  'This response is not in format version 1.0, the only one Egoscope reads. Generate the exploration prompt again and give it to the AI.';
const NOT_AN_EXPLORATION_RESPONSE = 'This text is not an exploration response.';
const PROPOSED_TYPES_MISSING =
  'The response has no list of proposed types (proposed_types). Ask the AI to answer again in the format of the exploration prompt.';
const FORMAT_OR_VERSION_MISSING: ExplorationWarning = {
  kind: 'format_or_version_missing',
  message: 'Format or version missing: version 1.0 assumed',
};
const VERSION_NORMALIZED: ExplorationWarning = {
  kind: 'version_normalized',
  message: 'Format version read as 1.0',
};
const UNKNOWN_FIELDS: ExplorationWarning = {
  kind: 'unknown_fields',
  message: 'Unknown fields ignored',
};

function refused(
  kind: ExplorationResponseError['kind'],
  message: string,
): ExplorationResponseResult {
  return { ok: false, error: { kind, message } };
}

/**
 * The size of a text in UTF-8, in bytes. A lone surrogate, which encodeURIComponent
 * refuses, counts as the replacement character U+FFFD that an encoder writes instead.
 */
function utf8Size(text: string): number {
  const encoded = encodeURIComponent(text.toWellFormed());
  const escapes = encoded.split('%').length - 1;
  return encoded.length - escapes * EXTRA_CHARACTERS_PER_ESCAPE;
}

/** A size in bytes, in MB to the hundredth above. */
function megabytes(bytes: number): string {
  return String(Math.ceil((bytes * HUNDREDTHS) / BYTES_PER_MEGABYTE) / HUNDREDTHS);
}

/** The 1-based position of the proposed type that a place lies in, if it lies in one. */
function proposedTypeAt(path: JsonPath): number | undefined {
  const [key, index] = path;
  return key === 'proposed_types' && typeof index === 'number' ? index + 1 : undefined;
}

/**
 * Where a syntax error lies, roughly (IMP-04): in a proposed type, by its position; at
 * the start of the response, before its first key; or around the field of the root that
 * the reading last entered.
 */
function syntaxErrorPlace(path: JsonPath): string {
  const position = proposedTypeAt(path);
  if (position !== undefined) {
    return `around proposed type ${String(position)}`;
  }
  const [key] = path;
  return key === undefined ? 'at the start of the response' : `around the field ${String(key)}`;
}

function cutMessage(path: JsonPath): string {
  const position = proposedTypeAt(path);
  const cutOff = position === undefined ? '' : `: proposed type ${String(position)} is cut off`;
  return `The text stops before the end of the response${cutOff}. ${CUT_FIX}`;
}

/** Why no single object could be read, as the refusal of the response. */
function extractionRefusal(error: ExtractJsonError): ExplorationResponseResult {
  switch (error.kind) {
    case 'no_result_found': {
      return refused('no_result_found', NO_RESPONSE_FOUND);
    }
    case 'several_results': {
      return refused('several_results', SEVERAL_RESPONSES);
    }
    case 'syntax_error': {
      const place = syntaxErrorPlace(error.path);
      return refused('syntax_error', `The JSON is not valid ${place}. ${SYNTAX_ERROR_FIX}`);
    }
    case 'cut': {
      return refused('cut_not_recoverable', cutMessage(error.path));
    }
  }
}

/** The members of a value that JSON read, when it is an object; none otherwise. */
function fieldsOf(value: unknown): Fields {
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  return new Map<string, unknown>(isObject ? Object.entries(value) : []);
}

/** The elements of a value that JSON read, when it is a list; undefined otherwise. */
function listOf(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** Says whether a value is a text with content, which null or an empty text is not (CL-IMP-06). */
function isText(value: unknown): value is string {
  return typeof value === 'string' && !isAbsent(value);
}

function textOf(value: unknown): string | undefined {
  return isText(value) ? value : undefined;
}

/** Says whether a value is a text that holds a possible citation marker (CL-IMP-07). */
function isMarkedText(value: unknown): boolean {
  return typeof value === 'string' && hasPossibleCitationMarker(value);
}

function sourceOf(value: unknown): IllustrationSource {
  const fields = fieldsOf(value);
  return {
    url: textOf(fields.get('url')),
    outlet: textOf(fields.get('outlet')),
    title: textOf(fields.get('title')),
    publicationDate: textOf(fields.get('publication_date')),
    citationMarkers: SOURCE_TEXTS.filter((key) => isMarkedText(fields.get(key))),
  };
}

function readProposedType(value: unknown): ProposedType {
  // A text of the sheet, by its key, as read.
  type SheetTextRead = readonly [SheetText, string | undefined];
  const fields = fieldsOf(value);
  const texts = SHEET_TEXTS.map((key): SheetTextRead => [key, textOf(fields.get(key))]);
  const text = new Map(texts);
  const known = fields.get('known_in_advance');
  const elements = {
    definition: text.get('definition'),
    inclusionCriteria: text.get('inclusion_criteria'),
    exclusionCriteria: text.get('exclusion_criteria'),
    datingRule: text.get('dating_rule'),
    knownInAdvance: typeof known === 'boolean' ? known : undefined,
    genericExample: text.get('generic_example'),
    documentationDifficulty: canonicalValue(fields.get('documentation_difficulty'), DIFFICULTIES),
    possibleOverlaps: listOf(fields.get('possible_overlaps'))?.filter((element) => isText(element)),
    illustrationSources: listOf(fields.get('illustration_sources'))?.map((item) => sourceOf(item)),
  };
  // Each element as read, by its key: the texts of the sheet, then the others.
  const read = new Map<ProposedTypeElement, unknown>([
    ...texts,
    ['known_in_advance', elements.knownInAdvance],
    ['documentation_difficulty', elements.documentationDifficulty],
    ['possible_overlaps', elements.possibleOverlaps],
    ['illustration_sources', elements.illustrationSources],
  ]);
  const name = text.get('name');
  const reports = {
    ...elements,
    missingElements: PROPOSED_TYPE_ELEMENTS.filter((key) => read.get(key) === undefined),
    citationMarkers: SHEET_TEXTS.filter((key) => isMarkedText(fields.get(key))),
  };
  return name === undefined
    ? { canBecomeProposal: false, name, ...reports }
    : { canBecomeProposal: true, name, ...reports };
}

/** Says whether an object has a member under none of the keys given, which are distinct. */
function hasUnknownKey(fields: Fields, keys: readonly string[]): boolean {
  return fields.size > keys.filter((key) => fields.has(key)).length;
}

/**
 * Says whether the response holds a field that the format does not define, at the root,
 * in a proposed type or in an illustration source (IMP-16).
 */
function hasUnknownField(root: Fields, proposedTypes: readonly unknown[]): boolean {
  const items = proposedTypes.map((item) => fieldsOf(item));
  const sources = items.flatMap(
    (fields) => listOf(fields.get('illustration_sources'))?.map((source) => fieldsOf(source)) ?? [],
  );
  return (
    hasUnknownKey(root, RESPONSE_KEYS) ||
    items.some((fields) => hasUnknownKey(fields, PROPOSED_TYPE_ELEMENTS)) ||
    sources.some((fields) => hasUnknownKey(fields, SOURCE_KEYS))
  );
}

/** How a value of the header differs from the one expected, if it does. */
function deviationOf(value: unknown, expected: string): Deviation | undefined {
  if (isAbsent(value)) {
    return 'missing';
  }
  return canonicalValue(value, [expected]) === undefined ? 'other' : undefined;
}

function versionDeviationOf(value: unknown): Header['version'] {
  const isShort =
    value === SHORT_VERSION_NUMBER || canonicalValue(value, [SHORT_VERSION]) !== undefined;
  return isShort ? 'normalized' : deviationOf(value, FORMAT_VERSION);
}

/** The warnings on the whole response, each given at most once, in the glossary's order. */
function warningsOf(
  header: Header,
  root: Fields,
  proposedTypes: readonly unknown[],
): readonly ExplorationWarning[] {
  const warnings: readonly (readonly [boolean, ExplorationWarning])[] = [
    [header.format === 'missing' || header.version === 'missing', FORMAT_OR_VERSION_MISSING],
    [header.version === 'normalized', VERSION_NORMALIZED],
    [hasUnknownField(root, proposedTypes), UNKNOWN_FIELDS],
  ];
  return warnings.filter(([applies]) => applies).map(([, warning]) => warning);
}

/**
 * Reads the isolated object (CL-TAX-04, IMP-06). Another format refuses it, and so does a
 * missing one unless the structure is recognized, by its list of proposed types; then an
 * unknown version refuses it, and so does a missing list of proposed types.
 */
function readResponse(root: Fields): ExplorationResponseResult {
  const format = deviationOf(root.get('format'), EXPLORATION_FORMAT);
  const version = versionDeviationOf(root.get('format_version'));
  const proposedTypes = listOf(root.get('proposed_types'));
  if (format === 'other' || (format === 'missing' && proposedTypes === undefined)) {
    return refused('not_an_exploration_response', NOT_AN_EXPLORATION_RESPONSE);
  }
  if (version === 'other') {
    return refused('unknown_version', UNKNOWN_VERSION);
  }
  if (proposedTypes === undefined) {
    return refused('proposed_types_missing', PROPOSED_TYPES_MISSING);
  }
  return {
    ok: true,
    response: {
      proposedTypes: proposedTypes.map((item) => readProposedType(item)),
      warnings: warningsOf({ format, version }, root, proposedTypes),
    },
  };
}

/**
 * Reads an exploration response pasted from a research AI, in format egoscope-exploration
 * 1.0 (TAX-17, CL-TAX-04), with the reading rules of the research import (CL-IMP-06). A
 * text over `maxPastedTextMegabytes` (`imports.maxPastedTextMegabytes`), counted in UTF-8
 * bytes, is refused (IMP-02, CL-IMP-27). Its JSON is isolated by extractJson, this format
 * preferred among several objects: prose around it, code fences and invisible characters
 * are ignored, and copies equal value for value count as one (IMP-04). The response is
 * refused whole, with a plain message, when the text holds no object or several different
 * ones; when the JSON breaks its syntax, located around its proposed type; when the text
 * is cut, with the advice to ask for fewer types; for any other format, egoscope-backtest
 * included ("This text is not an exploration response.", CA-TAX-17); for an unknown
 * version, with the advice to generate the prompt again; and without its list of proposed
 * types. A missing format or version, the list being there, reads as 1.0 with a warning,
 * and so does the version written 1 (CL-IMP-06); closed values are compared trimmed,
 * without case or accents (CL-IMP-22). Each proposed type is read with its missing
 * elements and its citation markers (CL-IMP-07); unknown fields are ignored and flagged
 * once (IMP-16).
 */
export function parseExplorationResponse(
  pastedText: string,
  params: Readonly<{ maxPastedTextMegabytes: number }>,
): ExplorationResponseResult {
  const size = utf8Size(pastedText);
  const limit = params.maxPastedTextMegabytes;
  if (size > limit * BYTES_PER_MEGABYTE) {
    const message = `The pasted text is ${megabytes(size)} MB, over the ${String(limit)} MB limit.`;
    return refused('text_too_large', message);
  }
  const extracted = extractJson(pastedText, EXPLORATION_FORMAT);
  return extracted.ok
    ? readResponse(fieldsOf(extracted.value))
    : extractionRefusal(extracted.error);
}

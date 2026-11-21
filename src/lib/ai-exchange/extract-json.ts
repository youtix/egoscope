// Isolation of the JSON object in a text pasted from a research AI (IMP-04, BKT-26),
// tested against the usual quirks of their answers (ADR 0013). The text loses what
// the AI or the copy adds around the JSON: invisible characters anywhere, code
// fences, trailing spaces. Then each object that can start in it is read token by
// token, no-break and other Unicode spaces counting as spaces between tokens, and
// nothing else is repaired (CL-IMP-06): a fault is a syntax error at its place, and
// a text that ends inside the object is cut, which the recovery of IMP-05 reads.
import { canonicalValue, valuesOf } from './conventions';

/**
 * A place inside an object: the keys and array indexes from its root, indexes counted
 * from 0, so that `['events', 11, 'description']` lies in event 12.
 */
export type JsonPath = readonly (number | string)[];

// The names of the two formats of Egoscope: the research result's (BKT-24) and the
// exploration response's (TAX-17). A reader may prefer its own.
const FORMAT_NAMES = valuesOf(['egoscope-backtest', 'egoscope-exploration']);
type FormatName = (typeof FORMAT_NAMES)[number];

// Why no single object was isolated, before the formats that the text names are added.
type Fault =
  | Readonly<{ kind: 'no_result_found' }>
  | Readonly<{ kind: 'several_results' }>
  | Readonly<{ kind: 'syntax_error'; path: JsonPath }>
  | Readonly<{ kind: 'cut'; path: JsonPath; partialText: string }>;

/**
 * Why no single object was isolated:
 * - `no_result_found`: the text holds no JSON object;
 * - `several_results`: it holds different ones among those it keeps: the objects in
 *   the format that the reader prefers, else those in a format of Egoscope, else, when
 *   none is in one, all of them; so the owner is asked to paste only one;
 * - `syntax_error`: the object breaks the JSON syntax, and the reading stopped at
 *   `path`, the value read or last read there;
 * - `cut`: the text ends inside the object, at `path`; `partialText` is the object as
 *   far as it goes, its tokens as written without the spaces between them.
 *
 * `formats` names the formats of Egoscope that the objects of the text name in their own
 * `format` member, whether they can be read or not, each once, in the order of
 * egoscope-backtest then egoscope-exploration (IMP-06, CA-TAX-17, CL-IMP-22): so a reader
 * tells a text in the other format, cut, broken or pasted twice, from one in its own. A
 * member is named only once it is read: an object whose JSON breaks or stops at or before
 * its `format` member names no format, and neither does a text without an object.
 */
export type ExtractJsonError = Fault & Readonly<{ formats: readonly FormatName[] }>;

/** The isolated object, as JSON reads it, or why there is none. */
export type ExtractJsonResult =
  Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; error: ExtractJsonError }>;

// The reading of one object, or of the text, before the formats are added to its fault.
type Reading = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; error: Fault }>;

// A token as written: a punctuation mark, whose value is itself, or a string, a number,
// true, false or null, with its value as JSON reads it.
type ReadToken = Readonly<{ text: string; value: unknown; isPunctuation: boolean }>;
// Or no token: one that JSON refuses, or the end of the text, before or inside one.
type Token = ReadToken | 'invalid' | 'unfinished';

// An open object or array: in an object, the key last read; in an array, the index of
// the element read or last read.
type Frame = { readonly isArray: boolean; key: string | undefined; index: number };
type Expected = 'colon' | 'first_key' | 'first_value' | 'key' | 'next' | 'value';

type Candidate = Readonly<{
  // The tokens read, without the spaces between them: what a copy that cannot be read
  // is compared by.
  compact: string;
  // The value of the object's own `format` member, when read before a fault or a cut.
  format: unknown;
  // Where the search for the next object goes on: after the object, or at its fault.
  resumeAt: number;
  result: Reading;
}>;

// Two values that JSON read, for a comparison of copies.
type ValuePair = readonly [unknown, unknown];

// The zero-width space and non-joiner, the word joiner, the byte-order mark and the
// zero-width joiner, last, so that it joins no two characters of the class.
const INVISIBLE_CHARACTERS = /[\u{200B}\u{200C}\u{2060}\u{FEFF}\u{200D}]/gu;

// A code fence, three or more backticks or tildes at the start of a line, with the
// spaces around it and its language tag, which the object may follow on the same line.
// The tag runs from the fence and the spaces after it up to the first white space or
// opening brace, so that json-ld, c++ or objective-c is stripped whole. A line starts
// where the character before, if any, is a line feed or a carriage return: U+2028 and
// U+2029, which JSON allows inside a string, start none.
const CODE_FENCE = /(?<![^\n\r])[ \t]*(?:`{3,}|~{3,})[ \t]*[^\s{]*/gu;

// Where the spaces that a text starts with end, JSON's and the Unicode ones.
const END_OF_SPACES = /\S|$/u;

// A token: a punctuation mark; a string, up to the first quotation mark that no
// backslash escapes; anything else, up to a space, a quotation mark or punctuation.
const TOKEN = /^(?:[{}[\]:,]|"(?:[^"\\]|\\.)*"|[^\s",:[\]{}]+)/su;

// The punctuation marks of JSON, each of them a token.
const PUNCTUATION = '{}[]:,';

// A brace that starts an object: a key follows, between quotation marks of any kind,
// so that curly-quoted keys are read, and refused, or the closing brace.
const OBJECT_START = /\{(?=\s*["'‘’“”}])/gu;

function failure(error: Fault): Reading {
  return { ok: false, error };
}

function openFrame(isArray: boolean): Frame {
  return { isArray, key: undefined, index: 0 };
}

function placeOf(frame: Frame): JsonPath {
  if (frame.isArray) {
    return [frame.index];
  }
  return frame.key === undefined ? [] : [frame.key];
}

/** How many spaces, JSON's and the Unicode ones, `rest` starts with. */
function leadingSpaces(rest: string): number {
  return rest.search(END_OF_SPACES);
}

/** The token that `rest` starts with, the spaces before it already skipped. */
function readToken(rest: string): Token {
  const token = TOKEN.exec(rest)?.[0];
  if (token === undefined) {
    // The end of the text, or a string that no quotation mark closes.
    return 'unfinished';
  }
  if (PUNCTUATION.includes(token)) {
    return { text: token, value: token, isPunctuation: true };
  }
  try {
    const value: unknown = JSON.parse(token);
    return { text: token, value, isPunctuation: false };
  } catch {
    // An escape that JSON does not know, a control character in a string, or a word that
    // is no value: unfinished when the text ends with it.
    return token.length === rest.length ? 'unfinished' : 'invalid';
  }
}

/**
 * Reads the object that starts at a brace of the text, one token at a time and without
 * recursion, so that no depth of nesting can overflow the stack.
 */
class ObjectScanner {
  readonly #text: string;
  readonly #root = openFrame(false);
  readonly #parents: Frame[] = [];
  readonly #tokens = ['{'];
  #current = this.#root;
  #expected: Expected = 'first_key';
  #format: unknown;
  #index: number;
  #closed = false;

  constructor(text: string, start: number) {
    this.#text = text;
    this.#index = start + 1;
  }

  #accept(token: ReadToken): boolean {
    switch (this.#expected) {
      case 'value': {
        return this.#value(token);
      }
      case 'first_value': {
        return token.text === ']' ? this.#close() : this.#value(token);
      }
      case 'key': {
        return this.#key(token);
      }
      case 'first_key': {
        return token.text === '}' ? this.#close() : this.#key(token);
      }
      case 'colon': {
        return token.text === ':' && this.#expect('value');
      }
      case 'next': {
        return this.#next(token);
      }
    }
  }

  #expect(expected: Expected): true {
    this.#expected = expected;
    return true;
  }

  #value(token: ReadToken): boolean {
    if (token.text === '{' || token.text === '[') {
      const isArray = token.text === '[';
      this.#parents.push(this.#current);
      this.#current = openFrame(isArray);
      return this.#expect(isArray ? 'first_value' : 'first_key');
    }
    if (token.isPunctuation) {
      return false;
    }
    if (this.#current === this.#root && this.#root.key === 'format') {
      this.#format = token.value;
    }
    return this.#expect('next');
  }

  #key(token: ReadToken): boolean {
    if (token.isPunctuation || typeof token.value !== 'string') {
      return false;
    }
    this.#current.key = token.value;
    return this.#expect('colon');
  }

  #next(token: ReadToken): boolean {
    const current = this.#current;
    if (token.text === ',') {
      current.index += 1;
      return this.#expect(current.isArray ? 'value' : 'key');
    }
    return token.text === (current.isArray ? ']' : '}') && this.#close();
  }

  #close(): boolean {
    const parent = this.#parents.pop();
    if (parent === undefined) {
      this.#closed = true;
      return true;
    }
    this.#current = parent;
    return this.#expect('next');
  }

  #path(): JsonPath {
    return [...this.#parents, this.#current].flatMap((frame) => placeOf(frame));
  }

  #compact(): string {
    return this.#tokens.join('');
  }

  // The search goes on at the fault: what follows may be prose, or other objects.
  #fault(): Candidate {
    const error: Fault = { kind: 'syntax_error', path: this.#path() };
    const compact = this.#compact();
    return { compact, format: this.#format, resumeAt: this.#index, result: failure(error) };
  }

  // The object as far as the text goes: the tokens read, then the unfinished one.
  #cut(): Candidate {
    const partialText = this.#compact() + this.#text.slice(this.#index);
    const error: Fault = { kind: 'cut', path: this.#path(), partialText };
    const resumeAt = this.#text.length;
    return { compact: partialText, format: this.#format, resumeAt, result: failure(error) };
  }

  scan(): Candidate {
    while (!this.#closed) {
      this.#index += leadingSpaces(this.#text.slice(this.#index));
      const token = readToken(this.#text.slice(this.#index));
      if (token === 'unfinished') {
        return this.#cut();
      }
      if (token === 'invalid' || !this.#accept(token)) {
        return this.#fault();
      }
      this.#tokens.push(token.text);
      this.#index += token.text.length;
    }
    const compact = this.#compact();
    const value: unknown = JSON.parse(compact);
    return { compact, format: this.#format, resumeAt: this.#index, result: { ok: true, value } };
  }
}

function nextObjectStart(text: string, from: number): number | undefined {
  OBJECT_START.lastIndex = from;
  return OBJECT_START.exec(text)?.index;
}

function readCandidates(text: string): readonly Candidate[] {
  const candidates: Candidate[] = [];
  let start = nextObjectStart(text, 0);
  while (start !== undefined) {
    const candidate = new ObjectScanner(text, start).scan();
    candidates.push(candidate);
    start = nextObjectStart(text, candidate.resumeAt);
  }
  return candidates;
}

// An object or a list, whose members a comparison of values goes through.
function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/**
 * The pairs of values, member by member and keys in any order, that two values JSON
 * read are equal by when both are objects, or both lists, with as many members.
 * Undefined when they differ already.
 */
function memberPairs(left: unknown, right: unknown): readonly ValuePair[] | undefined {
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right)) {
    return undefined;
  }
  const leftMembers: readonly [string, unknown][] = Object.entries(left);
  const rightMembers = new Map<string, unknown>(Object.entries(right));
  return leftMembers.length === rightMembers.size
    ? leftMembers.map(([key, value]): ValuePair => [value, rightMembers.get(key)])
    : undefined;
}

/**
 * Whether two values that JSON read are equal value for value (CL-IMP-06): the members
 * of an object in any order, and strings and numbers as JSON reads them, so that a
 * character is the same written or escaped, and `1.0` is the number `1`. Compared
 * without recursion, like the scanner reads, so that no depth of nesting can overflow
 * the stack.
 */
function areEqualValues(left: unknown, right: unknown): boolean {
  const pending: ValuePair[] = [[left, right]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [first, second] = pair;
    const members = first === second ? [] : memberPairs(first, second);
    if (members === undefined) {
      return false;
    }
    for (const member of members) {
      pending.push(member);
    }
  }
  return true;
}

// What a copy is compared by (CL-IMP-06): the value read, or, for an object that cannot
// be read, the tokens read as they are written.
function copyOf(candidate: Candidate): unknown {
  return candidate.result.ok ? candidate.result.value : candidate.compact;
}

/** The one object of a pool, its copies counting as one, or why there is none. */
function oneOf(pool: readonly Candidate[]): Reading {
  const [first, ...others] = pool;
  if (first === undefined) {
    return failure({ kind: 'no_result_found' });
  }
  const copy = copyOf(first);
  return others.every((other) => areEqualValues(copy, copyOf(other)))
    ? first.result
    : failure({ kind: 'several_results' });
}

/** The format of Egoscope that an object names in its own `format` member, if any. */
function formatOf(candidate: Candidate): FormatName | undefined {
  return canonicalValue(candidate.format, FORMAT_NAMES);
}

/**
 * The one object among the candidates (IMP-04, CL-IMP-06): of those in a format of
 * Egoscope, the ones in the format that the reader prefers when there are some. When
 * none names a format of Egoscope, the one is the first object that cannot be read,
 * since what follows its fault may be its own members, or else the one object of all.
 */
function choose(
  candidates: readonly Candidate[],
  preferredFormat: FormatName | undefined,
): Reading {
  const known = candidates.filter((candidate) => formatOf(candidate) !== undefined);
  if (known.length === 0) {
    const unreadable = candidates.find((candidate) => !candidate.result.ok);
    return unreadable === undefined ? oneOf(candidates) : unreadable.result;
  }
  const preferred = known.filter((candidate) => formatOf(candidate) === preferredFormat);
  return oneOf(preferred.length > 0 ? preferred : known);
}

/**
 * The formats of Egoscope that the candidates name, read or not, each once and in the
 * order of the format names (IMP-06, CA-TAX-17).
 */
function formatsNamed(candidates: readonly Candidate[]): readonly FormatName[] {
  const named = new Set(candidates.map((candidate) => formatOf(candidate)));
  return FORMAT_NAMES.filter((name) => named.has(name));
}

/**
 * Isolates the one JSON object of a text pasted from a research AI (IMP-04, BKT-26):
 * the prose around it, code fences with their language tags and invisible characters
 * are ignored, no-break and other Unicode spaces between tokens read as spaces, and
 * copies of one object, equal value for value, count as one (CL-IMP-06). Among several
 * objects, those in the format that the reader prefers are kept; when none is, those in
 * a format of Egoscope, egoscope-backtest or egoscope-exploration, so that a reader
 * given only the other format receives it, and refuses it with its own message (IMP-06,
 * CA-TAX-17). Without a preferred format, both formats count alike. Nothing else is
 * repaired: a fault, a citation marker between tokens included, is a syntax error at
 * its place, and a text that ends inside the object is cut, apart from a syntax error,
 * with the partial text that the recovery of IMP-05 reads. A citation marker inside a
 * text value stays as written (ADR 0013). Whatever the object chosen, the error names the
 * formats of Egoscope that the objects of the text name, those that cannot be read
 * included, so that a reader refuses a text in the other format that it was not given,
 * cut, broken or pasted twice, as of another format (IMP-06, CA-TAX-17).
 */
export function extractJson(pastedText: string, preferredFormat?: FormatName): ExtractJsonResult {
  const text = pastedText.replaceAll(INVISIBLE_CHARACTERS, '').replaceAll(CODE_FENCE, '');
  const candidates = readCandidates(text.trimEnd());
  const reading = choose(candidates, preferredFormat);
  return reading.ok
    ? reading
    : { ok: false, error: { ...reading.error, formats: formatsNamed(candidates) } };
}

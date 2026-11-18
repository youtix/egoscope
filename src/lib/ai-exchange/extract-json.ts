// Isolation of the JSON object in a text pasted from a research AI (IMP-04, BKT-26),
// tested against the usual quirks of their answers (ADR 0013). The text loses what
// the AI or the copy adds around the JSON: invisible characters anywhere, code-fence
// lines, trailing spaces. Then each object that can start in it is read token by
// token, no-break and other Unicode spaces counting as spaces between tokens, and
// nothing else is repaired (CL-IMP-06): a fault is a syntax error at its place, and
// a text that ends inside the object is cut, which the recovery of IMP-05 reads.
//
// Patterns and literals live inside the functions, never in module constants, so that
// mutation testing reaches each of them through the tests: the test runner does not
// activate a mutant of code that runs when the module loads.
import { canonicalValue } from './conventions';

/**
 * A place inside an object: the keys and array indexes from its root, indexes counted
 * from 0, so that `['events', 11, 'description']` lies in event 12.
 */
export type JsonPath = readonly (number | string)[];

/**
 * Why no single object was isolated:
 * - `no_result_found`: the text holds no JSON object;
 * - `several_results`: it holds different ones, and either more than one is in a
 *   format of Egoscope or none is, so the owner is asked to paste only one;
 * - `syntax_error`: the object breaks the JSON syntax, and the reading stopped at
 *   `path`, the value read or last read there;
 * - `cut`: the text ends inside the object, at `path`; `partialText` is the object as
 *   far as it goes, its tokens as written without the spaces between them.
 */
export type ExtractJsonError =
  | Readonly<{ kind: 'no_result_found' }>
  | Readonly<{ kind: 'several_results' }>
  | Readonly<{ kind: 'syntax_error'; path: JsonPath }>
  | Readonly<{ kind: 'cut'; path: JsonPath; partialText: string }>;

/** The isolated object, as JSON reads it, or why there is none. */
export type ExtractJsonResult =
  Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; error: ExtractJsonError }>;

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
  // The tokens read, without the spaces between them, so that copies compare equal.
  compact: string;
  // The value of the object's own `format` member, when read before a fault or a cut.
  format: unknown;
  // Where the search for the next object goes on: after the object, or at its fault.
  resumeAt: number;
  result: ExtractJsonResult;
}>;

function failure(error: ExtractJsonError): ExtractJsonResult {
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
  return rest.search(/\S|$/u);
}

/** The token that `rest` starts with, the spaces before it already skipped. */
function readToken(rest: string): Token {
  // A punctuation mark; a string, up to the first quotation mark that no backslash
  // escapes; anything else, up to a space, a quotation mark or punctuation.
  const token = /^(?:[{}[\]:,]|"(?:[^"\\]|\\.)*"|[^\s",:[\]{}]+)/su.exec(rest)?.[0];
  if (token === undefined) {
    // The end of the text, or a string that no quotation mark closes.
    return 'unfinished';
  }
  if ('{}[]:,'.includes(token)) {
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
    const error: ExtractJsonError = { kind: 'syntax_error', path: this.#path() };
    const compact = this.#compact();
    return { compact, format: this.#format, resumeAt: this.#index, result: failure(error) };
  }

  // The object as far as the text goes: the tokens read, then the unfinished one.
  #cut(): Candidate {
    const partialText = this.#compact() + this.#text.slice(this.#index);
    const error: ExtractJsonError = { kind: 'cut', path: this.#path(), partialText };
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
  // A brace that starts an object: a key follows, between quotation marks of any kind,
  // so that curly-quoted keys are read, and refused, or the closing brace.
  const objectStart = /\{(?=\s*["'‘’“”}])/gu;
  objectStart.lastIndex = from;
  return objectStart.exec(text)?.index;
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

/**
 * The one object among the candidates (IMP-04, CL-IMP-06): those in a format of Egoscope
 * when there are some, copies counting as one. When none names one, the first object
 * that cannot be read is the one, since what follows its fault may be its own members.
 */
function choose(candidates: readonly Candidate[]): ExtractJsonResult {
  const known = candidates.filter(
    (candidate) =>
      canonicalValue(candidate.format, ['egoscope-backtest', 'egoscope-exploration']) !== undefined,
  );
  const unreadable = candidates.find((candidate) => !candidate.result.ok);
  if (unreadable !== undefined && known.length === 0) {
    return unreadable.result;
  }
  const pool = known.length > 0 ? known : candidates;
  const [first, ...others] = pool.filter(
    (candidate, index) => pool.findIndex((other) => other.compact === candidate.compact) === index,
  );
  if (first === undefined) {
    return failure({ kind: 'no_result_found' });
  }
  return others.length === 0 ? first.result : failure({ kind: 'several_results' });
}

/**
 * Isolates the one JSON object of a text pasted from a research AI (IMP-04, BKT-26):
 * the prose around it, code-fence lines and invisible characters are ignored, no-break
 * and other Unicode spaces between tokens read as spaces, and copies of one object count
 * as one. Among several objects, the one in a format of Egoscope, egoscope-backtest or
 * egoscope-exploration, is kept, each reader refusing the other format. Nothing else is
 * repaired: a fault, a citation marker between tokens included, is a syntax error at
 * its place, and a text that ends inside the object is cut, apart from a syntax error,
 * with the partial text that the recovery of IMP-05 reads. A citation marker inside a
 * text value stays as written (ADR 0013).
 */
export function extractJson(pastedText: string): ExtractJsonResult {
  // The zero-width space and non-joiner, the word joiner, the byte-order mark and the
  // zero-width joiner, last, so that it joins no two characters of the class.
  const invisible = /[\u{200B}\u{200C}\u{2060}\u{FEFF}\u{200D}]/gu;
  // A code-fence line: three backticks or tildes, possibly more and a language tag.
  const fenceLine = /^[ \t]*(?:```|~~~).*/gmu;
  const text = pastedText.replaceAll(invisible, '').replaceAll(fenceLine, '').trimEnd();
  return choose(readCandidates(text));
}

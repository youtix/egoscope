import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import comment from '@data/fixtures/ai-exchange/extract-json/comment.json';
import curlyQuotes from '@data/fixtures/ai-exchange/extract-json/curly-quotes.json';
import cutBetweenEvents from '@data/fixtures/ai-exchange/extract-json/cut-between-events.json';
import cutInString from '@data/fixtures/ai-exchange/extract-json/cut-in-string.json';
import explorationResponse from '@data/fixtures/ai-exchange/extract-json/exploration-response.json';
import invisibleCharacters from '@data/fixtures/ai-exchange/extract-json/invisible-characters.json';
import markerBetweenTokens from '@data/fixtures/ai-exchange/extract-json/marker-between-tokens.json';
import markerInsideText from '@data/fixtures/ai-exchange/extract-json/marker-inside-text.json';
import proseAndFence from '@data/fixtures/ai-exchange/extract-json/prose-and-fence.json';
import reportThenJson from '@data/fixtures/ai-exchange/extract-json/report-then-json.json';
import researchResult from '@data/fixtures/ai-exchange/extract-json/research-result.json';
import resultAndSnippet from '@data/fixtures/ai-exchange/extract-json/result-and-snippet.json';
import sameObjectEscapedCharacter from '@data/fixtures/ai-exchange/extract-json/same-object-escaped-character.json';
import sameObjectKeysReordered from '@data/fixtures/ai-exchange/extract-json/same-object-keys-reordered.json';
import sameObjectNumberSpellings from '@data/fixtures/ai-exchange/extract-json/same-object-number-spellings.json';
import sameObjectTwice from '@data/fixtures/ai-exchange/extract-json/same-object-twice.json';
import trailingComma from '@data/fixtures/ai-exchange/extract-json/trailing-comma.json';
import twoResults from '@data/fixtures/ai-exchange/extract-json/two-results.json';
import unicodeSpaces from '@data/fixtures/ai-exchange/extract-json/unicode-spaces.json';

import { extractJson } from './extract-json';

import type { ExtractJsonError, ExtractJsonResult, JsonPath } from './extract-json';

/** The answer that a fixture holds, line by line. */
const answer = (fixture: Readonly<{ pasted: readonly string[] }>): string =>
  fixture.pasted.join('\n');
type Formats = ExtractJsonError['formats'];

const isolated = (value: unknown): ExtractJsonResult => ({ ok: true, value });
const refused = (error: ExtractJsonError): ExtractJsonResult => ({ ok: false, error });
const syntaxError = (path: JsonPath, formats: Formats): ExtractJsonResult =>
  refused({ kind: 'syntax_error', path, formats });

// The formats that the objects of a text name, in the order of the error.
const NONE: Formats = [];
const BACKTEST: Formats = ['egoscope-backtest'];
const EXPLORATION: Formats = ['egoscope-exploration'];
const BOTH: Formats = ['egoscope-backtest', 'egoscope-exploration'];

/** A result whose events are numbered facts, a citation marker after the description of one. */
function resultWithMarker(count: number, marked: number): string {
  const events = Array.from({ length: count }, (_, index) => {
    const marker = index + 1 === marked ? ' [3]' : '';
    return `{"event_type": "media-storm", "description": "Fact ${String(index + 1)}."${marker}}`;
  });
  return `{"format": "egoscope-backtest", "events": [\n${events.join(',\n')}\n]}`;
}

/**
 * How deep lists nest, through their first elements, in the member `a` of the isolated
 * object: without recursion, which a deep comparison of such a value would overflow.
 */
function nestingOfA(result: ExtractJsonResult): number {
  const value = result.ok ? result.value : undefined;
  let current = typeof value === 'object' && value !== null && 'a' in value ? value.a : undefined;
  let depth = 0;
  while (Array.isArray(current)) {
    depth += 1;
    current = current[0];
  }
  return depth;
}

// Every answer of this suite is the same for a reader that names no format and for one
// that prefers a format that no object of these texts has (IMP-04).
describe.each([
  ['a reader that names no format', undefined],
  ['a reader that prefers a format that no object has', 'egoscope-exploration'],
] as const)('extractJson, for %s', (_reader, preferredFormat) => {
  const extract = (text: string): ExtractJsonResult => extractJson(text, preferredFormat);

  it('[IMP-04] [CA-IMP-01] isolates and reads the JSON of an answer made of an introduction, a fenced block and a conclusion', () => {
    expect(extract(answer(proseAndFence))).toStrictEqual(isolated(researchResult));
  });

  it.each([
    ['a report with citation markers, then the JSON in one piece at the end', reportThenJson],
    ['invisible characters around and inside the JSON, in keys and texts', invisibleCharacters],
    ['no-break and other Unicode spaces between the tokens', unicodeSpaces],
    ['the same object twice, laid out differently', sameObjectTwice],
    ['the same object twice, its keys in another order', sameObjectKeysReordered],
    [
      'the same object twice, a character written once and escaped once',
      sameObjectEscapedCharacter,
    ],
    ['a smaller JSON object in the prose before it', resultAndSnippet],
  ])('[IMP-04] [BKT-26] isolates the result of an answer with %s', (_quirk, fixture) => {
    expect(extract(answer(fixture))).toStrictEqual(isolated(researchResult));
  });

  it('[IMP-04] [BKT-26] counts as one the same result twice, its version written 1.0 once and 1 once', () => {
    expect(extract(answer(sameObjectNumberSpellings))).toStrictEqual(
      isolated(sameObjectNumberSpellings.expected),
    );
  });

  it('[IMP-04] isolates citation markers inside text values, which stay as written', () => {
    expect(extract(answer(markerInsideText))).toStrictEqual(isolated(markerInsideText.expected));
  });

  it('[IMP-04] refuses two results that differ by one value, so that the owner pastes only one', () => {
    expect(extract(answer(twoResults))).toStrictEqual(
      refused({ kind: 'several_results', formats: BACKTEST }),
    );
  });

  it.each([
    [
      'a citation marker between two tokens',
      markerBetweenTokens,
      syntaxError(['events', 1, 'description'], BACKTEST),
    ],
    ['curly quotation marks around keys and texts', curlyQuotes, syntaxError([], NONE)],
    ['a comma after the last event', trailingComma, syntaxError(['events', 2], BACKTEST)],
    ['a comment between two events', comment, syntaxError(['events', 1], BACKTEST)],
  ])(
    '[IMP-04] repairs nothing: %s is a syntax error, with its place',
    (_quirk, fixture, expected) => {
      expect(extract(answer(fixture))).toStrictEqual(expected);
    },
  );

  it.each([
    [
      'inside a string, in a code fence that never closes',
      cutInString,
      ['events', 1, 'description'],
    ],
    ['between two events', cutBetweenEvents, ['events', 1]],
  ])(
    '[IMP-05] reports an answer cut %s apart from a syntax error, with the partial object',
    (_place, fixture, path) => {
      const { partialText } = fixture;
      const cut = refused({ kind: 'cut', path, partialText, formats: BACKTEST });

      expect(extract(answer(fixture))).toStrictEqual(cut);
    },
  );

  it('[IMP-04] locates the fault of the 12th event around event 12, at index 11 of the events', () => {
    expect(extract(resultWithMarker(15, 12))).toStrictEqual(
      syntaxError(['events', 11, 'description'], BACKTEST),
    );
  });

  it('[IMP-04] locates a citation marker after the description of any event, in a list of any length', () => {
    const counted = fc
      .integer({ min: 1, max: 40 })
      .chain((count) => fc.tuple(fc.constant(count), fc.integer({ min: 1, max: count })));

    fc.assert(
      fc.property(counted, ([count, marked]) => {
        expect(extract(resultWithMarker(count, marked))).toStrictEqual(
          syntaxError(['events', marked - 1, 'description'], BACKTEST),
        );
      }),
    );
  });

  it('[IMP-04] reads every JSON value as JSON does: escapes, numbers, literals and nesting', () => {
    const text = String.raw`{"text": "a \"quote\" \\ \/ \b\f\n\r\t \u00e9", "numbers": [0, -1.5e3, 2E-2, 10],
      "literals": [true, false, null], "empty": {"object": {}, "array": []}, "deep": [[{"a": [1]}]]}`;

    expect(extract(text)).toStrictEqual(isolated(JSON.parse(text)));
  });

  it('[IMP-04] [CL-IMP-06] reads an object nested a hundred thousand levels deep, and two copies of it as one, without overflowing the stack', () => {
    const depth = 100_000;
    const text = `{"a": ${'['.repeat(depth)}${']'.repeat(depth)}}`;

    expect(nestingOfA(extract(text))).toBe(depth);
    expect(nestingOfA(extract(`${text}\n${text}`))).toBe(depth);
  });

  it.each([
    ['an empty text', ''],
    ['spaces only', ' \n\t '],
    ['prose without JSON', 'The research found nothing to report.'],
    [
      'braces that start no object',
      'Placeholders like {{PLAYER_NAME}} or {see below}, and [1, 2].',
    ],
  ])('[IMP-04] finds no result in %s', (_kind, text) => {
    expect(extract(text)).toStrictEqual(refused({ kind: 'no_result_found', formats: NONE }));
  });

  it('[IMP-04] reads an empty object as an object, and the prose after it as prose', () => {
    expect(extract('The result: { } and nothing else.')).toStrictEqual(isolated({}));
  });

  it.each(['\u{FEFF}', '\u{200B}', '\u{200C}', '\u{200D}', '\u{2060}'])(
    '[IMP-04] strips the invisible character %j anywhere, in keys and texts too',
    (character) => {
      const text = `${character}{"for${character}mat": "egoscope${character}-backtest"}${character}`;

      expect(extract(text)).toStrictEqual(isolated({ format: 'egoscope-backtest' }));
    },
  );

  it('[IMP-04] reads Unicode spaces between tokens as spaces, and keeps them inside texts', () => {
    const text = '{\u{00A0}"a":\u{2003}"x\u{00A0}y",\u{3000}"b":\u{202F}1\u{00A0}}';

    expect(extract(text)).toStrictEqual(isolated({ a: 'x\u{00A0}y', b: 1 }));
  });

  it.each([
    '```',
    '````',
    '```json',
    '  ```json',
    '~~~',
    '\t~~~ text',
    '```json-ld',
    '~~~ c++',
    '```objective-c',
  ])('[IMP-04] [BKT-26] strips the code-fence line %j, even inside the object', (fence) => {
    const text = ['{"format": "egoscope-backtest",', fence, '  "events": []}'].join('\n');

    expect(extract(text)).toStrictEqual(isolated({ format: 'egoscope-backtest', events: [] }));
  });

  it.each([
    [
      'a block written on one line',
      '```json {"format": "egoscope-backtest", "events": [{"a": 1}]} ```',
      { format: 'egoscope-backtest', events: [{ a: 1 }] },
    ],
    [
      'an opening fence that the object follows',
      '```json{"format": "egoscope-backtest",\n  "events": []}\n```',
      { format: 'egoscope-backtest', events: [] },
    ],
    [
      'a tilde fence, its tag after a space',
      '~~~~ JSON {"format": "egoscope-backtest", "events": []}\n~~~~',
      { format: 'egoscope-backtest', events: [] },
    ],
    [
      'a line that a lone carriage return starts',
      '{"format": "egoscope-backtest",\r```json\r  "events": []}',
      { format: 'egoscope-backtest', events: [] },
    ],
  ])('[IMP-04] [BKT-26] strips only the fence and its language tag of %s', (_kind, text, value) => {
    expect(extract(text)).toStrictEqual(isolated(value));
  });

  it.each(['`', '``', '~', '~~'])(
    '[IMP-04] [BKT-26] keeps a line that starts with %j, fewer than three marks, which is no code fence and a syntax error inside the object',
    (marks) => {
      const text = ['{"format": "egoscope-backtest",', `${marks}json`, '  "events": []}'].join(
        '\n',
      );

      expect(extract(text)).toStrictEqual(syntaxError(['format'], BACKTEST));
    },
  );

  it('[IMP-04] keeps backticks and tildes inside texts, where they open no line', () => {
    const text = '{"a":"```",\n "b": "x ~~~ y"}';

    expect(extract(text)).toStrictEqual(isolated({ a: '```', b: 'x ~~~ y' }));
  });

  it.each([
    ['the line separator U+2028', '\u{2028}'],
    ['the paragraph separator U+2029', '\u{2029}'],
  ])(
    '[IMP-04] reads as written a text that holds %s then three backticks, since no line starts there',
    (_separator, separator) => {
      const value = `before${separator}\`\`\`json after`;
      const text = `{"format": "egoscope-backtest", "a": "${value}"}`;

      expect(extract(text)).toStrictEqual(isolated({ format: 'egoscope-backtest', a: value }));
    },
  );

  it.each(["{'format': 'egoscope-backtest'}", '{‘a’: 1}', '{’a’: 1}', '{“a”: 1}', '{”a”: 1}'])(
    '[IMP-04] reads %s as an object, to refuse its quotation marks at the root',
    (text) => {
      expect(extract(text)).toStrictEqual(syntaxError([], NONE));
    },
  );

  it.each([
    ['a word that is no value', '{"a": tru, "b": 1}', ['a']],
    ['a missing colon', '{"a" 1 2}', ['a']],
    ['a missing comma', '{"a": 1 "b": 2}', ['a']],
    ['a missing value', '{"a": , "b": 1}', ['a']],
    ['a closing brace for a value', '{"a": }', ['a']],
    ['an escape that JSON does not know', String.raw`{"a": "\q", "b": 1}`, ['a']],
    ['a line break inside a string', '{"a": "two\nlines", "b": 1}', ['a']],
    ['a key that is no string', '{"a": {1: 2}}', ['a']],
    ['a comma before the closing brace', '{"a": 1,}', ['a']],
    ['a comma before the closing bracket', '{"a": [1,]}', ['a', 1]],
    ['a brace that closes a list', '{"a": [1}', ['a', 0]],
    ['a bracket that closes an object', '{"a": {"b": 1]}', ['a', 'b']],
  ])('[IMP-04] reports %s as a syntax error at its place', (_fault, text, path) => {
    expect(extract(text)).toStrictEqual(syntaxError(path, NONE));
  });

  it.each([
    {
      place: 'inside a literal',
      text: '{"format": "egoscope-backtest", "events": [{"a": 1}, {"b": tru',
      path: ['events', 1, 'b'],
      formats: BACKTEST,
    },
    { place: 'inside a number', text: '{"events": [1.', path: ['events', 0], formats: NONE },
    {
      place: 'inside an escape',
      text: '{"events": [{"a": "x\\u00',
      path: ['events', 0, 'a'],
      formats: NONE,
    },
    { place: 'after a key', text: '{"events": [{"a"', path: ['events', 0, 'a'], formats: NONE },
    { place: 'after a colon', text: '{"a": {"b":', path: ['a', 'b'], formats: NONE },
    {
      place: 'after a complete event',
      text: '{"events": [{"a": 1}',
      path: ['events', 0],
      formats: NONE,
    },
    {
      place: 'after the list of events',
      text: '{"events": [{"a": 1}]',
      path: ['events'],
      formats: NONE,
    },
    {
      place: 'right after the brace of a nested object',
      text: '{"a": {',
      path: ['a'],
      formats: NONE,
    },
  ])(
    '[IMP-05] reports a text that ends $place as cut, where it stops, with the formats that it names',
    ({ text, path, formats }) => {
      // These texts hold no space inside a string: the partial object is the text without
      // its spaces.
      const partialText = text.replaceAll(/\s+/gu, '');

      expect(extract(`${text}  \n`)).toStrictEqual(
        refused({ kind: 'cut', path, partialText, formats }),
      );
    },
  );

  it('[IMP-05] [CL-IMP-22] names the format of a cut object as its format member names it, without case, accents or spaces', () => {
    const partialText = '{"format":" Égoscope-BACKTEST ","events":[';

    expect(extract('{"format": " Égoscope-BACKTEST ", "events": [')).toStrictEqual(
      refused({ kind: 'cut', path: ['events', 0], partialText, formats: BACKTEST }),
    );
  });

  it.each([
    [
      'a fault before it',
      '{"covered_types": ["a"] [2], "format": "egoscope-backtest"}',
      syntaxError(['covered_types'], NONE),
    ],
    ['a fault at it', '{"format" "egoscope-backtest"}', syntaxError(['format'], NONE)],
    [
      'a cut inside its value',
      '{"format": "egoscope-back',
      refused({
        kind: 'cut',
        path: ['format'],
        partialText: '{"format":"egoscope-back',
        formats: NONE,
      }),
    ],
  ])(
    '[IMP-04] [CL-IMP-06] names no format for an object whose JSON breaks or stops at or before its format member: %s',
    (_place, text, expected) => {
      expect(extract(text)).toStrictEqual(expected);
    },
  );

  it('[IMP-04] keeps the object in a format of Egoscope among others, its name compared without case, accents or spaces', () => {
    const text = '{"x": 1} {"format": " Égoscope-BACKTEST "} {"y": 2}';

    expect(extract(text)).toStrictEqual(isolated({ format: ' Égoscope-BACKTEST ' }));
  });

  it.each([
    ['different objects, none in a format of Egoscope', '{"a": 1} {"a": 2}'],
    ['an object and its copy next to a different one', '{"a": 1} {"a": 1} {"a": 2}'],
    ['a format in a nested object only', '{"meta": {"format": "egoscope-backtest"}} {"b": 2}'],
    ['a format inside a list only', '{"format": ["egoscope-backtest"]} {"b": 2}'],
    ['the name of a format under another key', '{"name": "egoscope-backtest"} {"b": 2}'],
  ])('[IMP-04] refuses %s, asking to paste only one', (_kind, text) => {
    expect(extract(text)).toStrictEqual(refused({ kind: 'several_results', formats: NONE }));
  });

  it('[IMP-04] reads a lone object without a format, which its reader may still recognize', () => {
    expect(extract('{"events": []} [1]')).toStrictEqual(isolated({ events: [] }));
  });

  it('[IMP-04] counts copies as one when they are written alike, whatever the spaces', () => {
    expect(extract('{"a": [1, 2]}\n\n{ "a" : [ 1 , 2 ] }')).toStrictEqual(isolated({ a: [1, 2] }));
  });

  it('[IMP-04] counts copies as one when they are equal value for value: keys in any order, characters escaped, numbers written otherwise', () => {
    const first = '{"a": [1, {"b": "é", "c": null}], "d": true, "e": 100}';
    const second = '{"e": 1e2, "d": true, "a": [1.0, {"c": null, "b": "\\u00e9"}]}';

    expect(extract(`${first}\n${second}`)).toStrictEqual(
      isolated({ a: [1, { b: 'é', c: null }], d: true, e: 100 }),
    );
  });

  it.each([
    ['one value', '{"a": 1, "b": 2}', '{"a": 1, "b": 3}'],
    ['one member more', '{"a": 1}', '{"a": 1, "b": 2}'],
    ['one key', '{"a": 1}', '{"b": 1}'],
    ['a list for an object', '{"a": []}', '{"a": {}}'],
    ['an object for a list', '{"a": {"0": 1}}', '{"a": [1]}'],
    ['a value for an object', '{"a": 1}', '{"a": {}}'],
    ['an object for a value', '{"a": {}}', '{"a": 1}'],
    ['null for an object', '{"a": null}', '{"a": {}}'],
    ['a number for a text', '{"a": 1}', '{"a": "1"}'],
    ['the order of a list', '{"a": [1, 2]}', '{"a": [2, 1]}'],
    ['a value deep inside', '{"a": [{"b": [true]}]}', '{"a": [{"b": [false]}]}'],
  ])(
    '[IMP-04] refuses two objects that differ by %s, compared value for value',
    (_difference, first, second) => {
      expect(extract(`${first}\n${second}`)).toStrictEqual(
        refused({ kind: 'several_results', formats: NONE }),
      );
    },
  );

  it('[IMP-04] counts as one the copies of a result that cannot be read only when they are written alike', () => {
    const result = '{"format": "egoscope-backtest", "a": 1, "events": [1 2]}';
    const spaced = '{ "format" : "egoscope-backtest" , "a" : 1 , "events" : [ 1 2 ] }';
    const reordered = '{"a": 1, "format": "egoscope-backtest", "events": [1 2]}';

    expect(extract(`${result}\n${spaced}`)).toStrictEqual(syntaxError(['events', 0], BACKTEST));
    expect(extract(`${result}\n${reordered}`)).toStrictEqual(
      refused({ kind: 'several_results', formats: BACKTEST }),
    );
  });

  it('[IMP-04] reports the first object that cannot be read when no object names a format', () => {
    expect(extract('{"a": 1 2} {"b": 1}')).toStrictEqual(syntaxError(['a'], NONE));
    expect(extract('{"events": [{"a": 1} [3], {"b": 2}]}')).toStrictEqual(
      syntaxError(['events', 0], NONE),
    );
  });

  it('[IMP-04] keeps a result in its format over an object of the prose that cannot be read', () => {
    const text = 'Note: {"draft": 1 2}\n{"format": "egoscope-backtest", "events": []}';

    expect(extract(text)).toStrictEqual(isolated({ format: 'egoscope-backtest', events: [] }));
  });

  it('[IMP-04] refuses a result in its format that cannot be read, whatever follows its fault', () => {
    const text = '{"format": "egoscope-backtest", "events": [{"a": 1} [3], {"b": 2}]}';

    expect(extract(text)).toStrictEqual(syntaxError(['events', 0], BACKTEST));
  });
});

describe('extractJson, for a reader that names its format', () => {
  const both = `${answer(proseAndFence)}\n${answer(explorationResponse)}`;
  const response = isolated(explorationResponse.expected);

  it.each([
    ['the research-result reader', 'egoscope-backtest', isolated(researchResult)],
    ['the exploration reader', 'egoscope-exploration', response],
  ] as const)(
    '[IMP-04] gives %s the object in its own format, of a text that holds a research result and an exploration response',
    (_reader, format, expected) => {
      expect(extractJson(both, format)).toStrictEqual(expected);
    },
  );

  it('[IMP-04] refuses to a reader that names no format a text that holds a research result and an exploration response, asking to paste only one', () => {
    expect(extractJson(both)).toStrictEqual(refused({ kind: 'several_results', formats: BOTH }));
  });

  it.each([
    ['a reader that names no format', undefined],
    ['the research-result reader, which refuses it', 'egoscope-backtest'],
    ['the exploration reader', 'egoscope-exploration'],
  ] as const)('[IMP-04] gives a lone exploration response to %s', (_reader, format) => {
    expect(extractJson(answer(explorationResponse), format)).toStrictEqual(response);
  });

  it.each([
    ['a reader that names no format', undefined],
    ['the research-result reader, which refuses it', 'egoscope-backtest'],
  ] as const)(
    '[IMP-04] gives %s the exploration response among objects in no format of Egoscope',
    (_reader, format) => {
      const text = '{"x": 1} {"format": "egoscope-exploration"} {"y": 2}';

      expect(extractJson(text, format)).toStrictEqual(isolated({ format: 'egoscope-exploration' }));
    },
  );

  // A cut exploration response, and the partial object that JSON isolation reports for it.
  const CUT_RESPONSE = '{"format": "egoscope-exploration", "proposed_types": [';
  const CUT_RESPONSE_READ = '{"format":"egoscope-exploration","proposed_types":[';

  it.each([
    {
      given: 'the research-result reader an exploration response that is cut',
      format: 'egoscope-backtest',
      text: CUT_RESPONSE,
      expected: refused({
        kind: 'cut',
        path: ['proposed_types', 0],
        partialText: CUT_RESPONSE_READ,
        formats: EXPLORATION,
      }),
    },
    {
      given: 'the exploration reader a research result that breaks',
      format: 'egoscope-exploration',
      text: '{"format": "egoscope-backtest", "covered_types": ["a"] [2]}',
      expected: syntaxError(['covered_types'], BACKTEST),
    },
    {
      given: 'the exploration reader its cut response after a research result that breaks',
      format: 'egoscope-exploration',
      text: `{"format": "egoscope-backtest", "events": [1 2]}\n${CUT_RESPONSE}`,
      expected: refused({
        kind: 'cut',
        path: ['proposed_types', 0],
        partialText: CUT_RESPONSE_READ,
        formats: BOTH,
      }),
    },
    {
      given: 'the research-result reader its cut result after an exploration response that breaks',
      format: 'egoscope-backtest',
      text: '{"format": "egoscope-exploration", "proposed_types": [1 2]}\n{"format": "egoscope-backtest", "events": [',
      expected: refused({
        kind: 'cut',
        path: ['events', 0],
        partialText: '{"format":"egoscope-backtest","events":[',
        formats: BOTH,
      }),
    },
  ] as const)(
    '[IMP-04] [IMP-06] [CA-TAX-17] gives $given, with the formats that the objects of the text name, in the order of the formats',
    ({ format, text, expected }) => {
      expect(extractJson(text, format)).toStrictEqual(expected);
    },
  );

  it('[IMP-04] refuses two different results to the research-result reader, and gives its own reader the exploration response that follows them', () => {
    const text = `${answer(twoResults)}\n${answer(explorationResponse)}`;

    expect(extractJson(text, 'egoscope-backtest')).toStrictEqual(
      refused({ kind: 'several_results', formats: BOTH }),
    );
    expect(extractJson(text, 'egoscope-exploration')).toStrictEqual(response);
  });
});

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
import sameObjectTwice from '@data/fixtures/ai-exchange/extract-json/same-object-twice.json';
import trailingComma from '@data/fixtures/ai-exchange/extract-json/trailing-comma.json';
import twoResults from '@data/fixtures/ai-exchange/extract-json/two-results.json';
import unicodeSpaces from '@data/fixtures/ai-exchange/extract-json/unicode-spaces.json';

import { extractJson } from './extract-json';

import type { ExtractJsonError, ExtractJsonResult, JsonPath } from './extract-json';

/** The answer that a fixture holds, line by line. */
const answer = (fixture: Readonly<{ pasted: readonly string[] }>): string =>
  fixture.pasted.join('\n');
const isolated = (value: unknown): ExtractJsonResult => ({ ok: true, value });
const refused = (error: ExtractJsonError): ExtractJsonResult => ({ ok: false, error });
const syntaxError = (path: JsonPath): ExtractJsonResult => refused({ kind: 'syntax_error', path });

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

describe('extractJson', () => {
  it('[IMP-04] [CA-IMP-01] isolates and reads the JSON of an answer made of an introduction, a fenced block and a conclusion', () => {
    expect(extractJson(answer(proseAndFence))).toStrictEqual(isolated(researchResult));
  });

  it.each([
    ['a report with citation markers, then the JSON in one piece at the end', reportThenJson],
    ['invisible characters around and inside the JSON, in keys and texts', invisibleCharacters],
    ['no-break and other Unicode spaces between the tokens', unicodeSpaces],
    ['the same object twice, laid out differently', sameObjectTwice],
    ['a smaller JSON object in the prose before it', resultAndSnippet],
  ])('[IMP-04] [BKT-26] isolates the result of an answer with %s', (_quirk, fixture) => {
    expect(extractJson(answer(fixture))).toStrictEqual(isolated(researchResult));
  });

  it.each([
    ['citation markers inside text values, which stay as written', markerInsideText],
    ['an exploration response, which its own reader refuses or reads', explorationResponse],
  ])('[IMP-04] isolates %s', (_kind, fixture) => {
    expect(extractJson(answer(fixture))).toStrictEqual(isolated(fixture.expected));
  });

  it('[IMP-04] refuses two different results, so that the owner pastes only one', () => {
    expect(extractJson(answer(twoResults))).toStrictEqual(refused({ kind: 'several_results' }));
  });

  it.each([
    ['a citation marker between two tokens', markerBetweenTokens, ['events', 1, 'description']],
    ['curly quotation marks around keys and texts', curlyQuotes, []],
    ['a comma after the last event', trailingComma, ['events', 2]],
    ['a comment between two events', comment, ['events', 1]],
  ])('[IMP-04] repairs nothing: %s is a syntax error, with its place', (_quirk, fixture, path) => {
    expect(extractJson(answer(fixture))).toStrictEqual(syntaxError(path));
  });

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
      const cut = refused({ kind: 'cut', path, partialText: fixture.partialText });

      expect(extractJson(answer(fixture))).toStrictEqual(cut);
    },
  );

  it('[IMP-04] locates the fault of the 12th event around event 12, at index 11 of the events', () => {
    expect(extractJson(resultWithMarker(15, 12))).toStrictEqual(
      syntaxError(['events', 11, 'description']),
    );
  });

  it('[IMP-04] locates a citation marker after the description of any event, in a list of any length', () => {
    const counted = fc
      .integer({ min: 1, max: 40 })
      .chain((count) => fc.tuple(fc.constant(count), fc.integer({ min: 1, max: count })));

    fc.assert(
      fc.property(counted, ([count, marked]) => {
        expect(extractJson(resultWithMarker(count, marked))).toStrictEqual(
          syntaxError(['events', marked - 1, 'description']),
        );
      }),
    );
  });

  it('[IMP-04] reads every JSON value as JSON does: escapes, numbers, literals and nesting', () => {
    const text = String.raw`{"text": "a \"quote\" \\ \/ \b\f\n\r\t \u00e9", "numbers": [0, -1.5e3, 2E-2, 10],
      "literals": [true, false, null], "empty": {"object": {}, "array": []}, "deep": [[{"a": [1]}]]}`;

    expect(extractJson(text)).toStrictEqual(isolated(JSON.parse(text)));
  });

  it('reads an object nested a hundred thousand levels deep without overflowing the stack', () => {
    const depth = 100_000;
    const text = `{"a": ${'['.repeat(depth)}${']'.repeat(depth)}}`;

    expect(nestingOfA(extractJson(text))).toBe(depth);
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
    expect(extractJson(text)).toStrictEqual(refused({ kind: 'no_result_found' }));
  });

  it('[IMP-04] reads an empty object as an object, and the prose after it as prose', () => {
    expect(extractJson('The result: { } and nothing else.')).toStrictEqual(isolated({}));
  });

  it.each(['\u{FEFF}', '\u{200B}', '\u{200C}', '\u{200D}', '\u{2060}'])(
    '[IMP-04] strips the invisible character %j anywhere, in keys and texts too',
    (character) => {
      const text = `${character}{"for${character}mat": "egoscope${character}-backtest"}${character}`;

      expect(extractJson(text)).toStrictEqual(isolated({ format: 'egoscope-backtest' }));
    },
  );

  it('[IMP-04] reads Unicode spaces between tokens as spaces, and keeps them inside texts', () => {
    const text = '{\u{00A0}"a":\u{2003}"x\u{00A0}y",\u{3000}"b":\u{202F}1\u{00A0}}';

    expect(extractJson(text)).toStrictEqual(isolated({ a: 'x\u{00A0}y', b: 1 }));
  });

  it.each(['```', '````', '```json', '  ```json', '~~~', '\t~~~ text'])(
    '[IMP-04] [BKT-26] strips the code-fence line %j, even inside the object',
    (fence) => {
      const text = ['{"format": "egoscope-backtest",', fence, '  "events": []}'].join('\n');

      expect(extractJson(text)).toStrictEqual(
        isolated({ format: 'egoscope-backtest', events: [] }),
      );
    },
  );

  it('[IMP-04] keeps backticks and tildes inside texts, where they open no line', () => {
    const text = '{"a":"```",\n "b": "x ~~~ y"}';

    expect(extractJson(text)).toStrictEqual(isolated({ a: '```', b: 'x ~~~ y' }));
  });

  it.each(["{'format': 'egoscope-backtest'}", '{‘a’: 1}', '{’a’: 1}', '{“a”: 1}', '{”a”: 1}'])(
    '[IMP-04] reads %s as an object, to refuse its quotation marks at the root',
    (text) => {
      expect(extractJson(text)).toStrictEqual(syntaxError([]));
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
    expect(extractJson(text)).toStrictEqual(syntaxError(path));
  });

  it.each([
    [
      'inside a literal',
      '{"format": "egoscope-backtest", "events": [{"a": 1}, {"b": tru',
      ['events', 1, 'b'],
    ],
    ['inside a number', '{"events": [1.', ['events', 0]],
    ['inside an escape', '{"events": [{"a": "x\\u00', ['events', 0, 'a']],
    ['after a key', '{"events": [{"a"', ['events', 0, 'a']],
    ['after a colon', '{"a": {"b":', ['a', 'b']],
    ['after a complete event', '{"events": [{"a": 1}', ['events', 0]],
    ['after the list of events', '{"events": [{"a": 1}]', ['events']],
    ['right after the brace of a nested object', '{"a": {', ['a']],
  ])('[IMP-05] reports a text that ends %s as cut, where it stops', (_place, text, path) => {
    // These texts hold no space inside a string: the partial object is the text without
    // its spaces.
    const partialText = text.replaceAll(/\s+/gu, '');

    expect(extractJson(`${text}  \n`)).toStrictEqual(refused({ kind: 'cut', path, partialText }));
  });

  it.each([' Égoscope-BACKTEST ', 'egoscope-exploration'])(
    '[IMP-04] keeps the object in the format %j among others, its name compared without case, accents or spaces',
    (format) => {
      const text = `{"x": 1} {"format": "${format}"} {"y": 2}`;

      expect(extractJson(text)).toStrictEqual(isolated({ format }));
    },
  );

  it.each([
    [
      'a research result and an exploration response',
      '{"format": "egoscope-backtest"} {"format": "egoscope-exploration"}',
    ],
    ['different objects, none in a format of Egoscope', '{"a": 1} {"a": 2}'],
    ['a format in a nested object only', '{"meta": {"format": "egoscope-backtest"}} {"b": 2}'],
    ['a format inside a list only', '{"format": ["egoscope-backtest"]} {"b": 2}'],
    ['the name of a format under another key', '{"name": "egoscope-backtest"} {"b": 2}'],
  ])('[IMP-04] refuses %s, asking to paste only one', (_kind, text) => {
    expect(extractJson(text)).toStrictEqual(refused({ kind: 'several_results' }));
  });

  it('[IMP-04] reads a lone object without a format, which its reader may still recognize', () => {
    expect(extractJson('{"events": []} [1]')).toStrictEqual(isolated({ events: [] }));
  });

  it('[IMP-04] counts copies as one when they are written alike, whatever the spaces', () => {
    expect(extractJson('{"a": [1, 2]}\n\n{ "a" : [ 1 , 2 ] }')).toStrictEqual(
      isolated({ a: [1, 2] }),
    );
  });

  it('[IMP-04] reports the first object that cannot be read when no object names a format', () => {
    expect(extractJson('{"a": 1 2} {"b": 1}')).toStrictEqual(syntaxError(['a']));
    expect(extractJson('{"events": [{"a": 1} [3], {"b": 2}]}')).toStrictEqual(
      syntaxError(['events', 0]),
    );
  });

  it('[IMP-04] keeps a result in its format over an object of the prose that cannot be read', () => {
    const text = 'Note: {"draft": 1 2}\n{"format": "egoscope-backtest", "events": []}';

    expect(extractJson(text)).toStrictEqual(isolated({ format: 'egoscope-backtest', events: [] }));
  });

  it('[IMP-04] refuses a result in its format that cannot be read, whatever follows its fault', () => {
    const text = '{"format": "egoscope-backtest", "events": [{"a": 1} [3], {"b": 2}]}';

    expect(extractJson(text)).toStrictEqual(syntaxError(['events', 0]));
  });
});

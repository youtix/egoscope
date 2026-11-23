import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CsvReader, CsvSplitter } from './sportsdataverse-csv';

import type { RowSink } from './sportsdataverse-csv';

/** The rows of `chunks`, split one after the other, then the last one. */
function split(chunks: readonly string[]): string[][] {
  const splitter = new CsvSplitter();
  return [...chunks.flatMap((chunk) => splitter.push(chunk)), ...splitter.end()];
}

/** A field as a CSV file writes it: quoted when it holds a separator, a quote or a line break. */
const written = (field: string): string =>
  /[",\n]/u.test(field) ? `"${field.replaceAll('"', '""')}"` : field;

/** A CSV file of `rows`. */
const csvOf = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => `${row.map((field) => written(field)).join(',')}\n`).join('');

/** `text` cut at `cuts`, each a place in it. */
function cut(text: string, cuts: readonly number[]): string[] {
  const places = [...new Set([0, ...cuts.map((place) => place % (text.length + 1))])].toSorted(
    (left, right) => left - right,
  );
  return places.map((place, index) => text.slice(place, places[index + 1] ?? text.length));
}

/** A sink of the columns `a` and `b` that keeps the rows it reads, and refuses a row whose `a` is `bad`. */
function pairSink(): RowSink<readonly (readonly [string, string])[]> {
  const rows: (readonly [string, string])[] = [];
  return {
    columns: ['a', 'b'],
    add: (row) => {
      rows.push([row('a'), row('b')]);
      return row('a') !== 'bad';
    },
    finish: () => rows,
  };
}

/** What a reader with the sink above reads of `text`, given in one chunk. */
function readAll(text: string): readonly (readonly [string, string])[] | undefined {
  const reader = new CsvReader(pairSink());
  reader.push(text);
  return reader.end();
}

describe('[STA-02] the CSV reading of the SportsDataverse release', () => {
  it('[STA-02] splits quoted fields that hold separators, doubled quotes and line breaks', () => {
    expect(split(['a,b\n"x, y","say ""hi""\nthen go"\n,""\nlast,row'])).toStrictEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthen go'],
      ['', ''],
      ['last', 'row'],
    ]);
    expect(split(['a,b\n', ''])).toStrictEqual([['a', 'b']]);
    expect(split(['a,'])).toStrictEqual([['a', '']]);
  });

  it('[STA-02] splits a file the same way whatever chunks it comes in', () => {
    const field = fc.string({ unit: fc.constantFrom('a', 'b', ',', '"', '\n'), maxLength: 6 });
    const rows = fc.array(fc.array(field, { minLength: 1, maxLength: 4 }), {
      minLength: 1,
      maxLength: 5,
    });
    const places = fc.array(fc.nat(), { maxLength: 8 });
    fc.assert(
      fc.property(rows, places, (fields, cuts) => {
        const chunks = cut(csvOf(fields), cuts);
        expect(split(chunks)).toStrictEqual(fields);
      }),
    );
  });

  it('[CL-STA-14] hands each row to the sink by column name, whatever the order and the other columns of the header', () => {
    expect(readAll('b,extra,a\n1,x,2\n3,y,4')).toStrictEqual([
      ['2', '1'],
      ['4', '3'],
    ]);
  });

  it.each([
    ['a missing column', 'a,c\n1,2\n'],
    ['a renamed column', 'a,B\n1,2\n'],
    ['a row of another width', 'a,b\n1,2\n3\n'],
    ['a row that the sink refuses', 'a,b\nbad,2\n'],
    ['a last row, without its line break, that the sink refuses', 'a,b\n1,2\nbad,3'],
    ['no header at all', ''],
  ])('[CL-STA-14] refuses a file with %s', (_name, text) => {
    expect(readAll(text)).toBeUndefined();
  });

  it('[CL-STA-14] stops reading the rows of a file once one is refused', () => {
    const sink = pairSink();
    const reader = new CsvReader(sink);
    expect(reader.push('a,b\nbad,1\n')).toBe(false);
    expect(reader.push('2,3\n')).toBe(false);
    expect(reader.end()).toBeUndefined();
    expect(sink.finish()).toStrictEqual([['bad', '1']]);
  });
});

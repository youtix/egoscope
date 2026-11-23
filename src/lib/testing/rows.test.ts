import { describe, expect, it } from 'vitest';

import { firstRow, readData } from './rows';

const CALL = { httpRequests: 1, bytesReceived: 0, fileRequests: 1 } as const;

describe('firstRow', () => {
  it('gives the first row of those given', () => {
    expect(firstRow([{ id: 4 }, { id: 5 }], 'a row')).toStrictEqual({ id: 4 });
  });

  it('fails, naming what was expected, when there is none', () => {
    expect(() => firstRow([], 'the followed player written')).toThrow(
      'Expected the followed player written, found none.',
    );
  });
});

describe('readData', () => {
  it('gives the data of a read', () => {
    expect(
      readData({ ok: true, value: { kind: 'read', version: 'v1', data: [3] }, call: CALL }, 'x'),
    ).toStrictEqual([3]);
  });

  it.each([
    ['a refused call', { ok: false, error: { kind: 'unavailable' }, call: CALL } as const],
    [
      'an answer without change',
      { ok: true, value: { kind: 'not_modified' }, call: CALL } as const,
    ],
  ])('fails on %s, naming what was expected', (_case, outcome) => {
    expect(() => readData(outcome, 'the games of 2024-25')).toThrow(
      'Expected the games of 2024-25 from the statistics-source fake, which did not read.',
    );
  });
});

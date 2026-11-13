import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readRegister, REGISTER_PATH } from './waiver-register';

import type { Register } from './waiver-register';

const HEADER = [
  '| ID     | kind   | part | reason | manual check or reference |',
  '| ------ | ------ | ---- | ------ | ------------------------- |',
];

/** A register whose table has `rows` after its header, below an introduction. */
const register = (rows: readonly string[]): string =>
  [
    '# Requirement waivers',
    '',
    'Some explanation.',
    '',
    ...HEADER,
    ...rows,
    '',
    'After the table.',
  ].join('\n');

const problemsOf = (read: Register): readonly string[] =>
  read.problems.map(({ where, problem }) => `${where}: ${problem}`);

describe('readRegister', () => {
  it('reads a waiver and a limit, with escaped pipes restored', () => {
    const read = readRegister(
      register([
        '| TRV-79 | waiver |      | A documentation requirement. | ADR 0014 |',
        '| CA-TAX-07 | limit | The answer of a real AI \\| its wording | Needs a real AI. | Guide, step 6 |',
      ]),
    );

    expect(read.entries).toStrictEqual([
      {
        id: 'TRV-79',
        kind: 'waiver',
        part: '',
        reason: 'A documentation requirement.',
        check: 'ADR 0014',
        where: `${REGISTER_PATH}:7`,
      },
      {
        id: 'CA-TAX-07',
        kind: 'limit',
        part: 'The answer of a real AI | its wording',
        reason: 'Needs a real AI.',
        check: 'Guide, step 6',
        where: `${REGISTER_PATH}:8`,
      },
    ]);
    expect(problemsOf(read)).toStrictEqual([]);
  });

  it('refuses an unknown kind, a row of the wrong width and an entry without its reason', () => {
    const read = readRegister(
      register([
        '| JOU-04 | exemption | | A reason. | A reference. |',
        '| JOU-05 | waiver | A reason. |',
        '| JOU-06 | waiver | | | A reference. |',
      ]),
    );

    expect(problemsOf(read)).toStrictEqual([
      `${REGISTER_PATH}:7: JOU-04 has the unknown kind "exemption": an entry is a waiver or a limit.`,
      `${REGISTER_PATH}:8: This row has 3 cells; the register has 5 columns.`,
      `${REGISTER_PATH}:9: JOU-06 gives no reason.`,
    ]);
  });

  it('refuses a limit that names no part or no manual check', () => {
    const read = readRegister(
      register([
        '| CA-TAX-07 | limit | | Needs a real AI. | |',
        '| CA-TAX-08 | limit | The wording | Needs a real AI. | |',
      ]),
    );

    expect(problemsOf(read)).toStrictEqual([
      `${REGISTER_PATH}:7: CA-TAX-07 is a limit that names no part: a limit names the part checked by hand.`,
      `${REGISTER_PATH}:7: CA-TAX-07 is a limit that gives no manual check, such as a script or a guide step.`,
      `${REGISTER_PATH}:8: CA-TAX-08 is a limit that gives no manual check, such as a script or a guide step.`,
    ]);
  });

  it('refuses a second entry for the same ID', () => {
    const read = readRegister(
      register([
        '| TRV-79 | waiver | | A reason. | ADR 0014 |',
        '| TRV-79 | limit | A part | A reason. | A check |',
      ]),
    );

    expect(problemsOf(read)).toStrictEqual([
      `${REGISTER_PATH}:8: TRV-79 has two entries; the first is at ${REGISTER_PATH}:7.`,
    ]);
  });

  it('refuses a register without its table', () => {
    const read = readRegister(
      '# Requirement waivers\n\n| ID | kind | reason |\n| --- | --- | --- |\n',
    );

    expect(problemsOf(read)).toStrictEqual([
      `${REGISTER_PATH}: The register needs its table: | ID | kind | part | reason | manual check or reference |.`,
    ]);
  });

  it('reads the committed register without a problem', () => {
    const text = readFileSync(path.join(import.meta.dirname, '..', REGISTER_PATH), 'utf8');

    expect(problemsOf(readRegister(text))).toStrictEqual([]);
  });
});

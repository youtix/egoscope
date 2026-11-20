// Proves where no-ad-hoc-format bites: in src/, tests included, outside src/lib/time and
// src/lib/wording, for each of the six formats and each way of naming one, and nowhere
// else. Deliberate violations are linted in the probe project of lint-probes.ts.
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { eslint, project, ruleIds, remove } = createProbes();
const RULE = 'egoscope/no-ad-hoc-format';
// A file of the wording module, which the probe project copies from src/ with the rest.
const WORDING_FILE = 'src/lib/wording/numbers.ts';

/** The rules that report a problem in `code`, linted as `file`, any file of the probe project. */
async function rulesIn(file: string, code: string): Promise<readonly (string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(project, file) });
  const messages = result?.messages ?? [];
  const fatal = messages.find((message) => message.fatal === true);
  if (fatal !== undefined) {
    // A probe that does not parse would make "not reported" assertions pass vacuously.
    throw new Error(`Probe ${file} does not parse: ${fatal.message}`);
  }
  return messages.map((message) => message.ruleId);
}

const FORMATS = [
  ['toFixed', 'export const text = (value: number): string => value.toFixed(2);\n'],
  [
    'toLocaleString',
    "export const text = (value: number): string => value.toLocaleString('en-US');\n",
  ],
  [
    'toLocaleDateString',
    "export const day = (at: Date): string => at.toLocaleDateString('en-US', { timeZone: 'UTC' });\n",
  ],
  [
    'toLocaleTimeString',
    "export const time = (at: Date): string => at.toLocaleTimeString('en-US', { timeZone: 'UTC' });\n",
  ],
  [
    'Intl.NumberFormat',
    "export const text = (value: number): string => new Intl.NumberFormat('en-US').format(value);\n",
  ],
  [
    'Intl.DateTimeFormat',
    "export const text = (at: Date): string => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(at);\n",
  ],
] as const;

describe(
  'no-ad-hoc-format: numbers and dates only through the formatters',
  { timeout: 120_000 },
  () => {
    afterAll(remove);

    it.each(FORMATS)('[IHM-13] rejects %s in src/lib', async (_format, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(RULE);
    });

    it.each(FORMATS)('[IHM-13] rejects %s in a screen of src/app', async (_format, code) => {
      expect(await ruleIds('src/app/probe/probe-view.tsx', code)).toContain(RULE);
    });

    it.each(FORMATS)('[IHM-13] rejects %s in a test of src/', async (_format, code) => {
      expect(await ruleIds('src/lib/probe/probe.test.ts', code)).toContain(RULE);
    });

    it.each(FORMATS)('[IHM-13] lets src/lib/time write %s', async (_format, code) => {
      expect(await ruleIds('src/lib/time/probe.ts', code)).not.toContain(RULE);
    });

    it.each(FORMATS)('[IHM-13] lets src/lib/wording write %s', async (_format, code) => {
      expect(await rulesIn(WORDING_FILE, code)).not.toContain(RULE);
    });

    it.each(['scripts/probe.ts', 'e2e/fixtures.ts'])(
      'lets %s, outside src/, write a number',
      async (file) => {
        const code = 'export const text = (value: number): string => value.toFixed(2);\n';

        expect(await ruleIds(file, code)).not.toContain(RULE);
      },
    );

    it.each([
      ['a computed name', "export const text = (value: number): string => value['toFixed'](2);\n"],
      [
        'a destructured method',
        'const { toFixed } = Number.prototype;\n\nexport const text = (value: number): string => toFixed.call(value, 2);\n',
      ],
      [
        'a format called without new',
        "export const text = (value: number): string => Intl.NumberFormat('en-US').format(value);\n",
      ],
      [
        'a format read through globalThis',
        "export const text = (value: number): string => new globalThis.Intl.NumberFormat('en-US').format(value);\n",
      ],
      [
        'a destructured format',
        "const { DateTimeFormat } = Intl;\n\nexport const text = (at: Date): string => new DateTimeFormat('en-US', { timeZone: 'UTC' }).format(at);\n",
      ],
    ])('[IHM-13] rejects %s in src/lib', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(RULE);
    });

    it('lets src/ name the formats as types, and write a number as plain text', async () => {
      const code = [
        'export type Format = Intl.NumberFormat;',
        'export const zone = (format: Intl.DateTimeFormat): string => format.resolvedOptions().timeZone;',
        'export const text = (value: number): string => String(value);',
        '',
      ].join('\n');

      expect(await ruleIds('src/lib/probe/probe.ts', code)).not.toContain(RULE);
    });
  },
);

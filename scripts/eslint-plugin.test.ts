// Proves that no comment or directive can switch a check off: each rule of the
// egoscope plugin bites where eslint.config.ts applies it, and so do the preset
// rules configured for the other switches. Deliberate violations are linted in
// the probe project of lint-probes.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { REMAPPER_HINT } from './eslint-plugin';
import { createProbes } from './lint-probes';

const ROOT = path.join(import.meta.dirname, '..');
const { ruleIds, remove } = createProbes();

/** A one-line module under `comment`. */
const withComment = (comment: string): string => `${comment}\nexport const probe = 1;\n`;

/** A test file whose suite holds `body`. */
const inTest = (body: string): string =>
  `import { describe, expect, it } from 'vitest';\n\ndescribe('probe', () => {\n${body}\n});\n`;

describe('comments and directives that switch a check off', { timeout: 120_000 }, () => {
  afterAll(remove);

  describe('ESLint, TypeScript, React and Vitest switches', () => {
    it.each([
      ['a file-wide disable', '/* eslint-disable */\nexport const probe = 1;\n'],
      ['a same-line disable', 'export const probe = 1; // eslint-disable-line no-new -- trying\n'],
      ['a rule set in a comment', '/* eslint no-console: "off" */\nexport const probe = 1;\n'],
      ['a global declared in a comment', '/* global answer */\nexport const probe = 1;\n'],
    ])('refuses %s: eslint-disable-next-line is the one ESLint comment', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(
        '@eslint-community/eslint-comments/no-use',
      );
    });

    it.each([
      [
        '@ts-ignore',
        "// @ts-ignore: the probe assigns a string\nexport const probe: number = 'one';\n",
        '@typescript-eslint/ban-ts-comment',
      ],
      [
        '@ts-nocheck',
        '// @ts-nocheck\nexport const probe = 1;\n',
        '@typescript-eslint/ban-ts-comment',
      ],
      [
        '@ts-expect-error outside a test',
        "// @ts-expect-error: the probe assigns a string\nexport const probe: number = 'one';\n",
        '@typescript-eslint/ban-ts-comment',
      ],
      [
        'a lib reference, which adds the DOM types',
        '/// <reference lib="dom" />\nexport const probe = 1;\n',
        '@typescript-eslint/triple-slash-reference',
      ],
      [
        'a types reference, which adds the Node types',
        '/// <reference types="node" />\nexport const probe = 1;\n',
        '@typescript-eslint/triple-slash-reference',
      ],
      [
        "the React Compiler's opt-out",
        "export function useProbe(): number {\n  'use no memo';\n  return 1;\n}\n",
        'no-restricted-syntax',
      ],
    ])('refuses %s', async (_kind, code, rule) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(rule);
    });

    it.each([
      ['a skipped test', inTest("  it.skip('runs', () => undefined);"), 'vitest/no-disabled-tests'],
      ['a focused test', inTest("  it.only('runs', () => undefined);"), 'vitest/no-focused-tests'],
      ['a test left to do', inTest("  it.todo('runs');"), 'vitest/warn-todo'],
    ])('refuses %s', async (_kind, code, rule) => {
      expect(await ruleIds('src/lib/probe/probe.test.ts', code)).toContain(rule);
    });

    it('lets a test expect a type error, with its reason', async () => {
      const body = [
        "  it('refuses a string', () => {",
        '    // @ts-expect-error: a count must be a number, not a string',
        "    const count: number = 'one';",
        "    expect(count).toBe('one');",
        '  });',
      ].join('\n');

      expect(await ruleIds('src/lib/probe/probe.test.ts', inTest(body))).not.toContain(
        '@typescript-eslint/ban-ts-comment',
      );
    });
  });

  describe('no-coverage-hints: coverage cannot be switched off from the source', () => {
    it.each([
      '/* v8 ignore next */',
      '// v8 ignore next',
      '/* v8 ignore start */',
      '/* v8 ignore next -- @preserve */',
      '/*  V8   IGNORE   else */',
      '/* istanbul ignore file */',
      '/** istanbul ignore else */',
      '// c8 ignore next 2',
      '/* node:coverage ignore next */',
      '// node:coverage ignore next',
      '/* node:coverage ignore next 3 */',
      '/* node:coverage ignore if */',
      '/* node:coverage ignore file */',
      '/* node:coverage ignore start */',
      '/* node:coverage disable */',
      '/* node:coverage enable */',
      '// zv8 ignore start',
      '// zv8 ignore stop',
      '/* _istanbul ignore next */',
      '// 9c8 ignore next',
      '// Notes for the xnode:coverage ignore start of this helper.',
    ])('rejects the hint %s', async (hint) => {
      expect(
        await ruleIds('src/lib/probe/probe.ts', `${hint}\nexport const probe = 1;\n`),
      ).toContain('egoscope/no-coverage-hints');
    });

    it('rejects a hint in a JSX comment', async () => {
      const code = 'export const view = <p>{/* node:coverage ignore next */}text</p>;\n';

      expect(await ruleIds('src/app/probe/probe-view.tsx', code)).toContain(
        'egoscope/no-coverage-hints',
      );
    });

    it.each([
      ['a string', "export const note = 'v8 ignore start';\n"],
      ['a template literal', 'export const note = `node:coverage disable`;\n'],
      ['a string, glued to a word', "export const note = 'zv8 ignore start';\n"],
    ])('rejects a hint that the remapper reads in %s of covered code', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('egoscope/no-coverage-hints');
    });

    it("refuses with the remapper's own expression, so that it refuses all that the remapper honours", () => {
      const remapper = readFileSync(
        path.join(ROOT, 'node_modules/ast-v8-to-istanbul/dist/index.mjs'),
        'utf8',
      );
      const start = remapper.indexOf('//#region src/ignore-hints.ts');
      const region = remapper.slice(start, remapper.indexOf('//#endregion', start));
      const expressions = region.match(/\/[^\n/]*ignore[^\n/]*\//gu) ?? [];

      expect(expressions).toHaveLength(3);
      expect(
        expressions.filter((expression) => !expression.includes(REMAPPER_HINT.source)),
      ).toStrictEqual([]);
    });

    it('lets a test hold a hint as data, since coverage never measures tests', async () => {
      const code = [
        "import { describe, expect, it } from 'vitest';",
        '',
        "describe('hints', () => {",
        "  it('keeps a hint as data', () => {",
        "    expect('v8 ignore start').toHaveLength(15);",
        '  });',
        '});',
        '',
      ].join('\n');

      expect(await ruleIds('src/lib/probe/probe.test.ts', code)).not.toContain(
        'egoscope/no-coverage-hints',
      );
    });
  });

  describe('no-tool-pragmas: no comment switches another tool off', () => {
    it.each([
      ['a line comment for Prettier', '// prettier-ignore\nexport const matrix = [1,0,0];\n'],
      ['a block comment for Prettier', '/* prettier-ignore */\nexport const matrix = [1,0,0];\n'],
      ['Stryker disable', '// Stryker disable next-line all\nexport const probe = 1;\n'],
      ['Stryker restore', '// Stryker restore all\nexport const probe = 1;\n'],
      ["knip's @public", '/** The probe, @public. */\nexport const probe = 1;\n'],
      ["knip's @beta", '/**\n * The probe.\n *\n * @beta\n */\nexport const probe = 1;\n'],
      ["knip's @alias", '/**\n * The probe.\n *\n * @alias\n */\nexport const probe = 1;\n'],
      ["knip's @internal", '/** The probe. @internal */\nexport const probe = 1;\n'],
    ])('rejects %s', async (_pragma, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('egoscope/no-tool-pragmas');
    });

    it('rejects prettier-ignore in a JSX comment', async () => {
      const code = 'export const view = <p>{/* prettier-ignore */}text</p>;\n';

      expect(await ruleIds('src/app/probe/probe-view.tsx', code)).toContain(
        'egoscope/no-tool-pragmas',
      );
    });
  });

  describe("Stryker's one exception: an equivalent mutant in the pure core", () => {
    const REASON = 'both bounds give the same score at zero minutes';

    it.each([
      ['src/lib/stats-engine/probe.ts', `// Stryker disable next-line EqualityOperator: ${REASON}`],
      [
        'src/lib/stats-engine/probe.ts',
        `// Stryker disable next-line EqualityOperator,ConditionalExpression: ${REASON}`,
      ],
      ['src/lib/ai-exchange/probe.ts', `// Stryker disable next-line StringLiteral: ${REASON}`],
    ])('allows, in %s, the reasoned next-line form %s', async (file, comment) => {
      expect(await ruleIds(file, withComment(comment))).not.toContain('egoscope/no-tool-pragmas');
    });

    it.each([
      ['the whole file', '// Stryker disable all'],
      ['every mutator', `// Stryker disable next-line all: ${REASON}`],
      // Stryker reads mutator names in any letter case: `All` and `ALL` mean `all`.
      ['every mutator, capitalized', `// Stryker disable next-line All: ${REASON}`],
      ['every mutator, in capitals', `// Stryker disable next-line ALL: ${REASON}`],
      [
        'every mutator, among named ones',
        `// Stryker disable next-line EqualityOperator, All: ${REASON}`,
      ],
      ['a block that a later comment restores', `// Stryker disable EqualityOperator: ${REASON}`],
      ['a restore', '// Stryker restore all'],
      ['no mutator name', `// Stryker disable next-line: ${REASON}`],
      ['no reason', '// Stryker disable next-line EqualityOperator'],
      ['a reason under 20 characters', '// Stryker disable next-line EqualityOperator: same score'],
      ['a block comment', `/* Stryker disable next-line EqualityOperator: ${REASON} */`],
    ])('refuses %s, even in the pure core', async (_kind, comment) => {
      expect(await ruleIds('src/lib/stats-engine/probe.ts', withComment(comment))).toContain(
        'egoscope/no-tool-pragmas',
      );
    });

    it.each(['src/lib/stats-engine/probe.test.ts', 'src/lib/probe/probe.ts'])(
      'refuses the reasoned form in %s, outside the non-test files of the pure core',
      async (file) => {
        const comment = `// Stryker disable next-line EqualityOperator: ${REASON}`;

        expect(await ruleIds(file, withComment(comment))).toContain('egoscope/no-tool-pragmas');
      },
    );
  });

  describe('no-skipped-tests: no test is switched off while it runs', () => {
    it.each([
      ['a conditional skip', inTest("  it.skipIf(true)('runs', () => undefined);")],
      ['a conditional run', inTest("  it.runIf(false)('runs', () => undefined);")],
      ['an expected failure', inTest("  it.fails('fails', () => undefined);")],
      ['a chained expected failure', inTest("  it.concurrent.fails('fails', () => undefined);")],
      ['a conditional suite', inTest("  describe.skipIf(true)('suite', () => undefined);")],
      [
        'a skip from the test context',
        inTest("  it('skips', (context) => {\n    context.skip();\n  });"),
      ],
      ['a destructured skip', inTest("  it('skips', ({ skip }) => {\n    skip();\n  });")],
      [
        'a skip from a hook context',
        inTest('  beforeEach((context) => {\n    context.skip();\n  });'),
      ],
    ])('rejects %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.test.ts', code)).toContain(
        'egoscope/no-skipped-tests',
      );
    });

    it('lets a test call methods of the same names on its own objects', async () => {
      const body = [
        "  it('pages through a playlist', () => {",
        '    const playlist = { skip: (count: number): number => count, fails: (count: number): number => count };',
        '    const skip = (count: number): number => count + 1;',
        '    expect(playlist.skip(1) + playlist.fails(3) + skip(1)).toBe(6);',
        '  });',
      ].join('\n');

      expect(await ruleIds('src/lib/probe/probe.test.ts', inTest(body))).not.toContain(
        'egoscope/no-skipped-tests',
      );
    });
  });

  describe('no-local-time: the pure core never depends on the time zone', () => {
    it.each([
      ['a local-time getter', 'export const hour = (at: Date): number => at.getHours();\n'],
      ['a local-time setter', 'export const set = (at: Date): number => at.setHours(0);\n'],
      ['the time zone', 'export const offset = (at: Date): number => at.getTimezoneOffset();\n'],
      [
        'a local-time string',
        'export const day = (at: Date): string => at.toLocaleDateString();\n',
      ],
      ['a date toString', 'export const text = (at: Date): string => at.toString();\n'],
      ['a String(date)', 'export const text = (at: Date): string => String(at);\n'],
      ['local calendar fields', 'export const at = (): Date => new Date(2025, 2, 14);\n'],
      ['a date string', "export const at = (): Date => new Date('2025-03-14T19:30');\n"],
    ])('rejects %s in the statistics core', async (_kind, code) => {
      expect(await ruleIds('src/lib/stats-engine/probe.ts', code)).toContain(
        'egoscope/no-local-time',
      );
    });

    it('rejects local time in src/lib/ai-exchange too', async () => {
      const code = 'export const hour = (at: Date): number => at.getHours();\n';

      expect(await ruleIds('src/lib/ai-exchange/probe.ts', code)).toContain(
        'egoscope/no-local-time',
      );
    });

    it('allows UTC arithmetic on instants passed in', async () => {
      const code = [
        'export const at = (milliseconds: number): Date => new Date(milliseconds);',
        'export const hour = (milliseconds: number): number => new Date(milliseconds).getUTCHours();',
        'export const iso = (instant: Date): string => instant.toISOString();',
        'export const start = (): number => Date.UTC(2025, 2, 14);',
        '',
      ].join('\n');
      const rules = await ruleIds('src/lib/stats-engine/probe.ts', code);

      expect(rules).not.toContain('egoscope/no-local-time');
      expect(rules).not.toContain('no-restricted-syntax');
      expect(rules).not.toContain('no-restricted-properties');
    });
  });

  describe('no-ambient-time: only src/lib/time reads the clock and parses dates', () => {
    const AMBIENT = [
      ['the clock', 'export const now = (): number => Date.now();\n'],
      ['the current date', 'export const today = (): Date => new Date();\n'],
      ['the date as a string', 'export const today = (): string => Date();\n'],
      ['a parsed date', "export const at = (): number => Date.parse('2026-11-10');\n"],
      ['a date string', "export const at = (): Date => new Date('2026-11-10T19:30');\n"],
      ['local calendar fields', 'export const at = (): Date => new Date(2026, 10, 10);\n'],
      [
        "Temporal's clock",
        "import { Temporal } from 'temporal-polyfill';\n\nexport const now = (): number => Temporal.Now.instant().epochMilliseconds;\n",
      ],
    ];

    it.each(AMBIENT)('rejects %s in src/lib', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('egoscope/no-ambient-time');
    });

    it.each([
      'src/app/probe/helper.ts',
      'src/lib/probe/probe.test.ts',
      'scripts/probe.ts',
      'e2e/fixtures.ts',
      'e2e/smoke.spec.ts',
    ])('rejects the clock in %s too', async (file) => {
      const code = 'export const now = (): number => Date.now();\n';

      expect(await ruleIds(file, code)).toContain('egoscope/no-ambient-time');
    });

    it.each(AMBIENT)('lets src/lib/time read %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/time/probe.ts', code)).not.toContain(
        'egoscope/no-ambient-time',
      );
    });

    it('allows a Date made from an instant, and UTC fields', async () => {
      const code = [
        'export const at = (milliseconds: number): Date => new Date(milliseconds);',
        'export const copy = (instant: Date): Date => new Date(instant);',
        'export const start = (): number => Date.UTC(2026, 10, 10);',
        '',
      ].join('\n');

      expect(await ruleIds('src/lib/probe/probe.ts', code)).not.toContain(
        'egoscope/no-ambient-time',
      );
    });
  });

  describe('no-default-locale: a result that depends on a locale names it', () => {
    it.each([
      ['a date', 'export const text = (at: Date): string => at.toLocaleString();\n'],
      [
        'a date, with undefined for the locale',
        "export const text = (at: Date): string => at.toLocaleDateString(undefined, { weekday: 'long' });\n",
      ],
      [
        'a time, with no locale in the list',
        'export const text = (at: Date): string => at.toLocaleTimeString([]);\n',
      ],
      ['a number', 'export const text = (count: number): string => count.toLocaleString();\n'],
      ['upper case', 'export const upper = (text: string): string => text.toLocaleUpperCase();\n'],
      ['lower case', 'export const lower = (text: string): string => text.toLocaleLowerCase();\n'],
      [
        'a comparison',
        'export const order = (left: string, right: string): number => left.localeCompare(right);\n',
      ],
      [
        'an Intl constructor',
        'export const format = (): Intl.NumberFormat => new Intl.NumberFormat();\n',
      ],
      [
        'an Intl constructor called without new',
        'export const zone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;\n',
      ],
      [
        'a locale that may be undefined',
        'export const order = (locale?: string): Intl.Collator => new Intl.Collator(locale);\n',
      ],
      [
        'a spread locale',
        'export const text = (at: Date, options: [string]): string => at.toLocaleString(...options);\n',
      ],
    ])('rejects %s without an explicit locale', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('egoscope/no-default-locale');
    });

    it.each(['src/lib/time/probe.ts', 'scripts/probe.ts', 'e2e/fixtures.ts'])(
      'rejects a default locale in %s too',
      async (file) => {
        const code = 'export const text = (at: Date): string => at.toLocaleString();\n';

        expect(await ruleIds(file, code)).toContain('egoscope/no-default-locale');
      },
    );

    it('allows every call that names its locale', async () => {
      const code = [
        "export const text = (at: Date): string => at.toLocaleString('en-US', { timeZone: 'UTC' });",
        "export const order = (left: string, right: string): number => left.localeCompare(right, 'en');",
        "export const format = (): Intl.NumberFormat => new Intl.NumberFormat('en-US');",
        'export const words = (locale: string): Intl.Segmenter => new Intl.Segmenter(locale);',
        "export const tags = (): string[] => Intl.getCanonicalLocales('EN-us');",
        '',
      ].join('\n');

      expect(await ruleIds('src/lib/probe/probe.ts', code)).not.toContain(
        'egoscope/no-default-locale',
      );
    });
  });
});

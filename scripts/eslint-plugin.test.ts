// Proves that each rule of the egoscope plugin bites where eslint.config.ts applies
// it, with deliberate violations linted in the probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();

/** A test file whose suite holds `body`. */
const inTest = (body: string): string =>
  `import { describe, it } from 'vitest';\n\ndescribe('probe', () => {\n${body}\n});\n`;

describe('the egoscope ESLint plugin', { timeout: 120_000 }, () => {
  afterAll(remove);

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
    ])('rejects a hint that the remapper reads in %s of covered code', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('egoscope/no-coverage-hints');
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

  describe('no-skipped-tests: no test is switched off while it runs', () => {
    it.each([
      ['a conditional skip', inTest("  it.skipIf(true)('runs', () => undefined);")],
      ['a conditional run', inTest("  it.runIf(false)('runs', () => undefined);")],
      ['an expected failure', inTest("  it.fails('fails', () => undefined);")],
      [
        'a skip from the test context',
        inTest("  it('skips', (context) => {\n    context.skip();\n  });"),
      ],
      ['a destructured skip', inTest("  it('skips', ({ skip }) => {\n    skip();\n  });")],
    ])('rejects %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.test.ts', code)).toContain(
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
});

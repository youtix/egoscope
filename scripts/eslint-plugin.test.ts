// Proves that each rule of the egoscope plugin bites where eslint.config.ts applies
// it, with deliberate violations linted in the probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();

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
    ])('rejects the hint %s', async (hint) => {
      expect(
        await ruleIds('src/lib/probe/probe.ts', `${hint}\nexport const probe = 1;\n`),
      ).toContain('egoscope/no-coverage-hints');
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

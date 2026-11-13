// Proves that the lint policy bites: each module rule of CLAUDE.md, and the other
// guarantees of eslint.config.ts, must reject a deliberate violation. The probes
// run in the temporary project of scripts/lint-probes.ts. Every comment or
// directive that would switch a check off has its probe in
// scripts/eslint-plugin.test.ts, next to the project's own rules.
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createProbes, SHELL_PROBES } from './scripts/lint-probes';

const { project, eslint, lint, ruleIds, remove } = createProbes();

describe('eslint.config.ts', { timeout: 120_000 }, () => {
  afterAll(remove);

  describe('module rule 1: src/lib never imports src/app', () => {
    it.each([
      [
        'a static import',
        "export { GET } from '@/app/api/health/route';\n",
        'no-restricted-imports',
      ],
      [
        'a type-only import',
        "import type { GET } from '@/app/api/health/route';\n\nexport type Handler = typeof GET;\n",
        'no-restricted-imports',
      ],
      [
        'a dynamic import',
        "export const load = async (): Promise<unknown> => import('@/app/api/health/route');\n",
        'no-restricted-syntax',
      ],
      [
        'an import type',
        "export type Handler = typeof import('@/app/api/health/route');\n",
        'no-restricted-syntax',
      ],
      [
        'a require call',
        "export const route: unknown = require('@/app/api/health/route');\n",
        'no-restricted-syntax',
      ],
      [
        'a relative import, after resolving it',
        "export { GET } from '../../app/api/health/route';\n",
        'import-x/no-restricted-paths',
      ],
    ])('rejects %s', async (_form, code, rule) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(rule);
    });
  });

  describe('module rule 2: the pure core', () => {
    it.each([
      ['a package', "export { z } from 'zod';\n"],
      ['a Node API', "export { readFileSync } from 'node:fs';\n"],
      ['another module', "export { readServerEnv } from '@/lib/env';\n"],
    ])('keeps the statistics core from importing %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/stats-engine/probe.ts', code)).toContain(
        'no-restricted-imports',
      );
    });

    it.each([
      'src/lib/stats-engine/view-probe.tsx',
      'src/lib/stats-engine/probe.mts',
      'src/lib/stats-engine/probe.cts',
    ])('applies to %s like to a .ts file', async (file) => {
      expect(await ruleIds(file, "export { readFileSync } from 'node:fs';\n")).toContain(
        'no-restricted-imports',
      );
    });

    it.each([
      ['the clock', 'export const now = (): number => Date.now();\n', 'no-restricted-properties'],
      [
        'the current date',
        'export const today = (): Date => new Date();\n',
        'no-restricted-syntax',
      ],
      [
        'the date as a string',
        'export const today = (): string => Date();\n',
        'no-restricted-syntax',
      ],
      [
        'a parsed date',
        "export const at = (): number => Date.parse('2025-03-14');\n",
        'no-restricted-properties',
      ],
      [
        'Intl',
        "export const format = (): string => new Intl.NumberFormat('en').format(1);\n",
        'no-restricted-globals',
      ],
      [
        'randomness',
        'export const roll = (): number => Math.random();\n',
        'no-restricted-properties',
      ],
      [
        'the environment',
        "export const level = (): unknown => process.env['LOG_LEVEL'];\n",
        'no-restricted-globals',
      ],
      ['globalThis', 'export const scope = (): unknown => globalThis;\n', 'no-restricted-globals'],
      ['global', 'export const scope = (): unknown => global;\n', 'no-restricted-globals'],
      [
        'the network',
        "export const load = (): unknown => fetch('https://example.com');\n",
        'no-restricted-globals',
      ],
      [
        'asynchronous code',
        'export async function load(): Promise<number> {\n  return 1;\n}\n',
        'no-restricted-syntax',
      ],
    ])('keeps the statistics core from reading %s', async (_kind, code, rule) => {
      expect(await ruleIds('src/lib/stats-engine/probe.ts', code)).toContain(rule);
    });

    it('lets the core tests import vitest, fast-check and fixtures, and nothing else', async () => {
      const allowed =
        "export { expect } from 'vitest';\nexport { default as fc } from 'fast-check';\nexport { default as season } from '@data/fixtures/season.json';\n";

      expect(await ruleIds('src/lib/stats-engine/probe.test.ts', allowed)).not.toContain(
        'no-restricted-imports',
      );
      expect(
        await ruleIds('src/lib/stats-engine/probe.test.ts', "export { z } from 'zod';\n"),
      ).toContain('no-restricted-imports');
    });

    it('lets src/lib/ai-exchange use zod, but no other module and no clock', async () => {
      const file = 'src/lib/ai-exchange/probe.ts';

      expect(await ruleIds(file, "export { z } from 'zod';\n")).not.toContain(
        'no-restricted-imports',
      );
      expect(await ruleIds(file, "export { readServerEnv } from '@/lib/env';\n")).toContain(
        'no-restricted-imports',
      );
      expect(await ruleIds(file, 'export const now = (): number => Date.now();\n')).toContain(
        'no-restricted-properties',
      );
    });

    it.each([
      ['src/lib/stats-engine/probe.ts', "import type { NextRequest } from 'next/server';"],
      ['src/lib/ai-exchange/probe.ts', "import type { NextRequest } from 'next/server';"],
      ['src/lib/ai-exchange/probe.ts', "import type { ReactNode } from 'react';"],
      ['src/lib/ai-exchange/probe.test.ts', "import type { NextRequest } from 'next/server';"],
    ])('keeps Node and DOM types out of the pure core: %s refuses %s', async (file, statement) => {
      const code = `${statement}\n\nexport type Probe = unknown;\n`;

      expect(await ruleIds(file, code)).toContain('no-restricted-imports');
    });

    it('lets the ai-exchange tests import vitest, fast-check and fixtures', async () => {
      const allowed =
        "export { expect } from 'vitest';\nexport { default as fc } from 'fast-check';\nexport { default as season } from '@data/fixtures/season.json';\nexport { z } from 'zod';\n";

      expect(await ruleIds('src/lib/ai-exchange/probe.test.ts', allowed)).not.toContain(
        'no-restricted-imports',
      );
    });
  });

  describe('module rule 3: routes are isolated from each other', () => {
    it.each([
      [
        'another route by alias',
        'src/app/players/page.tsx',
        "export { GET } from '@/app/api/health/route';\n",
      ],
      [
        'a parent route folder',
        'src/app/players/[playerId]/page.tsx',
        "export { card } from '../player-card';\n",
      ],
      [
        'a nested route folder',
        'src/app/players/page.tsx',
        "export { card } from './[playerId]/player-card';\n",
      ],
    ])('rejects a static import from %s', async (_kind, file, code) => {
      expect(await ruleIds(file, code)).toContain('no-restricted-imports');
    });

    it.each([
      [
        'another route by alias',
        "export const load = async (): Promise<unknown> => import('@/app/api/health/route');\n",
      ],
      [
        'a parent route folder',
        "export const load = async (): Promise<unknown> => import('../api/health/route');\n",
      ],
      [
        'a computed path',
        "const name = 'health';\nexport const load = async (): Promise<unknown> => import(`@/app/api/${name}/route`);\n",
      ],
      ['a require call', "export const route: unknown = require('../api/health/route');\n"],
    ])('rejects a dynamic reference to %s', async (_kind, code) => {
      expect(await ruleIds('src/app/probe/helper.ts', code)).toContain('no-restricted-syntax');
    });

    it.each([
      [
        'createRequire',
        "import { createRequire } from 'node:module';\n\nexport const load = (): unknown => createRequire(import.meta.url)('../api/health/route');\n",
        'no-restricted-imports',
      ],
      [
        'createRequire through the module namespace',
        "import nodeModule from 'module';\n\nexport const load = (): unknown => nodeModule.createRequire(import.meta.url)('../api/health/route');\n",
        'no-restricted-syntax',
      ],
      [
        'node:module loaded at run time',
        "export const load = async (): Promise<unknown> => import('node:module');\n",
        'no-restricted-syntax',
      ],
      [
        'require.resolve',
        "export const where = (): string => require.resolve('zod');\n",
        'no-restricted-globals',
      ],
      [
        'require held in a variable',
        "const load = require;\n\nexport const route: unknown = load('../api/health/route');\n",
        'no-restricted-globals',
      ],
    ])('rejects %s: src/ holds ECMAScript modules only', async (_kind, code, rule) => {
      expect(await ruleIds('src/app/probe/helper.ts', code)).toContain(rule);
    });

    it('accepts a file colocated in the same route folder', async () => {
      const code = "export { card } from './player-card';\n";

      expect(await ruleIds('src/app/players/page.tsx', code)).not.toContain(
        'no-restricted-imports',
      );
    });
  });

  describe('module rule 4: modules are used through their index.ts only', () => {
    it.each([
      [
        'a static',
        "export { gameScore } from '@/lib/stats-engine/game-score';\n",
        'no-restricted-imports',
      ],
      [
        'a type-only',
        "import type { GameScoreInput } from '@/lib/stats-engine/game-score';\n\nexport type Input = GameScoreInput;\n",
        'no-restricted-imports',
      ],
      [
        'a dynamic',
        "export const load = async (): Promise<unknown> => import('@/lib/stats-engine/game-score');\n",
        'no-restricted-syntax',
      ],
    ])('rejects %s deep import into another module', async (_form, code, rule) => {
      expect(await ruleIds('src/app/page-helper.ts', code)).toContain(rule);
    });

    it.each([
      ['src/lib/log/probe.ts', "export { readServerEnv } from '../env/server-env';\n"],
      ['src/lib/log/sinks/probe.ts', "export { readServerEnv } from '../../env/server-env';\n"],
    ])('rejects a relative import that leaves the module, from %s', async (file, code) => {
      expect(await ruleIds(file, code)).toContain('no-restricted-imports');
    });

    it('accepts a relative import inside the module, from a subfolder', async () => {
      const code = "export { createLogger } from '../logger';\n";

      expect(await ruleIds('src/lib/log/sinks/probe.ts', code)).not.toContain(
        'no-restricted-imports',
      );
    });

    it.each([
      ['a declaration', 'export const answer = 42;\n'],
      ['a star re-export', "export * from './server-env';\n"],
    ])('keeps index.ts to explicit re-exports: rejects %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/env/index.ts', code)).toContain('no-restricted-syntax');
    });

    it('rejects two files that import each other', async () => {
      const [result] = await eslint.lintFiles([path.join(project, 'src/lib/alpha/first.ts')]);

      expect(result?.messages.map((message) => message.ruleId)).toContain('import-x/no-cycle');
    });
  });

  describe('module rule 6: naming, default exports and enums', () => {
    it.each([
      ['a file name', 'src/lib/probe/BadName.ts', 'check-file/filename-naming-convention'],
      ['a folder name', 'src/lib/Bad_Module/probe.ts', 'check-file/folder-naming-convention'],
    ])('rejects %s that is not kebab-case', async (_kind, file, rule) => {
      expect(await ruleIds(file, 'export const probe = 1;\n')).toContain(rule);
    });

    it('rejects a default export, except where Next.js requires one', async () => {
      const code = 'export default function Probe(): null {\n  return null;\n}\n';

      expect(await ruleIds('src/app/probe/probe-view.tsx', code)).toContain(
        'import-x/no-default-export',
      );
      expect(await ruleIds('src/app/probe/page.tsx', code)).not.toContain(
        'import-x/no-default-export',
      );
    });

    it('rejects an enum', async () => {
      const code = "export enum Verdict {\n  Probable = 'probable',\n}\n";

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('no-restricted-syntax');
    });
  });

  describe('route shells stay thin', () => {
    const page = 'export default function Page(): null {\n  return null;\n}\n';

    it.each(SHELL_PROBES)('applies the shell rules to %s', async (file) => {
      const code =
        'export default function Shell(): null {\n  for (const item of [1]) {\n    void item;\n  }\n  return null;\n}\n';

      expect(await ruleIds(file, code)).toContain('no-restricted-syntax');
    });

    it.each([
      [
        'a loop',
        'export default function Page(): null {\n  for (const item of [1]) {\n    void item;\n  }\n  return null;\n}\n',
      ],
      [
        'a top-level helper',
        "const helper = (): string => 'x';\n\nexport default function Page(): string {\n  return helper();\n}\n",
      ],
      [
        'an exported helper function',
        `export function label(): string {\n  return 'x';\n}\n\n${page}`,
      ],
      ['an exported helper arrow', `export const label = (): string => 'x';\n\n${page}`],
      ['a class', `export class Store {}\n\n${page}`],
      ['an export list', `const label = 'x';\nexport { label };\n\n${page}`],
      ['a default export that is not a function declaration', 'export default (): null => null;\n'],
    ])('rejects %s in page.tsx', async (_kind, code) => {
      expect(await ruleIds('src/app/probe/page.tsx', code)).toContain('no-restricted-syntax');
    });

    it('tolerates a condition and an inline callback under the caps, as CLAUDE.md says', async () => {
      const code = [
        'export default function Page({ names }: Readonly<{ names: readonly string[] }>): string {',
        "  return names.length > 0 ? names.map((name) => name.trim()).join(', ') : 'none';",
        '}',
        '',
      ].join('\n');

      expect(await ruleIds('src/app/probe/page.tsx', code)).not.toContain('no-restricted-syntax');
    });

    it('accepts the exports that Next.js reads from page.tsx', async () => {
      const code = [
        "import type { Metadata } from 'next';",
        '',
        "export const metadata: Metadata = { title: 'Probe' };",
        '',
        'export function generateStaticParams(): { id: string }[] {',
        "  return [{ id: 'one' }];",
        '}',
        '',
        page,
      ].join('\n');

      expect(await ruleIds('src/app/probe/page.tsx', code)).not.toContain('no-restricted-syntax');
    });

    it.each([
      [
        'not-found.tsx',
        'src/app/probe/not-found.tsx',
        "export const viewport = { colorScheme: 'dark' };\n",
      ],
      ['loading.tsx', 'src/app/probe/loading.tsx', "export const metadata = { title: 'Probe' };\n"],
    ])('rejects an export that Next.js does not read from %s', async (_kind, file, code) => {
      expect(await ruleIds(file, `${code}\n${page}`)).toContain('no-restricted-syntax');
    });

    it('caps the complexity of every function in the file', async () => {
      const code = [
        'export default function Page({ a, b }: Readonly<{ a: boolean; b: boolean }>): string {',
        "  const pick = (): string => (a ? (b ? 'ab' : 'a') : b ? 'b' : 'none');",
        '  return pick();',
        '}',
        '',
      ].join('\n');

      expect(await ruleIds('src/app/probe/page.tsx', code)).toContain('complexity');
    });
  });

  describe('type-aware rules', () => {
    it.each([
      [
        'a floating promise',
        'async function save(): Promise<void> {\n  await Promise.resolve();\n}\n\nexport function run(): void {\n  save();\n}\n',
        '@typescript-eslint/no-floating-promises',
      ],
      [
        'an unsafe any',
        'export const parsed: { count: number } = JSON.parse(\'{"count":1}\');\n',
        '@typescript-eslint/no-unsafe-assignment',
      ],
      [
        'a number used as a condition',
        "export const label = (count: number): string => (count ? 'some' : 'none');\n",
        '@typescript-eslint/strict-boolean-expressions',
      ],
      [
        'a switch that misses a case',
        "type Verdict = 'probable' | 'possible' | 'inconclusive';\n\nexport function rank(verdict: Verdict): number {\n  switch (verdict) {\n    case 'probable': {\n      return 2;\n    }\n    case 'possible': {\n      return 1;\n    }\n  }\n}\n",
        '@typescript-eslint/switch-exhaustiveness-check',
      ],
    ])('reject %s', async (_kind, code, rule) => {
      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(rule);
    });

    it('apply the React hooks rules to .ts files', async () => {
      const code =
        "import { useEffect } from 'react';\n\nexport function useProbe(enabled: boolean): void {\n  if (enabled) {\n    useEffect(() => undefined, []);\n  }\n}\n";

      expect(await ruleIds('src/lib/probe/use-probe.ts', code)).toContain(
        'react-hooks/rules-of-hooks',
      );
    });
  });

  describe('end-to-end specs', () => {
    it.each(['e2e/smoke.spec.ts', 'e2e/fixtures.ts'])(
      'let %s import a development dependency',
      async (file) => {
        const code = "import { expect } from 'vitest';\n\nexport const check = expect;\n";

        expect(await ruleIds(file, code)).not.toContain('import-x/no-extraneous-dependencies');
      },
    );

    it('still keeps development dependencies out of src/', async () => {
      const code = "import { expect } from 'vitest';\n\nexport const check = expect;\n";

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(
        'import-x/no-extraneous-dependencies',
      );
    });
  });

  describe('secrets, logging and documentation', () => {
    it('reads process.env only inside src/lib/env', async () => {
      const code = "export const level = (): unknown => process.env['LOG_LEVEL'];\n";

      expect(await ruleIds('src/app/probe/helper.ts', code)).toContain('no-restricted-properties');
      expect(await ruleIds('src/lib/env/probe.ts', code)).not.toContain('no-restricted-properties');
    });

    it('writes to the console only in the log sink', async () => {
      const code = "export const say = (): void => {\n  console.info('x');\n};\n";

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('no-console');
      expect(await ruleIds('src/lib/log/console-sink.ts', code)).not.toContain('no-console');
    });

    it('requires a description on exported functions of src/lib', async () => {
      const code = 'export function probe(): number {\n  return 1;\n}\n';

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('jsdoc/require-jsdoc');
    });
  });

  describe('inline disables and severities', () => {
    it('requires a reason on every disable comment', async () => {
      const code = '// eslint-disable-next-line no-new\nnew Date();\n';

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(
        '@eslint-community/eslint-comments/require-description',
      );
    });

    it.each([
      [
        'an architecture rule',
        "// eslint-disable-next-line no-restricted-imports -- trying\nexport { GET } from '@/app/api/health/route';\n",
      ],
      [
        'the coverage-hint rule',
        '// eslint-disable-next-line egoscope/no-coverage-hints -- trying\n/* v8 ignore next */\nexport const probe = 1;\n',
      ],
      [
        'a chain of disable comments',
        "// eslint-disable-next-line @eslint-community/eslint-comments/no-restricted-disable -- trying\n// eslint-disable-next-line no-restricted-imports, import-x/no-restricted-paths -- trying\nexport { GET } from '@/app/api/health/route';\n",
      ],
    ])('refuses a disable comment for %s, even with a reason', async (_kind, code) => {
      const messages = await lint('src/lib/probe/probe.ts', code);

      expect(messages.map((message) => message.ruleId)).toContain(
        '@eslint-community/eslint-comments/no-restricted-disable',
      );
    });

    it('reports rules that presets set to "warn" as errors', async () => {
      const code =
        "import { first } from './x';\nimport { second } from './x';\n\nexport const both = [first, second];\n";
      const messages = await lint('src/lib/probe/probe.ts', code);
      const duplicates = messages.filter((message) => message.ruleId === 'import-x/no-duplicates');

      expect(duplicates).not.toHaveLength(0);
      expect(duplicates.every((message) => message.severity === 2)).toBe(true);
    });
  });
});

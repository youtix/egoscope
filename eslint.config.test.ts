// Proves that the lint policy bites: each module rule of CLAUDE.md, and the
// other guarantees of eslint.config.ts, must reject a deliberate violation.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import eslintReact from '@eslint-react/eslint-plugin';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it, onTestFinished } from 'vitest';

import config from './eslint.config';

import type { Linter } from 'eslint';

const ROOT = import.meta.dirname;
const CONFIG_FILE = path.join(ROOT, 'eslint.config.ts');
const TIMEOUT = { timeout: 60_000 };

// Probes are linted from memory, without type information, so every rule that
// needs types is switched off: those whose metadata says so, whichever plugin
// they come from, and those of eslint-react and Vitest, which do not say so.
// The rules under test read import paths, names and syntax, never types.
const typeAwareRules = config.flatMap((block) =>
  Object.entries(block.plugins ?? {}).flatMap(([prefix, plugin]) =>
    Object.entries(plugin.rules ?? {})
      .filter(([, rule]) => {
        const docs: object = rule.meta?.docs ?? {};
        return 'requiresTypeChecking' in docs && docs.requiresTypeChecking === true;
      })
      .map(([name]) => `${prefix}/${name}`),
  ),
);
const WITHOUT_TYPES: Linter.Config[] = [
  { files: ['**/*.{ts,tsx,mts}'], ...tseslint.configs.disableTypeChecked },
  eslintReact.configs['disable-type-checked'],
  {
    rules: {
      ...Object.fromEntries(typeAwareRules.map((rule) => [rule, 'off'])),
      'vitest/unbound-method': 'off',
    },
  },
];

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: CONFIG_FILE,
  overrideConfig: WITHOUT_TYPES,
});

async function lint(file: string, code: string): Promise<readonly Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  const messages = result?.messages ?? [];
  const fatal = messages.find((message) => message.fatal === true);
  if (fatal !== undefined) {
    // A probe that does not parse would make "not reported" assertions pass vacuously.
    throw new Error(`Probe ${file} does not parse: ${fatal.message}`);
  }
  return messages;
}

async function ruleIds(file: string, code: string): Promise<readonly (string | null)[]> {
  const messages = await lint(file, code);
  return messages.map((message) => message.ruleId);
}

/** Writes `files` under a fresh temporary directory, removed when the test ends. */
function temporaryProject(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'egoscope-lint-'));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

describe('eslint.config.ts', TIMEOUT, () => {
  describe('module rule 1: src/lib never imports src/app', () => {
    it('rejects an alias import', async () => {
      const code = "export { GET } from '@/app/api/health/route';\n";

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain('no-restricted-imports');
    });

    it('rejects a relative import, after resolving it', async () => {
      const code = "export { GET } from '../../app/api/health/route';\n";

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(
        'import-x/no-restricted-paths',
      );
    });
  });

  describe('module rule 2: the statistics core is pure', () => {
    it.each([
      ['a package', "export { z } from 'zod';\n"],
      ['a Node API', "export { readFileSync } from 'node:fs';\n"],
      ['another module', "export { readServerEnv } from '@/lib/env';\n"],
    ])('rejects importing %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/stats-engine/probe.ts', code)).toContain(
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
        'randomness',
        'export const roll = (): number => Math.random();\n',
        'no-restricted-properties',
      ],
      [
        'the environment',
        "export const level = (): unknown => process.env['LOG_LEVEL'];\n",
        'no-restricted-globals',
      ],
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
    ])('rejects reading %s', async (_kind, code, rule) => {
      expect(await ruleIds('src/lib/stats-engine/probe.ts', code)).toContain(rule);
    });

    it('accepts an instant passed in as an argument', async () => {
      const code = 'export const at = (milliseconds: number): Date => new Date(milliseconds);\n';
      const rules = await ruleIds('src/lib/stats-engine/probe.ts', code);

      expect(rules).not.toContain('no-restricted-syntax');
      expect(rules).not.toContain('no-restricted-imports');
    });

    it('lets its tests import vitest, fast-check and fixtures, and nothing else', async () => {
      const allowed =
        "export { expect } from 'vitest';\nexport { default as fc } from 'fast-check';\nexport { default as season } from '@data/fixtures/season.json';\n";
      const forbidden = "export { z } from 'zod';\n";

      expect(await ruleIds('src/lib/stats-engine/probe.test.ts', allowed)).not.toContain(
        'no-restricted-imports',
      );
      expect(await ruleIds('src/lib/stats-engine/probe.test.ts', forbidden)).toContain(
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
    ])('rejects importing from %s', async (_kind, file, code) => {
      expect(await ruleIds(file, code)).toContain('no-restricted-imports');
    });

    it('accepts a file colocated in the same route folder', async () => {
      const code = "export { card } from './player-card';\n";

      expect(await ruleIds('src/app/players/page.tsx', code)).not.toContain(
        'no-restricted-imports',
      );
    });
  });

  describe('module rule 4: modules are used through their index.ts only', () => {
    it('rejects a deep import into another module', async () => {
      const code = "export { gameScore } from '@/lib/stats-engine/game-score';\n";

      expect(await ruleIds('src/app/page-helper.ts', code)).toContain('no-restricted-imports');
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
      // A cycle needs real files on disk, so this probe is a small throwaway project.
      const project = temporaryProject({
        'src/lib/alpha/index.ts': "export { first } from './first';\n",
        'src/lib/alpha/first.ts':
          "import { second } from './second';\n\nexport const first = (): number => second() + 1;\n",
        'src/lib/alpha/second.ts':
          "import { first } from './first';\n\nexport const second = (): number => first() - 1;\n",
      });
      const linter = new ESLint({
        cwd: project,
        overrideConfigFile: CONFIG_FILE,
        overrideConfig: WITHOUT_TYPES,
      });

      const [result] = await linter.lintFiles(['src/lib/alpha/first.ts']);

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
    it.each([
      [
        'a loop',
        'export default function Page(): null {\n  for (const item of [1]) {\n    void item;\n  }\n  return null;\n}\n',
      ],
      [
        'a helper',
        "const helper = (): string => 'x';\n\nexport default function Page(): string {\n  return helper();\n}\n",
      ],
    ])('rejects %s in page.tsx', async (_kind, code) => {
      expect(await ruleIds('src/app/probe/page.tsx', code)).toContain('no-restricted-syntax');
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

    it('refuses disable comments for architecture rules, even with a reason', async () => {
      const code =
        "// eslint-disable-next-line no-restricted-imports -- trying to bypass\nexport { GET } from '@/app/api/health/route';\n";

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(
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

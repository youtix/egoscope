/**
 * The harness of the lint policy probes, shared by eslint.config.test.ts and
 * scripts/eslint-plugin.test.ts. Probes are real files in a temporary copy of the
 * project, linted with the full configuration, type-aware rules included.
 * typescript-estree's automatic single-run mode is off: under CI=true it would
 * reuse an isolated program across the many lints of one probe path.
 */
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

import { layerZones } from '../eslint.config';

import type { Linter } from 'eslint';

export type Probes = Readonly<{
  /** The temporary project. */
  project: string;
  /** The linter of the temporary project. */
  eslint: ESLint;
  /** Lints `code` as the content of `file`, which must be in the list of probe files. */
  lint: (file: string, code: string) => Promise<readonly Linter.LintMessage[]>;
  /** The rules that report a problem in `code`, linted as `file`. */
  ruleIds: (file: string, code: string) => Promise<readonly (string | null)[]>;
  /** Deletes the temporary project. */
  remove: () => void;
}>;

const ROOT = path.join(import.meta.dirname, '..');
const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

// Every path a probe lints. Each exists on disk before the first lint, so that the
// TypeScript project service sees it.
const PROBE_FILES: readonly string[] = [
  'src/app/page-helper.ts',
  'src/app/players/[playerId]/page.tsx',
  'src/app/players/page.tsx',
  'src/app/probe/helper.ts',
  'src/app/probe/loading.tsx',
  'src/app/probe/not-found.tsx',
  'src/app/probe/page.tsx',
  'src/app/probe/probe-view.tsx',
  'src/lib/Bad_Module/probe.ts',
  'src/lib/ai-exchange/probe.ts',
  'src/lib/env/index.ts',
  'src/lib/env/probe.ts',
  'src/lib/log/console-sink.ts',
  'src/lib/log/probe.ts',
  'src/lib/log/sinks/probe.ts',
  'src/lib/probe/BadName.ts',
  'src/lib/probe/probe.test.ts',
  'src/lib/probe/probe.ts',
  'src/lib/probe/use-probe.ts',
  'src/lib/stats-engine/probe.cts',
  'src/lib/stats-engine/probe.mts',
  'src/lib/stats-engine/probe.test.ts',
  'src/lib/stats-engine/probe.ts',
  'src/lib/stats-engine/view-probe.tsx',
];

// Two modules that import each other: a cycle needs real files.
const CYCLE_FILES: Readonly<Record<string, string>> = {
  'src/lib/alpha/index.ts': "export { first } from './first';\n",
  'src/lib/alpha/first.ts':
    "import { second } from './second';\n\nexport const first = (): number => second() + 1;\n",
  'src/lib/alpha/second.ts':
    "import { first } from './first';\n\nexport const second = (): number => first() - 1;\n",
};

/** A temporary copy of the project's sources and settings, with every probe file in place. */
function createProbeProject(): string {
  const project = mkdtempSync(path.join(tmpdir(), 'egoscope-probes-'));
  cpSync(path.join(ROOT, 'src'), path.join(project, 'src'), { recursive: true });
  for (const file of ['tsconfig.json', 'package.json']) {
    copyFileSync(path.join(ROOT, file), path.join(project, file));
  }
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(project, 'node_modules'), 'dir');
  const placeholders = PROBE_FILES.map((file) => [file, 'export {};\n'] as const);
  for (const [file, content] of [...placeholders, ...Object.entries(CYCLE_FILES)]) {
    mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    writeFileSync(path.join(project, file), content);
  }
  return project;
}

/** The project's ESLint configuration, pointed at the temporary project. */
function createLinter(project: string): ESLint {
  return new ESLint({
    cwd: project,
    overrideConfigFile: path.join(ROOT, 'eslint.config.ts'),
    overrideConfig: [
      {
        files: TS_FILES,
        languageOptions: {
          parserOptions: { tsconfigRootDir: project, disallowAutomaticSingleRunInference: true },
        },
        settings: {
          'import-x/resolver-next': [
            createTypeScriptImportResolver({
              alwaysTryTypes: true,
              project: path.join(project, 'tsconfig.json'),
            }),
          ],
        },
      },
      {
        files: ['src/**/*.{ts,tsx,mts,cts}'],
        rules: { 'import-x/no-restricted-paths': layerZones(project) },
      },
    ],
  });
}

/** Creates a temporary probe project and its linter. */
export function createProbes(): Probes {
  const project = createProbeProject();
  const eslint = createLinter(project);
  const lint = async (file: string, code: string): Promise<readonly Linter.LintMessage[]> => {
    if (!PROBE_FILES.includes(file)) {
      throw new Error(`Add ${file} to PROBE_FILES, so that it exists before the first lint.`);
    }
    const [result] = await eslint.lintText(code, { filePath: path.join(project, file) });
    const messages = result?.messages ?? [];
    const fatal = messages.find((message) => message.fatal === true);
    if (fatal !== undefined) {
      // A probe that does not parse would make "not reported" assertions pass vacuously.
      throw new Error(`Probe ${file} does not parse: ${fatal.message}`);
    }
    return messages;
  };
  return {
    project,
    eslint,
    lint,
    ruleIds: async (file, code) => {
      const messages = await lint(file, code);
      return messages.map((message) => message.ruleId);
    },
    remove: () => {
      rmSync(project, { recursive: true, force: true });
    },
  };
}

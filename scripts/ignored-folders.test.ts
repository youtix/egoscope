// Proves that no tool reads .claude/, where the other agents' worktrees live. The
// probe is a simulated nested worktree whose files would break each tool. It sits
// under .claude/ in a throwaway copy of the project, so that the real checkout is
// never written to, and outside .claude/worktrees/, which .gitignore already hides,
// so that each tool's own ignore setting is what gets tested.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import { IGNORED_FOLDERS, isIgnoredPath } from './ignored-folders';

const ROOT = path.join(import.meta.dirname, '..');
const NESTED = '.claude/ignore-probe';
// A class that the build would generate CSS for if Tailwind scanned the probe. It is
// made at run time, so that no scanned file, this one included, contains it.
const PROBE_CLASS = `bg-[#${process.pid.toString(16).padStart(6, '0').slice(-6)}]`;
const BROKEN_FILES: Readonly<Record<string, string>> = {
  // A type error, lint errors and bad formatting.
  [`${NESTED}/src/lib/broken/index.ts`]:
    "export const value: number = 'text'\nconsole.log( value )\n",
  // A test that fails if Vitest collects it.
  [`${NESTED}/src/lib/broken/index.test.ts`]:
    "import { it } from 'vitest';\nit('fails', () => {\n  throw new Error('collected');\n});\n",
  // A heading level that markdownlint rejects, and a link that the structure check rejects.
  [`${NESTED}/README.md`]: '# Title\n\n### Skipped level\n\n[A missing page](missing-page.md)\n',
  // A name that the structure check rejects.
  [`${NESTED}/src/BadName.ts`]: 'export {};\n',
  // A component whose class name would end up in the built stylesheet.
  [`${NESTED}/src/app/probe-view.tsx`]: `export const className = '${PROBE_CLASS}';\n`,
};
const BIN = (name: string): string => path.join(ROOT, 'node_modules/.bin', name);

/**
 * A throwaway copy of the project, with the probe in place: the files that git
 * would commit, a link to node_modules, and a git repository of its own, which the
 * structure check lists its files with.
 */
function copyProject(): string {
  const copy = mkdtempSync(path.join(tmpdir(), 'egoscope-ignore-'));
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  const files = listed
    .split('\0')
    .filter((file) => file !== '' && !isIgnoredPath(file) && existsSync(path.join(ROOT, file)));
  for (const [file, content] of [
    ...files.map((name) => [name, readFileSync(path.join(ROOT, name))] as const),
    ...Object.entries(BROKEN_FILES),
  ]) {
    mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    writeFileSync(path.join(copy, file), content);
  }
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  execFileSync('git', ['init', '--quiet'], { cwd: copy });
  // To git the link is a file, which `node_modules/` in .gitignore does not cover.
  appendFileSync(path.join(copy, '.git/info/exclude'), 'node_modules\n');
  return copy;
}

const PROJECT = copyProject();
const PROBE_TS = path.join(PROJECT, `${NESTED}/src/lib/broken/index.ts`);
const STYLESHEET = path.join(PROJECT, 'src/app/globals.css');

/**
 * Scans the copy for class names as the build does: @tailwindcss/turbopack
 * compiles the stylesheet, then scans the automatic source (the project root, where
 * the build runs) together with the stylesheet's own `@source` entries.
 */
async function tailwindScan(): Promise<Readonly<{ files: string[]; classes: string[] }>> {
  const compiler = await compile(readFileSync(STYLESHEET, 'utf8'), {
    from: STYLESHEET,
    base: path.dirname(STYLESHEET),
    onDependency: () => undefined,
  });
  const automatic =
    compiler.root === null ? [{ base: PROJECT, pattern: '**/*', negated: false }] : [];
  const scanner = new Scanner({ sources: [...automatic, ...compiler.sources] });
  const classes = scanner.scan();
  return { files: scanner.files, classes };
}

/** Runs a project tool in the copy, outside the shared lock. */
function tool(
  command: string,
  args: readonly string[],
): Readonly<{ status: number | null; output: string }> {
  const result = spawnSync(command, args, {
    cwd: PROJECT,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('ignored folders', { timeout: 120_000 }, () => {
  afterAll(() => {
    // The link goes with the copy; what it points at stays.
    rmSync(PROJECT, { recursive: true, force: true });
  });

  it('lists .claude/ and recognizes the paths inside it', () => {
    expect(IGNORED_FOLDERS).toStrictEqual(['.claude/']);
    expect(isIgnoredPath(`${NESTED}/README.md`)).toBe(true);
    expect(isIgnoredPath('src/app/page.tsx')).toBe(false);
  });

  it('is ignored by ESLint', async () => {
    await expect(new ESLint({ cwd: PROJECT }).isPathIgnored(PROBE_TS)).resolves.toBe(true);
  });

  it('is ignored by Prettier', async () => {
    const ignorePath = [path.join(PROJECT, '.gitignore'), path.join(PROJECT, '.prettierignore')];

    await expect(getFileInfo(PROBE_TS, { ignorePath })).resolves.toMatchObject({ ignored: true });
  });

  it('is left out of the TypeScript project', () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      path.join(PROJECT, 'tsconfig.json'),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    );

    const inside = parsed?.fileNames.filter((file) => isIgnoredPath(path.relative(PROJECT, file)));

    expect(inside).toStrictEqual([]);
  });

  it('is not scanned by Tailwind, so the build takes no class name from it', async () => {
    const { files, classes } = await tailwindScan();

    // The scan read the project, so the absence of the probe is meaningful.
    expect(files).toContain(path.join(PROJECT, 'src/app/page.tsx'));
    expect(files.filter((file) => isIgnoredPath(path.relative(PROJECT, file)))).toStrictEqual([]);
    expect(classes).not.toContain(PROBE_CLASS);
  });

  it.each([
    ['markdownlint', BIN('markdownlint-cli2'), ['**/*.md']],
    ['Vitest', BIN('vitest'), ['list', '--filesOnly']],
    ['knip', BIN('knip'), ['--include', 'files', '--no-progress', '--no-exit-code']],
    ['the structure check', 'bun', ['scripts/check-structure.ts']],
  ])('is not read by %s', (_tool, command, args) => {
    const { status, output } = tool(command, args);

    // The tool ran to completion, so the absence of the probe is meaningful.
    expect(status).toBe(0);
    expect(output).not.toContain('ignore-probe');
  });

  it('leaves the real checkout untouched', () => {
    expect(existsSync(path.join(ROOT, NESTED))).toBe(false);
  });
});

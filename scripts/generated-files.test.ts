// Proves that the folders of generated files are exempt from the tools that a
// generator's output would trip, and that nothing outside them is. The names are
// those that drizzle-kit writes.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import config from '../vitest.config';
import { GENERATED_FOLDERS, isGeneratedPath } from './generated-files';
import { IGNORED_FOLDERS } from './ignored-folders';
import { findStructureViolations } from './structure-rules';

const ROOT = path.join(import.meta.dirname, '..');
const MIGRATIONS = [
  'drizzle/0000_bright_ironclad.sql',
  'drizzle/meta/_journal.json',
  'drizzle/meta/0000_snapshot.json',
];
const IGNORE_PATH = [path.join(ROOT, '.gitignore'), path.join(ROOT, '.prettierignore')];

/** The entries of .prettierignore, without comments and blank lines. */
function prettierIgnores(): readonly string[] {
  return readFileSync(path.join(ROOT, '.prettierignore'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

/** The `ignores` of .markdownlint-cli2.jsonc, which is JSON with comments. */
function markdownlintIgnores(): unknown {
  const file = path.join(ROOT, '.markdownlint-cli2.jsonc');
  const parsed = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
  const settings: unknown = parsed.config;
  return typeof settings === 'object' && settings !== null && 'ignores' in settings
    ? settings.ignores
    : undefined;
}

describe('generated files', { timeout: 60_000 }, () => {
  it('starts with drizzle/, where the database task writes its migrations', () => {
    expect(GENERATED_FOLDERS).toStrictEqual(['drizzle/']);
    expect(MIGRATIONS.every((file) => isGeneratedPath(file))).toBe(true);
    expect(isGeneratedPath('data/drizzle/0000_bright_ironclad.sql')).toBe(false);
  });

  it("lets the generator's own file names through the structure check there, and only there", () => {
    expect(findStructureViolations(MIGRATIONS)).toStrictEqual([]);
    expect(findStructureViolations(['data/0000_bright_ironclad.sql'])).not.toStrictEqual([]);
  });

  it('is skipped by ESLint, while the same file elsewhere is linted', async () => {
    const eslint = new ESLint({ cwd: ROOT });

    await expect(eslint.isPathIgnored(path.join(ROOT, 'drizzle/schema.ts'))).resolves.toBe(true);
    await expect(eslint.isPathIgnored(path.join(ROOT, 'src/lib/db/schema.ts'))).resolves.toBe(
      false,
    );
  });

  it('is skipped by Prettier, while the same file elsewhere is formatted', async () => {
    const journal = await getFileInfo(path.join(ROOT, 'drizzle/meta/_journal.json'), {
      ignorePath: IGNORE_PATH,
    });
    const fixture = await getFileInfo(path.join(ROOT, 'data/meta/_journal.json'), {
      ignorePath: IGNORE_PATH,
    });

    expect(journal.ignored).toBe(true);
    expect(fixture.ignored).toBe(false);
  });

  it('is counted in no coverage', () => {
    expect(config.test?.coverage?.exclude).toStrictEqual(
      expect.arrayContaining(GENERATED_FOLDERS.map((folder) => `${folder}**`)),
    );
  });

  it('is repeated exactly, and with nothing else exempt, by Prettier and markdownlint', () => {
    expect(prettierIgnores()).toStrictEqual([
      ...IGNORED_FOLDERS.map((folder) => `/${folder}`),
      '/docs/*.md',
      'bun.lock',
      ...GENERATED_FOLDERS.map((folder) => `/${folder}`),
    ]);
    expect(markdownlintIgnores()).toStrictEqual([
      'docs/*.md',
      ...IGNORED_FOLDERS.map((folder) => `${folder}**`),
      ...GENERATED_FOLDERS.map((folder) => `${folder}**`),
    ]);
  });
});

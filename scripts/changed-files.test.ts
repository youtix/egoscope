import { describe, expect, it } from 'vitest';

import { parseNameStatus, planCheck, stepsFor, testStep } from './changed-files';

import type { Change } from './changed-files';

const present = (...paths: readonly string[]): Change[] =>
  paths.map((path) => ({ path, removed: false }));
const removed = (...paths: readonly string[]): Change[] =>
  paths.map((path) => ({ path, removed: true }));

describe('parseNameStatus', () => {
  it('reads additions, changes, deletions, renames and copies', () => {
    const output = [
      'A',
      'src/a.ts',
      'M',
      'src/b.ts',
      'D',
      'src/c.ts',
      'R087',
      'src/d.ts',
      'src/e.ts',
      'C100',
      'src/f.ts',
      'src/g.ts',
      '',
    ].join('\0');

    expect(parseNameStatus(output)).toStrictEqual([
      ...present('src/a.ts', 'src/b.ts'),
      ...removed('src/c.ts', 'src/d.ts'),
      ...present('src/e.ts', 'src/f.ts', 'src/g.ts'),
    ]);
  });

  it('reads nothing from empty output', () => {
    expect(parseNameStatus('')).toStrictEqual([]);
  });
});

describe('planCheck', () => {
  it('plans nothing when nothing changed', () => {
    expect(planCheck([])).toStrictEqual({
      changed: false,
      files: [],
      code: [],
      markdown: [],
      frozen: [],
      related: [],
      wholeSuite: [],
    });
  });

  it('sends code to ESLint, Markdown to markdownlint and every present file to Prettier', () => {
    const plan = planCheck(
      present('src/lib/env/server-env.ts', 'src/app/page.tsx', 'README.md', 'src/app/globals.css'),
    );

    expect(plan.files).toStrictEqual([
      'README.md',
      'src/app/globals.css',
      'src/app/page.tsx',
      'src/lib/env/server-env.ts',
    ]);
    expect(plan.code).toStrictEqual(['src/app/page.tsx', 'src/lib/env/server-env.ts']);
    expect(plan.markdown).toStrictEqual(['README.md']);
  });

  it('runs the tests related to changed sources, tests and fixtures', () => {
    const plan = planCheck(
      present(
        'src/lib/env/server-env.ts',
        'src/lib/env/server-env.test.ts',
        'data/fixtures/stats-source/season.json',
        'CLAUDE.md',
      ),
    );

    expect(plan.related).toStrictEqual([
      'data/fixtures/stats-source/season.json',
      'src/lib/env/server-env.test.ts',
      'src/lib/env/server-env.ts',
    ]);
    expect(plan.wholeSuite).toStrictEqual([]);
  });

  it('counts a deletion as a change and runs the whole suite for a removed source', () => {
    const plan = planCheck(removed('src/lib/log/console-sink.ts'));

    expect(plan.changed).toBe(true);
    expect(plan.files).toStrictEqual([]);
    expect(plan.wholeSuite).toStrictEqual(['src/lib/log/console-sink.ts']);
  });

  it('runs the whole suite when a source is renamed', () => {
    const plan = planCheck(
      parseNameStatus(['R100', 'src/lib/log/logger.ts', 'src/lib/log/log.ts', ''].join('\0')),
    );

    expect(plan.related).toStrictEqual(['src/lib/log/log.ts']);
    expect(plan.wholeSuite).toStrictEqual(['src/lib/log/logger.ts']);
  });

  it.each([
    'package.json',
    'bun.lock',
    'eslint.config.ts',
    'tsconfig.json',
    '.markdownlint-cli2.jsonc',
    'scripts/with-lock.ts',
    '.github/workflows/ci.yml',
  ])('treats %s as tooling, which runs the whole test suite', (file) => {
    expect(planCheck(present(file, 'src/app/page.tsx')).wholeSuite).toStrictEqual([file]);
  });

  it('reports a changed French specification instead of skipping it', () => {
    const plan = planCheck([
      ...present('docs/07-statistiques-de-match.md'),
      ...removed('docs/README.md'),
    ]);

    expect(plan.frozen).toStrictEqual(['docs/07-statistiques-de-match.md', 'docs/README.md']);
    expect(plan.files).toStrictEqual([]);
  });

  it('accepts a changed French specification together with its updated manifest', () => {
    const plan = planCheck(present('docs/07-statistiques-de-match.md', 'docs/frozen-specs.sha256'));

    expect(plan.frozen).toStrictEqual([]);
    expect(plan.files).toStrictEqual(['docs/frozen-specs.sha256']);
  });

  it('keeps the English documents in docs/ subfolders', () => {
    expect(planCheck(present('docs/engineering/glossary.md')).markdown).toStrictEqual([
      'docs/engineering/glossary.md',
    ]);
  });

  it('lists each file once', () => {
    expect(planCheck(present('src/app/page.tsx', 'src/app/page.tsx')).files).toStrictEqual([
      'src/app/page.tsx',
    ]);
  });
});

describe('stepsFor', () => {
  const TYPE_CHECKS = [
    'Structure check',
    'Route types',
    'Type check, whole project',
    'Type check, pure core',
  ];

  it('type-checks the whole project even when files were only deleted', () => {
    const steps = stepsFor(planCheck(removed('src/lib/log/console-sink.ts')));

    expect(steps.map((step) => step.name)).toStrictEqual([
      ...TYPE_CHECKS,
      'All unit tests, because of src/lib/log/console-sink.ts',
    ]);
  });

  it('formats and lints the present files, type-checks, then runs the related tests', () => {
    const steps = stepsFor(planCheck(present('src/lib/env/server-env.ts', 'README.md')));

    expect(steps.map((step) => step.name)).toStrictEqual([
      'Prettier',
      'ESLint',
      'markdownlint',
      ...TYPE_CHECKS,
      'Related unit tests',
    ]);
    expect(steps.at(-1)?.command).toStrictEqual([
      'vitest',
      'related',
      '--run',
      '--passWithNoTests',
      'src/lib/env/server-env.ts',
    ]);
  });

  it('names the first files that make the whole suite run, and counts the others', () => {
    const plan = planCheck(present('a.json', 'b.json', 'c.json', 'd.json', 'e.json'));

    expect(testStep(plan)?.name).toBe(
      'All unit tests, because of a.json, b.json, c.json and 2 more',
    );
  });

  it('runs no unit test when no source, test, fixture or tooling changed', () => {
    const plan = planCheck(present('docs/engineering/glossary.md'));

    expect(testStep(plan)).toBeUndefined();
  });
});

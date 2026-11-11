import { describe, expect, it } from 'vitest';

import { planCheck } from './changed-files';

describe('planCheck', () => {
  it('plans nothing when nothing changed', () => {
    expect(planCheck([])).toStrictEqual({
      files: [],
      code: [],
      markdown: [],
      tooling: [],
      related: [],
    });
  });

  it('skips the frozen French specifications but keeps the English docs', () => {
    const plan = planCheck(['docs/07-statistiques-de-match.md', 'docs/engineering/glossary.md']);

    expect(plan.files).toStrictEqual(['docs/engineering/glossary.md']);
    expect(plan.markdown).toStrictEqual(['docs/engineering/glossary.md']);
  });

  it('sends code to ESLint, Markdown to markdownlint and every file to Prettier', () => {
    const plan = planCheck([
      'src/lib/env/server-env.ts',
      'src/app/page.tsx',
      'README.md',
      'src/app/globals.css',
    ]);

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
    const plan = planCheck([
      'src/lib/env/server-env.ts',
      'src/lib/env/server-env.test.ts',
      'data/fixtures/stats-source/season.json',
      'CLAUDE.md',
    ]);

    expect(plan.related).toStrictEqual([
      'data/fixtures/stats-source/season.json',
      'src/lib/env/server-env.test.ts',
      'src/lib/env/server-env.ts',
    ]);
    expect(plan.tooling).toStrictEqual([]);
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
    expect(planCheck([file, 'src/app/page.tsx']).tooling).toStrictEqual([file]);
  });

  it('lists each file once', () => {
    expect(planCheck(['src/app/page.tsx', 'src/app/page.tsx']).files).toStrictEqual([
      'src/app/page.tsx',
    ]);
  });
});

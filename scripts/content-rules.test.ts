import { describe, expect, it } from 'vitest';

import {
  brokenLinks,
  checkFrozenSpecs,
  isFrozenSpec,
  pathFilters,
  pragmaViolations,
  unguardedJobs,
} from './content-rules';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const MANIFEST = `${HASH_A}  docs/00-vue-d-ensemble.md\n${HASH_B}  docs/README.md\n`;
const ACTUAL = new Map([
  ['docs/00-vue-d-ensemble.md', HASH_A],
  ['docs/README.md', HASH_B],
]);

function problems(violations: readonly { path: string; problem: string }[]): string {
  return violations.map((violation) => `${violation.path}: ${violation.problem}`).join('\n');
}

/**
 * A CI workflow with the jobs lint and test, the lines of `extra`, and a ci-ok job
 * that runs whatever happened (`always()`) and needs `needs`.
 */
function workflow(needs: string, extra: readonly string[] = []): string {
  return [
    'name: CI',
    'on:',
    '  pull_request:',
    'jobs:',
    '  lint:',
    '    runs-on: ubuntu-24.04',
    '  test:',
    '    runs-on: ubuntu-24.04',
    ...extra,
    '  ci-ok:',
    '    if: always()',
    `    needs: ${needs}`,
    '    runs-on: ubuntu-24.04',
    '',
  ].join('\n');
}

describe('checkFrozenSpecs', () => {
  it('treats only the Markdown files directly inside docs/ as frozen', () => {
    expect(isFrozenSpec('docs/07-statistiques-de-match.md')).toBe(true);
    expect(isFrozenSpec('docs/engineering/glossary.md')).toBe(false);
    expect(isFrozenSpec('docs/frozen-specs.sha256')).toBe(false);
  });

  it('accepts specifications that match the manifest', () => {
    expect(checkFrozenSpecs(MANIFEST, ACTUAL)).toStrictEqual([]);
  });

  it('rejects a changed specification', () => {
    const changed = new Map([...ACTUAL, ['docs/00-vue-d-ensemble.md', HASH_B]]);

    expect(problems(checkFrozenSpecs(MANIFEST, changed))).toContain(
      'docs/00-vue-d-ensemble.md: This frozen French specification has changed.',
    );
  });

  it('says that an agent reverts the change, without teaching how to make it pass', () => {
    const changed = new Map([...ACTUAL, ['docs/00-vue-d-ensemble.md', HASH_B]]);
    const message = problems(checkFrozenSpecs(MANIFEST, changed));

    expect(message).toContain('an agent never edits them, so revert the change');
    expect(message).toContain(
      'Only the coordinator updates docs/frozen-specs.sha256, when the owner changes a specification.',
    );
    expect(message).not.toContain('in the same pull request');
  });

  it('rejects a deleted specification', () => {
    const deleted = new Map([['docs/README.md', HASH_B]]);

    expect(problems(checkFrozenSpecs(MANIFEST, deleted))).toContain(
      'docs/00-vue-d-ensemble.md: This frozen French specification is missing.',
    );
  });

  it('rejects a new file directly inside docs/', () => {
    const added = new Map([...ACTUAL, ['docs/notes.md', HASH_A]]);

    expect(problems(checkFrozenSpecs(MANIFEST, added))).toContain(
      'docs/notes.md: docs/ holds only the frozen French specifications',
    );
  });

  it('rejects a malformed manifest line', () => {
    expect(problems(checkFrozenSpecs(`${MANIFEST}not a checksum\n`, ACTUAL))).toContain(
      'docs/frozen-specs.sha256: Malformed line: "not a checksum".',
    );
  });
});

describe('brokenLinks', () => {
  const files = new Set(['README.md', 'CLAUDE.md', 'docs/README.md', 'src/app/layout.tsx']);

  it('accepts links to files and folders that exist, and links it does not check', () => {
    const markdown = [
      '[the rules](CLAUDE.md), [the layout](src/app/layout.tsx#L1), [the specs](docs/)',
      '[a site](https://example.com), [mail](mailto:someone@example.com), [a heading](#scripts)',
      '`[not a link](missing.md)`',
      '```md',
      '[inside a code block](missing.md)',
      '```',
    ].join('\n');

    expect(brokenLinks('README.md', markdown, files)).toStrictEqual([]);
  });

  it('resolves links from the folder of the Markdown file', () => {
    expect(brokenLinks('docs/README.md', '[back](../CLAUDE.md)', files)).toStrictEqual([]);
  });

  it.each([
    ['an inline link', '[the glossary](docs/engineering/glossary.md)'],
    ['a reference link', '[glossary]: docs/engineering/glossary.md'],
  ])('rejects %s to a file that is not in the repository', (_kind, markdown) => {
    expect(problems(brokenLinks('README.md', markdown, files))).toContain(
      'README.md: The link to "docs/engineering/glossary.md" points at nothing in the repository.',
    );
  });
});

describe('pragmaViolations', () => {
  it.each([
    ['README.md', '<!-- prettier-ignore -->\n| a | b |\n', 'Prettier'],
    [
      'README.md',
      '<!-- prettier-ignore-start -->\n| a |\n<!-- prettier-ignore-end -->\n',
      'Prettier',
    ],
    ['CLAUDE.md', '<!-- markdownlint-disable MD013 -->\nA long line.\n', 'markdownlint'],
    ['CLAUDE.md', '<!-- markdownlint-configure-file { "MD013": false } -->\n', 'markdownlint'],
    [
      '.github/workflows/ci.yml',
      'jobs:\n  lint:\n    steps:\n      - run: |\n          # shellcheck disable=SC2086\n          echo $x\n',
      'shellcheck',
    ],
    ['lefthook.yml', '# prettier-ignore\nglob_matcher: doublestar\n', 'Prettier'],
    ['scripts/lint-workflows.sh', '#!/bin/sh\n# shellcheck disable=SC2034\n', 'shellcheck'],
    ['src/app/globals.css', "/* prettier-ignore */\n@import 'tailwindcss';\n", 'Prettier'],
    ['.markdownlint-cli2.jsonc', '{\n  // prettier-ignore\n  "config": {}\n}\n', 'Prettier'],
  ])('rejects a switch in %s', (file, text, tool) => {
    expect(problems(pragmaViolations(file, text))).toContain(tool);
  });

  it('accepts a switch named in Markdown prose or code, where no tool reads it', () => {
    const markdown =
      'Never write `prettier-ignore`.\n\n```md\n<!-- markdownlint-disable -->\n```\n<!-- A note. -->\n';

    expect(pragmaViolations('CLAUDE.md', markdown)).toStrictEqual([]);
  });

  it('leaves TypeScript to ESLint', () => {
    expect(pragmaViolations('src/app/page.tsx', '// prettier-ignore\n')).toStrictEqual([]);
  });
});

describe('unguardedJobs', () => {
  it('accepts a ci-ok job that needs every other job', () => {
    expect(unguardedJobs('ci.yml', workflow('[lint, test]'))).toStrictEqual([]);
  });

  it.each([
    ['a block sequence', '\n      - lint\n      - test'],
    ['a flow sequence with a comment', '[lint, test] # every other job'],
  ])('reads needs written as %s', (_form, needs) => {
    expect(unguardedJobs('ci.yml', workflow(needs))).toStrictEqual([]);
  });

  it('rejects a job that ci-ok does not need', () => {
    expect(unguardedJobs('ci.yml', workflow('[lint]'))).toStrictEqual([
      {
        path: 'ci.yml',
        problem: 'Job "test" is missing from the needs of ci-ok, so it would not gate merges.',
      },
    ]);
  });

  it.each([
    ['extra-check:', 'extra-check'],
    ['extra_check:', 'extra_check'],
    ['ExtraCheck:', 'ExtraCheck'],
    ['extra-check: # runs the extra check', 'extra-check'],
    ["'extra-check':", 'extra-check'],
  ])('rejects a forgotten job whose id is written %j', (key, id) => {
    const extra = [`  ${key}`, '    runs-on: ubuntu-24.04', '    steps:', '      - run: exit 1'];
    const violations = unguardedJobs('ci.yml', workflow('[lint, test]', extra));

    expect(problems(violations)).toContain(`Job "${id}" is missing from the needs of ci-ok`);
  });

  it('counts the keys of jobs only, not keys named like jobs further down', () => {
    const extra = [
      '  build:',
      '    runs-on: ubuntu-24.04',
      '    services:',
      '      deploy:',
      '        image: postgres:17',
      '    steps:',
      '      - name: release',
      '        with:',
      '          publish: true',
    ];

    expect(unguardedJobs('ci.yml', workflow('[lint, test, build]', extra))).toStrictEqual([]);
  });

  it('rejects a ci-ok job that a failed job would skip', () => {
    const skippable = workflow('[lint, test]').replace('    if: always()\n', '');

    expect(problems(unguardedJobs('ci.yml', skippable))).toContain('ci-ok must run');
  });

  it.each([
    ['without a ci-ok job', 'jobs:\n  lint:\n    runs-on: ubuntu-24.04\n'],
    ['that is not YAML', 'jobs: [unclosed\n'],
  ])('rejects a workflow %s', (_kind, text) => {
    expect(problems(unguardedJobs('ci.yml', text))).toContain('needs a ci-ok job, under `jobs`');
  });
});

describe('pathFilters', () => {
  it.each(['paths', 'paths-ignore'])('rejects a trigger filtered by %s', (filter) => {
    const filtered = `on:\n  pull_request:\n    ${filter}: ['src/**']\n  push:\n    branches: [main]\n`;

    expect(problems(pathFilters('.github/workflows/e2e.yml', filtered))).toContain(
      'The pull_request trigger has a path filter',
    );
  });

  it('accepts branch filters and triggers written as a list', () => {
    expect(pathFilters('ci.yml', 'on:\n  push:\n    branches: [main]\n')).toStrictEqual([]);
    expect(pathFilters('ci.yml', 'on: [push, pull_request]\n')).toStrictEqual([]);
  });
});

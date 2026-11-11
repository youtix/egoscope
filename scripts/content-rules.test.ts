import { describe, expect, it } from 'vitest';

import { brokenLinks, checkFrozenSpecs, isFrozenSpec, unguardedJobs } from './content-rules';

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

/** A CI workflow with the jobs lint and test, and a ci-ok job that needs `needs`. */
function workflow(needs: string): string {
  return [
    'name: CI',
    'on:',
    '  pull_request:',
    'jobs:',
    '  lint:',
    '    runs-on: ubuntu-24.04',
    '  test:',
    '    runs-on: ubuntu-24.04',
    '  ci-ok:',
    `    needs: [${needs}]`,
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

describe('unguardedJobs', () => {
  it('accepts a ci-ok job that needs every other job', () => {
    expect(unguardedJobs('ci.yml', workflow('lint, test'))).toStrictEqual([]);
  });

  it('rejects a job that ci-ok does not need', () => {
    expect(unguardedJobs('ci.yml', workflow('lint'))).toStrictEqual([
      {
        path: 'ci.yml',
        problem: 'Job "test" is missing from the needs of ci-ok, so it would not gate merges.',
      },
    ]);
  });

  it('rejects a workflow without a ci-ok job', () => {
    const withoutCiOk = 'jobs:\n  lint:\n    runs-on: ubuntu-24.04\n';

    expect(problems(unguardedJobs('ci.yml', withoutCiOk))).toContain('needs a ci-ok job');
  });
});

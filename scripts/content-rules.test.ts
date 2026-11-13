import { describe, expect, it } from 'vitest';

import { brokenLinks, checkFrozenSpecs, isFrozenSpec, pragmaViolations } from './content-rules';

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

  it('reads no comment inside a JSON string, such as a recorded link', () => {
    const fixture = JSON.stringify({
      source: 'https://example.com/blog/why-we-dropped-prettier-ignore',
      note: 'a /* prettier-ignore */ inside a string, and an escaped \\" quote // prettier-ignore',
    });

    expect(pragmaViolations('data/fixtures/stats-source/season.json', fixture)).toStrictEqual([]);
  });

  it.each([
    ['tsconfig.json', '{\n  /* prettier-ignore */\n  "compilerOptions": {}\n}\n'],
    ['data/fixtures/stats-source/season.json', '{\n  "a": 1 // prettier-ignore\n}\n'],
  ])('still rejects a real comment in %s', (file, text) => {
    expect(problems(pragmaViolations(file, text))).toContain('Prettier');
  });
});

/**
 * The acceptance criteria index, docs/engineering/acceptance-criteria-index.md: the
 * ID, spec file and first words of every acceptance criterion, so that tests, issues
 * and pull requests can cite the criteria whose IDs the specs do not write. The
 * traceability check (trace-requirements.ts) renders it in Prettier's format and
 * fails when the committed file differs; `bun run trace --write-index` rewrites it.
 */
import path from 'node:path';

import { format, resolveConfig } from 'prettier';

import type { Criterion } from './spec-ids';

export const INDEX_PATH = 'docs/engineering/acceptance-criteria-index.md';

const FIRST_WORDS = 15;
const INTRODUCTION = [
  '# Acceptance criteria index',
  '',
  'Every acceptance criterion of the French specifications, with the ID that tests, issues and pull',
  "requests cite, as in `it('[CA-JOU-02] refuses a 31st active player', …)`. Files 03, 04 and 14",
  'write the IDs. In the other files, the ID is the position of the criterion in its section',
  "« Critères d'acceptation », counted from 01 in document order.",
  '',
  'This file is generated, so never edit it by hand: `bun run trace` fails when it no longer matches',
  'the specifications, and `bun run trace --write-index` rewrites it.',
  '',
  '| ID | Spec file | First words |',
  '| --- | --- | --- |',
];
// The bold and code marks of the criteria, which the index drops.
const FORMATTING = /\*\*|`/gu;
// Characters that would start Markdown inside a table cell, which the index escapes.
const MARKDOWN = /[\\|*_`[\]<>]/gu;

/** The first words of a criterion, as plain text that a table cell shows as it is. */
function firstWords(text: string): string {
  const words = text
    .replaceAll(FORMATTING, '')
    .split(/\s+/u)
    .filter((word) => word !== '');
  const shown = words.slice(0, FIRST_WORDS).join(' ');
  return (words.length > FIRST_WORDS ? `${shown}…` : shown).replaceAll(MARKDOWN, String.raw`\$&`);
}

function row(criterion: Criterion): string {
  const file = path.posix.basename(criterion.file);
  const link = path.posix.relative(path.posix.dirname(INDEX_PATH), criterion.file);
  return `| ${criterion.id} | [${file}](${link}) | ${firstWords(criterion.text)} |`;
}

/** The index of `criteria`, formatted as Prettier formats the committed file. */
export async function criteriaIndex(criteria: readonly Criterion[]): Promise<string> {
  const markdown = [...INTRODUCTION, ...criteria.map((criterion) => row(criterion)), ''].join('\n');
  const options = await resolveConfig(INDEX_PATH);
  return format(markdown, { ...options, filepath: INDEX_PATH });
}

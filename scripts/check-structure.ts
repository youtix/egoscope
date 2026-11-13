/**
 * Checks every file that git tracks or would track against the layout rules of
 * structure-rules.ts and the content rules of content-rules.ts, and fails on the
 * first broken rule it reports. Run with `bun run lint:structure`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  brokenLinks,
  checkFrozenSpecs,
  FROZEN_MANIFEST,
  hasCommentSyntax,
  isFrozenSpec,
  pathFilters,
  pragmaViolations,
  unguardedJobs,
} from './content-rules';
import { isGeneratedPath } from './generated-files';
import { isIgnoredPath } from './ignored-folders';
import { findStructureViolations } from './structure-rules';

import type { StructureViolation } from './structure-rules';

const WORKFLOW = '.github/workflows/ci.yml';
const WORKFLOWS = /^\.github\/workflows\/[^/]+\.ya?ml$/u;

const listing = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
);
const paths = listing
  .split('\0')
  .filter((path) => path !== '' && !isIgnoredPath(path) && existsSync(path));
const files: ReadonlySet<string> = new Set(paths);
const read = (path: string): string => readFileSync(path, 'utf8');

function frozenSpecViolations(): readonly StructureViolation[] {
  if (!files.has(FROZEN_MANIFEST)) {
    return [
      {
        path: FROZEN_MANIFEST,
        problem: 'The checksum manifest of the French specifications is missing.',
      },
    ];
  }
  const hashes = new Map(
    paths
      .filter((path) => isFrozenSpec(path))
      .map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
  );
  return checkFrozenSpecs(read(FROZEN_MANIFEST), hashes);
}

const violations = [
  ...findStructureViolations(paths),
  ...frozenSpecViolations(),
  ...paths
    .filter((path) => path.endsWith('.md') && !isFrozenSpec(path))
    .flatMap((path) => brokenLinks(path, read(path), files)),
  ...paths
    .filter((path) => hasCommentSyntax(path) && !isFrozenSpec(path) && !isGeneratedPath(path))
    .flatMap((path) => pragmaViolations(path, read(path))),
  ...(files.has(WORKFLOW)
    ? unguardedJobs(WORKFLOW, read(WORKFLOW))
    : [{ path: WORKFLOW, problem: 'The CI workflow, which holds ci-ok, is missing.' }]),
  ...paths.filter((path) => WORKFLOWS.test(path)).flatMap((path) => pathFilters(path, read(path))),
];

for (const { path, problem } of violations) {
  console.error(`${path}: ${problem}`);
}
if (violations.length > 0) {
  console.error(`\nStructure check failed: ${String(violations.length)} problem(s).`);
  process.exitCode = 1;
} else {
  console.info(`Structure check passed (${String(paths.length)} files).`);
}

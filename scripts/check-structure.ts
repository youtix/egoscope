/**
 * Checks the layout of every file that git tracks or would track, and fails
 * when one breaks a rule of structure-rules.ts. Run with `bun run lint:structure`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { findStructureViolations } from './structure-rules';

const listing = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
);
const paths = listing.split('\0').filter((path) => path !== '' && existsSync(path));
const violations = findStructureViolations(paths);

for (const { path, problem } of violations) {
  console.error(`${path}: ${problem}`);
}
if (violations.length > 0) {
  console.error(`\nStructure check failed: ${String(violations.length)} problem(s).`);
  process.exitCode = 1;
} else {
  console.info(`Structure check passed (${String(paths.length)} files).`);
}

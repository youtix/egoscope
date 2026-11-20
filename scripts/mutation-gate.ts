/**
 * The mutation step of `bun run gate` and of the mutation workflow: runs the
 * mutation tests from scratch, `bun run test:mutation --force`, when a path of the
 * mutation scope (mutation-scope.ts) differs from the base, and otherwise says why
 * they do not run, so that the common gate stays fast. Run with
 * `bun scripts/mutation-gate.ts [base]`.
 *
 * The base defaults to where HEAD left origin/main, and the changes are listed as
 * check:changed lists them (changed-files.ts): committed, staged, unstaged and
 * untracked changes count, and so do deletions and both sides of a rename. CI
 * passes HEAD^1: for a pull request, the base branch of its merge commit; for a
 * push to main, the previous commit.
 *
 * Locally as in CI, which keeps no results (mutation.yml), the run reuses none of
 * those that an earlier run recorded in reports/: Stryker's incremental mode judges
 * a mutant by its own code and the lines of its tests alone, so it misses a change
 * to a helper of a test file, to another function of the pure core that a test
 * runs, or outside the pure core (CLAUDE.md, "Mutation testing").
 */
import { spawnSync } from 'node:child_process';

import { describeFiles, listChanges } from './changed-files';
import { mutationTriggers } from './mutation-scope';

function main(argv: readonly string[]): number {
  const [base] = argv;
  const listed = listChanges({ base });
  if (!listed.ok) {
    console.error(`✖ Mutation tests: ${listed.error}`);
    return 1;
  }
  const triggers = mutationTriggers(listed.changes.map((change) => change.path));
  if (triggers.length === 0) {
    console.info(
      `Mutation tests: nothing in their scope differs from ${base ?? 'origin/main'}, so they do not run.`,
    );
    return 0;
  }
  console.info(`Mutation tests from scratch, because of ${describeFiles(triggers)}.`);
  const result = spawnSync('bun', ['run', 'test:mutation', '--force'], { stdio: 'inherit' });
  return result.status ?? 1;
}

process.exitCode = main(process.argv.slice(2));

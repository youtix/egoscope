/**
 * The mutation step of `bun run gate` and of the mutation workflow: runs
 * `bun run test:mutation` when a path of the mutation scope (mutation-scope.ts)
 * differs from the base, and otherwise says why it does not, so that the common
 * gate stays fast. Run with `bun scripts/mutation-gate.ts [base]`.
 *
 * The base defaults to where HEAD left origin/main, and the changes are listed as
 * check:changed lists them (changed-files.ts): committed, staged, unstaged and
 * untracked changes count, and so do deletions and both sides of a rename. CI
 * passes HEAD^1: for a pull request, the base branch of its merge commit; for a
 * push to main, the previous commit.
 *
 * Locally, a run that a path outside the pure core started, an upgrade for one,
 * starts from scratch (`--force`): the results that earlier runs recorded in
 * reports/ do not account for such a change. CI already starts from scratch then,
 * since those paths name the cache of these results (mutation.yml).
 */
import { spawnSync } from 'node:child_process';

import { describeFiles, listChanges } from './changed-files';
import { mutationTriggers, requiresFreshRun } from './mutation-scope';

const isCi = process.env['CI'] === 'true';

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
  const isFreshRun = !isCi && requiresFreshRun(triggers);
  console.info(
    isFreshRun
      ? `Mutation tests from scratch, because of ${describeFiles(triggers)}: earlier results do not account for a change outside the pure core.`
      : `Mutation tests, because of ${describeFiles(triggers)}.`,
  );
  const force = isFreshRun ? ['--force'] : [];
  const result = spawnSync('bun', ['run', 'test:mutation', ...force], { stdio: 'inherit' });
  return result.status ?? 1;
}

process.exitCode = main(process.argv.slice(2));

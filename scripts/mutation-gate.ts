/**
 * The mutation step of `bun run gate` and of the mutation workflow: runs
 * `bun run test:mutation` when a path of the mutation scope (mutation-scope.ts)
 * differs from the base, and otherwise says why it does not, so that the common
 * gate stays fast. Run with `bun scripts/mutation-gate.ts [base]`.
 *
 * The base defaults to where HEAD left origin/main, as for check:changed.
 * Committed, staged, unstaged and untracked changes count, and so do deletions
 * and both sides of a rename. CI passes HEAD^1: for a pull request, the base
 * branch of its merge commit; for a push to main, the previous commit.
 */
import { spawnSync } from 'node:child_process';

import { describeFiles } from './changed-files';
import { isInMutationScope } from './mutation-scope';

/** Runs git and returns its output, or undefined if it fails. */
function git(args: readonly string[]): string | undefined {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : undefined;
}

/** The paths that differ from `base`, untracked files included, or undefined if git cannot list them. */
function changedPaths(base: string): readonly string[] | undefined {
  const tracked = git(['diff', '--name-only', '--no-renames', '-z', base, '--']);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  return tracked === undefined || untracked === undefined
    ? undefined
    : `${tracked}${untracked}`.split('\0').filter(Boolean);
}

function main(argv: readonly string[]): number {
  const base = argv[0] ?? git(['merge-base', 'origin/main', 'HEAD'])?.trim();
  const changed = base === undefined ? undefined : changedPaths(base);
  if (base === undefined || changed === undefined) {
    console.error(
      `✖ Mutation tests: cannot list the changes against ${argv[0] ?? 'origin/main'}. Run \`git fetch origin main\`, then try again.`,
    );
    return 1;
  }
  const inScope = changed.filter((path) => isInMutationScope(path));
  if (inScope.length === 0) {
    console.info(
      `Mutation tests: neither the pure core nor the Stryker setup differs from ${base}, so they do not run.`,
    );
    return 0;
  }
  console.info(`Mutation tests, because of ${describeFiles(inScope)}.`);
  const result = spawnSync('bun', ['run', 'test:mutation'], { stdio: 'inherit' });
  return result.status ?? 1;
}

process.exitCode = main(process.argv.slice(2));

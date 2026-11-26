/**
 * The mutation step of `bun run gate` and of the mutation workflow: runs the
 * mutation tests from scratch, `bun run test:mutation --force`, when a path of the
 * mutation scope (mutation-scope.ts) differs from the base, and otherwise says why
 * they do not run, so that the common gate stays fast. Run with
 * `bun scripts/mutation-gate.ts [--event <event>]`.
 *
 * Without an event, the base is where HEAD left origin/main. CI passes the event that
 * runs the workflow: a pull request compares with HEAD^1, the base branch of its merge
 * commit, and a push to main with the last commit of main on which the workflow
 * succeeded; any other event, or a base that cannot be determined, tests every mutant
 * (mutation-base.ts). The gate prints the base that it chose, or why it has none. The
 * changes are listed as check:changed lists them (changed-files.ts): committed, staged,
 * unstaged and untracked changes count, and so do deletions and both sides of a
 * rename. The fixtures and the setup files of the scope are read from the imports of
 * the working tree (mutation-imports.ts).
 *
 * Locally as in CI, which keeps no results (mutation.yml), the run reuses none of
 * those that an earlier run recorded in reports/: Stryker's incremental mode judges
 * a mutant by its own code and the lines of its tests alone, so it misses a change
 * to a helper of a test file, to another function of the pure core that a test
 * runs, or outside the pure core (CLAUDE.md, "Mutation testing").
 */
import { spawnSync } from 'node:child_process';

import { describeFiles, listChanges } from './changed-files';
import { chooseBase } from './mutation-base';
import { pureCoreImports, setupImports } from './mutation-imports';
import { mutationTriggers } from './mutation-scope';

const EVENT_OPTION = '--event';
const USAGE = `✖ Mutation tests: usage: bun scripts/mutation-gate.ts [${EVENT_OPTION} <event>]`;

/** The event that `argv` names, undefined for none, or false when `argv` is not understood. */
function eventOf(argv: readonly string[]): string | undefined | false {
  if (argv.length === 0) {
    return undefined;
  }
  const [option, event, ...rest] = argv;
  return option === EVENT_OPTION && event !== undefined && rest.length === 0 ? event : false;
}

function fromScratch(): number {
  return spawnSync('bun', ['run', 'test:mutation', '--force'], { stdio: 'inherit' }).status ?? 1;
}

/** Runs the mutation tests when their scope differs from `base` (undefined: origin/main). */
function compareWith(base: string | undefined): number {
  const listed = listChanges({ base });
  if (!listed.ok) {
    console.error(`✖ Mutation tests: ${listed.error}`);
    return 1;
  }
  const root = process.cwd();
  const imported = new Set([...pureCoreImports(root), ...setupImports(root)]);
  const triggers = mutationTriggers(
    listed.changes.map((change) => change.path),
    imported,
  );
  if (triggers.length === 0) {
    console.info('Mutation tests: nothing in their scope differs, so they do not run.');
    return 0;
  }
  console.info(`Mutation tests from scratch, because of ${describeFiles(triggers)}.`);
  return fromScratch();
}

function main(argv: readonly string[]): number {
  const event = eventOf(argv);
  if (event === false) {
    console.error(USAGE);
    return 1;
  }
  const choice = chooseBase(event, process.env);
  if (!choice.compare) {
    console.info(`Mutation tests from scratch, because ${choice.reason}.`);
    return fromScratch();
  }
  console.info(`Mutation tests: compared with ${choice.label}.`);
  return compareWith(choice.base);
}

process.exitCode = main(process.argv.slice(2));

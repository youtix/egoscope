/**
 * The fast local check: formats, lints and tests what differs from origin/main
 * (committed, staged, unstaged and untracked changes, deletions and renames
 * included), type-checks the whole project, and stops at the first failing step,
 * which it names. Run with `bun run check:changed`.
 */
import { spawnSync } from 'node:child_process';

import { describeFiles, parseNameStatus, planCheck, stepsFor, testStep } from './changed-files';
import { isIgnoredPath } from './ignored-folders';

import type { Change, CheckPlan, Step } from './changed-files';

/** Runs git and returns its output, or undefined if it fails. */
function git(args: readonly string[]): string | undefined {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : undefined;
}

/** The changes against origin/main, or a one-line reason why they cannot be listed. */
function changesFromOriginMain(): Readonly<{ changes: Change[] } | { problem: string }> {
  if (git(['rev-parse', '--verify', '--quiet', 'origin/main']) === undefined) {
    return { problem: 'origin/main is missing: run `git fetch origin main`, then try again.' };
  }
  const base = git(['merge-base', 'origin/main', 'HEAD'])?.trim();
  if (base === undefined || base === '') {
    return {
      problem:
        'HEAD shares no history with origin/main (stale or rewritten): run `git fetch origin main` and rebase.',
    };
  }
  const differing = parseNameStatus(
    git(['diff', '--name-status', '-z', '--find-renames', base]) ?? '',
  );
  const untracked = (git(['ls-files', '--others', '--exclude-standard', '-z']) ?? '')
    .split('\0')
    .filter(Boolean)
    .map((path) => ({ path, removed: false }));
  return { changes: [...differing, ...untracked].filter((change) => !isIgnoredPath(change.path)) };
}

/** Runs the steps in order and returns the exit code of the first one that fails. */
function runSteps(steps: readonly Step[]): number {
  for (const step of steps) {
    console.info(`\n▶ ${step.name}`);
    const [program = 'true', ...args] = step.command;
    const result = spawnSync(program, args, { stdio: 'inherit' });
    if (result.error !== undefined) {
      console.error(
        `\n✖ check:changed stopped: ${step.name} could not start (${result.error.message}); run \`bun install\`.`,
      );
      return 1;
    }
    if (result.status !== 0) {
      console.error(`\n✖ check:changed stopped: ${step.name} failed.`);
      return result.status ?? 1;
    }
  }
  return 0;
}

/** The exit code when no step runs: nothing changed, or a frozen specification did. */
function stopEarly(plan: CheckPlan): number | undefined {
  if (!plan.changed) {
    console.info('check:changed: nothing differs from origin/main, so there is nothing to check.');
    return 0;
  }
  if (plan.frozen.length > 0) {
    console.error(
      `✖ check:changed: the frozen French specifications changed (${describeFiles(plan.frozen)}). Revert them, or, if the change is deliberate, update docs/frozen-specs.sha256 in the same PR.`,
    );
    return 1;
  }
  return undefined;
}

function main(): number {
  const listed = changesFromOriginMain();
  if ('problem' in listed) {
    console.error(`✖ check:changed: ${listed.problem}`);
    return 1;
  }
  const plan = planCheck(listed.changes);
  const early = stopEarly(plan);
  if (early !== undefined) {
    return early;
  }
  console.info(`check:changed: ${String(listed.changes.length)} change(s) against origin/main.`);
  const status = runSteps(stepsFor(plan));
  if (status === 0) {
    const tests =
      testStep(plan) === undefined
        ? ' No source, test or fixture changed, so no unit tests ran.'
        : '';
    console.info(`\n✔ check:changed passed.${tests}`);
  }
  return status;
}

process.exitCode = main();

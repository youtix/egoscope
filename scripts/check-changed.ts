/**
 * The fast local check: formats, lints and tests what differs from origin/main
 * (committed, staged, unstaged and untracked changes, deletions and renames
 * included, as changed-files.ts lists them), type-checks the whole project, runs
 * the traceability check when a file that it reads changed, and stops at the first
 * failing step, which it names. Run with `bun run check:changed`.
 */
import { spawnSync } from 'node:child_process';

import { describeFiles, listChanges, planCheck, stepsFor, testStep } from './changed-files';
import { FROZEN_HELP } from './content-rules';

import type { CheckPlan, Step } from './changed-files';

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
    console.error(`✖ check:changed: ${describeFiles(plan.frozen)} changed. ${FROZEN_HELP}`);
    return 1;
  }
  return undefined;
}

function main(): number {
  const listed = listChanges();
  if (!listed.ok) {
    console.error(`✖ check:changed: ${listed.error}`);
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

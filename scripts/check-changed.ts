/**
 * The fast local check: formats, lints and tests what differs from origin/main
 * (committed, staged, unstaged and untracked files), type-checks the whole
 * project, and stops at the first failing step. Run with `bun run check:changed`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { planCheck } from './changed-files';

import type { CheckPlan } from './changed-files';

type Step = Readonly<{ name: string; command: readonly string[] }>;

const NAMED_TOOLING_FILES = 3;

function git(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function changedFiles(): string[] {
  const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const differing = git(['diff', '--name-only', '--diff-filter=d', '-z', base]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  return [...differing, ...untracked].filter((file) => existsSync(file));
}

function testStep(plan: CheckPlan): Step | undefined {
  if (plan.tooling.length > 0) {
    const named = plan.tooling.slice(0, NAMED_TOOLING_FILES).join(', ');
    const others = plan.tooling.length - NAMED_TOOLING_FILES;
    const more = others > 0 ? ` and ${String(others)} more` : '';
    return {
      name: `All unit tests, because tooling changed: ${named}${more}`,
      command: ['vitest', 'run'],
    };
  }
  return plan.related.length > 0
    ? {
        name: 'Related unit tests',
        command: ['vitest', 'related', '--run', '--passWithNoTests', ...plan.related],
      }
    : undefined;
}

function stepsFor(plan: CheckPlan): Step[] {
  const tests = testStep(plan);
  return [
    { name: 'Prettier', command: ['prettier', '--check', '--ignore-unknown', ...plan.files] },
    ...(plan.code.length > 0
      ? [
          {
            name: 'ESLint',
            command: ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...plan.code],
          },
        ]
      : []),
    ...(plan.markdown.length > 0
      ? [{ name: 'markdownlint', command: ['markdownlint-cli2', ...plan.markdown] }]
      : []),
    { name: 'Structure check', command: ['bun', 'scripts/check-structure.ts'] },
    { name: 'Route types', command: ['next', 'typegen'] },
    { name: 'Type check, whole project', command: ['tsc', '--noEmit'] },
    ...(tests === undefined ? [] : [tests]),
  ];
}

/** Runs the steps in order and returns the exit code of the first one that fails. */
function runSteps(steps: readonly Step[]): number {
  for (const step of steps) {
    console.info(`\n▶ ${step.name}`);
    const [program = 'true', ...args] = step.command;
    const { status } = spawnSync(program, args, { stdio: 'inherit' });
    if (status !== 0) {
      console.error(`\n✖ check:changed stopped: ${step.name} failed.`);
      return status ?? 1;
    }
  }
  return 0;
}

function main(): number {
  const plan = planCheck(changedFiles());
  if (plan.files.length === 0) {
    console.info('check:changed: nothing differs from origin/main, so there is nothing to check.');
    return 0;
  }
  console.info(`check:changed: ${String(plan.files.length)} file(s) differ from origin/main.`);
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

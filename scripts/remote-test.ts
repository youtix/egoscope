/**
 * Runs a targeted Vitest run of a pushed branch on a GitHub runner, where it starts within
 * seconds and takes no local lock (CLAUDE.md, "The local loop"). Anyone working on a branch of
 * this repository may start it; it never commits and never pushes.
 *
 *   bun run test:remote <filter>... [--coverage.include=<glob>]...
 *
 * - The local side checks that HEAD is pushed, dispatches .github/workflows/remote-test.yml on
 *   the current branch and follows its run (scripts/remote-test-run.ts): it prints the output of
 *   the tests and exits with 0 when they passed, 1 when they failed and 2 when the run gave no
 *   result. `gh` reads the repository from the git remote, so no owner or repository is written
 *   here.
 * - The runner side, `bun scripts/remote-test.ts --runner`, is the workflow's step: it reads the
 *   inputs from REMOTE_TEST_FILTERS and REMOTE_TEST_COVERAGE, checks them as the local side does,
 *   since whoever may dispatch the workflow can also do it by hand from GitHub's page, and starts
 *   Vitest with an argument array, never through a shell.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { findRun, follow, NO_RESULT, refusal, short, WORKFLOW } from './remote-test-run';

import type { Command, Commit, LocalIo, Print, Result, Run, Session } from './remote-test-run';

const RUNNER_FLAG = '--runner';
const COVERAGE_FLAG = '--coverage.include=';
const FILTERS_VARIABLE = 'REMOTE_TEST_FILTERS';
const COVERAGE_VARIABLE = 'REMOTE_TEST_COVERAGE';

const MAX_TOKEN_LENGTH = 200;
const MAX_TOKENS = 20;
const FILTER_CHARACTERS = /^[\w/.()[\]@-]+$/u;
const GLOB_CHARACTERS = /^src\/[\w/.()[\]@*-]+$/u;
const FORBIDDEN_START = /^[-/]/u;
const CHARACTERS = `${String(MAX_TOKEN_LENGTH)} letters, digits and / . _ - ( ) [ ] @`;
const FILTER_RULE = `use 1 to ${CHARACTERS}, do not start with - or /, and do not write two dots in a row`;
const GLOB_RULE = `start it with src/, use at most ${CHARACTERS} *, and do not write two dots in a row`;

const WAIT_LIMIT_MS = 1_200_000; // Twenty minutes.
// `git symbolic-ref --quiet` exits with 1, silently, when HEAD is detached.
const DETACHED_STATUS = 1;
// Large enough for the log of any run of the test step.
const OUTPUT_LIMIT_BYTES = 268_435_456;
const RUN_URL = /https:\/\/\S+\/actions\/runs\/(\d+)/u;
// GitHub's refusal of a dispatch on a branch whose workflow file has no such trigger names it.
const MISSING_WORKFLOW = 'workflow_dispatch';

const DETACHED = 'HEAD is detached: switch to the branch you pushed, then run the command again.';
const ON_MAIN =
  'The branch is main, which CI tests on every push: run the command from the branch of your task.';
const UNCOMMITTED =
  'The worktree holds changes that are not committed, which the run would not test: commit and push them, then run the command again.';
const REBASE =
  'The branch does not hold the remote-test workflow yet: rebase it onto origin/main, push it, then run the command again.';

type RemoteRequest = Readonly<{ filters: readonly string[]; globs: readonly string[] }>;

const isAllowed = (token: string, characters: RegExp): boolean =>
  token.length <= MAX_TOKEN_LENGTH &&
  characters.test(token) &&
  !FORBIDDEN_START.test(token) &&
  !token.includes('..');

const tooMany = (tokens: readonly string[], what: string): string =>
  `Give at most ${String(MAX_TOKENS)} ${what}: ${String(tokens.length)} were given.`;

/**
 * Checks what a run may be asked, on either side, since the inputs reach a command line on the
 * runner: 1 to 20 filters and at most 20 coverage globs, each 1 to 200 letters, digits and
 * `/ . _ - ( ) [ ] @`, not starting with `-` or `/` and without `..`; a glob may also hold `*`
 * and starts with `src/`. A refusal names the token.
 */
export function checkRequest(
  filters: readonly string[],
  globs: readonly string[],
): Result<RemoteRequest> {
  const filter = filters.find((token) => !isAllowed(token, FILTER_CHARACTERS));
  const glob = globs.find((token) => !isAllowed(token, GLOB_CHARACTERS));
  const problem = [
    filters.length === 0 && 'Give at least one test filter, such as src/lib/time.',
    filters.length > MAX_TOKENS && tooMany(filters, 'test filters'),
    globs.length > MAX_TOKENS && tooMany(globs, 'coverage globs'),
    filter !== undefined && `The filter ${JSON.stringify(filter)} is not allowed: ${FILTER_RULE}.`,
    glob !== undefined && `The coverage glob ${JSON.stringify(glob)} is not allowed: ${GLOB_RULE}.`,
  ].find((sentence): sentence is string => sentence !== false);
  return problem === undefined ? { ok: true, value: { filters, globs } } : refusal(problem);
}

const tokensOf = (value = ''): readonly string[] =>
  value.split(' ').filter((token) => token !== '');

/**
 * The runner side: checks the inputs that `env` holds and gives Vitest its arguments through
 * `startVitest`, which returns Vitest's exit code. A refused input starts nothing.
 */
export function runOnRunner(
  env: Readonly<Record<string, string | undefined>>,
  startVitest: (args: readonly string[]) => number,
  printError: Print,
): number {
  const checked = checkRequest(tokensOf(env[FILTERS_VARIABLE]), tokensOf(env[COVERAGE_VARIABLE]));
  if (!checked.ok) {
    printError(checked.error);
    return NO_RESULT;
  }
  const { filters, globs } = checked.value;
  const coverage = globs.map((glob) => `${COVERAGE_FLAG}${glob}`);
  return startVitest(['run', ...filters, ...(globs.length > 0 ? ['--coverage', ...coverage] : [])]);
}

/** The branch and the commit to test, or why the run would not test what the caller has. */
function readCommit(git: Command): Result<Commit> {
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch.status !== 0) {
    return refusal(branch.status === DETACHED_STATUS ? DETACHED : branch.stderr.trimEnd());
  }
  const name = branch.stdout.trim();
  if (name === 'main') {
    return refusal(ON_MAIN);
  }
  if (git(['status', '--porcelain']).stdout.trim() !== '') {
    return refusal(UNCOMMITTED);
  }
  const upstream = git(['rev-parse', '@{upstream}']);
  if (upstream.status !== 0) {
    return refusal(
      `The branch ${name} has no upstream: push it with git push -u origin ${name}, then run the command again.`,
    );
  }
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  return upstream.stdout.trim() === head
    ? { ok: true, value: { branch: name, head } }
    : refusal(
        `The upstream of ${name} is not at HEAD: commit and push first (git push -u origin ${name}), so that the run tests HEAD.`,
      );
}

/** Dispatches the workflow: the run that gh names, undefined when it names none, or the error. */
function dispatch({ io, commit }: Session, request: RemoteRequest): Result<Run | undefined> {
  const inputs = [`filters=${request.filters.join(' ')}`, `coverage=${request.globs.join(' ')}`];
  const fields = inputs.flatMap((input) => ['--raw-field', input]);
  const result = io.gh(['workflow', 'run', WORKFLOW, '--ref', commit.branch, ...fields]);
  if (result.status !== 0) {
    const error = result.stderr.trimEnd();
    return refusal(error.includes(MISSING_WORKFLOW) ? `${error}\n${REBASE}` : error);
  }
  const match = RUN_URL.exec(`${result.stdout}\n${result.stderr}`);
  return {
    ok: true,
    value: match?.[1] === undefined ? undefined : { id: match[1], url: match[0] },
  };
}

function refuse(io: LocalIo, error: string): number {
  io.printError(error);
  return NO_RESULT;
}

/**
 * The local side, `bun run test:remote <filter>... [--coverage.include=<glob>]...`: dispatches
 * the remote test of the pushed HEAD, follows its run and exits with 0 when the tests passed, 1
 * when they failed and 2 when there is no result, a refusal included.
 */
export async function runLocally(argv: readonly string[], io: LocalIo): Promise<number> {
  const globs = argv.filter((token) => token.startsWith(COVERAGE_FLAG));
  const checked = checkRequest(
    argv.filter((token) => !token.startsWith(COVERAGE_FLAG)),
    globs.map((token) => token.slice(COVERAGE_FLAG.length)),
  );
  if (!checked.ok) {
    return refuse(io, checked.error);
  }
  const commit = readCommit(io.git);
  if (!commit.ok) {
    return refuse(io, commit.error);
  }
  const session = { io, commit: commit.value, deadline: io.clock() + WAIT_LIMIT_MS };
  const dispatched = dispatch(session, checked.value);
  const found =
    dispatched.ok && dispatched.value === undefined ? await findRun(session) : dispatched;
  if (!found.ok) {
    return refuse(io, found.error);
  }
  return found.value === undefined
    ? refuse(
        io,
        `No run of ${WORKFLOW} appeared for ${short(commit.value.head)} in twenty minutes.`,
      )
    : follow(session, found.value);
}

/** Runs `program` without a shell; a program that cannot start answers with its error. */
function command(program: string): Command {
  return (args) => {
    const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT_BYTES });
    return {
      status: result.status ?? NO_RESULT,
      stdout: result.stdout,
      stderr: result.error === undefined ? result.stderr : result.error.message,
    };
  };
}

/** Starts Vitest from node_modules, without a shell and without color codes in the log. */
function spawnVitest(args: readonly string[]): number {
  const vitest = path.join(import.meta.dirname, '..', 'node_modules', '.bin', 'vitest');
  const env = { ...process.env, NO_COLOR: '1' };
  return spawnSync(vitest, args, { stdio: 'inherit', env }).status ?? NO_RESULT;
}

const toStdout: Print = (line) => {
  console.info(line);
};
const toStderr: Print = (line) => {
  console.error(line);
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const argv = process.argv.slice(2);
  const start = performance.now();
  const clock = (): number => performance.now() - start;
  process.exitCode =
    argv[0] === RUNNER_FLAG
      ? runOnRunner(process.env, spawnVitest, toStderr)
      : await runLocally(argv, {
          git: command('git'),
          gh: command('gh'),
          sleep: async (milliseconds) => {
            await sleep(milliseconds);
          },
          clock,
          print: toStdout,
          printError: toStderr,
        });
}

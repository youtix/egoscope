import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { checkRequest, runLocally, runOnRunner } from './remote-test';

import type { LocalIo, Output } from './remote-test-run';

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';
const BRANCH = 'chore/probe';
const RUNS = 'https://github.com/example/repository/actions/runs';
const RUN_URL = `${RUNS}/4242`;
const JOB_ID = 9001;
const FILTER = ['src/lib/orbit'];
const STATUS_QUESTION = 'run view 4242 --json status';

const FILTER_RULE =
  'use 1 to 200 letters, digits and / . _ - ( ) [ ] @, do not start with - or /, and do not write two dots in a row';
const GLOB_RULE =
  'start it with src/, use at most 200 letters, digits and / . _ - ( ) [ ] @ *, and do not write two dots in a row';
const NO_FILTER = 'Give at least one test filter, such as src/lib/time.';
const UNCOMMITTED =
  'The worktree holds changes that are not committed, which the run would not test: commit and push them, then run the command again.';
const filterRefused = (token: string): string =>
  `The filter ${JSON.stringify(token)} is not allowed: ${FILTER_RULE}.`;
const globRefused = (token: string): string =>
  `The coverage glob ${JSON.stringify(token)} is not allowed: ${GLOB_RULE}.`;

const answer = (stdout = ''): Output => ({ status: 0, stdout, stderr: '' });
const error = (stderr: string, status = 1): Output => ({ status, stdout: '', stderr });
const json = (value: unknown): Output => answer(JSON.stringify(value));
const listed = (...runs: readonly (readonly [number, string])[]): Output =>
  json(runs.map(([id, status]) => ({ databaseId: id, status, url: `${RUNS}/${String(id)}` })));

/** The answers of git on a pushed branch with nothing left to commit, some of them replaced. */
function fakeGit(replaced: Readonly<Record<string, Output>> = {}): LocalIo['git'] {
  const answers: Readonly<Record<string, Output>> = {
    'symbolic-ref --quiet --short HEAD': answer(`${BRANCH}\n`),
    'status --porcelain': answer(),
    'rev-parse @{upstream}': answer(`${HEAD}\n`),
    'rev-parse HEAD': answer(`${HEAD}\n`),
    ...replaced,
  };
  return (args) => answers[args.join(' ')] ?? error(`unexpected: git ${args.join(' ')}`);
}

/** The run that GitHub reports once it has completed. */
function finishedRun({
  conclusion = 'success',
  headSha = HEAD,
  tests = 'success',
  setUp = 'success',
} = {}): Output {
  const steps = [
    ['Set up job', 'success'],
    ['Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'success'],
    ['Run ./.github/actions/setup-project', setUp],
    ['Run the tests', tests],
    ['Complete job', 'success'],
  ].map(([name, stepConclusion]) => ({ name, conclusion: stepConclusion }));
  return json({ conclusion, headSha, jobs: [{ databaseId: JOB_ID, name: 'remote-test', steps }] });
}

// The log of the job, in the shape of `gh run view --log`, which scripts/remote-test-run.test.ts
// shows in full.
const LOG = [
  'remote-test\tRun ./.github/actions/setup-project\t2026-11-25T10:00:15.0000000Z 716 packages installed',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.0000000Z  ✓ |node| src/lib/orbit/moon.test.ts (3 tests)',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.1000000Z  Test Files  1 passed (1)',
].join('\n');
const TEST_OUTPUT = ' ✓ |node| src/lib/orbit/moon.test.ts (3 tests)\n Test Files  1 passed (1)';

type Script = Readonly<{
  dispatch?: Output;
  lists?: readonly Output[];
  statuses?: readonly string[];
  finished?: Output;
}>;

const DISPATCHED = answer(
  `✓ Created workflow_dispatch event for remote-test.yml at ${BRANCH}\n${RUN_URL}\n`,
);

/** A fake gh that answers as `script` says, each sequence repeating its last answer once spent. */
function fakeGh(script: Script): LocalIo['gh'] {
  const asked = { list: 0, status: 0 };
  const next = (answers: readonly Output[], kind: keyof typeof asked): Output => {
    asked[kind] += 1;
    return answers[Math.min(asked[kind], answers.length) - 1] ?? error('no answer');
  };
  const statuses = (script.statuses ?? ['completed']).map((status) => json({ status }));
  return (args) => {
    if (args[0] === 'workflow') {
      return script.dispatch ?? DISPATCHED;
    }
    if (args[1] === 'list') {
      return next(script.lists ?? [listed([4242, 'completed'])], 'list');
    }
    if (args.at(-1) === 'status') {
      return next(statuses, 'status');
    }
    return args.at(-1) === '--log' ? answer(LOG) : (script.finished ?? finishedRun());
  };
}

/**
 * The io of the local side, with the fake gh of `script` and a fake git, on a fake clock that
 * only the waits move. It records what is printed, every wait, and every question to GitHub with
 * the time it was asked.
 */
function harness(script: Script = {}, git = fakeGit()) {
  let now = 0;
  const out: string[] = [];
  const err: string[] = [];
  const sleeps: number[] = [];
  const asked: string[] = [];
  const times: number[] = [];
  const gh = fakeGh(script);
  const io: LocalIo = {
    git,
    gh: (args) => {
      asked.push(args.join(' '));
      times.push(now);
      return gh(args);
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
      await Promise.resolve();
    },
    clock: () => now,
    print: (line) => {
      out.push(line);
    },
    printError: (line) => {
      err.push(line);
    },
  };
  const timesOf = (question: string): readonly number[] =>
    times.filter((_, index) => asked[index] === question);
  return { io, out, err, sleeps, asked, timesOf };
}

describe('checkRequest', () => {
  it.each([
    ['a plain folder', ['src/lib/orbit']],
    ['a file', ['scripts/remote-test.test.ts']],
    ['a route group', ['src/app/(app)']],
    ['a dynamic route segment', ['src/app/players/[playerId]']],
    ['20 filters of 200 characters', Array.from({ length: 20 }, () => `src/${'a'.repeat(196)}`)],
  ])('allows %s', (_case, filters) => {
    expect(checkRequest(filters, [])).toStrictEqual({ ok: true, value: { filters, globs: [] } });
  });

  it('allows coverage globs under src/, stars included', () => {
    const globs = ['src/lib/orbit/**', 'src/app/(app)/*.tsx'];

    expect(checkRequest(FILTER, globs)).toStrictEqual({
      ok: true,
      value: { filters: FILTER, globs },
    });
  });

  it.each([
    ['a token that starts with -', '--bail'],
    ['a token with a space inside', 'src/lib orbit'],
    ['a tab', 'src/lib\torbit'],
    ['a semicolon', 'src/lib;id'],
    ['a command substitution', 'src/$(id)'],
    ['a backtick', 'src/`id`'],
    ['two dots', 'src/../etc'],
    ['an absolute path', '/etc/passwd'],
    ['an empty string', ''],
    ['a star', 'src/*'],
    ['201 characters', `src/${'a'.repeat(197)}`],
  ])('refuses a filter with %s, naming it', (_case, token) => {
    expect(checkRequest(['src', token], [])).toStrictEqual({
      ok: false,
      error: filterRefused(token),
    });
  });

  it.each([
    ['without src/', 'lib/**'],
    ['with two dots', 'src/../**'],
    ['with a semicolon', 'src/**;id'],
    ['with a space', 'src/lib/**  x'],
  ])('refuses a coverage glob %s, naming it', (_case, glob) => {
    expect(checkRequest(FILTER, ['src/**', glob])).toStrictEqual({
      ok: false,
      error: globRefused(glob),
    });
  });

  it.each([
    { name: 'no filter', filters: [], globs: [], sentence: NO_FILTER },
    {
      name: '21 filters',
      filters: Array.from({ length: 21 }, () => 'src'),
      globs: [],
      sentence: 'Give at most 20 test filters: 21 were given.',
    },
    {
      name: '21 globs',
      filters: FILTER,
      globs: Array.from({ length: 21 }, () => 'src/**'),
      sentence: 'Give at most 20 coverage globs: 21 were given.',
    },
  ])('refuses $name', ({ filters, globs, sentence }) => {
    expect(checkRequest(filters, globs)).toStrictEqual({ ok: false, error: sentence });
  });
});

describe('runOnRunner', () => {
  it.each([
    {
      name: 'filters alone',
      filters: 'src/lib/orbit  scripts/remote-test.test.ts',
      coverage: '',
      args: ['run', 'src/lib/orbit', 'scripts/remote-test.test.ts'],
    },
    {
      name: 'filters with coverage globs',
      filters: 'src/lib/orbit',
      coverage: 'src/lib/orbit/** src/lib/tide/**',
      args: [
        'run',
        'src/lib/orbit',
        '--coverage',
        '--coverage.include=src/lib/orbit/**',
        '--coverage.include=src/lib/tide/**',
      ],
    },
  ])(
    'gives Vitest the exact arguments for $name and passes on its exit code',
    ({ filters, coverage, args }) => {
      const startVitest = vi.fn(() => 1);
      const printError = vi.fn();
      const env = { REMOTE_TEST_FILTERS: filters, REMOTE_TEST_COVERAGE: coverage };

      expect(runOnRunner(env, startVitest, printError)).toBe(1);
      expect(startVitest.mock.calls).toStrictEqual([[args]]);
      expect(printError).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'a refused filter',
      { REMOTE_TEST_FILTERS: 'src/lib;id', REMOTE_TEST_COVERAGE: '' },
      filterRefused('src/lib;id'),
    ],
    ['a filter with a newline', { REMOTE_TEST_FILTERS: 'src\nid' }, filterRefused('src\nid')],
    [
      'a refused glob',
      { REMOTE_TEST_FILTERS: 'src', REMOTE_TEST_COVERAGE: 'src/$(id)' },
      globRefused('src/$(id)'),
    ],
    ['no filter', {}, NO_FILTER],
  ])('starts nothing for %s', (_case, env, sentence) => {
    const startVitest = vi.fn(() => 0);
    const printError = vi.fn();

    expect(runOnRunner(env, startVitest, printError)).toBe(2);
    expect(startVitest).not.toHaveBeenCalled();
    expect(printError.mock.calls).toStrictEqual([[sentence]]);
  });
});

describe('runLocally', () => {
  it('dispatches the pushed branch, finds the run in the URL gh prints and exits with 0 when the tests pass', async () => {
    const remote = harness({ statuses: ['queued', 'in_progress', 'in_progress', 'completed'] });

    expect(await runLocally([...FILTER, '--coverage.include=src/lib/orbit/**'], remote.io)).toBe(0);
    expect(remote.asked[0]).toBe(
      `workflow run remote-test.yml --ref ${BRANCH} --raw-field filters=src/lib/orbit --raw-field coverage=src/lib/orbit/**`,
    );
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([10_000, 20_000, 30_000, 40_000]);
    expect(remote.out).toStrictEqual([
      `Dispatched the remote test of a1b2c3d on ${BRANCH}: ${RUN_URL}`,
      'The run has started on a GitHub runner.',
      TEST_OUTPUT,
      `The tests passed: ${RUN_URL}`,
    ]);
    expect(remote.err).toStrictEqual([]);
  });

  it('finds the run by listing the runs of the commit when gh prints no URL', async () => {
    const remote = harness({
      dispatch: answer('✓ Created workflow_dispatch event for remote-test.yml\n'),
      lists: [listed([4241, 'completed']), listed([4242, 'queued'], [4241, 'completed'])],
    });
    const listing = `run list --workflow remote-test.yml --branch ${BRANCH} --commit ${HEAD} --event workflow_dispatch --json databaseId,status,url`;

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.timesOf(listing)).toStrictEqual([10_000, 20_000]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([30_000]);
    expect(remote.out.at(-1)).toBe(`The tests passed: ${RUN_URL}`);
  });

  it('exits with 1 and prints the output of the tests when they fail', async () => {
    const remote = harness({ finished: finishedRun({ conclusion: 'failure', tests: 'failure' }) });

    expect(await runLocally(FILTER, remote.io)).toBe(1);
    expect(remote.out.slice(-2)).toStrictEqual([TEST_OUTPUT, `The tests failed: ${RUN_URL}`]);
  });

  it.each([
    {
      name: 'a cancelled run',
      finished: { conclusion: 'cancelled', tests: 'cancelled' },
      lists: [listed([4242, 'completed'])],
      sentence: 'The run was cancelled, so it gave no result',
    },
    {
      name: 'a run that a newer dispatch replaced',
      finished: { conclusion: 'cancelled', tests: 'cancelled' },
      lists: [listed([4243, 'in_progress'], [4242, 'completed'])],
      sentence: `The run was cancelled because a newer dispatch of ${BRANCH} replaced it (${RUNS}/4243), so it gave no result`,
    },
    {
      name: 'a failed set-up step',
      finished: { conclusion: 'failure', setUp: 'failure', tests: 'skipped' },
      lists: [],
      sentence: 'A set-up step failed before the tests ran, so the run gave no result',
    },
    {
      name: 'a run of another commit',
      finished: { headSha: OTHER },
      lists: [],
      sentence:
        'The run tested commit f0e1d2c instead of HEAD a1b2c3d, so it gave no result; push HEAD and run the command again',
    },
  ])(
    'exits with 2 for $name, without printing a test output',
    async ({ finished, lists, sentence }) => {
      const remote = harness({ finished: finishedRun(finished), lists });

      expect(await runLocally(FILTER, remote.io)).toBe(2);
      expect(remote.out.at(-1)).toBe(`${sentence}: ${RUN_URL}`);
      expect(remote.asked.filter((asked) => asked.endsWith('--log'))).toStrictEqual([]);
    },
  );

  it('gives up after twenty minutes of questions ten seconds apart, and exits with 2', async () => {
    const remote = harness({ statuses: ['queued'] });
    const everyTenSeconds = Array.from({ length: 120 }, (_, index) => (index + 1) * 10_000);

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual(everyTenSeconds);
    expect(new Set(remote.sleeps)).toStrictEqual(new Set([10_000]));
    expect(remote.out.at(-1)).toBe(
      `Gave up waiting after twenty minutes; the run goes on: ${RUN_URL}`,
    );
  });

  it('passes on an error of gh while it waits, and exits with 2', async () => {
    const remote = harness({ statuses: [] });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.err).toStrictEqual(['no answer']);
    expect(remote.out.at(-1)).toBe(`Could not follow the run, so it gave no result: ${RUN_URL}`);
  });

  it.each([
    { name: 'no filter', argv: [], git: {}, sentence: NO_FILTER },
    {
      name: 'a filter that is not allowed',
      argv: ['src/lib;id'],
      git: {},
      sentence: filterRefused('src/lib;id'),
    },
    {
      name: 'a glob that is not allowed',
      argv: ['src', '--coverage.include=lib/**'],
      git: {},
      sentence: globRefused('lib/**'),
    },
    {
      name: 'the branch main',
      argv: FILTER,
      git: { 'symbolic-ref --quiet --short HEAD': answer('main\n') },
      sentence:
        'The branch is main, which CI tests on every push: run the command from the branch of your task.',
    },
    {
      name: 'a detached HEAD',
      argv: FILTER,
      git: { 'symbolic-ref --quiet --short HEAD': error('') },
      sentence: 'HEAD is detached: switch to the branch you pushed, then run the command again.',
    },
    {
      name: 'a change to a tracked file',
      argv: FILTER,
      git: { 'status --porcelain': answer(' M scripts/remote-test.ts\n') },
      sentence: UNCOMMITTED,
    },
    {
      name: 'an untracked file',
      argv: FILTER,
      git: { 'status --porcelain': answer('?? notes.txt\n') },
      sentence: UNCOMMITTED,
    },
    {
      name: 'a branch without an upstream',
      argv: FILTER,
      git: {
        'rev-parse @{upstream}': error(`fatal: no upstream configured for branch '${BRANCH}'`, 128),
      },
      sentence: `The branch ${BRANCH} has no upstream: push it with git push -u origin ${BRANCH}, then run the command again.`,
    },
    {
      name: 'an upstream that is not at HEAD',
      argv: FILTER,
      git: { 'rev-parse @{upstream}': answer(`${OTHER}\n`) },
      sentence: `The upstream of ${BRANCH} is not at HEAD: commit and push first (git push -u origin ${BRANCH}), so that the run tests HEAD.`,
    },
    {
      name: 'an error of git itself',
      argv: FILTER,
      git: { 'symbolic-ref --quiet --short HEAD': error('fatal: not a git repository\n', 128) },
      sentence: 'fatal: not a git repository',
    },
  ])(
    'refuses $name with exit code 2, before asking GitHub anything',
    async ({ argv, git, sentence }) => {
      const remote = harness({}, fakeGit(git));

      expect(await runLocally(argv, remote.io)).toBe(2);
      expect(remote.err).toStrictEqual([sentence]);
      expect(remote.asked).toStrictEqual([]);
    },
  );

  it.each([
    [
      'an error of gh itself, as it is',
      error('To get started with GitHub CLI, please run:  gh auth login\n', 4),
      'To get started with GitHub CLI, please run:  gh auth login',
    ],
    [
      'a branch that does not hold the workflow, with what to do',
      error(
        "could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger\n",
      ),
      "could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger\nThe branch does not hold the remote-test workflow yet: rebase it onto origin/main, push it, then run the command again.",
    ],
  ])('passes on a refused dispatch: %s', async (_case, dispatch, sentence) => {
    const remote = harness({ dispatch });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.err).toStrictEqual([sentence]);
    expect(remote.asked).toHaveLength(1);
  });
});

// The triggers and the jobs of a workflow, by name.
const WORKFLOW_KEYS = z.object({
  on: z.record(z.string(), z.unknown()),
  jobs: z.record(z.string(), z.unknown()),
});

describe('the remote-test workflow', () => {
  const text = readFileSync(
    new URL('../.github/workflows/remote-test.yml', import.meta.url),
    'utf8',
  );
  const workflow: unknown = parse(text);
  const { on, jobs } = WORKFLOW_KEYS.parse(workflow);
  const inputs = ['on', 'workflow_dispatch', 'inputs'];

  it('is dispatched by hand only, the filters required and the coverage globs optional', () => {
    expect(Object.keys(on)).toStrictEqual(['workflow_dispatch']);
    expect(workflow).toHaveProperty([...inputs, 'filters', 'required'], true);
    expect(workflow).toHaveProperty([...inputs, 'coverage', 'required'], false);
    expect(workflow).toHaveProperty([...inputs, 'coverage', 'default'], '');
  });

  it('runs one job, one run per branch, with no permission beyond reading the code', () => {
    expect(workflow).toHaveProperty('permissions', {});
    expect(Object.keys(jobs)).toStrictEqual(['remote-test']);
    expect(workflow).toHaveProperty(['jobs', 'remote-test', 'permissions'], { contents: 'read' });
    expect(workflow).toHaveProperty('concurrency', {
      group: `\${{ github.workflow }}-\${{ github.ref }}`,
      'cancel-in-progress': true,
    });
  });

  it('gives the inputs to the step that the log is read from through its environment alone', () => {
    expect(workflow).toHaveProperty(['jobs', 'remote-test', 'steps', 2], {
      name: 'Run the tests',
      env: {
        REMOTE_TEST_FILTERS: `\${{ inputs.filters }}`,
        REMOTE_TEST_COVERAGE: `\${{ inputs.coverage }}`,
      },
      run: 'bun scripts/remote-test.ts --runner',
    });
    expect(text).not.toMatch(/run:.*\$\{\{/u);
  });
});

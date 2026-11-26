// The tests of what remote-test.ts decides before any run exists: the request it checks, the
// arguments it gives Vitest on the runner, the refusals of the local side and of the dispatch,
// and the remote-test workflow. remote-test-run.test.ts tests the dispatched run, and
// remote-test-fakes.ts holds the fakes of both.
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { checkRequest, runLocally, runOnRunner } from './remote-test';
import {
  answer,
  BRANCH,
  COMMITS,
  error,
  fakeGit,
  FILTER,
  harness,
  HEAD,
  LOCAL,
  OTHER,
  UPSTREAM,
} from './remote-test-fakes';

const FILTER_RULE =
  'use 1 to 200 letters, digits and / . _ - ( ) [ ] @, do not start with - or /, and do not write two dots in a row';
const GLOB_RULE =
  'start it with src/, use at most 200 letters, digits and / . _ - ( ) [ ] @ *, and do not write two dots in a row';
const NO_FILTER = 'Give at least one test filter, such as src/lib/time.';
const UNCOMMITTED =
  'The worktree holds changes that are not committed, which the run would not test: commit and push them, then run the command again.';
const NOT_PUSHED = `The branch ${LOCAL} tracks no branch of a remote: push it under the name of your task's branch with git push -u origin HEAD:<type/short-slug>, then run the command again.`;
const filterRefused = (token: string): string =>
  `The filter ${JSON.stringify(token)} is not allowed: ${FILTER_RULE}.`;
const globRefused = (token: string): string =>
  `The coverage glob ${JSON.stringify(token)} is not allowed: ${GLOB_RULE}.`;

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
      name: 'a branch that tracks main',
      argv: FILTER,
      git: { [UPSTREAM]: answer('origin refs/heads/main\n') },
      sentence: `The branch ${LOCAL} tracks origin/main, which CI tests on every push: run the command from the branch of your task.`,
    },
    {
      name: 'a branch without an upstream',
      argv: FILTER,
      git: { [UPSTREAM]: answer(' \n') },
      sentence: NOT_PUSHED,
    },
    {
      name: 'a branch that tracks a local branch',
      argv: FILTER,
      git: { [UPSTREAM]: answer(`. refs/heads/${BRANCH}\n`) },
      sentence: NOT_PUSHED,
    },
    {
      name: 'an upstream that is not at HEAD',
      argv: FILTER,
      git: { [COMMITS]: answer(`${HEAD}\n${OTHER}\n`) },
      sentence: `The upstream of ${LOCAL}, origin/${BRANCH}, is not at HEAD: commit and push first (git push origin HEAD:${BRANCH}), so that the run tests HEAD.`,
    },
    {
      name: 'an upstream that the remote no longer holds',
      argv: FILTER,
      git: { [UPSTREAM]: answer(`origin refs/heads/${BRANCH} [gone]\n`) },
      sentence: `The upstream of ${LOCAL}, origin/${BRANCH}, is not at HEAD: commit and push first (git push origin HEAD:${BRANCH}), so that the run tests HEAD.`,
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

  it.each(['status --porcelain', UPSTREAM, COMMITS])(
    'passes on an error of git %s as it is, before asking GitHub anything',
    async (question) => {
      const remote = harness({}, fakeGit({ [question]: error('fatal: bad object HEAD\n', 128) }));

      expect(await runLocally(FILTER, remote.io)).toBe(2);
      expect(remote.err).toStrictEqual(['fatal: bad object HEAD']);
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

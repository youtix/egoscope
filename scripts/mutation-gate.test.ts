// Proves that the mutation gate runs the mutation tests only when their scope
// changed since its base, and then from scratch, in CI as outside it: it runs the gate
// in a throwaway repository, where a `test:mutation` script that prints the arguments
// it receives stands in for Stryker, and a `gh` script that prints a canned answer and
// records its arguments stands in for the GitHub CLI. And that the `stryker` job of the
// mutation workflow runs the gate so, with no result of an earlier run.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const GATE = path.join(import.meta.dirname, 'mutation-gate.ts');
const WORKFLOW = path.join(import.meta.dirname, '../.github/workflows/mutation.yml');
const PACKAGE = JSON.stringify({ scripts: { 'test:mutation': 'echo test:mutation' } });
// Each run starts Bun twice and git a few times, on a machine that other runs may share.
const TIMEOUT_MS = 30_000;
const REPOSITORY = 'example-owner/example-repository';
// The one request that a push makes: the newest successful push run of main.
const RUNS_REQUEST = `api repos/${REPOSITORY}/actions/workflows/mutation.yml/runs?branch=main&event=push&status=success&exclude_pull_requests=true&per_page=1`;
const STRYKER = 'test:mutation --force';
const EXECUTABLE = 0o755;
const LOCAL_BASE = 'Mutation tests: compared with where HEAD left origin/main.';
const NOTHING = 'Mutation tests: nothing in their scope differs, so they do not run.';
const USAGE = '✖ Mutation tests: usage: bun scripts/mutation-gate.ts [--event <event>]';
// A change to the pure core, which the mutation tests must test.
const CORE_FILE = 'src/lib/stats-engine/score.ts';
const CORE_TEST = 'src/lib/ai-exchange/extract.test.ts';

type GateRun = Readonly<{ status: number | null; lines: readonly string[]; errors: string }>;

/** Runs git in `root` and returns what it prints; a failure fails the test. */
const gitIn = (root: string, ...args: readonly string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/** A new empty folder, removed when the test ends. */
function scratchFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-mutation-gate-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/** Writes `files` (repository-relative path to text) in `root`. */
function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/** Commits every file of `root`; returns the commit. */
function commit(root: string, message: string): string {
  gitIn(root, 'add', '--all');
  gitIn(root, 'commit', '--quiet', `--message=${message}`);
  return gitIn(root, 'rev-parse', 'HEAD');
}

/**
 * A throwaway repository: one commit that holds the stand-in package.json and `files`,
 * where origin/main points too.
 */
function repositoryWith(files: Readonly<Record<string, string>> = {}): string {
  const root = scratchFolder();
  gitIn(root, 'init', '--quiet');
  write(root, { 'package.json': PACKAGE, ...files });
  commit(root, 'base');
  gitIn(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

/** Runs the gate in `root` with `args`. */
function gate(root: string, args: readonly string[] = []): GateRun {
  const result = spawnSync('bun', [GATE, ...args], { cwd: root, encoding: 'utf8' });
  return {
    status: result.status,
    lines: result.stdout.split('\n').filter(Boolean),
    errors: result.stderr,
  };
}

/** The lines that a successful run of the gate prints. */
function gateLines(root: string, args: readonly string[] = []): readonly string[] {
  const run = gate(root, args);

  expect(run.status).toBe(0);

  return run.lines;
}

/**
 * Puts first on PATH a `gh` that prints `answer` and exits with `exitCode`; returns what
 * reads the arguments of each of its calls.
 */
function standInGh(answer: string, exitCode = 0): () => readonly string[] {
  const folder = scratchFolder();
  const calls = path.join(folder, 'calls');
  write(folder, { answer });
  writeFileSync(
    path.join(folder, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\ncat "${path.join(folder, 'answer')}"\nexit ${String(exitCode)}\n`,
    { mode: EXECUTABLE },
  );
  vi.stubEnv('PATH', `${folder}${path.delimiter}${process.env['PATH'] ?? ''}`);
  return () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []);
}

/** Leaves on PATH only Bun and git, which the gate and the tests run, and so no `gh`. */
function withoutGh(): void {
  const folder = scratchFolder();
  const searched = (process.env['PATH'] ?? '').split(path.delimiter);
  for (const tool of ['bun', 'git']) {
    const found = searched.map((entry) => path.join(entry, tool)).find((file) => existsSync(file));

    expect(found).toBeDefined();

    symlinkSync(found ?? tool, path.join(folder, tool));
  }
  vi.stubEnv('PATH', folder);
}

/** What the API answers for a newest successful run on `sha`. */
const runOn = (sha: string): string =>
  `{"total_count":1,"workflow_runs":[{"id":1,"head_sha":${JSON.stringify(sha)}}]}`;

const lastSuccess = (sha: string): string =>
  `Mutation tests: compared with ${sha}, the last commit of main on which the mutation workflow succeeded.`;

describe('the mutation gate', { timeout: TIMEOUT_MS }, () => {
  beforeEach(() => {
    // git reads neither the machine's nor the user's configuration, such as a global
    // ignore file, and commits under a neutral identity; the gate runs outside CI,
    // unless a test says otherwise, for a repository that GitHub would name.
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_AUTHOR_NAME', 'Test');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.invalid');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Test');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.invalid');
    vi.stubEnv('CI', '');
    vi.stubEnv('GH_TOKEN', '');
    vi.stubEnv('GITHUB_REPOSITORY', REPOSITORY);
  });

  describe('without an event, as `bun run gate` runs it', () => {
    it.each([
      'src/lib/ai-exchange/text-rules.test.ts',
      'src/lib/stats-engine/performance/game-score.ts',
      'bun.lock',
      'stryker.config.ts',
      'vitest.config.ts',
      'tsconfig.json',
    ])(
      'runs the mutation tests from scratch after a change to %s, which an earlier result may not account for',
      (file) => {
        const root = repositoryWith();
        write(root, { [file]: 'changed\n' });

        expect(gateLines(root)).toStrictEqual([
          LOCAL_BASE,
          `Mutation tests from scratch, because of ${file}.`,
          STRYKER,
        ]);
      },
    );

    it('runs them from scratch in CI too, when only the pure core changed, a test file included', () => {
      vi.stubEnv('CI', 'true');
      const root = repositoryWith();
      write(root, { [CORE_TEST]: 'changed\n', [CORE_FILE]: 'changed\n' });

      // git lists the changes in the order of their paths.
      expect(gateLines(root)).toStrictEqual([
        LOCAL_BASE,
        `Mutation tests from scratch, because of ${CORE_TEST}, ${CORE_FILE}.`,
        STRYKER,
      ]);
    });

    it('does not run them when nothing in their scope changed', () => {
      const root = repositoryWith();
      write(root, { 'src/app/page.tsx': 'changed\n', 'README.md': 'changed\n' });

      expect(gateLines(root)).toStrictEqual([LOCAL_BASE, NOTHING]);
    });

    it('runs them after a change that adds a fixture and a test of the pure core that starts to import it', () => {
      const root = repositoryWith({ [CORE_TEST]: 'export {};\n' });
      write(root, {
        'data/fixtures/ai-exchange/new.json': '{}\n',
        [CORE_TEST]: "import fixture from '@data/fixtures/ai-exchange/new.json';\n",
      });

      // The modified test first, then the new fixture, which git does not track yet.
      expect(gateLines(root)).toStrictEqual([
        LOCAL_BASE,
        `Mutation tests from scratch, because of ${CORE_TEST}, data/fixtures/ai-exchange/new.json.`,
        STRYKER,
      ]);
    });

    it('runs them after a change to a fixture alone that an unchanged file of the pure core imports', () => {
      const root = repositoryWith({
        [CORE_TEST]: "import fixture from '@data/fixtures/ai-exchange/kept.json';\n",
        'data/fixtures/ai-exchange/kept.json': '{}\n',
      });
      write(root, { 'data/fixtures/ai-exchange/kept.json': '{ "changed": true }\n' });

      expect(gateLines(root)).toStrictEqual([
        LOCAL_BASE,
        'Mutation tests from scratch, because of data/fixtures/ai-exchange/kept.json.',
        STRYKER,
      ]);
    });

    it('does not run them after a change to a fixture that no file of the pure core imports', () => {
      const root = repositoryWith({
        [CORE_TEST]: "import fixture from '@data/fixtures/ai-exchange/kept.json';\n",
        'data/fixtures/ai-exchange/kept.json': '{}\n',
        'data/fixtures/telegram/answers.json': '{}\n',
      });
      write(root, { 'data/fixtures/telegram/answers.json': '{ "changed": true }\n' });

      expect(gateLines(root)).toStrictEqual([LOCAL_BASE, NOTHING]);
    });

    it('runs them after a change to a file that a configuration of the run imports', () => {
      const root = repositoryWith({
        'vitest.config.ts': "import { IGNORED_FOLDERS } from './scripts/ignored-folders.ts';\n",
        'scripts/ignored-folders.ts': 'export const IGNORED_FOLDERS = [];\n',
      });
      write(root, { 'scripts/ignored-folders.ts': "export const IGNORED_FOLDERS = ['.x/'];\n" });

      expect(gateLines(root)).toStrictEqual([
        LOCAL_BASE,
        'Mutation tests from scratch, because of scripts/ignored-folders.ts.',
        STRYKER,
      ]);
    });
  });

  describe('for a pull request', () => {
    it('compares with HEAD^1, the base branch of its merge commit, and asks GitHub nothing', () => {
      const calls = standInGh(runOn('0'.repeat(40)));
      const root = repositoryWith();
      write(root, { [CORE_FILE]: 'changed\n' });
      commit(root, 'change the pure core');

      expect(gateLines(root, ['--event', 'pull_request'])).toStrictEqual([
        'Mutation tests: compared with HEAD^1, the base branch of the pull request.',
        `Mutation tests from scratch, because of ${CORE_FILE}.`,
        STRYKER,
      ]);
      expect(calls()).toStrictEqual([]);
    });
  });

  describe('for a push to main', () => {
    it('runs them when the pure core changed since the last success, although the last commit changed only README.md', () => {
      const root = repositoryWith();
      const success = gitIn(root, 'rev-parse', 'HEAD');
      write(root, { [CORE_FILE]: 'changed\n' });
      commit(root, 'change the pure core in a merge whose run was replaced');
      write(root, { 'README.md': 'changed\n' });
      commit(root, 'change the README');
      const calls = standInGh(runOn(success));

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([
        lastSuccess(success),
        `Mutation tests from scratch, because of ${CORE_FILE}.`,
        STRYKER,
      ]);
      expect(calls()).toStrictEqual([RUNS_REQUEST]);
    });

    it('does not run them when nothing in their scope changed since the last success', () => {
      const root = repositoryWith();
      const success = gitIn(root, 'rev-parse', 'HEAD');
      write(root, { 'README.md': 'changed\n' });
      commit(root, 'change the README');
      standInGh(runOn(success));

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([lastSuccess(success), NOTHING]);
    });

    it('does not run them when the last success is HEAD itself, a run again of a proven commit', () => {
      const root = repositoryWith();
      write(root, { [CORE_FILE]: 'changed\n' });
      const head = commit(root, 'change the pure core');
      standInGh(runOn(head));

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([lastSuccess(head), NOTHING]);
    });

    it.each([
      {
        when: 'no run has succeeded yet',
        answer: '{"total_count":0,"workflow_runs":[]}',
        exitCode: 0,
        reason: 'no push run of the mutation workflow has succeeded on main yet',
      },
      {
        when: 'the request fails',
        answer: 'gh: API rate limit exceeded\n',
        exitCode: 1,
        reason: 'the GitHub CLI could not list the runs of the mutation workflow (exit code 1)',
      },
      {
        when: 'the answer is not JSON',
        answer: 'API rate limit exceeded\n',
        exitCode: 0,
        reason: 'the list of the runs of the mutation workflow is not the expected JSON',
      },
      {
        when: 'the answer is JSON of another shape',
        answer: '{"message":"Not Found"}',
        exitCode: 0,
        reason: 'the list of the runs of the mutation workflow is not the expected JSON',
      },
    ])('runs every mutant when $when', ({ answer, exitCode, reason }) => {
      const root = repositoryWith();
      standInGh(answer, exitCode);

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([
        `Mutation tests from scratch, because ${reason}.`,
        STRYKER,
      ]);
    });

    it('runs every mutant when the GitHub CLI is missing', () => {
      const root = repositoryWith();
      withoutGh();

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([
        'Mutation tests from scratch, because the GitHub CLI could not start (Executable not found in $PATH: "gh").',
        STRYKER,
      ]);
    });

    it.each([
      'a'.repeat(39),
      `${'a'.repeat(40)}0`,
      `x${'a'.repeat(40)}`,
      'g'.repeat(40),
      'A'.repeat(40),
    ])('runs every mutant when the last success names %s, which is no commit of the API', (sha) => {
      const root = repositoryWith();
      standInGh(runOn(sha));

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([
        'Mutation tests from scratch, because the last successful run of the mutation workflow names no valid commit.',
        STRYKER,
      ]);
    });

    it('runs every mutant when the last success is a commit that the checkout does not hold', () => {
      const root = repositoryWith();
      const absent = 'dead'.repeat(10);
      standInGh(runOn(absent));

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([
        `Mutation tests from scratch, because ${absent}, the last commit of main on which the mutation workflow succeeded, is not in the checkout.`,
        STRYKER,
      ]);
    });

    it('runs every mutant when the last success is not an ancestor of HEAD, as after a rewritten history', () => {
      const root = repositoryWith();
      const elsewhere = gitIn(root, 'commit-tree', 'HEAD^{tree}', '-m', 'a commit off the history');
      standInGh(runOn(elsewhere));

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([
        `Mutation tests from scratch, because ${elsewhere}, the last commit of main on which the mutation workflow succeeded, is not an ancestor of HEAD.`,
        STRYKER,
      ]);
    });

    it('runs every mutant, and asks GitHub nothing, when GITHUB_REPOSITORY is unset', () => {
      vi.stubEnv('GITHUB_REPOSITORY', '');
      const root = repositoryWith();
      const calls = standInGh(runOn('0'.repeat(40)));

      expect(gateLines(root, ['--event', 'push'])).toStrictEqual([
        'Mutation tests from scratch, because GITHUB_REPOSITORY is unset, so the runs of the mutation workflow cannot be listed.',
        STRYKER,
      ]);
      expect(calls()).toStrictEqual([]);
    });
  });

  it.each(['schedule', ''])('runs every mutant for the event "%s", which has no base', (event) => {
    const root = repositoryWith();

    expect(gateLines(root, ['--event', event])).toStrictEqual([
      `Mutation tests from scratch, because the "${event}" event has no base to compare with.`,
      STRYKER,
    ]);
  });

  it.each([[['HEAD^1']], [['--event']], [['--event', 'push', 'HEAD^1']], [['--base', 'push']]])(
    'refuses the arguments %j, and runs nothing',
    (args) => {
      const run = gate(repositoryWith(), args);

      expect(run).toStrictEqual({ status: 1, lines: [], errors: `${USAGE}\n` });
    },
  );
});

const STRYKER_JOB = z.object({ permissions: z.unknown(), steps: z.array(z.unknown()) });
const WORKFLOW_JOBS = z.object({ jobs: z.object({ stryker: STRYKER_JOB }) });

describe('the stryker job of the mutation workflow', () => {
  const workflow: unknown = parse(readFileSync(WORKFLOW, 'utf8'));
  const { stryker } = WORKFLOW_JOBS.parse(workflow).jobs;

  it('may read the contents and list the runs of the workflows, and nothing more', () => {
    expect(stryker.permissions).toStrictEqual({ contents: 'read', actions: 'read' });
  });

  it('runs the gate with the event and the token, in one step with no condition, after a checkout of the whole history', () => {
    // Every step, in order: any other, such as a cache that restores reports/, fails this.
    // Actions are compared by name, so that an update of their pinned version passes.
    expect(stryker.steps).toMatchObject([
      {
        uses: expect.stringMatching(/^actions\/checkout@/u) as unknown,
        with: { 'fetch-depth': 0 },
      },
      { uses: './.github/actions/setup-project' },
      {},
      {
        uses: expect.stringMatching(/^actions\/upload-artifact@/u) as unknown,
        with: { path: 'reports/mutation/' },
      },
    ]);
    // The whole gate step: an `if:`, which could skip it and pass the job untested, fails this.
    expect(stryker.steps[2]).toStrictEqual({
      name: 'Mutation tests from scratch, when the mutation scope changed',
      env: { GH_TOKEN: `\${{ github.token }}`, EVENT: `\${{ github.event_name }}` },
      run: 'bun scripts/mutation-gate.ts --event "$EVENT"',
    });
  });
});

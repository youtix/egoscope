import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { listChanges, parseNameStatus, planCheck, stepsFor, testStep } from './changed-files';

import type { Change } from './changed-files';

const present = (...paths: readonly string[]): Change[] =>
  paths.map((file) => ({ path: file, removed: false }));
const removed = (...paths: readonly string[]): Change[] =>
  paths.map((file) => ({ path: file, removed: true }));

/** Runs git in `root`; a failure fails the test. */
const gitIn = (root: string, ...args: readonly string[]): void => {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
};

/** Writes `files`, repository-relative paths and their text, into `root`. */
function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/** A throwaway repository, removed when the test ends, whose one commit is also origin/main. */
function repository(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'egoscope-changes-'));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  gitIn(root, 'init', '--quiet', '--initial-branch=main');
  writeFiles(root, files);
  gitIn(root, 'add', '--all');
  gitIn(root, 'commit', '--quiet', '--message=base');
  gitIn(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

describe('parseNameStatus', () => {
  it('reads additions, changes, deletions, renames and copies', () => {
    const output = [
      'A',
      'src/a.ts',
      'M',
      'src/b.ts',
      'D',
      'src/c.ts',
      'R087',
      'src/d.ts',
      'src/e.ts',
      'C100',
      'src/f.ts',
      'src/g.ts',
      '',
    ].join('\0');

    expect(parseNameStatus(output)).toStrictEqual([
      ...present('src/a.ts', 'src/b.ts'),
      ...removed('src/c.ts', 'src/d.ts'),
      ...present('src/e.ts', 'src/f.ts', 'src/g.ts'),
    ]);
  });

  it('reads nothing from empty output', () => {
    expect(parseNameStatus('')).toStrictEqual([]);
  });
});

describe('planCheck', () => {
  it('plans nothing when nothing changed', () => {
    expect(planCheck([])).toStrictEqual({
      changed: false,
      files: [],
      code: [],
      markdown: [],
      frozen: [],
      traced: [],
      related: [],
      wholeSuite: [],
    });
  });

  it('names the changed files that the traceability check reads, removed ones included', () => {
    const plan = planCheck([
      ...present(
        'src/lib/env/server-env.test.ts',
        'src/lib/env/server-env.ts',
        'docs/engineering/requirement-waivers.md',
        'docs/engineering/glossary.md',
      ),
      ...removed('e2e/home.spec.ts'),
    ]);

    expect(plan.traced).toStrictEqual([
      'docs/engineering/requirement-waivers.md',
      'e2e/home.spec.ts',
      'src/lib/env/server-env.test.ts',
    ]);
  });

  it('sends code to ESLint, Markdown to markdownlint and every present file to Prettier', () => {
    const plan = planCheck(
      present('src/lib/env/server-env.ts', 'src/app/page.tsx', 'README.md', 'src/app/globals.css'),
    );

    expect(plan.files).toStrictEqual([
      'README.md',
      'src/app/globals.css',
      'src/app/page.tsx',
      'src/lib/env/server-env.ts',
    ]);
    expect(plan.code).toStrictEqual(['src/app/page.tsx', 'src/lib/env/server-env.ts']);
    expect(plan.markdown).toStrictEqual(['README.md']);
  });

  it('runs the tests related to changed sources, tests and fixtures', () => {
    const plan = planCheck(
      present(
        'src/lib/env/server-env.ts',
        'src/lib/env/server-env.test.ts',
        'data/fixtures/stats-source/season.json',
        'CLAUDE.md',
      ),
    );

    expect(plan.related).toStrictEqual([
      'data/fixtures/stats-source/season.json',
      'src/lib/env/server-env.test.ts',
      'src/lib/env/server-env.ts',
    ]);
    expect(plan.wholeSuite).toStrictEqual([]);
  });

  it('counts a deletion as a change and runs the whole suite for a removed source', () => {
    const plan = planCheck(removed('src/lib/log/console-sink.ts'));

    expect(plan.changed).toBe(true);
    expect(plan.files).toStrictEqual([]);
    expect(plan.wholeSuite).toStrictEqual(['src/lib/log/console-sink.ts']);
  });

  it('runs the whole suite when a source is renamed', () => {
    const plan = planCheck(
      parseNameStatus(['R100', 'src/lib/log/logger.ts', 'src/lib/log/log.ts', ''].join('\0')),
    );

    expect(plan.related).toStrictEqual(['src/lib/log/log.ts']);
    expect(plan.wholeSuite).toStrictEqual(['src/lib/log/logger.ts']);
  });

  it.each([
    'package.json',
    'bun.lock',
    'eslint.config.ts',
    'tsconfig.json',
    '.markdownlint-cli2.jsonc',
    'scripts/with-lock.ts',
    '.github/workflows/ci.yml',
  ])('treats %s as tooling, which runs the whole test suite', (file) => {
    expect(planCheck(present(file, 'src/app/page.tsx')).wholeSuite).toStrictEqual([file]);
  });

  it('reports a changed French specification instead of skipping it', () => {
    const plan = planCheck([
      ...present('docs/07-statistiques-de-match.md'),
      ...removed('docs/README.md'),
    ]);

    expect(plan.frozen).toStrictEqual(['docs/07-statistiques-de-match.md', 'docs/README.md']);
    expect(plan.files).toStrictEqual([]);
  });

  it('accepts a changed French specification together with its updated manifest', () => {
    const plan = planCheck(present('docs/07-statistiques-de-match.md', 'docs/frozen-specs.sha256'));

    expect(plan.frozen).toStrictEqual([]);
    expect(plan.files).toStrictEqual(['docs/frozen-specs.sha256']);
  });

  it('keeps the English documents in docs/ subfolders', () => {
    expect(planCheck(present('docs/engineering/glossary.md')).markdown).toStrictEqual([
      'docs/engineering/glossary.md',
    ]);
  });

  it('leaves generated files to their generator', () => {
    const plan = planCheck(
      present('drizzle/0000_bright_ironclad.sql', 'drizzle/meta/_journal.json', 'README.md'),
    );

    expect(plan.files).toStrictEqual(['README.md']);
    expect(plan.changed).toBe(true);
  });

  it('runs the whole suite when a migration changes, since every test database is built from them', () => {
    const plan = planCheck([
      ...present('drizzle/0001_quiet_lake.sql', 'drizzle/meta/_journal.json'),
      ...removed('drizzle/meta/0001_snapshot.json'),
    ]);

    expect(plan.wholeSuite).toStrictEqual([
      'drizzle/0001_quiet_lake.sql',
      'drizzle/meta/_journal.json',
      'drizzle/meta/0001_snapshot.json',
    ]);
    expect(testStep(plan)?.command).toStrictEqual(['vitest', 'run']);
  });

  it('lists each file once', () => {
    expect(planCheck(present('src/app/page.tsx', 'src/app/page.tsx')).files).toStrictEqual([
      'src/app/page.tsx',
    ]);
  });
});

describe('stepsFor', () => {
  const TYPE_CHECKS = ['Structure check', 'Type check, whole project', 'Type check, pure core'];

  it.each([
    ['only deleted files', removed('src/lib/log/console-sink.ts')],
    ['a page', present('src/app/page.tsx')],
    ['a document alone', present('docs/engineering/glossary.md')],
    ['a test', present('src/lib/env/server-env.test.ts')],
  ])('generates the route types before any other step, for %s', (_change, changes) => {
    const steps = stepsFor(planCheck(changes));

    expect(steps[0]).toStrictEqual({ name: 'Route types', command: ['next', 'typegen'] });
    expect(steps.filter((step) => step.name === 'Route types')).toHaveLength(1);
  });

  it('type-checks the whole project even when files were only deleted', () => {
    const steps = stepsFor(planCheck(removed('src/lib/log/console-sink.ts')));

    expect(steps.map((step) => step.name)).toStrictEqual([
      'Route types',
      ...TYPE_CHECKS,
      'All unit tests, because of src/lib/log/console-sink.ts',
    ]);
  });

  it('formats and lints the present files, type-checks, then runs the related tests', () => {
    const steps = stepsFor(planCheck(present('src/lib/env/server-env.ts', 'README.md')));

    expect(steps.map((step) => step.name)).toStrictEqual([
      'Route types',
      'Prettier',
      'ESLint',
      'markdownlint',
      ...TYPE_CHECKS,
      'Related unit tests',
    ]);
    expect(steps.at(-1)?.command).toStrictEqual([
      'vitest',
      'related',
      '--run',
      '--passWithNoTests',
      'src/lib/env/server-env.ts',
    ]);
  });

  it('names the first files that make the whole suite run, and counts the others', () => {
    const plan = planCheck(present('a.json', 'b.json', 'c.json', 'd.json', 'e.json'));

    expect(testStep(plan)?.name).toBe(
      'All unit tests, because of a.json, b.json, c.json and 2 more',
    );
  });

  it('runs no unit test when no source, test, fixture or tooling changed', () => {
    const plan = planCheck(present('docs/engineering/glossary.md'));

    expect(testStep(plan)).toBeUndefined();
  });

  it.each([
    [
      'a specification, with its checksum manifest',
      present('docs/07-statistiques-de-match.md', 'docs/frozen-specs.sha256'),
    ],
    ['a ruling', present('docs/engineering/clarifications/07-game-statistics.md')],
    ['a unit test', present('src/lib/env/server-env.test.ts')],
    ['a removed component test', removed('src/app/page.test.tsx')],
    ['a test of the scripts', present('scripts/ci-ok.test.ts')],
    ['an end-to-end spec', present('e2e/home.spec.ts')],
    ['the waiver register', present('docs/engineering/requirement-waivers.md')],
    ['the acceptance criteria index', present('docs/engineering/acceptance-criteria-index.md')],
    ['the check itself', present('scripts/trace-requirements.ts')],
    ['its report', present('scripts/trace-report.ts')],
    ['its rules', present('scripts/trace-rules.ts')],
    ['its reader of the specifications', present('scripts/spec-ids.ts')],
    ['its reader of the test titles', present('scripts/test-titles.ts')],
    ['its reader of the waiver register', present('scripts/waiver-register.ts')],
    ['its reader of the criteria index', present('scripts/criteria-index.ts')],
    ['the Prettier settings, which format the criteria index', present('prettier.config.ts')],
  ])('runs `bun run trace` when %s changed', (_change, changes) => {
    const steps = stepsFor(planCheck(changes));

    expect(steps.find((step) => step.name === 'Requirement traceability')?.command).toStrictEqual([
      'bun',
      'run',
      'trace',
    ]);
  });

  it('runs the traceability check after the structure check, before the type checks', () => {
    const steps = stepsFor(planCheck(present('src/lib/env/server-env.test.ts')));

    expect(steps.map((step) => step.name)).toStrictEqual([
      'Route types',
      'Prettier',
      'ESLint',
      'Structure check',
      'Requirement traceability',
      'Type check, whole project',
      'Type check, pure core',
      'Related unit tests',
    ]);
  });

  it('leaves the traceability check out when none of the files that it reads changed', () => {
    const plan = planCheck(
      present('src/lib/env/server-env.ts', 'README.md', 'docs/engineering/glossary.md'),
    );

    expect(stepsFor(plan).map((step) => step.name)).not.toContain('Requirement traceability');
  });

  it.each([
    'scripts/ci-ok.sh',
    'scripts/content-rules.ts',
    'scripts/traced.ts',
    'eslint.config.ts',
  ])('leaves the traceability check out when only %s, which it does not run, changed', (file) => {
    const steps = stepsFor(planCheck(present(file)));

    expect(steps.map((step) => step.name)).not.toContain('Requirement traceability');
  });
});

// Each test starts git, which a busy machine can slow down past the default timeout.
describe('listChanges', { timeout: 30_000 }, () => {
  beforeEach(() => {
    // git reads neither the machine's nor the user's configuration, and commits under
    // a neutral identity.
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_AUTHOR_NAME', 'Test');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.invalid');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Test');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.invalid');
  });

  it('lists what differs from origin/main: committed, staged, unstaged and untracked', () => {
    const root = repository({
      '.gitignore': 'build/\n',
      'src/committed.ts': 'before\n',
      'src/staged.ts': 'before\n',
      'src/unstaged.ts': 'before\n',
      'src/deleted.ts': 'deleted\n',
      'src/moved.ts': 'a file long enough to be found again under its new name\n',
      'src/untouched.ts': 'untouched\n',
    });
    writeFiles(root, { 'src/committed.ts': 'after\n' });
    gitIn(root, 'commit', '--quiet', '--all', '--message=next');
    writeFiles(root, {
      'src/staged.ts': 'after\n',
      'src/unstaged.ts': 'after\n',
      'src/untracked.ts': 'new\n',
      'build/output.js': 'built\n',
      '.claude/worktrees/other/src/theirs.ts': 'theirs\n',
    });
    gitIn(root, 'add', 'src/staged.ts');
    gitIn(root, 'mv', 'src/moved.ts', 'src/renamed.ts');
    unlinkSync(path.join(root, 'src/deleted.ts'));

    // A deletion and both sides of a rename count; what git ignores and what lies in
    // a folder that no tool reads do not.
    expect(listChanges({ cwd: root })).toStrictEqual({
      ok: true,
      changes: [
        ...present('src/committed.ts'),
        ...removed('src/deleted.ts', 'src/moved.ts'),
        ...present('src/renamed.ts', 'src/staged.ts', 'src/unstaged.ts', 'src/untracked.ts'),
      ],
    });
  });

  it('measures from the base it is given, as CI gives the previous commit', () => {
    const root = repository({ 'src/first.ts': 'first\n' });
    writeFiles(root, { 'src/second.ts': 'second\n' });
    gitIn(root, 'add', '--all');
    gitIn(root, 'commit', '--quiet', '--message=next');
    writeFiles(root, { 'src/third.ts': 'third\n' });

    expect(listChanges({ base: 'HEAD^1', cwd: root })).toStrictEqual({
      ok: true,
      changes: present('src/second.ts', 'src/third.ts'),
    });
    expect(listChanges({ base: 'HEAD', cwd: root })).toStrictEqual({
      ok: true,
      changes: present('src/third.ts'),
    });
  });

  it('says why it cannot list the changes, instead of finding none', () => {
    const root = repository({ 'src/first.ts': 'first\n' });

    expect(listChanges({ base: 'no-such-commit', cwd: root })).toStrictEqual({
      ok: false,
      error:
        'git cannot list the changes against no-such-commit: run `git fetch origin main`, then try again.',
    });
    gitIn(root, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(listChanges({ cwd: root })).toStrictEqual({
      ok: false,
      error: 'origin/main is missing: run `git fetch origin main`, then try again.',
    });
  });

  it('refuses a HEAD that shares no history with origin/main', () => {
    const root = repository({ 'src/first.ts': 'first\n' });
    gitIn(root, 'checkout', '--quiet', '--orphan', 'unrelated');
    gitIn(root, 'commit', '--quiet', '--message=unrelated');

    expect(listChanges({ cwd: root })).toStrictEqual({
      ok: false,
      error:
        'HEAD shares no history with origin/main (stale or rewritten): run `git fetch origin main` and rebase.',
    });
  });
});

// Proves that the mutation gate runs the mutation tests only when their scope
// changed, and from scratch outside CI when what changed lies outside the pure
// core: it runs the gate in a throwaway repository, against its one commit, where a
// `test:mutation` script that prints the arguments it receives stands in for Stryker.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const GATE = path.join(import.meta.dirname, 'mutation-gate.ts');
// The base that the gate compares with: the one commit of the throwaway repository.
const BASE = 'HEAD';
const PACKAGE = JSON.stringify({ scripts: { 'test:mutation': 'echo test:mutation' } });
// Each run starts Bun twice and git twice, on a machine that other runs may share.
const TIMEOUT_MS = 30_000;

/** Runs git in `root`; a failure fails the test. */
const gitIn = (root: string, ...args: readonly string[]): void => {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
};

/**
 * A throwaway repository, removed when the test ends: one commit that holds the
 * stand-in package.json, then `changed`, repository-relative paths, left uncommitted.
 */
function repositoryWith(changed: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'egoscope-mutation-gate-'));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(path.join(root, 'package.json'), PACKAGE);
  gitIn(root, 'init', '--quiet');
  gitIn(root, 'add', '--all');
  gitIn(root, 'commit', '--quiet', '--message=base');
  for (const file of changed) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), 'changed\n');
  }
  return root;
}

/** The lines that the gate prints, run in `root` against its commit; it must succeed. */
function gate(root: string): readonly string[] {
  const result = spawnSync('bun', [GATE, BASE], { cwd: root, encoding: 'utf8' });

  expect(result.status).toBe(0);

  return result.stdout.split('\n').filter(Boolean);
}

describe('the mutation gate', { timeout: TIMEOUT_MS }, () => {
  beforeEach(() => {
    // git reads neither the machine's nor the user's configuration, such as a global
    // ignore file, and commits under a neutral identity; the gate runs outside CI.
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_AUTHOR_NAME', 'Test');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.invalid');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Test');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.invalid');
    vi.stubEnv('CI', '');
  });

  it.each([
    'bun.lock',
    'stryker.config.ts',
    'vitest.config.ts',
    'tsconfig.json',
    'data/fixtures/ai-exchange/extract-json/comment.json',
  ])('runs the mutation tests from scratch after a change to %s, outside the pure core', (file) => {
    expect(gate(repositoryWith([file]))).toStrictEqual([
      `Mutation tests from scratch, because of ${file}: earlier results do not account for a change outside the pure core.`,
      'test:mutation --force',
    ]);
  });

  it('runs them from scratch when a path outside the pure core changed along with the core', () => {
    // git lists the changes in the order of their paths.
    expect(gate(repositoryWith(['src/lib/ai-exchange/text-rules.ts', 'bun.lock']))).toStrictEqual([
      'Mutation tests from scratch, because of bun.lock, src/lib/ai-exchange/text-rules.ts: earlier results do not account for a change outside the pure core.',
      'test:mutation --force',
    ]);
  });

  it('keeps the results of earlier runs when only the pure core changed, its tests included', () => {
    const changed = [
      'src/lib/ai-exchange/text-rules.test.ts',
      'src/lib/stats-engine/performance/game-score.ts',
    ];

    expect(gate(repositoryWith(changed))).toStrictEqual([
      `Mutation tests, because of ${changed.join(', ')}.`,
      'test:mutation',
    ]);
  });

  it('keeps them in CI, where a change outside the pure core renames their cache instead', () => {
    vi.stubEnv('CI', 'true');

    expect(gate(repositoryWith(['bun.lock']))).toStrictEqual([
      'Mutation tests, because of bun.lock.',
      'test:mutation',
    ]);
  });

  it('does not run them when nothing in their scope changed', () => {
    expect(gate(repositoryWith(['src/app/page.tsx', 'README.md']))).toStrictEqual([
      `Mutation tests: nothing in their scope differs from ${BASE}, so they do not run.`,
    ]);
  });
});

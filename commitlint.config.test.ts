// Proves that commitlint, which checks every commit and every pull request title,
// lets no message through unchecked and refuses the markers that skip CI.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = import.meta.dirname;
const COMMITLINT = path.join(ROOT, 'node_modules/.bin/commitlint');

/** Runs commitlint on `message` as the pull-request title check does, and returns its output. */
function lint(message: string): Readonly<{ status: number | null; output: string }> {
  const result = spawnSync(COMMITLINT, [], { cwd: ROOT, input: message, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('commitlint.config.ts', { timeout: 60_000 }, () => {
  it.each([
    'feat: add the player list',
    'chore: merge origin/main into feat/player-list',
    'revert: add the player list',
  ])('accepts %j, as CLAUDE.md shows', (message) => {
    expect(lint(`${message}\n`).status).toBe(0);
  });

  it.each([
    'fixup! feat: add the player list',
    'Merge branch main into feat/player-list',
    'Revert "feat: add the player list"',
    'v1.2.3',
  ])('checks %j instead of ignoring it by default', (message) => {
    expect(lint(`${message}\n`).status).toBe(1);
  });

  it.each([
    'feat: add the player list [skip ci]',
    'feat: add the player list [ci skip]',
    'feat: add the player list [no ci]',
    'feat: add the player list [skip actions]',
    'feat: add the player list [actions skip]',
    'feat: add the player list\n\nskip-checks: true',
  ])('refuses %j, which would make GitHub skip CI', (message) => {
    const { status, output } = lint(`${message}\n`);

    expect(status).toBe(1);
    expect(output).toContain('egoscope/no-skip-markers');
  });
});

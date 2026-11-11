import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it, onTestFinished } from 'vitest';

import { describeHolder, formatDuration, isOverLimit, parseHolder, shouldLock } from './with-lock';

const SCRIPT = path.join(import.meta.dirname, 'with-lock.ts');
const HOLDER = { pid: 4242, startedAt: 1_000_000, command: 'vitest run', cwd: '/work/tree' };

type Outcome = Readonly<{ code: number | null; stdout: string; stderr: string; endedAt: number }>;

/** A fresh lock folder for one test, so tests never touch the real machine-wide lock. */
function lockFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-lock-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/** Runs the script outside CI and outside any held lock, with `extra` variables. */
async function withLock(
  args: readonly string[],
  folder: string,
  extra: Readonly<Record<string, string>> = {},
): Promise<Outcome> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: undefined,
    EGOSCOPE_LOCK_HELD: undefined,
    EGOSCOPE_LOCK_DIR: folder,
    ...extra,
  };
  return new Promise((resolve) => {
    const child = spawn('bun', [SCRIPT, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, endedAt: Date.now() });
    });
  });
}

/** Resolves once a run holds the lock in `folder`. */
async function untilHeld(folder: string): Promise<void> {
  while (!existsSync(path.join(folder, 'egoscope-heavy.lock.json'))) {
    await sleep(50);
  }
}

describe('with-lock', { timeout: 30_000 }, () => {
  it.each([
    [{}, true],
    [{ CI: 'true' }, false],
    [{ CI: '1' }, false],
    [{ CI: 'false' }, true],
    [{ EGOSCOPE_LOCK_HELD: '1' }, false],
  ])('decides whether %o must lock: %s', (env, expected) => {
    expect(shouldLock(env)).toBe(expected);
  });

  it.each([
    [0, '0s'],
    [45_000, '45s'],
    [125_000, '2m 05s'],
    [1_800_000, '30m 00s'],
    [-5000, '0s'],
  ])('formats %i ms as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it('reads a complete holder record and rejects anything else', () => {
    expect(parseHolder(JSON.stringify(HOLDER))).toStrictEqual(HOLDER);
    expect(parseHolder(JSON.stringify({ ...HOLDER, pid: 'x' }))).toBeUndefined();
    expect(parseHolder('null')).toBeUndefined();
    expect(parseHolder('{"pid":')).toBeUndefined();
  });

  it('gives up on a holder past the limit, or on its own wait when the holder is unknown', () => {
    const timing = { now: HOLDER.startedAt + 61_000, waitStart: HOLDER.startedAt + 50_000 };

    expect(isOverLimit(HOLDER, { ...timing, limitMs: 60_000 })).toBe(true);
    expect(isOverLimit(HOLDER, { ...timing, limitMs: 62_000 })).toBe(false);
    expect(isOverLimit(undefined, { ...timing, limitMs: 10_000 })).toBe(true);
    expect(isOverLimit(undefined, { ...timing, limitMs: 12_000 })).toBe(false);
  });

  it('names the holder, where it runs and for how long', () => {
    expect(describeHolder(HOLDER, HOLDER.startedAt + 90_000)).toBe(
      '"vitest run" in /work/tree (pid 4242), which has held the lock for 1m 30s',
    );
    expect(describeHolder(undefined, 0)).toBe('another run');
  });

  it('runs the command with its arguments, such as a test path, and returns its exit code', async () => {
    const outcome = await withLock(
      ['sh', '-c', 'printf "%s|" "$@"; exit 3', 'sh', 'src/lib/foo', '--flag'],
      lockFolder(),
    );

    expect(outcome.code).toBe(3);
    expect(outcome.stdout).toBe('src/lib/foo|--flag|');
  });

  it('makes a second run wait for the first, and says how long it waited', async () => {
    const folder = lockFolder();
    const first = withLock(['sh', '-c', 'sleep 1.5'], folder);
    await untilHeld(folder);
    const second = withLock(['true'], folder);

    const [held, waited] = await Promise.all([first, second]);

    expect(waited.code).toBe(0);
    expect(waited.endedAt).toBeGreaterThanOrEqual(held.endedAt);
    expect(waited.stderr).toMatch(/Waiting for "sh -c sleep 1\.5" .*; waited \d+s so far/u);
    expect(waited.stderr).toMatch(/Got the lock after waiting \d+s/u);
  });

  it('takes the lock once for a run and the runs it starts, without deadlock', async () => {
    const outcome = await withLock(['bun', SCRIPT, 'sh', '-c', 'echo nested'], lockFolder());

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toBe('nested\n');
  });

  it('never locks in CI', async () => {
    const folder = lockFolder();
    const holding = withLock(['sh', '-c', 'sleep 2'], folder);
    await untilHeld(folder);

    const inCi = await withLock(['true'], folder, { CI: 'true' });
    const held = await holding;

    expect(inCi.code).toBe(0);
    expect(inCi.stderr).toBe('');
    expect(inCi.endedAt).toBeLessThan(held.endedAt);
  });

  it('fails with a clear message when one run holds the lock past the limit', async () => {
    const folder = lockFolder();
    const stuck = withLock(['sh', '-c', 'sleep 3'], folder);
    await untilHeld(folder);

    const waiter = await withLock(['true'], folder, { EGOSCOPE_LOCK_LIMIT_SECONDS: '1' });
    await stuck;

    expect(waiter.code).toBe(1);
    expect(waiter.stderr).toMatch(
      /Gave up after waiting \d+s: "sh -c sleep 3" .* has held the lock for \d+s, more than the 1s limit/u,
    );
  });
});

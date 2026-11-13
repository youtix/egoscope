import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it, onTestFinished } from 'vitest';

import {
  describeHolder,
  formatDuration,
  isOverLimit,
  parseHolder,
  shouldLock,
  watchMode,
} from './with-lock';

import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const SCRIPT = path.join(import.meta.dirname, 'with-lock.ts');
const LOCK = 'egoscope-heavy.lock';
const HOLDER = { pid: 4242, startedAt: 1_000_000, command: 'vitest run', cwd: '/work/tree' };

type Outcome = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  endedAt: number;
}>;
type Run = Readonly<{
  child: ChildProcessWithoutNullStreams;
  stderr: () => string;
  /** Settles when the wrapper process ends, while its command may still write output. */
  exited: Promise<unknown>;
  /** Settles once the output is complete: the wrapper and its command have both ended. */
  outcome: Promise<Outcome>;
}>;

/** A fresh lock folder for one test, so tests never touch the real machine-wide lock. */
function lockFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-lock-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/** Starts the script outside CI and outside any held lock, with `extra` variables. */
function start(
  args: readonly string[],
  folder: string,
  extra: Readonly<Record<string, string>> = {},
): Run {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: undefined,
    EGOSCOPE_LOCK_HELD: undefined,
    EGOSCOPE_LOCK_DIR: folder,
    ...extra,
  };
  const child = spawn('bun', [SCRIPT, ...args], { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise((resolve) => {
    child.on('exit', resolve);
  });
  const outcome = new Promise<Outcome>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr, endedAt: Date.now() });
    });
  });
  return { child, stderr: () => stderr, exited, outcome };
}

async function withLock(
  args: readonly string[],
  folder: string,
  extra: Readonly<Record<string, string>> = {},
): Promise<Outcome> {
  return start(args, folder, extra).outcome;
}

async function until(isDone: () => boolean): Promise<void> {
  while (!isDone()) {
    await sleep(50);
  }
}

/** Resolves once a run holds the lock in `folder`. */
async function untilHeld(folder: string): Promise<void> {
  await until(() => existsSync(path.join(folder, `${LOCK}.json`)));
}

/**
 * Resolves once process `pid` has taken delivery of the signals sent to it, so that
 * it has caught them, even when it is still busy with something else.
 */
async function untilDelivered(pid: number): Promise<void> {
  await until(() => /^ShdPnd:\s+0+$/mu.test(readFileSync(`/proc/${String(pid)}/status`, 'utf8')));
}

type SlowGit = Readonly<{ path: string; asked: string; answer: () => void }>;

/**
 * Writes a `git` for the PATH it returns: when the wrapper asks it for the git
 * directory during its start-up checks, it creates `asked`, then runs `reply` only
 * once the test calls `answer`.
 */
function slowGit(folder: string, reply: string): SlowGit {
  const bin = path.join(folder, 'bin');
  const [asked, answered] = [path.join(folder, 'asked'), path.join(folder, 'answered')];
  mkdirSync(bin);
  const script = [
    '#!/bin/sh',
    `touch '${asked}'`,
    `until [ -e '${answered}' ]; do sleep 0.01; done`,
    reply,
  ];
  writeFileSync(path.join(bin, 'git'), `${script.join('\n')}\n`, { mode: 0o755 });
  return {
    path: `${bin}:${process.env['PATH'] ?? ''}`,
    asked,
    answer: () => {
      writeFileSync(answered, '');
    },
  };
}

/** Says whether a process holds the lock in `folder`, by trying to take it. */
function isLocked(folder: string): boolean {
  return spawnSync('flock', ['--nonblock', path.join(folder, LOCK), 'true']).status !== 0;
}

function parentOf(pid: number): number {
  const status = readFileSync(`/proc/${String(pid)}/status`, 'utf8');
  return Number(/^PPid:\s+(?<parent>\d+)$/mu.exec(status)?.groups?.['parent']);
}

/** The processes from the parent of `pid` up to `top`: every wrapper around a command. */
function wrappersOf(pid: number, top: number): number[] {
  const chain: number[] = [];
  for (let current = pid; current !== top;) {
    current = parentOf(current);
    if (!Number.isSafeInteger(current) || current <= 1) {
      throw new Error(`Process ${String(pid)} does not run under process ${String(top)}.`);
    }
    chain.push(current);
  }
  return chain;
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
    expect(describeHolder(HOLDER, HOLDER.startedAt + 90_000, '/git/egoscope-heavy.lock')).toBe(
      '"vitest run" in /work/tree (pid 4242), which has held the lock for 1m 30s',
    );
  });

  it('says that a process left in the background holds the lock when no run is recorded', () => {
    expect(describeHolder(undefined, 0, '/git/egoscope-heavy.lock')).toBe(
      'a process that an earlier command left running in the background, which still holds the lock (find it with `fuser -v /git/egoscope-heavy.lock`)',
    );
  });

  it.each([
    [['vitest'], '`vitest` without `run`'],
    [['node_modules/.bin/vitest', 'related', 'src/lib/a.ts'], '`vitest` without `run`'],
    [['sh', '-c', 'next typegen && vitest'], '`vitest` without `run`'],
    [['vitest', 'run', '--watch'], 'the --watch flag'],
    [['vitest', 'run', '-w'], 'the -w flag'],
    [['vitest', 'run', '--ui'], 'the --ui flag'],
    [['tsc', '--noEmit', '--watch'], 'the --watch flag'],
    [['bun', '--hot', 'scripts/server.ts'], 'the --hot flag'],
    [['next', 'dev'], '`next dev`'],
  ])('refuses %j, which starts %s', (command, mode) => {
    expect(watchMode(command)).toBe(mode);
  });

  it.each([
    [['vitest', 'run', '--coverage']],
    [['vitest', 'related', '--run', 'src/lib/a.ts']],
    [['vitest', 'list']],
    [['next', 'build']],
    [['sh', '-c', 'next typegen && tsc --noEmit']],
    [['eslint', 'vitest.config.ts']],
  ])('accepts %j, which ends by itself', (command) => {
    expect(watchMode(command)).toBeUndefined();
  });

  it('refuses a watch mode with a clear message, before running anything', async () => {
    const outcome = await withLock(['sh', '-c', 'echo ran', '--watch'], lockFolder());

    expect(outcome.code).toBe(2);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('[lock] Refusing the --watch flag: a watch, UI or dev-server');
  });

  it('runs the command with its arguments, such as a test path, and returns its exit code', async () => {
    const outcome = await withLock(
      ['sh', '-c', 'printf "%s|" "$@"; exit 3', 'sh', 'src/lib/foo', '--flag'],
      lockFolder(),
    );

    expect(outcome.code).toBe(3);
    expect(outcome.stdout).toBe('src/lib/foo|--flag|');
  });

  it.each([1, 197])(
    'runs a command that exits with %i exactly once, and passes the code on',
    async (code) => {
      const folder = lockFolder();
      const runs = path.join(folder, 'runs');

      const outcome = await withLock(
        ['sh', '-c', `echo run >> "$1"; exit ${String(code)}`, 'sh', runs],
        folder,
      );

      expect(outcome.code).toBe(code);
      expect(readFileSync(runs, 'utf8')).toBe('run\n');
    },
  );

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

  it('passes SIGTERM on to the command and waits for the command to end', async () => {
    const folder = lockFolder();
    const [started, cleaned] = [path.join(folder, 'started'), path.join(folder, 'cleaned')];
    const script = [
      'trap \'kill "$pid"; sleep 0.5; touch "$2"; exit 42\' TERM',
      'sleep 10 & pid=$!',
      'touch "$1"',
      'wait "$pid"',
    ].join('\n');
    const run = start(['sh', '-c', script, 'sh', started, cleaned], folder);
    // The wrapper catches the signals before it starts any process, so a command
    // that has set its trap shows that both are ready.
    await until(() => existsSync(started));

    run.child.kill('SIGTERM');
    const outcome = await run.outcome;

    expect(outcome.code).toBe(42);
    expect(existsSync(cleaned)).toBe(true);
  });

  it('ends with status 143 and starts nothing on a SIGTERM that comes before the command has started', async () => {
    const folder = lockFolder();
    const ran = path.join(folder, 'ran');
    // The first run holds the lock until its input ends, so the second one cannot start.
    const holder = start(['cat'], folder);
    await untilHeld(folder);
    const waiter = start(['touch', ran], folder);
    // The wrapper writes this line once it has caught the signals and found the lock taken.
    await until(() => waiter.stderr().includes('[lock] Waiting for'));

    waiter.child.kill('SIGTERM');
    const stopped = await waiter.outcome;
    holder.child.stdin.end();
    await holder.outcome;

    expect(stopped.code).toBe(143);
    expect(stopped.signal).toBeNull();
    expect(existsSync(ran)).toBe(false);
  });

  it.each([
    ['takes the lock', (folder: string) => `echo '${folder}'`, ''],
    [
      'runs without it',
      () => 'exit 1',
      '[lock] No git directory or no flock here: running without the shared lock.\n',
    ],
  ])(
    'ends with status 143 and starts nothing on a SIGTERM during the start-up checks of a run that %s',
    async (_run, reply, stderr) => {
      const folder = lockFolder();
      const ran = path.join(folder, 'ran');
      // Without EGOSCOPE_LOCK_DIR, the wrapper asks git for its lock folder.
      const git = slowGit(folder, reply(folder));
      const run = start(['touch', ran], folder, { EGOSCOPE_LOCK_DIR: '', PATH: git.path });
      await until(() => existsSync(git.asked));

      run.child.kill('SIGTERM');
      await untilDelivered(run.child.pid ?? 0);
      git.answer();
      const stopped = await run.outcome;

      expect(stopped.code).toBe(143);
      expect(stopped.signal).toBeNull();
      expect(stopped.stderr).toBe(stderr);
      expect(existsSync(ran)).toBe(false);
    },
  );

  it('keeps the lock until the command ends, even when every wrapper is killed', async () => {
    const folder = lockFolder();
    const [started, finished] = [path.join(folder, 'started'), path.join(folder, 'finished')];
    const run = start(
      ['sh', '-c', 'echo "$$" > "$1"; sleep 2; touch "$2"', 'sh', started, finished],
      folder,
    );
    await until(() => existsSync(started) && readFileSync(started, 'utf8').endsWith('\n'));
    const wrappers = wrappersOf(Number(readFileSync(started, 'utf8')), run.child.pid ?? 0);

    for (const wrapper of wrappers) {
      process.kill(wrapper, 'SIGKILL');
    }
    await run.exited;

    expect(isLocked(folder)).toBe(true);
    await until(() => !isLocked(folder));
    expect(existsSync(finished)).toBe(true);
  });

  it('stops waiting on SIGTERM, without ever running the command', async () => {
    const folder = lockFolder();
    const ran = path.join(folder, 'ran');
    const holding = withLock(['sh', '-c', 'sleep 1.5'], folder);
    await untilHeld(folder);
    const waiter = start(['touch', ran], folder);
    await until(() => waiter.stderr().includes('[lock] Waiting for'));

    waiter.child.kill('SIGTERM');
    await Promise.all([waiter.outcome, holding]);

    expect(existsSync(ran)).toBe(false);
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

  it('names a process that a finished command left running with the lock', async () => {
    const folder = lockFolder();
    // The command ends at once; the sleep it starts in the background keeps the lock.
    const leaving = start(['sh', '-c', 'sleep 3 &'], folder);
    await leaving.exited;

    const waiter = await withLock(['true'], folder, { EGOSCOPE_LOCK_LIMIT_SECONDS: '1' });
    await leaving.outcome;

    expect(waiter.code).toBe(1);
    expect(waiter.stderr).toContain(
      'a process that an earlier command left running in the background, which still holds the lock',
    );
  });
});

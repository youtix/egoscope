/**
 * Runs a heavy command (type check, lint, tests, build, knip) under one lock that
 * every worktree of this clone shares, so the agents on one machine take turns:
 *
 *   bun scripts/with-lock.ts <command> [arguments...]
 *
 * - The lock is `egoscope-heavy.lock` in the shared git directory
 *   (`git rev-parse --git-common-dir`); `egoscope-heavy.lock.json` says who holds it.
 * - CI never locks, and neither does a command started by a run that already holds
 *   the lock: `bun run gate` takes it once for all its steps.
 * - A waiter says whom it waits for and for how long, and gives up as soon as one
 *   run has held the lock for more than 30 minutes.
 *
 * Tests override the lock folder and the limit with EGOSCOPE_LOCK_DIR and
 * EGOSCOPE_LOCK_LIMIT_SECONDS.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export type Holder = Readonly<{ pid: number; startedAt: number; command: string; cwd: string }>;

type Env = Readonly<Record<string, string | undefined>>;

const HELD = 'EGOSCOPE_LOCK_HELD';
const LOCK_NAME = 'egoscope-heavy.lock';
const HOLDING_FLAG = '--holding';
const CI_OFF_VALUES: ReadonlySet<string> = new Set(['', '0', 'false']);
// flock exits with this code, which no tool here uses, when the lock is taken.
const BUSY = 197;
const POLL_MS = 1000;
// A waiter reports on its first poll, then about every 30 seconds.
const POLLS_PER_REPORT = 30;
const DEFAULT_LIMIT_SECONDS = 1800;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const EXIT_SIGNAL_BASE = 128;
const EXIT_NOT_FOUND = 127;

/** Says whether a run with this environment takes the lock: never in CI, never twice. */
export function shouldLock(env: Env): boolean {
  const isCi = !CI_OFF_VALUES.has(env['CI'] ?? '');
  return !isCi && env[HELD] === undefined;
}

/** Formats a duration as minutes and seconds, such as "2m 05s" or "45s". */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE);
  return minutes === 0 ? `${seconds}s` : `${String(minutes)}m ${seconds.padStart(2, '0')}s`;
}

/** Reads the record that the lock holder writes, if it is complete. */
export function parseHolder(text: string): Holder | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const record: Partial<Record<keyof Holder, unknown>> = value;
    const { pid, startedAt, command, cwd } = record;
    return typeof pid === 'number' &&
      typeof startedAt === 'number' &&
      typeof command === 'string' &&
      typeof cwd === 'string'
      ? { pid, startedAt, command, cwd }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Says whether a waiter gives up: the known holder has kept the lock longer than
 * the limit, or, when the holder is unknown, the waiter itself has waited that long.
 */
export function isOverLimit(
  holder: Holder | undefined,
  timing: Readonly<{ now: number; waitStart: number; limitMs: number }>,
): boolean {
  const since = holder === undefined ? timing.waitStart : holder.startedAt;
  return timing.now - since > timing.limitMs;
}

/** Describes the run that holds the lock, and for how long it has held it as of `now`. */
export function describeHolder(holder: Holder | undefined, now: number): string {
  return holder === undefined
    ? 'another run'
    : `"${holder.command}" in ${holder.cwd} (pid ${String(holder.pid)}), which has held the lock for ${formatDuration(now - holder.startedAt)}`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function readHolder(infoPath: string): Holder | undefined {
  try {
    const holder = parseHolder(readFileSync(infoPath, 'utf8'));
    return holder !== undefined && isAlive(holder.pid) ? holder : undefined;
  } catch {
    return undefined;
  }
}

async function run(command: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [program = 'true', ...args] = command;
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: 'inherit', env });
    child.on('error', (error) => {
      console.error(`[lock] Cannot run ${program}: ${error.message}`);
      resolve(EXIT_NOT_FOUND);
    });
    child.on('exit', (code, signal) => {
      resolve(code ?? EXIT_SIGNAL_BASE + (signal === null ? 0 : constants.signals[signal]));
    });
  });
}

function lockFolder(env: Env): string | undefined {
  const override = env['EGOSCOPE_LOCK_DIR'];
  if (override !== undefined && override !== '') {
    return override;
  }
  const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  });
  return git.status === 0 ? git.stdout.trim() : undefined;
}

/** Holding mode: flock has the lock; record who holds it, then run the command. */
async function holdAndRun(
  command: readonly string[],
  lock: Readonly<{ infoPath: string; waitStart: number }>,
): Promise<number> {
  const holder: Holder = {
    pid: process.pid,
    startedAt: Date.now(),
    command: command.join(' '),
    cwd: process.cwd(),
  };
  writeFileSync(lock.infoPath, JSON.stringify(holder));
  const waited = holder.startedAt - lock.waitStart;
  if (waited >= POLL_MS) {
    console.error(`[lock] Got the lock after waiting ${formatDuration(waited)}.`);
  }
  try {
    return await run(command, { ...process.env, [HELD]: '1' });
  } finally {
    rmSync(lock.infoPath, { force: true });
  }
}

/** Returns why a waiter must give up now, or what it should report, if anything. */
function checkWait(
  lockPath: string,
  timing: Readonly<{ now: number; waitStart: number; limitMs: number }>,
): Readonly<{ giveUp: boolean; message: string }> {
  const holder = readHolder(`${lockPath}.json`);
  const who = describeHolder(holder, timing.now);
  const waited = formatDuration(timing.now - timing.waitStart);
  return isOverLimit(holder, timing)
    ? {
        giveUp: true,
        message: `[lock] Gave up after waiting ${waited}: ${who}, more than the ${formatDuration(timing.limitMs)} limit (${lockPath}). If that run is stuck, stop it, then run this command again.`,
      }
    : {
        giveUp: false,
        message: `[lock] Waiting for ${who}; waited ${waited} so far. Heavy scripts run one at a time across worktrees.`,
      };
}

/** The flock call that runs this script again, in holding mode, if the lock is free. */
function flockAttempt(lockPath: string, waitStart: number, command: readonly string[]): string[] {
  return [
    'flock',
    '--nonblock',
    '--conflict-exit-code',
    String(BUSY),
    lockPath,
    process.execPath,
    fileURLToPath(import.meta.url),
    HOLDING_FLAG,
    `${lockPath}.json`,
    String(waitStart),
    ...command,
  ];
}

async function waitAndRun(command: readonly string[], folder: string): Promise<number> {
  const lockPath = path.join(folder, LOCK_NAME);
  const waitStart = Date.now();
  const attempt = flockAttempt(lockPath, waitStart, command);
  const limitSeconds = Number(process.env['EGOSCOPE_LOCK_LIMIT_SECONDS'] ?? DEFAULT_LIMIT_SECONDS);
  const timing = { waitStart, limitMs: limitSeconds * MS_PER_SECOND };
  for (let poll = 0; ; poll += 1) {
    const status = await run(attempt, process.env);
    if (status !== BUSY) {
      return status;
    }
    const verdict = checkWait(lockPath, { ...timing, now: Date.now() });
    if (verdict.giveUp || poll % POLLS_PER_REPORT === 0) {
      console.error(verdict.message);
    }
    if (verdict.giveUp) {
      return 1;
    }
    await sleep(POLL_MS);
  }
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === HOLDING_FLAG) {
    const [, infoPath = '', waitStart = '0', ...command] = argv;
    return holdAndRun(command, { infoPath, waitStart: Number(waitStart) });
  }
  if (!shouldLock(process.env)) {
    return run(argv, process.env);
  }
  const folder = lockFolder(process.env);
  const hasFlock = spawnSync('flock', ['--version']).status === 0;
  if (folder === undefined || !hasFlock) {
    console.error('[lock] No git directory or no flock here: running without the shared lock.');
    return run(argv, process.env);
  }
  return waitAndRun(argv, folder);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}

/**
 * Runs a heavy command (type check, lint, tests, build, knip) under one lock that
 * every worktree of this clone shares, so the agents on one machine take turns:
 *
 *   bun scripts/with-lock.ts <command> [arguments...]
 *
 * - The lock is `egoscope-heavy.lock` in the shared git directory
 *   (`git rev-parse --git-common-dir`); `egoscope-heavy.lock.json` says who holds it.
 * - The command holds the lock itself, on a file descriptor it inherits, so the
 *   lock lasts as long as the command (and anything it leaves running), even when
 *   this wrapper is killed. The wrapper catches SIGINT, SIGTERM and SIGHUP from its
 *   first instant: it passes them on to the command and waits for the command to
 *   end, and one that comes before the command has started ends the run without
 *   starting it, with status 128 plus the signal's number.
 * - The command's exit code is passed on untouched: whether the lock was free
 *   travels on a pipe of its own, so no exit code makes the command run again.
 * - CI never locks, and neither does a command started by a run that already holds
 *   the lock: `bun run gate` takes it once for all its steps.
 * - A waiter says whom it waits for and for how long, and gives up as soon as one
 *   run has held the lock for more than 30 minutes.
 * - Watch, UI and dev-server modes are refused: they would hold the lock until stopped.
 *
 * Tests override the lock folder and the limit with EGOSCOPE_LOCK_DIR and
 * EGOSCOPE_LOCK_LIMIT_SECONDS.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { Socket } from 'node:net';
import { constants } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn, setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { ChildProcess, StdioOptions } from 'node:child_process';

export type Holder = Readonly<{ pid: number; startedAt: number; command: string; cwd: string }>;

type Env = Readonly<Record<string, string | undefined>>;
type Attempt = Readonly<{ state: 'held' | 'busy' | 'unlockable'; code: number }>;
/**
 * The termination signals that the wrapper catches during its whole run, and the
 * process they are passed on to.
 */
type Relay = Readonly<{
  /**
   * 128 plus the number of the first signal caught, or undefined before any. Bun
   * calls signal listeners only from its event loop, so a signal caught while
   * synchronous code runs shows here only after the next turn of the loop.
   */
  stopStatus: () => number | undefined;
  /** Aborts at the first signal, which cuts a wait for the lock short. */
  stopped: AbortSignal;
  /** Makes `child` the process that the signals caught from now on are passed on to. */
  forwardTo: (child: ChildProcess) => void;
}>;
/** The lock that a run waits for, since when it waits, and the run's signals. */
type Lock = Readonly<{ lockPath: string; waitStart: number; relay: Relay }>;

const HELD = 'EGOSCOPE_LOCK_HELD';
const LOCK_NAME = 'egoscope-heavy.lock';
const CI_OFF_VALUES: ReadonlySet<string> = new Set(['', '0', 'false']);
// `-w` is the short form of `--watch` for Vitest and tsc.
const WATCH_FLAGS: ReadonlySet<string> = new Set(['--watch', '-w', '--ui', '--hot']);
const VITEST_ONE_SHOT: ReadonlySet<string> = new Set(['run', 'list']);
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
// Each shell that becomes the command first waits for the wrapper's go-ahead, a line
// on descriptor 3, and ends without one (see letRun).
const GO_AHEAD = 'read -r go <&3 || exit 1';
// The shell that runs the command under the lock. It opens the lock file on
// descriptor 9 and tries once to lock it (flock exits with 1 when another run holds
// it). It then reports "busy" on descriptor 3, or records the holder, reports "held"
// and becomes the command, which keeps descriptor 9 and so holds the lock itself.
const HOLD_SCRIPT = [
  GO_AHEAD,
  'exec 9>>"$1" || exit 1',
  'flock --nonblock 9',
  'case $? in 0) ;; 1) printf busy >&3; exit 0 ;; *) exit 1 ;; esac',
  'printf \'{"pid":%s,%s\' "$$" "$3" > "$2"',
  'printf held >&3 || exit 1',
  'exec 3>&-',
  'shift 3',
  'exec "$@"',
].join('\n');
// The shell that runs the command without the lock: it becomes the command.
const UNLOCKED_SCRIPT = [GO_AHEAD, 'exec 3>&-', 'exec "$@"'].join('\n');
// Bun makes descriptor 3 a socket, which carries the go-ahead and the lock's reply.
const SHELL_STDIO: StdioOptions = ['inherit', 'inherit', 'inherit', 'pipe'];
const POLL_MS = 1000;
// A waiter reports on its first poll, then about every 30 seconds.
const POLLS_PER_REPORT = 30;
const DEFAULT_LIMIT_SECONDS = 1800;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const EXIT_SIGNAL_BASE = 128;
const EXIT_NOT_FOUND = 127;
const EXIT_USAGE = 2;

/** Says whether a run with this environment takes the lock: never in CI, never twice. */
export function shouldLock(env: Env): boolean {
  const isCi = !CI_OFF_VALUES.has(env['CI'] ?? '');
  return !isCi && env[HELD] === undefined;
}

/** Says whether the words from `index` on start Vitest in watch mode. */
const isVitestWatch = (words: readonly string[], index: number): boolean =>
  path.basename(words[index] ?? '') === 'vitest' &&
  !VITEST_ONE_SHOT.has(words[index + 1] ?? '') &&
  !words.includes('--run');

/** Names the watch, UI or dev-server mode that `command` would start, if any. */
export function watchMode(command: readonly string[]): string | undefined {
  // Splitting on spaces also reads the tools that `sh -c '…'` starts.
  const words = command.flatMap((argument) => argument.split(/\s+/u));
  const flag = words.find((word) => WATCH_FLAGS.has(word));
  if (flag !== undefined) {
    return `the ${flag} flag`;
  }
  if (words.some((_word, index) => isVitestWatch(words, index))) {
    return '`vitest` without `run`';
  }
  const isDevServer = words.some(
    (word, index) => path.basename(word) === 'next' && words[index + 1] === 'dev',
  );
  return isDevServer ? '`next dev`' : undefined;
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

/**
 * Describes the run that holds the lock at `lockPath`, and for how long it has held
 * it as of `now`. With no live holder on record, the lock is held by a process that
 * a finished command left behind, which inherited the lock from it.
 */
export function describeHolder(holder: Holder | undefined, now: number, lockPath: string): string {
  return holder === undefined
    ? `a process that an earlier command left running in the background, which still holds the lock (find it with \`fuser -v ${lockPath}\`)`
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

function readRecord(infoPath: string): Holder | undefined {
  try {
    return parseHolder(readFileSync(infoPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The holder of the lock, if its record is readable and its process still runs. */
function readHolder(infoPath: string): Holder | undefined {
  const holder = readRecord(infoPath);
  return holder !== undefined && isAlive(holder.pid) ? holder : undefined;
}

const exitCodeFor = (signal: NodeJS.Signals): number =>
  EXIT_SIGNAL_BASE + constants.signals[signal];

/**
 * Catches SIGINT, SIGTERM and SIGHUP before the wrapper starts any process, so
 * that none of them can end it unseen: a signal is passed on to the command once
 * the wrapper has let it start, and keeps it from starting before that.
 */
function catchSignals(): Relay {
  let caught: NodeJS.Signals | undefined;
  let target: ChildProcess | undefined;
  const stop = new AbortController();
  const onSignal = (signal: NodeJS.Signals): void => {
    caught ??= signal;
    stop.abort();
    // Once that process has ended, `kill` does nothing.
    target?.kill(signal);
  };
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, onSignal);
  }
  return {
    stopStatus: () => (caught === undefined ? undefined : exitCodeFor(caught)),
    stopped: stop.signal,
    forwardTo: (child) => {
      target = child;
    },
  };
}

/**
 * Lets the shell `child` become the command, unless a termination signal has come,
 * and waits for it to end; resolves to its exit code, or to the run's status when a
 * signal came first. From the go-ahead on, signals are passed on to the shell. Bun's
 * `spawn()` can return after the shell has run for milliseconds, and Bun calls the
 * listeners of the signals caught meanwhile later still, so the shell waits for the
 * go-ahead; without it, the shell ends at once.
 */
async function letRun(child: ChildProcess, program: string, relay: Relay): Promise<number> {
  const ended = new Promise<number>((resolve) => {
    child.on('error', (error) => {
      console.error(`[lock] Cannot run ${program}: ${error.message}`);
      resolve(EXIT_NOT_FOUND);
    });
    child.on('close', (exitCode, signal) => {
      resolve(exitCode ?? (typeof signal === 'string' ? exitCodeFor(signal) : 1));
    });
  });
  // Bun calls the listeners of the signals caught so far before this callback.
  await nextTurn();
  const stopStatus = relay.stopStatus();
  const pipe = child.stdio[3];
  if (stopStatus === undefined && pipe instanceof Socket) {
    relay.forwardTo(child);
    // A shell that ends before it has read the go-ahead resets the pipe.
    pipe.on('error', () => undefined).write('go\n');
  } else {
    pipe?.destroy();
  }
  return stopStatus ?? (await ended);
}

/**
 * Runs the command without the lock; resolves to its exit code, or to the run's
 * status when a termination signal kept it from starting.
 */
async function runUnlocked(command: readonly string[], relay: Relay): Promise<number> {
  const child = spawn('sh', ['-c', UNLOCKED_SCRIPT, 'sh', ...command], { stdio: SHELL_STDIO });
  return letRun(child, command[0] ?? 'the command', relay);
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

/**
 * Tries once to take the lock and, if it is free, runs the command under it.
 * The state comes from the lock pipe alone, never from an exit code.
 */
async function attempt(command: readonly string[], lock: Lock): Promise<Attempt> {
  const infoPath = `${lock.lockPath}.json`;
  const record = JSON.stringify({
    startedAt: Date.now(),
    command: command.join(' '),
    cwd: process.cwd(),
  });
  const holdArgs = ['-c', HOLD_SCRIPT, 'sh', lock.lockPath, infoPath, record.slice(1)];
  const child = spawn('sh', [...holdArgs, ...command], {
    stdio: SHELL_STDIO,
    env: { ...process.env, [HELD]: '1' },
  });
  const pipe = child.stdio[3];
  let reply = '';
  pipe?.on('data', (chunk: Buffer) => {
    reply += chunk.toString();
    const waited = Date.now() - lock.waitStart;
    if (reply === 'held' && waited >= POLL_MS) {
      console.error(`[lock] Got the lock after waiting ${formatDuration(waited)}.`);
    }
  });
  // Bun can report the exit before the message on the pipe, so the reply counts
  // once the pipe has closed. When sh cannot start, Bun gives no pipe at all.
  const pipeClosed = new Promise((resolve) => {
    if (pipe) {
      pipe.on('close', resolve);
    } else {
      resolve(undefined);
    }
  });
  const code = await letRun(child, command[0] ?? 'the command', lock.relay);
  await pipeClosed;
  if (reply === 'held' && child.pid !== undefined && readRecord(infoPath)?.pid === child.pid) {
    rmSync(infoPath, { force: true });
  }
  return { state: reply === 'held' || reply === 'busy' ? reply : 'unlockable', code };
}

/** Returns what to tell a waiter now, and whether it must give up. */
function checkWait(
  lockPath: string,
  timing: Readonly<{ now: number; waitStart: number; limitMs: number }>,
): Readonly<{ giveUp: boolean; message: string }> {
  const holder = readHolder(`${lockPath}.json`);
  const who = describeHolder(holder, timing.now, lockPath);
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

/**
 * Settles a run after an attempt: the command's exit code if it ran, or if it never
 * will under the lock (the wrapper was told to stop, or the lock is unusable).
 * Undefined means that another run holds the lock, so the waiter waits.
 */
async function settle(
  command: readonly string[],
  { state, code }: Attempt,
  lock: Lock,
): Promise<number | undefined> {
  if (state === 'held') {
    return code;
  }
  const stopStatus = lock.relay.stopStatus();
  if (stopStatus !== undefined) {
    return stopStatus;
  }
  if (state === 'unlockable') {
    console.error(`[lock] Cannot lock ${lock.lockPath}: running without the shared lock.`);
    return runUnlocked(command, lock.relay);
  }
  return undefined;
}

async function waitAndRun(argv: readonly string[], folder: string, relay: Relay): Promise<number> {
  const lockPath = path.join(folder, LOCK_NAME);
  const waitStart = Date.now();
  const limitSeconds = Number(process.env['EGOSCOPE_LOCK_LIMIT_SECONDS'] ?? DEFAULT_LIMIT_SECONDS);
  const timing = { waitStart, limitMs: limitSeconds * MS_PER_SECOND };
  const lock = { lockPath, waitStart, relay };
  for (let poll = 0; ; poll += 1) {
    const settled = await settle(argv, await attempt(argv, lock), lock);
    if (settled !== undefined) {
      return settled;
    }
    const verdict = checkWait(lockPath, { ...timing, now: Date.now() });
    if (verdict.giveUp || poll % POLLS_PER_REPORT === 0) {
      console.error(verdict.message);
    }
    if (verdict.giveUp) {
      return 1;
    }
    // A termination signal cuts the pause short, and the next attempt ends the run.
    await Promise.allSettled([sleep(POLL_MS, undefined, { signal: relay.stopped })]);
  }
}

async function main(argv: readonly string[], relay: Relay): Promise<number> {
  if (argv.length === 0) {
    console.error('[lock] Usage: bun scripts/with-lock.ts <command> [arguments...]');
    return EXIT_USAGE;
  }
  const watching = watchMode(argv);
  if (watching !== undefined) {
    console.error(
      `[lock] Refusing ${watching}: a watch, UI or dev-server mode runs until stopped, so it would hold the shared lock and stall every other worktree. Run it without this wrapper (for example \`bun x vitest\`), or as a single run (\`vitest run\`).`,
    );
    return EXIT_USAGE;
  }
  if (!shouldLock(process.env)) {
    return runUnlocked(argv, relay);
  }
  const folder = lockFolder(process.env);
  const hasFlock = spawnSync('flock', ['--version']).status === 0;
  if (folder === undefined || !hasFlock) {
    console.error('[lock] No git directory or no flock here: running without the shared lock.');
    return runUnlocked(argv, relay);
  }
  return waitAndRun(argv, folder, relay);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Before anything else, so that no process starts before the signals are caught.
  const relay = catchSignals();
  process.exitCode = await main(process.argv.slice(2), relay);
}

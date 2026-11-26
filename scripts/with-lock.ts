/**
 * Runs a heavy command (type check, lint, tests, build, knip) under a lock with two
 * slots that every worktree of this clone shares, so the agents on one machine take
 * turns:
 *
 *   bun scripts/with-lock.ts <command> [arguments...]
 *
 * - Slot 1 is `egoscope-heavy.lock` and slot 2 `egoscope-heavy-2.lock`, in the shared
 *   git directory (`git rev-parse --git-common-dir`); the `.json` file beside each,
 *   `egoscope-heavy.lock.json` and `egoscope-heavy-2.lock.json`, says who holds it.
 *   Slot 1 keeps the protocol of the older wrapper, which knows that slot alone, so
 *   an older wrapper and this one exclude each other there.
 * - A whole-project command takes slot 1 only. A narrow command (an eslint run with
 *   paths, as scripts/command-scope.ts decides; every Vitest run is whole-project)
 *   takes whichever slot is free, trying slot 2 first, and when both are busy it waits
 *   and takes the first that frees. So one whole-project command runs at a time, with
 *   at most one narrow command beside it, or two narrow commands run together.
 * - The command holds its slot itself, on a file descriptor it inherits, so the
 *   slot stays taken as long as the command (and anything it leaves running), even
 *   when this wrapper is killed. The wrapper catches SIGINT, SIGTERM and SIGHUP from
 *   its first instant: it passes them on to the command and waits for the command to
 *   end, and one that comes before the command has started ends the run without
 *   starting it, with status 128 plus the signal's number.
 * - The command's exit code is passed on untouched: whether the slot was free
 *   travels on a pipe of its own, so no exit code makes the command run again.
 * - CI never locks, and neither does a command started by a run that already holds
 *   a slot, whichever it is: `bun run gate` takes slot 1 once for all its steps.
 * - A waiter says whom it waits for, the holder of every slot it may take, and for
 *   how long, and gives up as soon as one of them has held its slot for more than
 *   30 minutes. A slot whose lock file cannot be used is passed over, and only when
 *   no slot that the command may take can be used does it run without the lock.
 * - Watch, UI and dev-server modes are refused: they would hold a slot until stopped.
 *
 * Tests override the lock folder and the limit with EGOSCOPE_LOCK_DIR and
 * EGOSCOPE_LOCK_LIMIT_SECONDS.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { Socket } from 'node:net';
import path from 'node:path';
import { setImmediate as nextTurn, setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { commandScope } from './command-scope';
import { catchSignals, endOf, runUnlocked } from './signal-relay';

import type { Command, Relay } from './signal-relay';
import type { ChildProcess, StdioOptions } from 'node:child_process';

export type Holder = Readonly<{ pid: number; startedAt: number; command: string; cwd: string }>;

type Env = Readonly<Record<string, string | undefined>>;
type Attempt = Readonly<{ state: 'held' | 'busy' | 'unlockable'; code: number }>;
/** A slot that a run may take, since when the run waits, and the run's signals. */
type Lock = Readonly<{ lockPath: string; waitStart: number; relay: Relay }>;
type Timing = Readonly<{ now: number; waitStart: number; limitMs: number }>;

const HELD = 'EGOSCOPE_LOCK_HELD';
const SLOT_1 = 'egoscope-heavy.lock';
const SLOT_2 = 'egoscope-heavy-2.lock';
const SLOT_RULE =
  'Heavy scripts take turns across worktrees on two slots: a whole-project one takes the first alone, a narrow one either.';
const CI_OFF_VALUES: ReadonlySet<string> = new Set(['', '0', 'false']);
// `-w` is the short form of `--watch` for Vitest and tsc.
const WATCH_FLAGS: ReadonlySet<string> = new Set(['--watch', '-w', '--ui', '--hot']);
const VITEST_ONE_SHOT: ReadonlySet<string> = new Set(['run', 'list']);
// The hold shell first waits for the wrapper's go-ahead, a line on descriptor 3, and
// ends without one (see letRun).
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
// Bun makes descriptor 3 a socket, which carries the go-ahead and the lock's reply.
const SHELL_STDIO: StdioOptions = ['inherit', 'inherit', 'inherit', 'pipe'];
const POLL_MS = 1000;
// A waiter reports on its first poll, then about every 30 seconds.
const POLLS_PER_REPORT = 30;
const DEFAULT_LIMIT_SECONDS = 1800;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const EXIT_USAGE = 2;

/**
 * The time in milliseconds, on a monotonic clock that no change of the system clock
 * moves, so that none lengthens or cuts a wait short. `performance.now()` counts from
 * the start of this process; adding `performance.timeOrigin`, the Unix time of that
 * start, puts the times of all runs on one scale, which the holder record needs: a
 * waiter tells from it how long the holder has held the lock.
 */
const monotonicNow = (): number => performance.timeOrigin + performance.now();

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
export function isOverLimit(holder: Holder | undefined, timing: Timing): boolean {
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

/**
 * Lets the shell `child` become the command, unless a termination signal has come,
 * and waits for it to end; resolves to its exit code, or to the run's status when a
 * signal came first. From the go-ahead on, signals are passed on to the shell. Bun's
 * `spawn()` can return after the shell has run for milliseconds, and Bun calls the
 * listeners of the signals caught meanwhile later still, so the shell waits for the
 * go-ahead; without it, the shell ends at once.
 */
async function letRun(child: ChildProcess, program: string, relay: Relay): Promise<number> {
  const ended = endOf(child, program);
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
    startedAt: monotonicNow(),
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
    const waited = monotonicNow() - lock.waitStart;
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

/**
 * Returns what to tell a waiter now, and whether it must give up: as soon as the
 * holder of one of the slots it may take is over the limit, each slot on its own.
 */
function checkWait(
  locks: readonly Lock[],
  timing: Timing,
): Readonly<{ giveUp: boolean; message: string }> {
  const slots = locks.map(({ lockPath }) => ({ lockPath, holder: readHolder(`${lockPath}.json`) }));
  const describe = ({ holder, lockPath }: (typeof slots)[number]): string =>
    describeHolder(holder, timing.now, lockPath);
  const waited = formatDuration(timing.now - timing.waitStart);
  const stuck = slots.find(({ holder }) => isOverLimit(holder, timing));
  return stuck === undefined
    ? {
        giveUp: false,
        message: `[lock] Waiting for ${slots.map((slot) => describe(slot)).join(', and for ')}; waited ${waited} so far. ${SLOT_RULE}`,
      }
    : {
        giveUp: true,
        message: `[lock] Gave up after waiting ${waited}: ${describe(stuck)}, more than the ${formatDuration(timing.limitMs)} limit (${stuck.lockPath}). If that run is stuck, stop it, then run this command again.`,
      };
}

/**
 * Tries each slot of `locks` once, in order, and settles the run: the command's exit
 * code if it ran on one, or if it never will under the lock (the wrapper was told to
 * stop, or no slot's lock file is usable). Otherwise it returns the slots that another
 * run holds, for which the run waits: an unusable slot is passed over while another
 * one may be taken.
 */
async function tryEach(
  command: Command,
  locks: readonly Lock[],
  relay: Relay,
): Promise<number | readonly Lock[]> {
  const busy: Lock[] = [];
  for (const lock of locks) {
    const { state, code } = await attempt(command, lock);
    if (state === 'held') {
      return code;
    }
    const stopStatus = relay.stopStatus();
    if (stopStatus !== undefined) {
      return stopStatus;
    }
    if (state === 'busy') {
      busy.push(lock);
    }
  }
  if (busy.length > 0) {
    return busy;
  }
  const paths = locks.map(({ lockPath }) => lockPath).join(' or ');
  console.error(`[lock] Cannot lock ${paths}: running without the shared lock.`);
  return runUnlocked(command, relay);
}

async function waitAndRun(argv: Command, folder: string, relay: Relay): Promise<number> {
  const waitStart = monotonicNow();
  const limitSeconds = Number(process.env['EGOSCOPE_LOCK_LIMIT_SECONDS'] ?? DEFAULT_LIMIT_SECONDS);
  const timing = { waitStart, limitMs: limitSeconds * MS_PER_SECOND };
  // The slots that the command may take, in the order it tries them.
  const slots = commandScope(argv, process.cwd()) === 'narrow' ? [SLOT_2, SLOT_1] : [SLOT_1];
  const locks = slots.map((slot) => ({ lockPath: path.join(folder, slot), waitStart, relay }));
  for (let poll = 0; ; poll += 1) {
    const tried = await tryEach(argv, locks, relay);
    if (typeof tried === 'number') {
      return tried;
    }
    const verdict = checkWait(tried, { ...timing, now: monotonicNow() });
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

/** Says whether the command line names a program to run. */
const isCommand = (argv: readonly string[]): argv is Command => argv.length > 0;

async function main(argv: readonly string[], relay: Relay): Promise<number> {
  if (!isCommand(argv)) {
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

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

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
const LOCK_2 = 'egoscope-heavy-2.lock';
const HOLDER = { pid: 4242, startedAt: 1_000_000, command: 'vitest run', cwd: '/work/tree' };
const MISSING_PROGRAM = 'egoscope-missing-program';
// The older wrapper's attempt on slot 1, which exits with 1 when another run holds it.
const OLDER_ATTEMPT = 'exec 9>>"$1"; flock -n 9';

type Child = ChildProcessWithoutNullStreams;
type Env = Readonly<Record<string, string>>;
type Outcome = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  endedAt: number;
}>;
type Run = Readonly<{
  child: Child;
  stderr: () => string;
  /** Settles when the wrapper process ends, while its command may still write output. */
  exited: Promise<unknown>;
  /** Settles once the output is complete: the wrapper and its command have both ended. */
  outcome: Promise<Outcome>;
}>;

/** A whole-project command: `script` in a shell, with `args` as its `$1`, `$2`… */
const whole = (script: string, ...args: string[]): string[] => ['sh', '-c', script, 'sh', ...args];

/** A fresh lock folder for one test, so tests never touch the real machine-wide lock. */
function lockFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-lock-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/** Starts the script outside CI and outside any held lock, with `extra` variables. */
function start(args: readonly string[], folder: string, extra: Env = {}): Run {
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
      resolve({ code, signal, stdout, stderr, endedAt: performance.now() });
    });
  });
  return { child, stderr: () => stderr, exited, outcome };
}

async function withLock(...args: Parameters<typeof start>): Promise<Outcome> {
  return start(...args).outcome;
}

async function until(isDone: () => boolean): Promise<void> {
  while (!isDone()) {
    await sleep(50);
  }
}

/** Resolves once a run holds the slot `lock` in `folder`. */
async function untilHeld(folder: string, lock = LOCK): Promise<void> {
  await until(() => existsSync(path.join(folder, `${lock}.json`)));
}

/** Resolves once `run` waits for a slot. */
async function untilWaiting(run: Run): Promise<void> {
  await until(() => run.stderr().includes('[lock] Waiting for'));
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
 * once the test calls `answer`. The shells that the wrapper starts from that PATH
 * ignore SIGTERM, so a signal passed on to them cannot stand in for the go-ahead.
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
  writeFileSync(path.join(bin, 'sh'), '#!/bin/sh\ntrap "" TERM\nexec /bin/sh "$@"\n', {
    mode: 0o755,
  });
  return {
    path: `${bin}:${process.env['PATH'] ?? ''}`,
    asked,
    answer: () => {
      writeFileSync(answered, '');
    },
  };
}

/** Says whether a process holds the slot `lock` in `folder`, by trying to take it. */
function isLocked(folder: string, lock = LOCK): boolean {
  return spawnSync('flock', ['--nonblock', path.join(folder, lock), 'true']).status !== 0;
}

/**
 * Holds the slot `lock` in `folder` the way the older wrapper holds slot 1, with an
 * flock on its lock file alone and no holder record, until its input ends or the
 * test does.
 */
async function holdLikeOlderWrapper(folder: string, lock = LOCK): Promise<Child> {
  const holder = spawn('flock', [path.join(folder, lock), 'cat']);
  onTestFinished(() => {
    holder.stdin.end();
  });
  await until(() => isLocked(folder, lock));
  return holder;
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

type Slot = Readonly<{
  lock: string;
  /** The other slots that this slot's commands may take. */
  others: readonly string[];
  /** A command that takes this slot: `script` in a shell, with `args` as its `$1`, `$2`… */
  command: (script: string, ...args: string[]) => string[];
}>;

/** Holds every other slot that the commands of `slot` may take: they run on it or not at all. */
async function occupyOthers(folder: string, slot: Slot): Promise<void> {
  await Promise.all(slot.others.map(async (lock) => holdLikeOlderWrapper(folder, lock)));
}

describe('with-lock', { timeout: 30_000 }, () => {
  // A stand-in for ESLint, which makes a command narrow: it runs its arguments, here
  // the shell of a whole-project command, whose words name paths (`sh`), none of them `.`.
  let fakeEslint = '';
  const narrow: typeof whole = (...words) => [fakeEslint, ...whole(...words)];
  const slots: [string, Slot][] = [
    ['slot 1, which a whole-project command takes', { lock: LOCK, others: [], command: whole }],
    ['slot 2, taken first by a narrow command', { lock: LOCK_2, others: [LOCK], command: narrow }],
  ];

  beforeAll(() => {
    const bin = mkdtempSync(path.join(tmpdir(), 'egoscope-eslint-'));
    fakeEslint = path.join(bin, 'eslint');
    writeFileSync(fakeEslint, '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
    return () => {
      rmSync(bin, { recursive: true, force: true });
    };
  });

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

  it('makes a second whole-project run wait for the first, even while slot 2 is free, and says how long it waited', async () => {
    const folder = lockFolder();
    const first = withLock(['sh', '-c', 'sleep 1.5'], folder);
    await untilHeld(folder);
    const second = start(['true'], folder);
    await untilWaiting(second);

    expect(isLocked(folder, LOCK_2)).toBe(false);
    const [held, waited] = await Promise.all([first, second.outcome]);
    expect(waited.code).toBe(0);
    expect(waited.endedAt).toBeGreaterThanOrEqual(held.endedAt);
    expect(waited.stderr).toMatch(/Waiting for "sh -c sleep 1\.5" .*; waited \d+s so far/u);
    expect(waited.stderr).toMatch(/Got the lock after waiting \d+s/u);
  });

  it('runs a narrow command on slot 2 while a whole-project one holds slot 1, each with its own exit code', async () => {
    const folder = lockFolder();
    const wholeRun = start(whole('cat > /dev/null; exit 3'), folder);
    await untilHeld(folder);

    const narrowRun = await withLock(narrow('exit 5'), folder);
    wholeRun.child.stdin.end();
    const wholeOutcome = await wholeRun.outcome;

    expect(narrowRun.code).toBe(5);
    expect(narrowRun.stderr).toBe('');
    expect(wholeOutcome.code).toBe(3);
  });

  it.each(['slot 1', 'slot 2'])(
    'runs two narrow commands together, and a third, which names both, on %s once it frees first',
    async (freed) => {
      const folder = lockFolder();
      const [firstCommand, secondCommand] = [narrow('exec cat', 'a'), narrow('exec cat', 'b')];
      const first = start(firstCommand, folder);
      await untilHeld(folder, LOCK_2);
      const second = start(secondCommand, folder);
      await untilHeld(folder, LOCK);
      const third = start(narrow('true'), folder);
      await untilWaiting(third);

      const [freedRun, keptRun] = freed === 'slot 1' ? [second, first] : [first, second];
      freedRun.child.stdin.end();
      // The third run ends while the other holder still runs: it took the slot that freed.
      const ended = await third.outcome;
      keptRun.child.stdin.end();
      await Promise.all([first.outcome, second.outcome]);

      expect(ended.code).toBe(0);
      expect(ended.stderr).toContain(`Waiting for "${firstCommand.join(' ')}" in `);
      expect(ended.stderr).toContain(`, and for "${secondCommand.join(' ')}" in `);
    },
  );

  it('excludes the older wrapper on slot 1 both ways, and runs a narrow command on slot 2 beside it', async () => {
    const folder = lockFolder();
    const ran = path.join(folder, 'ran');
    const older = await holdLikeOlderWrapper(folder);
    const wholeRun = start(whole('touch "$1"; exec cat', ran), folder);
    await untilWaiting(wholeRun);

    const narrowRun = await withLock(narrow('exit 4'), folder);
    expect(existsSync(ran)).toBe(false);
    older.stdin.end();
    await until(() => existsSync(ran));
    const olderAttempt = spawnSync('sh', ['-c', OLDER_ATTEMPT, 'sh', path.join(folder, LOCK)]);
    wholeRun.child.stdin.end();
    const wholeOutcome = await wholeRun.outcome;

    expect(narrowRun.code).toBe(4);
    expect(olderAttempt.status).toBe(1);
    expect(wholeOutcome.code).toBe(0);
  });

  it('applies the 30-minute limit to the holder of each slot on its own', async () => {
    const folder = lockFolder();
    // A run that has held slot 2 since 1970, far past the limit.
    const stuck = await holdLikeOlderWrapper(folder, LOCK_2);
    const record = { pid: stuck.pid, startedAt: 0, command: 'eslint src/lib/stuck', cwd: '/work' };
    writeFileSync(path.join(folder, `${LOCK_2}.json`), JSON.stringify(record));
    const holder = start(whole('exec cat'), folder);
    await untilHeld(folder);

    const narrowWaiter = await withLock(narrow('true'), folder);
    const wholeWaiter = start(whole('true'), folder);
    await untilWaiting(wholeWaiter);
    holder.child.stdin.end();
    const wholeOutcome = await wholeWaiter.outcome;

    expect(narrowWaiter.code).toBe(1);
    expect(narrowWaiter.stderr).toMatch(
      /Gave up after waiting \d+s: "eslint src\/lib\/stuck" in \/work \(pid \d+\), which has held the lock for \d+m \d+s, more than the 30m 00s limit/u,
    );
    expect(narrowWaiter.stderr).toContain(`limit (${path.join(folder, LOCK_2)})`);
    expect(wholeOutcome.code).toBe(0);
    expect(wholeOutcome.stderr).not.toContain('src/lib/stuck');
  });

  it('runs a narrow command on slot 1, and not without the lock, when slot 2 cannot be locked', async () => {
    const folder = lockFolder();
    mkdirSync(path.join(folder, LOCK_2));
    const command = narrow('flock -n "$1" true || exit 9', path.join(folder, LOCK));
    // Run without the lock, the command would take slot 1 itself and end with 0.
    await expect(withLock(command, folder)).resolves.toMatchObject({ code: 9 });
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

  it('reports a program that cannot start, with status 127, on a run without the lock', async () => {
    const outcome = await withLock([MISSING_PROGRAM, '--flag'], lockFolder(), { CI: 'true' });

    expect(outcome.code).toBe(127);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toMatch(/^\[lock\] Cannot run egoscope-missing-program: .+\n$/u);
  });

  describe.each(slots)('on %s', (_slot, slot) => {
    it('runs the command with its arguments, such as a test path, and returns its exit code', async () => {
      const folder = lockFolder();
      await occupyOthers(folder, slot);

      const outcome = await withLock(
        slot.command('printf "%s|" "$@"; exit 3', 'src/lib/foo', '--flag'),
        folder,
      );

      expect(outcome.code).toBe(3);
      expect(outcome.stdout).toBe('src/lib/foo|--flag|');
    });

    it.each([1, 197])(
      'runs a command that exits with %i exactly once, and passes the code on',
      async (code) => {
        const folder = lockFolder();
        const runs = path.join(folder, 'runs');
        await occupyOthers(folder, slot);

        const outcome = await withLock(
          slot.command(`echo run >> "$1"; exit ${String(code)}`, runs),
          folder,
        );

        expect(outcome.code).toBe(code);
        expect(readFileSync(runs, 'utf8')).toBe('run\n');
      },
    );

    it.each([
      ['with the lock', {}],
      ['without the lock', { CI: 'true' }],
    ])(
      'passes SIGTERM on to the command of a run %s and waits for the command to end',
      async (_run, extra) => {
        const folder = lockFolder();
        const [started, cleaned] = [path.join(folder, 'started'), path.join(folder, 'cleaned')];
        const script = [
          'trap \'kill "$pid"; sleep 0.5; touch "$2"; exit 42\' TERM',
          'sleep 10 & pid=$!',
          'touch "$1"',
          'wait "$pid"',
        ].join('\n');
        await occupyOthers(folder, slot);
        const run = start(slot.command(script, started, cleaned), folder, extra);
        // The wrapper catches the signals before it starts any process, so a command
        // that has set its trap shows that both are ready.
        await until(() => existsSync(started));

        run.child.kill('SIGTERM');
        const outcome = await run.outcome;

        expect(outcome.code).toBe(42);
        expect(existsSync(cleaned)).toBe(true);
      },
    );

    it.each<[NodeJS.Signals, number]>([
      ['SIGINT', 130],
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ])(
      'ends on a %s that comes before the command has started, with status %i, and starts nothing',
      async (signal, status) => {
        const folder = lockFolder();
        const ran = path.join(folder, 'ran');
        await occupyOthers(folder, slot);
        // The first run holds the slot until its input ends, so the second one cannot start.
        const holder = start(slot.command('exec cat'), folder);
        await untilHeld(folder, slot.lock);
        const waiter = start(slot.command('touch "$1"', ran), folder);
        // The wrapper writes this line once it has caught the signals and found the slot taken.
        await untilWaiting(waiter);

        waiter.child.kill(signal);
        const stopped = await waiter.outcome;
        holder.child.stdin.end();
        await holder.outcome;

        expect(stopped.code).toBe(status);
        expect(stopped.signal).toBeNull();
        expect(existsSync(ran)).toBe(false);
      },
    );

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
        await occupyOthers(folder, slot);
        // Without EGOSCOPE_LOCK_DIR, the wrapper asks git for its lock folder.
        const git = slowGit(folder, reply(folder));
        // Starting a missing program fails at once and loudly, so a signal passed on to
        // it cannot hide the start: the shell of the command, which ignores the signal
        // as every shell from that PATH does, reports it. A quiet run started nothing.
        const missing = slot.command(`exec ${MISSING_PROGRAM}`);
        const run = start(missing, folder, { EGOSCOPE_LOCK_DIR: '', PATH: git.path });
        await until(() => existsSync(git.asked));

        run.child.kill('SIGTERM');
        await untilDelivered(run.child.pid ?? 0);
        git.answer();
        const stopped = await run.outcome;

        expect(stopped.code).toBe(143);
        expect(stopped.signal).toBeNull();
        expect(stopped.stderr).toBe(stderr);
      },
    );

    it('keeps the slot until the command ends, even when every wrapper is killed', async () => {
      const folder = lockFolder();
      const [started, finished] = [path.join(folder, 'started'), path.join(folder, 'finished')];
      await occupyOthers(folder, slot);
      const run = start(
        slot.command('echo "$$" > "$1"; sleep 2; touch "$2"', started, finished),
        folder,
      );
      await until(() => existsSync(started) && readFileSync(started, 'utf8').endsWith('\n'));
      const wrappers = wrappersOf(Number(readFileSync(started, 'utf8')), run.child.pid ?? 0);

      for (const wrapper of wrappers) {
        process.kill(wrapper, 'SIGKILL');
      }
      await run.exited;

      expect(isLocked(folder, slot.lock)).toBe(true);
      await until(() => !isLocked(folder, slot.lock));
      expect(existsSync(finished)).toBe(true);
    });

    it('stops waiting on SIGTERM, without ever running the command', async () => {
      const folder = lockFolder();
      const ran = path.join(folder, 'ran');
      await occupyOthers(folder, slot);
      const holding = withLock(slot.command('sleep 1.5'), folder);
      await untilHeld(folder, slot.lock);
      const waiter = start(slot.command('touch "$1"', ran), folder);
      await untilWaiting(waiter);

      waiter.child.kill('SIGTERM');
      await Promise.all([waiter.outcome, holding]);

      expect(existsSync(ran)).toBe(false);
    });

    it('takes the slot once for a run and the runs it starts, whichever slot it is, without deadlock', async () => {
      const folder = lockFolder();
      await occupyOthers(folder, slot);

      // The nested command is whole-project: it would wait for slot 1 if it locked.
      const outcome = await withLock(
        slot.command('exec bun "$1" sh -c "echo nested"', SCRIPT),
        folder,
      );

      expect(outcome.code).toBe(0);
      expect(outcome.stdout).toBe('nested\n');
    });

    it('fails with a clear message when one run holds the slot past the limit', async () => {
      const folder = lockFolder();
      await occupyOthers(folder, slot);
      const stuck = withLock(slot.command('sleep 3'), folder);
      await untilHeld(folder, slot.lock);

      const waiter = await withLock(slot.command('true'), folder, {
        EGOSCOPE_LOCK_LIMIT_SECONDS: '1',
      });
      await stuck;

      expect(waiter.code).toBe(1);
      expect(waiter.stderr).toMatch(/Gave up after waiting \d+s: /u);
      expect(waiter.stderr).toContain(`: "${slot.command('sleep 3').join(' ')}" in `);
      expect(waiter.stderr).toMatch(/has held the lock for \d+s, more than the 1s limit/u);
    });

    it('names a process that a finished command left running with the slot', async () => {
      const folder = lockFolder();
      await occupyOthers(folder, slot);
      // The command ends at once; the sleep it starts in the background keeps the slot.
      const leaving = start(slot.command('sleep 3 &'), folder);
      await leaving.exited;

      const waiter = await withLock(slot.command('true'), folder, {
        EGOSCOPE_LOCK_LIMIT_SECONDS: '1',
      });
      await leaving.outcome;

      expect(waiter.code).toBe(1);
      expect(waiter.stderr).toContain(
        `a process that an earlier command left running in the background, which still holds the lock (find it with \`fuser -v ${path.join(folder, slot.lock)}\`)`,
      );
    });
  });
});

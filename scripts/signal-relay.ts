/**
 * How scripts/with-lock.ts handles the termination signals, SIGINT, SIGTERM and
 * SIGHUP, and starts a command without the lock.
 *
 * - The wrapper catches the signals before it starts any process, and passes each
 *   one on to the command once the command has started.
 * - Without the lock, the wrapper starts the command itself, without a shell. Bun
 *   calls the listener of a signal only from its event loop, so the wrapper first
 *   lets one turn of the loop pass, and starts nothing if a signal has come by then.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { setImmediate as nextTurn } from 'node:timers/promises';

import type { ChildProcess } from 'node:child_process';

/** A program and its arguments, as the wrapper's command line gives them. */
export type Command = readonly [program: string, ...args: string[]];
/**
 * The termination signals that the wrapper catches during its whole run, and the
 * process they are passed on to.
 */
export type Relay = Readonly<{
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

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const EXIT_SIGNAL_BASE = 128;
const EXIT_NOT_FOUND = 127;

const exitCodeFor = (signal: NodeJS.Signals): number =>
  EXIT_SIGNAL_BASE + constants.signals[signal];

/**
 * Catches SIGINT, SIGTERM and SIGHUP before the wrapper starts any process, so
 * that none of them can end it unseen: a signal is passed on to the command once
 * the wrapper has let it start, and keeps it from starting before that.
 */
export function catchSignals(): Relay {
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
 * Resolves to the exit code of `child`, to 128 plus the number of the signal that
 * ended it, or to 127 when `program` cannot start, which it reports.
 */
export async function endOf(child: ChildProcess, program: string): Promise<number> {
  return new Promise<number>((resolve) => {
    child.on('error', (error) => {
      console.error(`[lock] Cannot run ${program}: ${error.message}`);
      resolve(EXIT_NOT_FOUND);
    });
    child.on('close', (exitCode, signal) => {
      resolve(exitCode ?? (typeof signal === 'string' ? exitCodeFor(signal) : 1));
    });
  });
}

/**
 * Runs the command without the lock and without a shell; resolves to its exit code,
 * or to the run's status when a termination signal came before it started. The
 * listeners of the signals caught during the start-up checks run in the turn of the
 * event loop that it lets pass first. A signal caught while `spawn()` runs reaches
 * its listener on a later turn, once the command exists, and is passed on to it.
 */
export async function runUnlocked([program, ...args]: Command, relay: Relay): Promise<number> {
  await nextTurn();
  const stopStatus = relay.stopStatus();
  if (stopStatus !== undefined) {
    return stopStatus;
  }
  const child = spawn(program, args, { stdio: 'inherit' });
  relay.forwardTo(child);
  return endOf(child, program);
}

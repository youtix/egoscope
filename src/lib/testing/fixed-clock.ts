import { z } from 'zod';

import { err, ok } from '@/lib/result';
import { installFakeClock, now, parseTimestamp, fixedClock as stoppedClock } from '@/lib/time';

import { invalidCommand } from './commands';

import type { InvalidCommand } from './commands';
import type { Result } from '@/lib/result';
import type { EpochMs, FixedClock } from '@/lib/time';

// The clock that `fixedClock.set` installed, and the way to put back the one before,
// kept on globalThis under a registered symbol, so that every copy of this module (a
// bundle layer of the hermetic server) moves the same clock.
const INSTALLED = Symbol.for('egoscope.testing.fixed-clock');

type Installed = Readonly<{ clock: FixedClock; restore: () => void }>;

const isInstalled = (value: unknown): value is Installed =>
  typeof value === 'object' && value !== null && 'restore' in value;

function installed(): Installed | undefined {
  const value: unknown = Reflect.get(globalThis, INSTALLED);
  return isInstalled(value) ? value : undefined;
}

/**
 * The process's fixed clock, which the hermetic end-to-end control `/api/test/clock`
 * sets (TRV-68): `set(at)` stops the clock that `now()` reads at `at`, replacing the
 * one that an earlier `set` stopped; `advance(durationMs)` moves it on, or back for a
 * negative duration, and says whether a fixed clock was set; `release()` puts back the
 * clock that ran before the first `set`.
 */
export const fixedClock = {
  set(at: EpochMs): void {
    fixedClock.release();
    const clock = stoppedClock(at);
    Reflect.set(globalThis, INSTALLED, { clock, restore: installFakeClock(clock) });
  },
  advance(durationMs: number): boolean {
    const current = installed();
    current?.clock.advance(durationMs);
    return current !== undefined;
  },
  release(): void {
    installed()?.restore();
    Reflect.set(globalThis, INSTALLED, undefined);
  },
} as const;

/** An instant as machines exchange it, ISO 8601 with its offset, read as epoch milliseconds (TRV-68). */
export const isoInstant = z.string().transform((text, context) => {
  const parsed = parseTimestamp(text);
  if (parsed.ok && parsed.timestamp.kind === 'instant') {
    return parsed.timestamp.at;
  }
  context.addIssue({ code: 'custom', message: 'Expected an ISO 8601 instant with its offset.' });
  return z.NEVER;
});

// One command at a time: stop the clock at an instant, move it on, or release it.
const clockCommand = z
  .strictObject({
    at: isoInstant.optional(),
    advanceMs: z.int().optional(),
    release: z.literal(true).optional(),
  })
  .refine((command) => Object.keys(command).length === 1, {
    message: 'Expected exactly one of "at", "advanceMs" and "release".',
  });

/** Why `scriptClock` changed nothing: the command is not one it knows, or there is no fixed clock to advance. */
export type ClockCommandError = InvalidCommand | Readonly<{ kind: 'no_fixed_clock' }>;

/**
 * Runs a command of `/api/test/clock` on the process's clock (TRV-68): `{ "at": "<ISO
 * 8601 instant>" }` stops it there, `{ "advanceMs": <n> }` moves a stopped clock on,
 * `{ "release": true }` lets the system clock run again. Gives the instant that `now()`
 * reads afterwards, or why nothing changed.
 */
export function scriptClock(input: unknown): Result<EpochMs, ClockCommandError> {
  const parsed = clockCommand.safeParse(input);
  if (!parsed.success) {
    return err(invalidCommand(parsed.error));
  }
  const { at, advanceMs } = parsed.data;
  if (at !== undefined) {
    fixedClock.set(at);
    return ok(now());
  }
  if (advanceMs === undefined) {
    fixedClock.release();
    return ok(now());
  }
  return fixedClock.advance(advanceMs) ? ok(now()) : err({ kind: 'no_fixed_clock' });
}

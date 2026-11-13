import { toEpochMs } from './instant';

import type { EpochMs } from './instant';

/** The port through which the app reads the current instant: nothing else reads the ambient time. */
export type Clock = Readonly<{ now: () => EpochMs }>;

/** A clock that stays on one instant until a test moves it on. */
export type FixedClock = Clock & Readonly<{ advance: (durationMs: number) => void }>;

/** The current instant by the machine's clock: the one place where the app reads the ambient time. */
function readMachineClock(): EpochMs {
  return toEpochMs(Date.now());
}

/** The machine's clock, which `now()` reads unless a fake clock is installed. */
export const systemClock: Clock = { now: readMachineClock };

/**
 * A clock stopped at `at`, for tests and the hermetic end-to-end mode:
 * `advance(durationMs)` moves it on, or back for a negative duration.
 */
export function fixedClock(at: EpochMs): FixedClock {
  let current = at;
  return {
    now: () => current,
    advance: (durationMs) => {
      current = toEpochMs(current + durationMs);
    },
  };
}

// The installed clock lives on globalThis under a registered symbol, so that every
// copy of this module in a process reads the same one: Next.js loads a module once
// per bundle layer, and the hermetic end-to-end mode sets the clock from a route.
const INSTALLED_CLOCK = Symbol.for('egoscope.time.installed-clock');

function isClock(value: unknown): value is Clock {
  return typeof value === 'object' && value !== null && 'now' in value;
}

function installedClock(): Clock {
  const value: unknown = Reflect.get(globalThis, INSTALLED_CLOCK);
  return isClock(value) ? value : systemClock;
}

/** The current instant, read from the installed clock: the system clock unless a test replaced it. */
export function now(): EpochMs {
  return installedClock().now();
}

/**
 * Replaces the clock that `now()` reads, in the whole process, until the
 * returned function puts the previous one back. Restore nested clocks in the
 * reverse order of their installation.
 */
export function installFakeClock(clock: Clock): () => void {
  const previous = installedClock();
  Reflect.set(globalThis, INSTALLED_CLOCK, clock);
  return () => {
    Reflect.set(globalThis, INSTALLED_CLOCK, previous);
  };
}

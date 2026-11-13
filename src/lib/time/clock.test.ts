import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixedClock, installFakeClock, now, systemClock } from './clock';
import { toEpochMs } from './instant';

const MINUTE_MS = 60_000;
const MACHINE_TIME = toEpochMs(Date.UTC(2026, 10, 13, 9, 15));
const TIP_OFF = toEpochMs(Date.UTC(2026, 10, 11, 0, 30));
const LATER = toEpochMs(TIP_OFF + MINUTE_MS);

// The restore functions of the clocks a test installed, called after it in reverse order.
const restorers: (() => void)[] = [];

describe('the clock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: MACHINE_TIME, toFake: ['Date'] });
  });

  afterEach(() => {
    for (const restore of restorers.splice(0).toReversed()) {
      restore();
    }
    vi.useRealTimers();
  });

  it('reads the machine clock through systemClock', () => {
    expect(systemClock.now()).toBe(MACHINE_TIME);
  });

  it('reads the system clock through now() while no fake clock is installed', () => {
    vi.advanceTimersByTime(MINUTE_MS);

    expect(now()).toBe(MACHINE_TIME + MINUTE_MS);
  });

  it('keeps a fixed clock on its instant until it is advanced, either way', () => {
    const clock = fixedClock(TIP_OFF);
    vi.advanceTimersByTime(MINUTE_MS);

    expect(clock.now()).toBe(TIP_OFF);

    clock.advance(90 * MINUTE_MS);

    expect(clock.now()).toBe(TIP_OFF + 90 * MINUTE_MS);

    clock.advance(-120 * MINUTE_MS);

    expect(clock.now()).toBe(TIP_OFF - 30 * MINUTE_MS);
  });

  it('refuses to advance a fixed clock by a fraction of a millisecond', () => {
    const clock = fixedClock(TIP_OFF);

    expect(() => {
      clock.advance(0.5);
    }).toThrow('Not an instant in epoch milliseconds');
    expect(clock.now()).toBe(TIP_OFF);
  });

  it('makes now() read an installed clock, and the system clock again once restored', () => {
    const clock = fixedClock(TIP_OFF);
    const restore = installFakeClock(clock);
    clock.advance(MINUTE_MS);

    expect(now()).toBe(LATER);

    restore();

    expect(now()).toBe(MACHINE_TIME);
  });

  it('puts nested clocks back in the reverse order of their installation', () => {
    restorers.push(installFakeClock(fixedClock(TIP_OFF)));
    const restoreInner = installFakeClock(fixedClock(LATER));

    expect(now()).toBe(LATER);

    restoreInner();

    expect(now()).toBe(TIP_OFF);
  });

  it('shares the installed clock with every copy of this module in the process', async () => {
    restorers.push(installFakeClock(fixedClock(TIP_OFF)));
    vi.resetModules();
    const copy = await import('./clock');

    expect(copy.now()).toBe(TIP_OFF);

    const later = fixedClock(LATER);
    restorers.push(copy.installFakeClock(later));

    expect(now()).toBe(LATER);
  });
});

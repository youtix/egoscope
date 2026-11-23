import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeClock, now, fixedClock as stoppedClock, toEpochMs } from '@/lib/time';

import { fixedClock, scriptClock } from './fixed-clock';

const INSTALLED = Symbol.for('egoscope.testing.fixed-clock');
// The clock that runs before the test sets one, itself stopped, so that a release shows.
const BEFORE = toEpochMs(Date.UTC(2026, 0, 5, 12));
const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const MINUTE_MS = 60_000;

describe('the fixed clock', () => {
  beforeEach(() => {
    vi.stubGlobal(INSTALLED, undefined);
    const restoreClock = installFakeClock(stoppedClock(BEFORE));
    return () => {
      fixedClock.release();
      restoreClock();
    };
  });

  describe('fixedClock', () => {
    it('[TRV-68] stops the clock at an instant, moves it on and back, then puts back the clock before', () => {
      fixedClock.set(AT);
      expect(now()).toBe(AT);

      expect(fixedClock.advance(5 * MINUTE_MS)).toBe(true);
      expect(now()).toBe(AT + 5 * MINUTE_MS);
      fixedClock.advance(-10 * MINUTE_MS);
      expect(now()).toBe(AT - 5 * MINUTE_MS);
      fixedClock.release();

      expect(now()).toBe(BEFORE);
    });

    it('replaces the clock of an earlier set, and still puts back the one before the first', () => {
      fixedClock.set(AT);
      fixedClock.set(toEpochMs(AT + MINUTE_MS));
      expect(now()).toBe(AT + MINUTE_MS);

      fixedClock.release();

      expect(now()).toBe(BEFORE);
    });

    it('advances nothing and releases nothing when no clock was set', () => {
      expect(fixedClock.advance(MINUTE_MS)).toBe(false);
      fixedClock.release();

      expect(now()).toBe(BEFORE);
    });

    it('moves one clock for every copy of the module', async () => {
      fixedClock.set(AT);
      vi.resetModules();
      const copy = await import('./fixed-clock');

      expect(copy.fixedClock.advance(MINUTE_MS)).toBe(true);
      copy.fixedClock.release();

      expect(now()).toBe(BEFORE);
    });
  });

  describe('scriptClock', () => {
    it('[TRV-68] stops the clock at an instant given with its offset, and gives it', () => {
      expect(scriptClock({ at: '2026-11-20T03:15:00-05:00' })).toStrictEqual({
        ok: true,
        value: AT,
      });
      expect(now()).toBe(AT);
    });

    it('moves a stopped clock on, then lets the clock before run again', () => {
      scriptClock({ at: '2026-11-20T08:15:00Z' });

      expect(scriptClock({ advanceMs: MINUTE_MS })).toStrictEqual({
        ok: true,
        value: AT + MINUTE_MS,
      });
      expect(scriptClock({ release: true })).toStrictEqual({ ok: true, value: BEFORE });
    });

    it('refuses to move a clock that no command stopped', () => {
      expect(scriptClock({ advanceMs: MINUTE_MS })).toStrictEqual({
        ok: false,
        error: { kind: 'no_fixed_clock' },
      });
      expect(now()).toBe(BEFORE);
    });

    it.each([
      [
        { at: '2026-11-20T08:15:00' },
        ['command.at: Expected an ISO 8601 instant with its offset.'],
      ],
      [{ at: '2026-11-20' }, ['command.at: Expected an ISO 8601 instant with its offset.']],
      [{ advanceMs: 1.5 }, ['command.advanceMs: Invalid input: expected int, received number']],
      [{ release: false }, ['command.release: Invalid input: expected true']],
      [
        { at: '2026-11-20T08:15:00Z', advanceMs: MINUTE_MS },
        ['command: Expected exactly one of "at", "advanceMs" and "release".'],
      ],
      [{}, ['command: Expected exactly one of "at", "advanceMs" and "release".']],
      [{ at: '2026-11-20T08:15:00Z', reset: true }, ['command: Unrecognized key: "reset"']],
      [null, ['command: Invalid input: expected object, received null']],
    ])('changes nothing for an invalid command %j, and says what is wrong', (command, issues) => {
      expect(scriptClock(command)).toStrictEqual({
        ok: false,
        error: { kind: 'invalid_command', issues },
      });
      expect(now()).toBe(BEFORE);
    });
  });
});

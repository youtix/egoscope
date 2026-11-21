import { z } from 'zod';

import { runtimeCache } from '@/lib/runtime-cache';

import { LONG_TTL_SECONDS, MINUTE_MS, storedInstant } from './stored-values';

import type { CacheFailure } from '@/lib/runtime-cache';
import type { EpochMs } from '@/lib/time';

/**
 * The tick records, `tick:last` (module map §1.9): the last accepted tick, whoever sent
 * it, and each caller's last accepted call, by the name its request gives (the
 * `x-tick-source` header or the Vercel user agent).
 */
export type TickRecords = Readonly<{
  lastAcceptedAt: EpochMs;
  callers: Readonly<Record<string, EpochMs>>;
}>;

/** Whether a tick came within a minute of the last accepted one, or why the records are unknown. */
export type TickRecording = Readonly<{ ok: true; isDuplicate: boolean }> | CacheFailure;

/** The tick records, `null` when the cache holds none it can read, or why they are unknown. */
export type TickReading = Readonly<{ ok: true; ticks: TickRecords | null }> | CacheFailure;

const TICKS_KEY = 'tick:last';

const ticksSchema = z.strictObject({
  lastAcceptedAt: storedInstant,
  callers: z.record(z.string(), storedInstant),
});

/**
 * The tick records, without the database: `null` when the cache holds none or holds
 * them garbled, which a tick treats as no tick yet (module map §1.9). The status
 * screen lists each caller's last call from them (TRV-32).
 */
export async function lastTicks(): Promise<TickReading> {
  const read = await runtimeCache().get(TICKS_KEY);
  if (!read.ok) {
    return read;
  }
  const parsed = ticksSchema.safeParse(read.value);
  return { ok: true, ticks: parsed.success ? parsed.data : null };
}

/**
 * Accepts the tick that `caller` sent at `at`, unless it is a duplicate (module map §1.6
 * step 3; TRV-29): a tick less than a minute from the last accepted one, the two
 * callers overlapping or a run delivered twice, writes nothing; any other tick becomes
 * the last accepted one and its caller's last call, in one write.
 */
export async function recordTick(caller: string, at: EpochMs): Promise<TickRecording> {
  const reading = await lastTicks();
  if (!reading.ok) {
    return reading;
  }
  const { ticks } = reading;
  if (ticks !== null && Math.abs(at - ticks.lastAcceptedAt) < MINUTE_MS) {
    return { ok: true, isDuplicate: true };
  }
  const records: TickRecords = {
    lastAcceptedAt: at,
    callers: { ...ticks?.callers, [caller]: at },
  };
  const written = await runtimeCache().set(TICKS_KEY, records, LONG_TTL_SECONDS);
  return written.ok ? { ok: true, isDuplicate: false } : written;
}

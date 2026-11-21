import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const TICKS_KEY = 'tick:last';
const START = toEpochMs(Date.UTC(2026, 10, 21, 9));
const at = (milliseconds: number) => toEpochMs(START + milliseconds);

const UNAVAILABLE = { ok: false, error: { kind: 'unavailable' } };

/** The tick records as a server loads them, over the process's fake cache. */
async function server() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return { fake: processFakeRuntimeCache(), ...(await import('.')) };
}

describe('the tick records', () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
  });

  describe('recordTick', () => {
    it("[TRV-29] accepts the first tick, which becomes the last accepted one and its caller's last call", async () => {
      const { recordTick, lastTicks } = await server();

      expect(await recordTick('cloudflare', START)).toStrictEqual({ ok: true, isDuplicate: false });
      expect(await lastTicks()).toStrictEqual({
        ok: true,
        ticks: { lastAcceptedAt: START, callers: { cloudflare: START } },
      });
    });

    it.each([
      [59_999, true],
      [-59_999, true],
      [60_000, false],
      [-60_000, false],
    ])(
      '[TRV-29] finds a tick %i ms from the last accepted one a duplicate: %s, which writes nothing',
      async (offset, isDuplicate) => {
        const { fake, recordTick } = await server();
        await recordTick('cloudflare', START);

        const recording = await recordTick('vercel-cron/1.0', at(offset));

        expect(recording).toStrictEqual({ ok: true, isDuplicate });
        expect(fake.writeCount(TICKS_KEY)).toBe(isDuplicate ? 1 : 2);
      },
    );

    it("[TRV-32] keeps the last accepted tick, whoever sent it, and each caller's last accepted call", async () => {
      const { recordTick, lastTicks } = await server();

      await recordTick('cloudflare', START);
      await recordTick('vercel-cron/1.0', at(150_000));
      await recordTick('cloudflare', at(300_000));
      await recordTick('vercel-cron/1.0', at(320_000));

      expect(await lastTicks()).toStrictEqual({
        ok: true,
        ticks: {
          lastAcceptedAt: at(300_000),
          callers: { cloudflare: at(300_000), 'vercel-cron/1.0': at(150_000) },
        },
      });
    });

    it('[TRV-29] counts garbled tick records as no tick yet, and replaces them', async () => {
      const { fake, recordTick, lastTicks } = await server();
      await fake.set(TICKS_KEY, { lastAcceptedAt: 'a minute ago' }, 60);

      const garbled = await lastTicks();
      const recording = await recordTick('cloudflare', START);

      expect(garbled).toStrictEqual({ ok: true, ticks: null });
      expect(recording).toStrictEqual({ ok: true, isDuplicate: false });
      expect(await lastTicks()).toStrictEqual({
        ok: true,
        ticks: { lastAcceptedAt: START, callers: { cloudflare: START } },
      });
    });

    it('[TRV-31] answers unavailable while the cache fails, and when it refuses the write', async () => {
      const { fake, recordTick, lastTicks } = await server();

      fake.setWritable(false);
      const refused = await recordTick('cloudflare', START);
      fake.setAvailable(false);
      const unread = [await recordTick('cloudflare', START), await lastTicks()];

      expect([refused, ...unread]).toStrictEqual([UNAVAILABLE, UNAVAILABLE, UNAVAILABLE]);
    });
  });

  describe('lastTicks', () => {
    it('[TRV-32] reads no tick records before the first accepted tick', async () => {
      const { lastTicks } = await server();

      expect(await lastTicks()).toStrictEqual({ ok: true, ticks: null });
    });
  });
});

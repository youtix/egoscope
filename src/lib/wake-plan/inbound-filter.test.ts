import { createHmac, randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const INBOUND_KEY = 'telegram:inbound';
const UNAVAILABLE = { ok: false, error: { kind: 'unavailable' } };

// What `notifications` would compute, under 32 random bytes for the webhook's value.
const SEED = randomBytes(32);
const CHAT_ID = '481516234';
const LINK_CODE = 'Xq7vR2mK9pL4sT8wB1nC6dF3gH5jZ0aE-_yU2iO7kQe';
const hmac = (value: string) => createHmac('sha256', SEED).update(value).digest('hex');

/** The inbound filter as a server loads it, over the process's fake cache. */
async function server() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return { fake: processFakeRuntimeCache(), ...(await import('.')) };
}

describe('the Telegram inbound filter', () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
  });

  describe('readInboundFilter', () => {
    it("[TEL-31] reads no filter while the cache holds none, so that every update counts as a stranger's", async () => {
      const { readInboundFilter } = await server();

      expect(await readInboundFilter()).toStrictEqual({ ok: true, filter: null });
    });

    it('[TEL-31] reads a garbled filter as none', async () => {
      const { fake, readInboundFilter } = await server();
      await fake.set(INBOUND_KEY, { linkedChat: CHAT_ID, pendingCode: null }, 60);

      expect(await readInboundFilter()).toStrictEqual({ ok: true, filter: null });
    });

    it('[TEL-31] answers unavailable while the cache fails', async () => {
      const { fake, readInboundFilter } = await server();
      fake.setAvailable(false);

      expect(await readInboundFilter()).toStrictEqual(UNAVAILABLE);
    });
  });

  describe('writeInboundFilter', () => {
    it('[TEL-31] [TRV-66] keeps the hashes of the linked chat and of the pending code, which it gives back', async () => {
      const { writeInboundFilter, readInboundFilter } = await server();
      const filter = { linkedChat: hmac(CHAT_ID), pendingCode: hmac(LINK_CODE) };

      expect(await writeInboundFilter(filter)).toStrictEqual({ ok: true });
      expect(await readInboundFilter()).toStrictEqual({ ok: true, filter });
    });

    it('[TEL-31] keeps a filter with no linked chat while a code is pending, and one with no code once linked', async () => {
      const { writeInboundFilter, readInboundFilter } = await server();

      await writeInboundFilter({ linkedChat: null, pendingCode: hmac(LINK_CODE) });
      const pending = await readInboundFilter();
      await writeInboundFilter({ linkedChat: hmac(CHAT_ID), pendingCode: null });

      expect(pending).toStrictEqual({
        ok: true,
        filter: { linkedChat: null, pendingCode: hmac(LINK_CODE) },
      });
      expect(await readInboundFilter()).toStrictEqual({
        ok: true,
        filter: { linkedChat: hmac(CHAT_ID), pendingCode: null },
      });
    });

    it.each([
      ['the chat identifier in clear', { linkedChat: CHAT_ID, pendingCode: null }],
      ['the link code in clear', { linkedChat: null, pendingCode: LINK_CODE }],
      ['a hash in capitals', { linkedChat: hmac(CHAT_ID).toUpperCase(), pendingCode: null }],
    ])('[TRV-66] refuses %s, and writes nothing', async (_value, filter) => {
      const { fake, writeInboundFilter } = await server();

      await expect(writeInboundFilter(filter)).rejects.toThrow(ZodError);
      expect(fake.writeCount(INBOUND_KEY)).toBe(0);
    });

    it('[TEL-31] answers unavailable while the cache fails', async () => {
      const { fake, writeInboundFilter } = await server();
      fake.setAvailable(false);

      expect(
        await writeInboundFilter({ linkedChat: hmac(CHAT_ID), pendingCode: null }),
      ).toStrictEqual(UNAVAILABLE);
    });
  });
});

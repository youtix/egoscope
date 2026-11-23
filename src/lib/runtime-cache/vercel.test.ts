import { getCache } from '@vercel/functions';
import { describe, expect, it, vi } from 'vitest';

import { RUNTIME_CACHE_CONTRACT } from './contract';
import { vercelRuntimeCache } from './vercel';

import type { RuntimeCache as VercelCache } from '@vercel/functions';

vi.mock(import('@vercel/functions'), () => ({ getCache: vi.fn() }));

const UNAVAILABLE = { ok: false, error: { kind: 'unavailable' } };

/**
 * Vercel's cache as `getCache` hands it out, in memory, for the test that calls this:
 * JSON in and out, `null` for a key that holds nothing, and every call rejected, as
 * Vercel's client does on an error answer, once `breakCache` was called.
 */
function useVercelCacheInMemory(): Readonly<{ cache: VercelCache; breakCache: () => void }> {
  const entries = new Map<string, string>();
  let isBroken = false;
  const answer = async (): Promise<void> => {
    await Promise.resolve();
    if (isBroken) {
      throw new Error('Failed to set cache: 503 Service Unavailable');
    }
  };
  const cache: VercelCache = {
    get: vi.fn(async (key: string) => {
      await answer();
      const json = entries.get(key);
      return json === undefined ? null : (JSON.parse(json) as unknown);
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      await answer();
      entries.set(key, JSON.stringify(value));
    }),
    delete: vi.fn(async (key: string) => {
      await answer();
      entries.delete(key);
    }),
    expireTag: vi.fn(answer),
  };
  vi.mocked(getCache).mockImplementation(() => cache);
  return {
    cache,
    breakCache: () => {
      isBroken = true;
    },
  };
}

describe('vercelRuntimeCache', () => {
  describe('[TRV-12] holds to the contract of every adapter', () => {
    it.each(RUNTIME_CACHE_CONTRACT)('$title', async ({ run, expected }) => {
      const { breakCache } = useVercelCacheInMemory();

      const result = await run({ cache: vercelRuntimeCache, breakCache });

      expect(result).toStrictEqual(expected);
    });
  });

  it('[TRV-12] hands the time to live to Vercel in seconds, its own unit', async () => {
    const { cache } = useVercelCacheInMemory();

    await vercelRuntimeCache.set('tick:last', { lastAcceptedAt: 1 }, 2_592_000);

    expect(cache.set).toHaveBeenCalledWith('tick:last', { lastAcceptedAt: 1 }, { ttl: 2_592_000 });
  });

  it('[TRV-12] asks Vercel for the cache in the namespace of the application, apart from the other projects of the team', async () => {
    useVercelCacheInMemory();
    vi.mocked(getCache).mockClear();

    await vercelRuntimeCache.get('wake:plan');
    await vercelRuntimeCache.set('wake:plan', null, 60);
    await vercelRuntimeCache.delete('wake:plan');

    expect(vi.mocked(getCache).mock.calls).toStrictEqual([
      [{ namespace: 'egoscope' }],
      [{ namespace: 'egoscope' }],
      [{ namespace: 'egoscope' }],
    ]);
  });

  it('[TRV-31] answers unavailable when no cache can be had in the context', async () => {
    vi.mocked(getCache).mockImplementation(() => {
      throw new Error('No cache available in this context');
    });

    const results = [
      await vercelRuntimeCache.get('wake:plan'),
      await vercelRuntimeCache.set('wake:plan', null, 60),
      await vercelRuntimeCache.delete('wake:plan'),
    ];

    expect(results).toStrictEqual([UNAVAILABLE, UNAVAILABLE, UNAVAILABLE]);
  });
});

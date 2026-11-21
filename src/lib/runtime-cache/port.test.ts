import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');

/** The port as a server loads it, with EGOSCOPE_FAKES set to `fakes`. */
async function serverWith(fakes: string) {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', fakes);
  return { ...(await import('./port')), ...(await import('./vercel')) };
}

describe('the runtime-cache port', () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
  });

  describe('runtimeCache', () => {
    it('[TRV-12] serves the process fake while EGOSCOPE_FAKES names the port', async () => {
      const { runtimeCache, processFakeRuntimeCache } = await serverWith('runtime-cache');

      expect(runtimeCache()).toBe(processFakeRuntimeCache());
    });

    it("[TRV-12] serves Vercel's cache while EGOSCOPE_FAKES leaves the port out", async () => {
      const { runtimeCache, vercelRuntimeCache } = await serverWith('telegram');

      expect(runtimeCache()).toBe(vercelRuntimeCache);
    });
  });

  describe('processFakeRuntimeCache', () => {
    it('shares one store between the requests of a process, through every copy of the module', async () => {
      const first = await serverWith('all');
      await first.runtimeCache().set('wake:plan', 'plan', 60);

      const reloaded = await serverWith('all');

      expect(reloaded.processFakeRuntimeCache()).toBe(first.processFakeRuntimeCache());
      expect(await reloaded.runtimeCache().get('wake:plan')).toStrictEqual({
        ok: true,
        value: 'plan',
      });
    });
  });
});

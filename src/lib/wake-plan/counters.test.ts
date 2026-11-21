import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { MAX_ATTEMPTS } from './counters';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const INSTANCE_COUNTERS = Symbol.for('egoscope.wake-plan.instance-counters');
const COUNTERS_KEY = 'wake:counters';
const START = toEpochMs(Date.UTC(2026, 10, 21, 9));
const at = (seconds: number) => toEpochMs(START + seconds * 1000);

const REFUSED = { attempt: 'refused_trigger' } as const;
const UNAVAILABLE = { ok: false, error: { kind: 'unavailable' } };
const NOTHING = { ok: true, counters: { attempts: [], beyond: [], probeCalls: [] } };

/** The counters as a server instance loads them, over the process's fake cache. */
async function instance() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return { fake: processFakeRuntimeCache(), ...(await import('.')) };
}

describe('the counters of the attempts and probe calls', () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    vi.stubGlobal(INSTANCE_COUNTERS, undefined);
  });

  describe('bumpCounter', () => {
    it('[TRV-65] [CL-TRV-21] [CL-TRV-25] keeps a refused tick and an ignored update with their instant and kind, an isolated attempt written at once', async () => {
      const { fake, bumpCounter, drainCounters } = await instance();

      await bumpCounter(REFUSED, START)();
      const written = fake.writeCount(COUNTERS_KEY);
      await bumpCounter({ attempt: 'group' }, at(90))();

      expect(written).toBe(1);
      expect(await drainCounters()).toStrictEqual({
        ok: true,
        counters: {
          attempts: [
            { kind: 'refused_trigger', at: START },
            { kind: 'group', at: at(90) },
          ],
          beyond: [],
          probeCalls: [],
        },
      });
    });

    it('[TRV-03] keeps each probe call with its service and instant', async () => {
      const { bumpCounter, drainCounters } = await instance();

      await bumpCounter({ probeCall: 'statsSource' }, START)();
      await bumpCounter({ probeCall: 'telegram' }, at(300))();

      expect(await drainCounters()).toStrictEqual({
        ok: true,
        counters: {
          attempts: [],
          beyond: [],
          probeCalls: [
            { service: 'statsSource', at: START },
            { service: 'telegram', at: at(300) },
          ],
        },
      });
    });

    it('[CL-TRV-25] writes once a minute at most under a stream of attempts, each kept in its order', async () => {
      const { fake, bumpCounter, drainCounters } = await instance();

      const writes = [];
      for (const seconds of [0, 20, 40, 59, 60, 61, 119, 120]) {
        await bumpCounter(REFUSED, at(seconds))();
        writes.push(fake.writeCount(COUNTERS_KEY));
      }
      const drained = await drainCounters();

      expect(writes).toStrictEqual([1, 1, 1, 1, 2, 2, 2, 3]);
      expect(
        drained.ok && drained.counters.attempts.map(({ at: instant }) => instant),
      ).toStrictEqual([0, 20, 40, 59, 60, 61, 119, 120].map((seconds) => at(seconds)));
    });

    it('[CL-TRV-25] writes nothing for a request whose attempt another request of the instance already wrote', async () => {
      const { fake, bumpCounter } = await instance();

      const earlier = bumpCounter(REFUSED, START);
      await bumpCounter(REFUSED, at(120))();
      await earlier();

      expect(fake.writeCount(COUNTERS_KEY)).toBe(1);
    });

    it('[CL-TRV-25] keeps what a failed write held, before what came after, until a write succeeds', async () => {
      const { fake, bumpCounter, drainCounters } = await instance();

      fake.setWritable(false);
      await bumpCounter(REFUSED, START)();
      fake.setAvailable(false);
      await bumpCounter({ attempt: 'channel' }, at(60))();
      fake.setAvailable(true);
      fake.setWritable(true);
      await bumpCounter({ attempt: 'private' }, at(90))();
      const beforeTheMinute = await drainCounters();
      await bumpCounter(REFUSED, at(120))();

      expect(beforeTheMinute).toStrictEqual(NOTHING);
      expect(await drainCounters()).toStrictEqual({
        ok: true,
        counters: {
          attempts: [
            { kind: 'refused_trigger', at: START },
            { kind: 'channel', at: at(60) },
            { kind: 'private', at: at(90) },
            { kind: 'refused_trigger', at: at(120) },
          ],
          beyond: [],
          probeCalls: [],
        },
      });
    });

    it('[CL-TRV-25] beyond 1,000 pending attempts keeps only their count by kind, with the first and the last instant', async () => {
      const { bumpCounter, drainCounters } = await instance();
      for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
        bumpCounter(REFUSED, toEpochMs(START + index));
      }
      bumpCounter({ attempt: 'group' }, at(10));
      bumpCounter(REFUSED, at(11));
      bumpCounter({ attempt: 'group' }, at(12));

      await bumpCounter(REFUSED, at(13))();
      const drained = await drainCounters();

      expect(drained.ok && drained.counters.attempts).toHaveLength(MAX_ATTEMPTS);
      expect(drained.ok && drained.counters.attempts.at(-1)).toStrictEqual({
        kind: 'refused_trigger',
        at: toEpochMs(START + MAX_ATTEMPTS - 1),
      });
      expect(drained.ok && drained.counters.beyond).toStrictEqual([
        { kind: 'refused_trigger', count: 2, firstAt: at(11), lastAt: at(13) },
        { kind: 'group', count: 2, firstAt: at(10), lastAt: at(12) },
      ]);
    });

    it('[CL-TRV-25] holds 1,000 attempts at most in the cache, from all instances, and counts the others', async () => {
      const first = await instance();
      for (let index = 0; index < 600; index += 1) {
        first.bumpCounter(REFUSED, toEpochMs(START + index));
      }
      await first.bumpCounter({ attempt: 'channel' }, at(1))();
      vi.stubGlobal(INSTANCE_COUNTERS, undefined);
      const second = await instance();
      for (let index = 0; index < 400; index += 1) {
        second.bumpCounter({ attempt: 'private' }, toEpochMs(at(2) + index));
      }
      await second.bumpCounter({ attempt: 'private' }, at(3))();

      const drained = await first.drainCounters();

      expect(drained.ok && drained.counters.attempts).toHaveLength(MAX_ATTEMPTS);
      expect(drained.ok && drained.counters.beyond).toStrictEqual([
        { kind: 'private', count: 2, firstAt: toEpochMs(at(2) + 399), lastAt: at(3) },
      ]);
    });

    it('[CL-TRV-25] keeps one buffer per server instance, which every copy of the module shares', async () => {
      const first = await instance();
      first.fake.setWritable(false);
      await first.bumpCounter(REFUSED, START)();
      first.fake.setWritable(true);

      const reloaded = await instance();
      await reloaded.bumpCounter({ attempt: 'group' }, at(60))();

      const drained = await reloaded.drainCounters();
      expect(drained.ok && drained.counters.attempts).toStrictEqual([
        { kind: 'refused_trigger', at: START },
        { kind: 'group', at: at(60) },
      ]);
    });
  });

  describe('drainCounters', () => {
    it('[CL-TRV-21] gives what the cache holds and empties it, and an empty cache costs no write', async () => {
      const { fake, bumpCounter, drainCounters } = await instance();
      await bumpCounter(REFUSED, START)();

      const first = await drainCounters();
      const second = await drainCounters();

      expect(first).toStrictEqual({
        ok: true,
        counters: {
          attempts: [{ kind: 'refused_trigger', at: START }],
          beyond: [],
          probeCalls: [],
        },
      });
      expect(second).toStrictEqual(NOTHING);
      expect(fake.writeCount(COUNTERS_KEY)).toBe(2);
    });

    it('[CL-TRV-21] gives the failure of a refused delete, and keeps the counters for the next pass', async () => {
      const { fake, bumpCounter, drainCounters } = await instance();
      await bumpCounter(REFUSED, START)();

      fake.setWritable(false);
      const refused = await drainCounters();
      fake.setWritable(true);
      const next = await drainCounters();

      expect(refused).toStrictEqual(UNAVAILABLE);
      expect(next.ok && next.counters.attempts).toStrictEqual([
        { kind: 'refused_trigger', at: START },
      ]);
    });

    it('[CL-TRV-21] answers unavailable while the cache fails', async () => {
      const { fake, drainCounters } = await instance();
      fake.setAvailable(false);

      expect(await drainCounters()).toStrictEqual(UNAVAILABLE);
    });

    it('[CL-TRV-25] reads garbled counters as none, which the next write replaces', async () => {
      const { fake, bumpCounter, drainCounters } = await instance();
      await fake.set(COUNTERS_KEY, { attempts: 'many' }, 60);

      const garbled = await drainCounters();
      await bumpCounter(REFUSED, START)();

      expect(garbled).toStrictEqual(NOTHING);
      expect(await drainCounters()).toStrictEqual({
        ok: true,
        counters: {
          attempts: [{ kind: 'refused_trigger', at: START }],
          beyond: [],
          probeCalls: [],
        },
      });
    });
  });
});

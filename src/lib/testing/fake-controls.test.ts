import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fakeBackupStorage } from '@/lib/backup-storage';
import { fakeLinkCheck } from '@/lib/link-check';
import { processFakeRuntimeCache } from '@/lib/runtime-cache';
import { fakeStatsSource } from '@/lib/stats-source';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import { PLAN_KEY } from '@/lib/wake-plan';

import { fakeControls, scriptFake } from './fake-controls';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8));
const CONTEXT = {
  deadline: toEpochMs(Date.UTC(2026, 10, 20, 9)),
  signal: new AbortController().signal,
};
const FAKES = [
  'egoscope.runtime-cache.process-fake',
  'egoscope.stats-source.fake',
  'egoscope.link-check.fake',
  'egoscope.backup-storage.fake',
];
// Every control, in the order of the registry.
const CONTROLS = [
  'runtime-cache.evict-wake-plan',
  'runtime-cache.lose-wake-plan',
  'runtime-cache.set-available',
  'stats-source.inject',
  'stats-source.clear-faults',
  'stats-source.refresh',
  'link-check.answer',
  'link-check.reset',
  'backup-storage.set-access',
  'backup-storage.set-private',
  'backup-storage.fail-next',
  'backup-storage.interrupt-next-upload',
  'backup-storage.keep-next-deletion',
];
const OTHER_KEY = 'wake:ticks';
const TTL_SECONDS = 600;
const ARTICLE = 'https://news.test/a-storm';
const PROBE = { url: ARTICLE, timeoutMs: 5000 };

/** The wake plan as a tick reads it over the process's fake cache, which holds a garbled plan and another entry. */
async function cacheWithAPlan() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  const { readPlan } = await import('@/lib/wake-plan');
  const cache = processFakeRuntimeCache();
  await cache.set(PLAN_KEY, { garbled: true }, TTL_SECONDS);
  await cache.set(OTHER_KEY, 'kept', TTL_SECONDS);
  return { cache, readPlan: async () => readPlan(AT) };
}

/** A backup file that the fake storage holds, uploaded under `name`. */
async function storedBackup(name: string): Promise<string> {
  const storage = fakeBackupStorage();
  await storage.ensureContainer(CONTEXT);
  const upload = await storage.upload(name, new Uint8Array([1, 2, 3]), CONTEXT);
  if (!upload.ok || upload.value.kind !== 'stored') {
    throw new Error(`The fake storage did not store ${name}.`);
  }
  return upload.value.file.id;
}

describe('the controls of the fakes', () => {
  beforeEach(() => {
    for (const fake of FAKES) {
      vi.stubGlobal(Symbol.for(fake), undefined);
    }
    onTestFinished(installFakeClock(fixedClock(AT)));
  });

  describe('fakeControls', () => {
    it('evicts the wake plan alone, which the next tick finds missing', async () => {
      const { cache, readPlan } = await cacheWithAPlan();
      await expect(readPlan()).resolves.toStrictEqual({ ok: false, error: { kind: 'unreadable' } });

      fakeControls.runtimeCache.evictWakePlan();

      await expect(readPlan()).resolves.toStrictEqual({ ok: false, error: { kind: 'missing' } });
      await expect(cache.get(OTHER_KEY)).resolves.toStrictEqual({ ok: true, value: 'kept' });
    });

    it('evicts the value stored under the key of the wake plan that the wake-plan module names', async () => {
      const cache = processFakeRuntimeCache();
      await cache.set(PLAN_KEY, 'a plan', TTL_SECONDS);

      fakeControls.runtimeCache.evictWakePlan();

      await expect(cache.get(PLAN_KEY)).resolves.toStrictEqual({ ok: true, value: null });
    });

    it('loses the wake plan with everything else that the cache held', async () => {
      const { cache, readPlan } = await cacheWithAPlan();

      fakeControls.runtimeCache.loseWakePlan();

      await expect(readPlan()).resolves.toStrictEqual({ ok: false, error: { kind: 'missing' } });
      await expect(cache.get(OTHER_KEY)).resolves.toStrictEqual({ ok: true, value: null });
    });

    it('makes the runtime cache unavailable, then available again', async () => {
      const { readPlan } = await cacheWithAPlan();

      fakeControls.runtimeCache.setAvailable(false);
      await expect(readPlan()).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'unavailable' },
      });
      fakeControls.runtimeCache.setAvailable(true);

      await expect(readPlan()).resolves.toStrictEqual({ ok: false, error: { kind: 'unreadable' } });
    });

    it("gives the process's own fakes, those that the ports serve", () => {
      expect(fakeControls.statsSource()).toBe(fakeStatsSource());
      expect(fakeControls.linkCheck()).toBe(fakeLinkCheck());
      expect(fakeControls.backupStorage()).toBe(fakeBackupStorage());
    });
  });

  describe('scriptFake', () => {
    it.each([
      ['runtime-cache.evict-wake-plan', { kind: 'missing' }],
      ['runtime-cache.lose-wake-plan', { kind: 'missing' }],
    ])('runs %s on the wake plan', async (control, error) => {
      const { readPlan } = await cacheWithAPlan();

      expect(scriptFake({ control })).toStrictEqual({ ok: true, value: control });
      await expect(readPlan()).resolves.toStrictEqual({ ok: false, error });
    });

    it('makes the runtime cache unavailable', async () => {
      const { readPlan } = await cacheWithAPlan();

      scriptFake({ control: 'runtime-cache.set-available', available: false });

      await expect(readPlan()).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'unavailable' },
      });
    });

    it('injects a fault into the statistics source, clears the faults and refreshes it', async () => {
      const source = fakeStatsSource();

      expect(
        scriptFake({ control: 'stats-source.inject', fault: { kind: 'outage', times: 1 } }),
      ).toStrictEqual({ ok: true, value: 'stats-source.inject' });
      await expect(source.checkHealth(CONTEXT)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'unavailable' },
      });
      scriptFake({ control: 'stats-source.inject', fault: { kind: 'outage', times: 1 } });
      scriptFake({ control: 'stats-source.clear-faults' });
      await expect(source.checkHealth(CONTEXT)).resolves.toMatchObject({ ok: true });
      scriptFake({ control: 'stats-source.refresh', at: '2026-11-20T04:30:00-05:00' });

      await expect(source.getPublication(CONTEXT, { knownVersion: null })).resolves.toMatchObject({
        ok: true,
        value: { kind: 'read', data: { refreshedAt: Date.UTC(2026, 10, 20, 9, 30) } },
      });
    });

    it('scripts the answer of a link, then forgets it', async () => {
      const check = fakeLinkCheck();

      scriptFake({ control: 'link-check.answer', url: ARTICLE, answer: { status: 404 } });
      await expect(check.probe(CONTEXT, PROBE)).resolves.toMatchObject({
        value: { verdict: 'not_found', status: 404 },
      });
      scriptFake({ control: 'link-check.reset' });

      await expect(check.probe(CONTEXT, PROBE)).resolves.toMatchObject({
        value: { verdict: 'reachable', status: 200 },
      });
    });

    it('[CL-TRV-12] scripts the access, the privacy and the next failure of the backup storage', async () => {
      const storage = fakeBackupStorage();
      const resetsAt = '2026-11-20T10:00:00Z';

      scriptFake({ control: 'backup-storage.set-private', private: false });
      await expect(storage.checkHealth(CONTEXT)).resolves.toMatchObject({
        ok: true,
        value: { private: false },
      });
      scriptFake({
        control: 'backup-storage.fail-next',
        operation: 'checkHealth',
        error: { kind: 'rate_limited' },
        rateLimitResetsAt: resetsAt,
      });
      await expect(storage.checkHealth(CONTEXT)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'rate_limited' },
        call: { rateLimitResetsAt: Date.UTC(2026, 10, 20, 10) },
      });
      scriptFake({ control: 'backup-storage.set-access', access: 'not_configured' });

      await expect(storage.checkHealth(CONTEXT)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'unauthorized', cause: 'not_configured' },
      });
    });

    it('fails the next call of an operation without a reset instant when none is given', async () => {
      scriptFake({
        control: 'backup-storage.fail-next',
        operation: 'list',
        error: { kind: 'unavailable' },
      });

      await expect(fakeBackupStorage().list(CONTEXT)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'unavailable' },
        call: { rateLimitResetsAt: null },
      });
    });

    it('interrupts the next upload and keeps the next deletion of the backup storage', async () => {
      const storage = fakeBackupStorage();
      const kept = await storedBackup('backup-2026-11-15.bin');

      scriptFake({ control: 'backup-storage.interrupt-next-upload' });
      await expect(
        storage.upload('backup-2026-11-22.bin', new Uint8Array([4, 5]), CONTEXT),
      ).resolves.toMatchObject({ ok: false, error: { kind: 'unavailable' } });
      scriptFake({ control: 'backup-storage.keep-next-deletion' });
      await expect(storage.delete(kept, CONTEXT)).resolves.toMatchObject({ ok: true });

      await expect(storage.list(CONTEXT)).resolves.toMatchObject({
        ok: true,
        value: [{ id: kept }, { name: 'backup-2026-11-22.bin' }],
      });
    });

    it.each([
      [
        { control: 'stats-source.explode' },
        [`command.control: Expected a control of a fake: ${CONTROLS.join(', ')}.`],
      ],
      [
        { control: 'runtime-cache.set-available' },
        ['command.available: Invalid input: expected boolean, received undefined'],
      ],
      [
        { control: 'stats-source.refresh', at: '2026-11-20' },
        ['command.at: Expected an ISO 8601 instant with its offset.'],
      ],
      [
        { control: 'link-check.answer', url: 'not a link', answer: 'timeout' },
        ['command.url: Invalid URL'],
      ],
      [
        'runtime-cache.lose-wake-plan',
        ['command: Invalid input: expected object, received string'],
      ],
    ])(
      'runs nothing for an invalid command %j, and says what is wrong',
      async (command, issues) => {
        const { readPlan } = await cacheWithAPlan();

        expect(scriptFake(command)).toStrictEqual({
          ok: false,
          error: { kind: 'invalid_command', issues },
        });
        await expect(readPlan()).resolves.toStrictEqual({
          ok: false,
          error: { kind: 'unreadable' },
        });
      },
    );
  });
});

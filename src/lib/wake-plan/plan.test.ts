import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { PLAN_KEY, PLAN_MAX_AGE_MS, TASK_KEYS } from './plan';

import type { PlanContent, WakeProbe } from './plan';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const COMPUTED_AT = toEpochMs(Date.UTC(2026, 10, 21, 9));
const MINUTE = 60_000;
const at = (minutes: number) => toEpochMs(COMPUTED_AT + minutes * MINUTE);

const PROBE: WakeProbe = {
  kind: 'stats-source-refresh',
  dueAt: at(360),
  state: { thresholdAt: at(300), version: 'W/"5f2c-18b9"' },
};

const CONTENT: PlanContent = {
  computedAt: COMPUTED_AT,
  entries: [
    { task: 'purge', dueAt: at(1140) },
    { task: 'link-check', dueAt: at(25) },
    { task: 'statistics-update', dueAt: at(360) },
  ],
  probes: [PROBE],
};

const UNREADABLE = { ok: false, error: { kind: 'unreadable' } };

/** The plan of deployment `dpl_first` as the cache would hold it, with `changes`. */
const stored = (changes: object) => ({ deploymentId: 'dpl_first', ...CONTENT, ...changes });

/** The wake plan as a deployment with `deploymentId` loads it, over the process's fake cache. */
async function deployment(deploymentId = '') {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', deploymentId);
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return { fake: processFakeRuntimeCache(), ...(await import('.')) };
}

describe('the wake plan', () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    onTestFinished(installFakeClock(fixedClock(COMPUTED_AT)));
  });

  describe('readPlan', () => {
    it('[TRV-25] gives a trusted plan with its earliest due instant, its entries and its probes', async () => {
      const { writePlan, readPlan } = await deployment('dpl_first');
      await writePlan(CONTENT);

      expect(await readPlan(at(10))).toStrictEqual({
        ok: true,
        plan: { deploymentId: 'dpl_first', ...CONTENT },
        earliestDueAt: at(25),
      });
    });

    it('[TRV-25] gives no earliest due instant to a plan in which no task is due', async () => {
      const { writePlan, readPlan } = await deployment('dpl_first');
      await writePlan({ ...CONTENT, entries: [] });

      const reading = await readPlan(at(10));

      expect(reading.ok && reading.earliestDueAt).toBeNull();
    });

    it('[TRV-31] says to check the database when the cache holds no plan', async () => {
      const { readPlan } = await deployment('dpl_first');

      expect(await readPlan(at(10))).toStrictEqual({ ok: false, error: { kind: 'missing' } });
    });

    it.each([
      ['a text', 'plan'],
      [
        'a plan without its probes',
        { deploymentId: 'dpl_first', computedAt: COMPUTED_AT, entries: [] },
      ],
      ['an unknown task', stored({ entries: [{ task: 'player-erasure', dueAt: at(5) }] })],
      ['an unknown probe', stored({ probes: [{ ...PROBE, kind: 'press-feeds' }] })],
      ['a field that the format does not know', stored({ playerName: 'Tobiah Wrenfield' })],
      ['a fraction of a millisecond', stored({ computedAt: COMPUTED_AT + 0.5 })],
      ['an instant before 1970', stored({ entries: [{ task: 'purge', dueAt: -1 }] })],
      ['an instant beyond the range of dates', stored({ computedAt: 8.64e15 + 1 })],
      [
        'a probe state that nests an object',
        stored({ probes: [{ ...PROBE, state: { chat: { id: 7 } } }] }),
      ],
      [
        'a probe text of 257 characters',
        stored({ probes: [{ ...PROBE, state: { v: 'v'.repeat(257) } }] }),
      ],
    ])('[TRV-31] says to check the database when the cache holds %s', async (_garbled, value) => {
      const { fake, readPlan } = await deployment('dpl_first');
      await fake.set(PLAN_KEY, value, 60);

      expect(await readPlan(at(10))).toStrictEqual(UNREADABLE);
    });

    it('[TRV-31] reads a probe text of 256 characters', async () => {
      const { writePlan, readPlan } = await deployment('dpl_first');
      await writePlan({ ...CONTENT, probes: [{ ...PROBE, state: { v: 'v'.repeat(256) } }] });

      const reading = await readPlan(at(10));

      expect(reading.ok).toBe(true);
    });

    it.each([
      ['another deployment', 'dpl_first', 'dpl_second'],
      ['a deployment with an id, read without one', 'dpl_first', ''],
      ['a deployment without an id, read with one', '', 'dpl_second'],
    ])(
      '[TRV-31] says to check the database for a plan written by %s',
      async (_writer, writer, reader) => {
        const { writePlan } = await deployment(writer);
        await writePlan(CONTENT);
        const { readPlan } = await deployment(reader);

        expect(await readPlan(at(10))).toStrictEqual({ ok: false, error: { kind: 'foreign' } });
      },
    );

    it('[TRV-31] trusts a plan for an hour on either side of its computation, to the millisecond, then says to check the database', async () => {
      const { writePlan, readPlan } = await deployment('dpl_first');
      await writePlan(CONTENT);

      const ages = [PLAN_MAX_AGE_MS, PLAN_MAX_AGE_MS + 1, -PLAN_MAX_AGE_MS, -PLAN_MAX_AGE_MS - 1];
      const readings = await Promise.all(
        ages.map(async (age) => {
          const reading = await readPlan(toEpochMs(COMPUTED_AT + age));
          return reading.ok;
        }),
      );

      expect(readings).toStrictEqual([true, false, true, false]);
      expect(await readPlan(at(61))).toStrictEqual({ ok: false, error: { kind: 'stale' } });
    });

    it('[TRV-31] without a deployment id from the host, writes plans that carry none, which a new deployment trusts until the hourly check', async () => {
      const { fake, writePlan } = await deployment('');
      await writePlan(CONTENT);
      const held = await fake.get(PLAN_KEY);
      const { readPlan } = await deployment('');
      const beforeTheCheck = await readPlan(at(59));

      expect(held).toStrictEqual({ ok: true, value: { deploymentId: null, ...CONTENT } });
      expect(beforeTheCheck.ok).toBe(true);
      expect(await readPlan(at(61))).toStrictEqual({ ok: false, error: { kind: 'stale' } });
    });

    it('[TRV-31] says to check the database while the cache fails', async () => {
      const { fake, writePlan, readPlan } = await deployment('dpl_first');
      await writePlan(CONTENT);

      fake.setAvailable(false);

      expect(await readPlan(at(10))).toStrictEqual({ ok: false, error: { kind: 'unavailable' } });
    });
  });

  describe('writePlan', () => {
    it('[TRV-25] replaces the whole plan, as the end of each database pass does', async () => {
      const { writePlan, readPlan } = await deployment('dpl_first');
      await writePlan(CONTENT);
      const later: PlanContent = {
        computedAt: at(30),
        entries: [{ task: 'backup', dueAt: at(2000) }],
        probes: [],
      };

      await writePlan(later);

      expect(await readPlan(at(40))).toStrictEqual({
        ok: true,
        plan: { deploymentId: 'dpl_first', ...later },
        earliestDueAt: at(2000),
      });
    });

    it('[TRV-31] answers unavailable while the cache fails', async () => {
      const { fake, writePlan } = await deployment('dpl_first');
      fake.setAvailable(false);

      expect(await writePlan(CONTENT)).toStrictEqual({ ok: false, error: { kind: 'unavailable' } });
    });

    it('[TRV-66] admits only task keys, instants, counts, versions and hashes, never personal data', async () => {
      const { writePlan, readPlan } = await deployment('dpl_first');

      // @ts-expect-error -- a plan names its tasks by their keys alone
      await writePlan({ ...CONTENT, entries: [{ task: 'Tobiah Wrenfield', dueAt: at(5) }] });
      const withName = await readPlan(at(10));
      // @ts-expect-error -- a probe's state holds numbers and short texts, never an object
      await writePlan({ ...CONTENT, probes: [{ ...PROBE, state: { chat: { id: 7 } } }] });
      const withObject = await readPlan(at(10));

      expect([withName, withObject]).toStrictEqual([UNREADABLE, UNREADABLE]);
    });
  });

  describe('TASK_KEYS', () => {
    it('[TRV-25] holds the key of every scheduled task of the module map, and no other', () => {
      const map = readFileSync(
        path.join(import.meta.dirname, '../../../docs/engineering/module-map.md'),
        'utf8',
      );
      const section = map.slice(map.indexOf('## 4. Scheduled tasks'), map.indexOf('## 5. Ports'));
      const keys = Array.from(section.matchAll(/^\| `([a-z-]+)` +\|/gmu), ([, key]) => key);

      expect(keys).toHaveLength(TASK_KEYS.length);
      expect(new Set(keys)).toStrictEqual(new Set(TASK_KEYS));
    });
  });
});

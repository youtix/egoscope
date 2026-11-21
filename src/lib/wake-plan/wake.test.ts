import fc from 'fast-check';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { PLAN_KEY, TASK_KEYS } from './plan';

import type { PlanContent } from './plan';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const COMPUTED_AT = toEpochMs(Date.UTC(2026, 10, 21, 9));
const MINUTE = 60_000;
const at = (minutes: number) => toEpochMs(COMPUTED_AT + minutes * MINUTE);

// The minute, after COMPUTED_AT, of the earliest due instant of CONTENT.
const CONTENT_EARLIEST = 180;

const CONTENT: PlanContent = {
  computedAt: COMPUTED_AT,
  entries: [
    { task: 'purge', dueAt: at(1140) },
    { task: 'link-check', dueAt: at(CONTENT_EARLIEST) },
  ],
  probes: [{ kind: 'telegram-polling', dueAt: at(5), state: { codeHash: 'a'.repeat(64) } }],
};

const UNWRITTEN = { ok: true, written: false };
const WRITTEN = { ok: true, written: true };
const UNAVAILABLE = { ok: false, error: { kind: 'unavailable' } };

/** The wake plan as deployment `dpl_first` loads it, over the process's fake cache. */
async function deployment() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_first');
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return { fake: processFakeRuntimeCache(), ...(await import('.')) };
}

/**
 * The earliest due minute of the plan of CONTENT after `calls`, in their order, and how
 * many of them came before every earlier one: the writes that `wakeAt` makes.
 */
function replay(calls: readonly Readonly<{ minutes: number }>[]) {
  let earliest = CONTENT_EARLIEST;
  let writes = 0;
  for (const { minutes } of calls) {
    if (minutes >= earliest) {
      continue;
    }
    earliest = minutes;
    writes += 1;
  }
  return { earliest, writes };
}

describe('the wake-up calls', () => {
  beforeEach(() => {
    const clock = fixedClock(at(10));
    vi.stubGlobal(PROCESS_FAKE, undefined);
    onTestFinished(installFakeClock(clock));
  });

  describe('wakeAt', () => {
    it('[TRV-25] moves the task to the earlier instant, keeping when the plan was computed and its probes', async () => {
      const { writePlan, wakeAt, readPlan } = await deployment();
      await writePlan(CONTENT);

      const outcome = await wakeAt(at(30), 'link-check');

      expect(outcome).toStrictEqual(WRITTEN);
      expect(await readPlan(at(10))).toStrictEqual({
        ok: true,
        plan: {
          deploymentId: 'dpl_first',
          computedAt: COMPUTED_AT,
          entries: [
            { task: 'purge', dueAt: at(1140) },
            { task: 'link-check', dueAt: at(30) },
          ],
          probes: CONTENT.probes,
        },
        earliestDueAt: at(30),
      });
    });

    it('[TRV-25] adds a task that the plan did not hold yet', async () => {
      const { writePlan, wakeAt, readPlan } = await deployment();
      await writePlan(CONTENT);

      await wakeAt(at(12), 'recalculation');
      const reading = await readPlan(at(10));

      expect(reading.ok && reading.plan.entries).toStrictEqual([
        ...CONTENT.entries,
        { task: 'recalculation', dueAt: at(12) },
      ]);
    });

    it.each([
      ['at the earliest due instant', 180],
      ['after it', 600],
    ])('[TRV-25] writes nothing for an instant %s', async (_when, minutes) => {
      const { fake, writePlan, wakeAt } = await deployment();
      await writePlan(CONTENT);

      expect(await wakeAt(at(minutes), 'recalculation')).toStrictEqual(UNWRITTEN);
      expect(fake.writeCount(PLAN_KEY)).toBe(1);
    });

    it('[TRV-25] keeps the earliest due instant whatever the order of the calls, writing only for each new earliest', async () => {
      const { fake, writePlan, wakeAt, readPlan } = await deployment();
      const calls = fc.array(
        fc.record({
          minutes: fc.integer({ min: 0, max: 400 }),
          task: fc.constantFrom(...TASK_KEYS),
        }),
        { minLength: 1, size: 'medium' },
      );
      const ordered = calls.chain((list) =>
        fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length })),
      );

      await fc.assert(
        fc.asyncProperty(ordered, async ([inOrder, shuffled]) => {
          for (const order of [inOrder, shuffled]) {
            await writePlan(CONTENT);
            const writesBefore = fake.writeCount(PLAN_KEY);
            for (const { minutes, task } of order) {
              await wakeAt(at(minutes), task);
            }
            const reading = await readPlan(at(10));
            const expected = replay(order);

            expect(reading.ok && reading.earliestDueAt).toBe(at(expected.earliest));
            expect(fake.writeCount(PLAN_KEY) - writesBefore).toBe(expected.writes);
          }
        }),
      );
    });

    it('[TRV-25] writes nothing inside a database pass, whose end rewrites the plan', async () => {
      const { fake, writePlan, wakeAt, duringPass } = await deployment();
      await writePlan(CONTENT);

      const outcome = await duringPass(async () => wakeAt(at(11), 'recalculation'));

      expect(outcome).toStrictEqual(UNWRITTEN);
      expect(fake.writeCount(PLAN_KEY)).toBe(1);
    });

    it('[TRV-25] still writes for a request that the same instance serves while a pass runs', async () => {
      const { writePlan, wakeAt, duringPass, readPlan } = await deployment();
      await writePlan(CONTENT);
      const { promise: passMayGoOn, resolve: letPassGoOn } = Promise.withResolvers<undefined>();

      const passing = duringPass(async () => {
        await passMayGoOn;
        return wakeAt(at(11), 'recalculation');
      });
      const outside = await wakeAt(at(20), 'statistics-fetch');
      letPassGoOn(undefined);

      expect([outside, await passing]).toStrictEqual([WRITTEN, UNWRITTEN]);
      const reading = await readPlan(at(10));
      expect(reading.ok && reading.earliestDueAt).toBe(at(20));
    });

    it('[TRV-31] writes nothing without a plan, since the next tick checks the database anyway', async () => {
      const { fake, wakeAt } = await deployment();

      expect(await wakeAt(at(11), 'recalculation')).toStrictEqual(UNWRITTEN);
      expect(fake.writeCount(PLAN_KEY)).toBe(0);
    });

    it('[TRV-31] writes nothing to a plan computed more than an hour ago, which sends the next tick to the database', async () => {
      const { fake, writePlan, wakeAt } = await deployment();
      await writePlan({ ...CONTENT, computedAt: at(-51) });

      expect(await wakeAt(at(11), 'recalculation')).toStrictEqual(UNWRITTEN);
      expect(fake.writeCount(PLAN_KEY)).toBe(1);
    });

    it('[TRV-31] answers unavailable while the cache fails, and when it refuses the write', async () => {
      const { fake, writePlan, wakeAt } = await deployment();
      await writePlan(CONTENT);

      fake.setWritable(false);
      const refused = await wakeAt(at(11), 'recalculation');
      fake.setAvailable(false);
      const unread = await wakeAt(at(11), 'recalculation');

      expect([refused, unread]).toStrictEqual([UNAVAILABLE, UNAVAILABLE]);
    });

    it('[TRV-31] tolerates a write lost to a racing writer: the hourly check brings the work an hour late at most', async () => {
      const { fake, writePlan, wakeAt, readPlan } = await deployment();
      await writePlan(CONTENT);

      fake.raceNextWrite(PLAN_KEY);
      const outcome = await wakeAt(at(11), 'recalculation');
      const afterRace = await readPlan(at(12));
      const atHourlyCheck = await readPlan(toEpochMs(COMPUTED_AT + 60 * MINUTE + 1));

      expect(outcome).toStrictEqual(WRITTEN);
      expect(afterRace.ok && afterRace.earliestDueAt).toBe(at(180));
      expect(atHourlyCheck).toStrictEqual({ ok: false, error: { kind: 'stale' } });
    });
  });

  describe('invalidate', () => {
    it('[TRV-25] [TRV-27] drops the plan, so that the next tick checks the database', async () => {
      const { writePlan, invalidate, readPlan } = await deployment();
      await writePlan(CONTENT);

      expect(await invalidate()).toStrictEqual({ ok: true });
      expect(await readPlan(at(10))).toStrictEqual({ ok: false, error: { kind: 'missing' } });
    });

    it('[TRV-31] answers unavailable while the cache fails', async () => {
      const { fake, invalidate } = await deployment();
      fake.setAvailable(false);

      expect(await invalidate()).toStrictEqual(UNAVAILABLE);
    });
  });
});

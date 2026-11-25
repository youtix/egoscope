import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, getDb, getDirectDb } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, noQueryDatabase } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { ProbeOutcome, ScheduledTask } from './types';
import type { NoQueryDatabase } from '@/lib/testing';
import type { WakeProbe } from '@/lib/wake-plan';

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: vi.fn(),
  getDirectDb: vi.fn(),
}));

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
const AT = toEpochMs(Date.UTC(2026, 10, 25, 14));
const at = (minutes: number) => toEpochMs(AT + minutes * MINUTE);
const PROBE: WakeProbe = { kind: 'stats-source-refresh', dueAt: at(-1), state: { version: 'v1' } };
const NEXT_PROBE: WakeProbe = { ...PROBE, dueAt: at(60) };

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return {
    fake: processFakeRuntimeCache(),
    wakePlan: await import('@/lib/wake-plan'),
    ...(await import('.')),
  };
}

/** A statistics update whose guard's probe gives `outcome`, and notes each call. */
function guarded(outcome: ProbeOutcome, calls: WakeProbe[]): ScheduledTask {
  return {
    key: 'statistics-update',
    schedules: [{ kind: 'daily', times: () => ['15:00'] }],
    readyGuard: {
      probe: 'stats-source-refresh',
      call: async (probe) => {
        await Promise.resolve();
        calls.push(probe);
        return outcome;
      },
      check: async () => {
        await Promise.resolve();
        return { ready: true };
      },
      cutoff: (dueAt) => dueAt,
    },
    run: async () => {
      await Promise.resolve();
      return { kind: 'done', result: 'succeeded' };
    },
  };
}

describe('the decision of a tick', () => {
  let stub: NoQueryDatabase;

  beforeEach(() => {
    stub = noQueryDatabase();
    vi.mocked(getDb).mockResolvedValue({ ok: true, db: stub.db });
    vi.mocked(getDirectDb).mockResolvedValue({ ok: true, db: stub.db });
    return installFakeClock(fixedClock(AT));
  });

  it('[TRV-13] asks for the database when the plan is missing, unreadable, foreign, older than an hour or due, without a query', async () => {
    const { decide, fake, wakePlan } = await load();
    const plan = {
      computedAt: at(-10),
      entries: [{ task: 'purge', dueAt: at(5) }],
      probes: [],
    } as const;
    const decisions = [await decide([], AT)];
    await fake.set('wake:plan', 'garbled', 60);
    decisions.push(await decide([], AT));
    await fake.set('wake:plan', { ...plan, deploymentId: 'dpl_other' }, 60);
    decisions.push(await decide([], AT));
    await wakePlan.writePlan({ ...plan, computedAt: at(-61) });
    decisions.push(await decide([], AT));
    await wakePlan.writePlan({ ...plan, entries: [{ task: 'purge', dueAt: AT }] });
    decisions.push(await decide([], AT));
    await wakePlan.writePlan(plan);
    decisions.push(await decide([], AT));
    expect(decisions).toStrictEqual([
      { kind: 'database', reason: 'missing' },
      { kind: 'database', reason: 'unreadable' },
      { kind: 'database', reason: 'foreign' },
      { kind: 'database', reason: 'stale' },
      { kind: 'database', reason: 'due' },
      { kind: 'idle' },
    ]);
    expect(stub.attempts()).toStrictEqual([]);
  });

  it("[TRV-13] [CL-TRV-23] makes a due probe without the database: one that finds nothing moves to its next call and keeps the plan's computedAt", async () => {
    const { decide, wakePlan } = await load();
    const calls: WakeProbe[] = [];
    const entries = [{ task: 'statistics-update', dueAt: at(300) }] as const;
    await wakePlan.writePlan({ computedAt: at(-10), entries, probes: [PROBE] });
    const registry = [guarded({ found: false, next: NEXT_PROBE }, calls)];
    const decisions = [await decide(registry, AT), await decide(registry, at(5))];
    expect(decisions).toStrictEqual([{ kind: 'idle' }, { kind: 'idle' }]);
    expect(calls).toStrictEqual([PROBE]);
    expect(await wakePlan.readPlan(AT)).toMatchObject({
      ok: true,
      plan: { computedAt: at(-10), entries, probes: [NEXT_PROBE] },
    });
    expect(stub.attempts()).toStrictEqual([]);
  });

  it('[TRV-13] [CL-TRV-23] asks for the database when a due probe finds work', async () => {
    const { decide, wakePlan } = await load();
    await wakePlan.writePlan({ computedAt: at(-10), entries: [], probes: [PROBE] });
    expect(await decide([guarded({ found: true }, [])], AT)).toStrictEqual({
      kind: 'database',
      reason: 'probe',
    });
    expect(stub.attempts()).toStrictEqual([]);
  });

  it('[TRV-13] allows one database pass an hour per server instance while the cache fails', async () => {
    const { decide, fake } = await load();
    fake.setAvailable(false);
    const decisions = [
      await decide([], AT),
      await decide([], at(5)),
      await decide([], at(59)),
      await decide([], at(60)),
    ];
    expect(decisions).toStrictEqual([
      { kind: 'database', reason: 'unavailable' },
      { kind: 'idle' },
      { kind: 'idle' },
      { kind: 'database', reason: 'unavailable' },
    ]);
    expect(stub.attempts()).toStrictEqual([]);
  });

  it(
    '[TRV-13] takes a plan missing right after this instance wrote it for a failing cache, and falls back to one pass an hour',
    { timeout: DATABASE_TEST_TIMEOUT_MS },
    async () => {
      const { decide, execute, fake } = await load();
      const decisions = [await decide([], AT), await decide([], at(1))];
      const database = await createTestDatabase();
      try {
        await execute(database.db, []);
      } finally {
        await database.close();
      }
      fake.evict('wake:plan');
      decisions.push(await decide([], at(5)), await decide([], at(61)));
      expect(decisions).toStrictEqual([
        { kind: 'database', reason: 'missing' },
        { kind: 'database', reason: 'missing' },
        { kind: 'idle' },
        { kind: 'database', reason: 'missing' },
      ]);
      expect(stub.attempts()).toStrictEqual([]);
    },
  );
});

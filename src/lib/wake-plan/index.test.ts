// A 30-day month of the cache's writes, driven through the module's public API on the
// fake cache, which counts them (module map §1.9, cache budget; hosting sheet).
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { WakeProbe } from './plan';
import type { EpochMs } from '@/lib/time';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const INSTANCE_COUNTERS = Symbol.for('egoscope.wake-plan.instance-counters');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
// The simulation's resolution: every event below falls on a multiple of it.
const STEP = 30 * SECOND;
const START = toEpochMs(Date.UTC(2026, 10, 1));
const HASH = 'f'.repeat(64);
const WRITE_ALLOWANCE = 200_000;

// The month's events, by their offset from the start of the month.
const isPass = (offset: number) => offset % (30 * MINUTE) === 0;
const isPrimaryTick = (offset: number) => offset % (5 * MINUTE) === 0;
const isBackstopTick = (offset: number) => (offset - 150 * SECOND) % (15 * MINUTE) === 0;
// Ten owner actions a day that give a queue work due a minute later.
const isOwnerAction = (offset: number) => offset % (144 * MINUTE) === MINUTE;
// The statistics probe, hourly from 13:02 to 17:02 UTC: 150 calls in the month.
const isStatsProbe = (offset: number) => {
  const ofDay = offset % DAY;
  return ofDay % HOUR === 2 * MINUTE && ofDay >= 13 * HOUR && ofDay < 18 * HOUR;
};
// Telegram polling while a link code is pending, at 10:07 and 10:12 on 25 days: 50 calls.
const isTelegramProbe = (offset: number) =>
  offset < 25 * DAY && [10 * HOUR + 7 * MINUTE, 10 * HOUR + 12 * MINUTE].includes(offset % DAY);
// One stray refused call a day, at 03:33:30.
const isStrayRefusal = (offset: number) => offset % DAY === 3 * HOUR + 33 * MINUTE + 30 * SECOND;
// The worst case: one instance under a refused call every 30 seconds, all month long.
const isStreamedRefusal = (offset: number) => offset % (30 * SECOND) === 0;

/** The wake plan of one server instance of deployment `dpl_month`, over the process's fake cache. */
async function server() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_month');
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return { fake: processFakeRuntimeCache(), ...(await import('.')) };
}

type WakePlanModule = Awaited<ReturnType<typeof server>>;

/** A database pass at `at`: it drains the counters and rewrites the plan in full. */
async function pass(wakePlan: WakePlanModule, at: EpochMs): Promise<void> {
  await wakePlan.duringPass(async () => {
    await wakePlan.drainCounters();
    await wakePlan.writePlan({
      computedAt: at,
      entries: [{ task: 'purge', dueAt: toEpochMs(at + 30 * MINUTE) }],
      probes: [],
    });
  });
}

/** A probe's call at `at`, without the database: its call counted, then its next instant written. */
async function probe(wakePlan: WakePlanModule, at: EpochMs, isStats: boolean): Promise<void> {
  await wakePlan.bumpCounter({ probeCall: isStats ? 'statsSource' : 'telegram' }, at)();
  const reading = await wakePlan.readPlan(at);
  if (!reading.ok) {
    return;
  }
  const { computedAt, entries } = reading.plan;
  const next: WakeProbe = isStats
    ? { kind: 'stats-source-refresh', dueAt: toEpochMs(at + HOUR), state: { version: 'v7' } }
    : { kind: 'telegram-polling', dueAt: toEpochMs(at + 5 * MINUTE), state: { codeHash: HASH } };
  await wakePlan.writePlan({ computedAt, entries, probes: [next] });
}

/** The events of one step of the month, in the order a tick meets them. */
async function step(wakePlan: WakePlanModule, offset: number, hasStream: boolean): Promise<void> {
  const at = toEpochMs(START + offset);
  if (isPass(offset)) {
    await pass(wakePlan, at);
  }
  if (isPrimaryTick(offset)) {
    await wakePlan.recordTick('cloudflare', at);
  }
  if (isBackstopTick(offset)) {
    await wakePlan.recordTick('vercel-cron/1.0', at);
  }
  if (isOwnerAction(offset)) {
    await wakePlan.wakeAt(toEpochMs(at + MINUTE), 'statistics-fetch');
  }
  if (isStatsProbe(offset) || isTelegramProbe(offset)) {
    await probe(wakePlan, at, isStatsProbe(offset));
  }
  if (isStrayRefusal(offset) || (hasStream && isStreamedRefusal(offset))) {
    await wakePlan.bumpCounter({ attempt: 'refused_trigger' }, at)();
  }
}

/** The cache's writes in a simulated month, by entry and in all. */
async function simulateMonth(hasStream: boolean) {
  const clock = fixedClock(START);
  onTestFinished(installFakeClock(clock));
  const wakePlan = await server();
  for (let offset = 0; offset < MONTH; offset += STEP) {
    await step(wakePlan, offset, hasStream);
    clock.advance(STEP);
  }
  const { fake } = wakePlan;
  return {
    ticks: fake.writeCount('tick:last'),
    plan: fake.writeCount('wake:plan'),
    counters: fake.writeCount('wake:counters'),
    total: fake.writeCount(),
  };
}

describe('the cache writes of a month', { timeout: 120_000 }, () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    vi.stubGlobal(INSTANCE_COUNTERS, undefined);
  });

  it('[TRV-04] stay near 14,000 in an ordinary month: a write per accepted tick and per pass, the owner actions, the probes and the counters', async () => {
    const writes = await simulateMonth(false);

    expect(writes).toStrictEqual({
      // 8,640 primary and 2,880 backstop ticks, none a duplicate.
      ticks: 11_520,
      // 1,440 passes, 300 owner actions that moved the plan earlier, 200 probe moves.
      plan: 1940,
      // 230 writes for 200 probe calls and 30 stray refusals, and 205 drains.
      counters: 435,
      total: 13_895,
    });
  });

  it('[TRV-04] [CL-TRV-25] stay well under the 200,000 of the allowance under a stream of refused calls on one instance all month', async () => {
    const writes = await simulateMonth(true);

    expect(writes).toStrictEqual({
      ticks: 11_520,
      plan: 1940,
      // One write a minute, 43,200, and a drain at each pass but the first.
      counters: 44_639,
      total: 58_099,
    });
    expect(writes.total / WRITE_ALLOWANCE).toBeLessThan(0.3);
  });
});

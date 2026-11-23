// A 30-day month of the cache's traffic, driven through the module's public API on the
// fake cache, which meters its reads and writes in units of 8 KB as the host does
// (module map §1.9, cache budget; hosting sheet).
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
const READ_ALLOWANCE = 1_000_000;
const WRITE_ALLOWANCE = 200_000;

// The month's events, by their offset from the start of the month.
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
const strayRefusals = (offset: number) =>
  offset % DAY === 3 * HOUR + 33 * MINUTE + 30 * SECOND ? 1 : 0;
// A stream on one instance all month long: a refused call every 30 seconds.
const streamedRefusals = () => 1;
// A busy instance all month long: 23 refused calls a minute, what the invocation
// allowance of 1,000,000 a month sustains, 12 in the first half of each minute, 11 in
// the second.
const BUSY_PER_MINUTE = 23;
const busyRefusals = (offset: number) =>
  offset % MINUTE === 0 ? Math.ceil(BUSY_PER_MINUTE / 2) : Math.floor(BUSY_PER_MINUTE / 2);

/** A month: how often a database pass drains the counters, and the refused calls of each step. */
type Month = Readonly<{ passEvery: number; refusals: (offset: number) => number }>;

const ORDINARY: Month = { passEvery: 30 * MINUTE, refusals: strayRefusals };

// The units of a month with one instance under a stream of refused calls and a pass
// every 30 minutes, the same whether a call comes every 30 seconds or 23 a minute: a
// write a minute, its read before it, and a drain at each pass but the first, each of
// one unit, the 690 attempts of half an hour weighing under 8 KB.
const BUSY_EVERY_30_MINUTES = {
  reads: { ticks: 11_520, plan: 12_020, counters: 44_640, total: 68_180 },
  writes: { ticks: 11_520, plan: 1940, counters: 44_639, total: 58_099 },
};

/** The wake plan of one server instance of deployment `dpl_month`, over the process's fake cache. */
async function server() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_month');
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return { fake: processFakeRuntimeCache(), ...(await import('.')) };
}

type WakePlanModule = Awaited<ReturnType<typeof server>>;

/** A database pass at `at`: it drains the counters and rewrites the plan, due at the next pass. */
async function pass(wakePlan: WakePlanModule, at: EpochMs, passEvery: number): Promise<void> {
  await wakePlan.duringPass(async () => {
    await wakePlan.drainCounters();
    await wakePlan.writePlan({
      computedAt: at,
      entries: [{ task: 'purge', dueAt: toEpochMs(at + passEvery) }],
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

/** A tick from `caller` at `at`: recorded, then, when accepted, the wake plan read. */
async function tick(wakePlan: WakePlanModule, caller: string, at: EpochMs): Promise<void> {
  const recording = await wakePlan.recordTick(caller, at);
  if (recording.ok && !recording.isDuplicate) {
    await wakePlan.readPlan(at);
  }
}

/** The events of one step of `month`, in the order a tick meets them. */
async function step(wakePlan: WakePlanModule, offset: number, month: Month): Promise<void> {
  const at = toEpochMs(START + offset);
  if (offset % month.passEvery === 0) {
    await pass(wakePlan, at, month.passEvery);
  }
  if (isPrimaryTick(offset)) {
    await tick(wakePlan, 'cloudflare', at);
  }
  if (isBackstopTick(offset)) {
    await tick(wakePlan, 'vercel-cron/1.0', at);
  }
  if (isOwnerAction(offset)) {
    await wakePlan.wakeAt(toEpochMs(at + MINUTE), 'statistics-fetch');
  }
  if (isStatsProbe(offset) || isTelegramProbe(offset)) {
    await probe(wakePlan, at, isStatsProbe(offset));
  }
  // The refused calls of the step, a second apart.
  for (let index = 0; index < month.refusals(offset); index += 1) {
    await wakePlan.bumpCounter({ attempt: 'refused_trigger' }, toEpochMs(at + index * SECOND))();
  }
}

/** The units that `units` gives, by entry and in all. */
const byEntry = (units: (key?: string) => number) => ({
  ticks: units('tick:last'),
  plan: units('wake:plan'),
  counters: units('wake:counters'),
  total: units(),
});

/** The units that the cache's reads and writes cost in `month`, by entry and in all. */
async function simulateMonth(month: Month) {
  const clock = fixedClock(START);
  onTestFinished(installFakeClock(clock));
  const wakePlan = await server();
  for (let offset = 0; offset < MONTH; offset += STEP) {
    await step(wakePlan, offset, month);
    clock.advance(STEP);
  }
  const { fake } = wakePlan;
  return { reads: byEntry(fake.readUnits), writes: byEntry(fake.writeUnits) };
}

describe('the cache units of a month', { timeout: 300_000 }, () => {
  beforeEach(() => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    vi.stubGlobal(INSTANCE_COUNTERS, undefined);
  });

  it('[TRV-04] stay far under both allowances in an ordinary month: the ticks, the passes, the owner actions, the probes and the counters', async () => {
    const units = await simulateMonth(ORDINARY);

    expect(units).toStrictEqual({
      reads: {
        // 8,640 primary and 2,880 backstop ticks, none a duplicate.
        ticks: 11_520,
        // A read at each accepted tick, at each of the 300 owner actions and 200 probe calls.
        plan: 12_020,
        // A read before each of the 230 writes, and one at each of the 1,440 passes.
        counters: 1670,
        total: 25_210,
      },
      writes: {
        ticks: 11_520,
        // 1,440 passes, 300 owner actions that moved the plan earlier, 200 probe moves.
        plan: 1940,
        // 230 writes for 200 probe calls and 30 stray refusals, and 205 drains.
        counters: 435,
        total: 13_895,
      },
    });
  });

  it('[TRV-04] [CL-TRV-25] stay under both allowances under a refused call every 30 seconds on one instance all month', async () => {
    const units = await simulateMonth({
      ...ORDINARY,
      refusals: (offset) => strayRefusals(offset) + streamedRefusals(),
    });

    expect(units).toStrictEqual(BUSY_EVERY_30_MINUTES);
  });

  it.each([
    ['every 30 minutes', 30 * MINUTE, BUSY_EVERY_30_MINUTES],
    [
      'every hour',
      HOUR,
      {
        // Every read and write of the counters costs one unit: 1,000 attempts weigh under 8 KB.
        reads: { ticks: 11_520, plan: 12_020, counters: 43_920, total: 67_460 },
        // 720 passes, the owner actions and the probes; a write a minute and 719 drains.
        writes: { ticks: 11_520, plan: 1220, counters: 43_919, total: 56_659 },
      },
    ],
  ])(
    '[TRV-04] [CL-TRV-25] stay under both allowances with 23 refused calls a minute on one instance all month and a pass %s',
    async (_interval, passEvery, expected) => {
      const units = await simulateMonth({
        passEvery,
        refusals: (offset) => strayRefusals(offset) + busyRefusals(offset),
      });

      expect(units).toStrictEqual(expected);
      expect(units.reads.total).toBeLessThan(READ_ALLOWANCE);
      expect(units.writes.total).toBeLessThan(WRITE_ALLOWANCE);
    },
  );
});

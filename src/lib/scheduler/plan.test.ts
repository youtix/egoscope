import { gt } from 'drizzle-orm';
import fc from 'fast-check';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, parameterOverrides, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import {
  fixedClock,
  installFakeClock,
  localOccurrenceInstant,
  toEpochMs,
  userDay,
} from '@/lib/time';

import type { ScheduledTask, TaskSchedule, Weekday } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
const DAY = 86_400_000;
/** An instant of 2026 in UTC, by its month, its day and its hour, minutes as a fraction. */
const utc = (month: number, day: number, hours: number) =>
  toEpochMs(Date.UTC(2026, month - 1, day) + hours * 3_600_000);
// Monday 23 November 2026, from which the oracle counts weekdays.
const A_MONDAY = Date.UTC(2026, 10, 23) / DAY;
const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const ZONES = ['Europe/Paris', 'America/New_York', 'Australia/Lord_Howe', 'UTC'] as const;
// The clock changes of 2026 in those zones, around which the instants cluster.
const CLOCK_CHANGES = [
  utc(3, 8, 7),
  utc(3, 29, 1),
  utc(4, 4, 15),
  utc(10, 3, 15.5),
  utc(10, 25, 1),
  utc(11, 1, 6),
];

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  return { wakePlan: await import('@/lib/wake-plan'), ...(await import('.')) };
}

/** A call that answers `value` on a later turn, as a real one does. */
const answer =
  <T>(value: T) =>
  async (): Promise<T> => {
    await Promise.resolve();
    return value;
  };

const task = (key: ScheduledTask['key'], schedules: readonly TaskSchedule[]): ScheduledTask => ({
  key,
  schedules,
  run: answer({ kind: 'done', result: 'succeeded' }),
});

type Timed = Readonly<{ weekday: Weekday; times: readonly string[] }>;

const scheduleOf = ({ weekday, times }: Timed): TaskSchedule =>
  weekday === 'every_day'
    ? { kind: 'daily', times: () => times }
    : { kind: 'weekly', occurrence: () => ({ weekday, time: times[0] ?? '00:00' }) };

/** Every occurrence of `timed` in `zone` on the days around `at`, by brute force. */
function occurrencesAround(at: EpochMs, timed: Timed, zone: string): readonly EpochMs[] {
  const firstDay = Math.floor(at / DAY) - 20;
  return Array.from({ length: 31 }, (_, index) => firstDay + index).flatMap((dayNumber) => {
    const day = userDay(toEpochMs(dayNumber * DAY), 'UTC');
    const weekday = WEEKDAYS[(((dayNumber - A_MONDAY) % 7) + 7) % 7];
    return timed.weekday === 'every_day' || timed.weekday === weekday
      ? timed.times.map((time) => localOccurrenceInstant(day, time, zone))
      : [];
  });
}

/** The next due instant the oracle expects, from the last scheduled occurrence, if any. */
function expectedDue({
  at,
  timed,
  zone,
  last,
}: Readonly<{
  at: EpochMs;
  timed: Timed;
  zone: string;
  last: EpochMs | null;
}>) {
  const all = occurrencesAround(at, timed, zone);
  const latest = Math.max(...all.filter((instant) => instant <= at));
  if (last === null) {
    return latest;
  }
  const next = Math.min(...all.filter((instant) => instant > last));
  return next > at ? next : latest;
}

const time = fc
  .tuple(fc.oneof(fc.constant(2), fc.integer({ min: 0, max: 23 })), fc.integer({ min: 0, max: 59 }))
  .map(([hour, minute]) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);

const timed: fc.Arbitrary<Timed> = fc.oneof(
  fc.record({
    weekday: fc.constant('every_day' as const),
    times: fc.array(time, { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    weekday: fc.constantFrom(...WEEKDAYS),
    times: fc.array(time, { minLength: 1, maxLength: 1 }),
  }),
);

const instant = fc.oneof(
  fc.integer({ min: Date.UTC(2026, 0, 15), max: Date.UTC(2026, 11, 15) }),
  fc
    .tuple(fc.constantFrom(...CLOCK_CHANGES), fc.integer({ min: -2 * DAY, max: 2 * DAY }))
    .map(([change, offset]) => change + offset),
);

describe('the wake plan', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeAll(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  const reset = async (zone: string) => {
    await db.delete(taskRuns).where(gt(taskRuns.id, 0));
    await db
      .insert(parameterOverrides)
      .values({ parameterKey: 'display.timeZone', value: zone })
      .onConflictDoUpdate({ target: parameterOverrides.parameterKey, set: { value: zone } });
  };

  const insertSuccess = async (key: ScheduledTask['key'], dueAt: EpochMs) => {
    await db.insert(taskRuns).values({
      taskKey: key,
      trigger: 'scheduled',
      dueAt: new Date(dueAt),
      startedAt: new Date(dueAt),
      finishedAt: new Date(dueAt + MINUTE),
      result: 'succeeded',
      passId: '00000000-0000-4000-8000-000000000001',
    });
  };

  it("[TRV-27] [CL-TRV-18] gives each timed task its next due instant in the owner's zone, and the plan's earliest instant is never later than any task's", async () => {
    const { computeWakePlan, wakePlan } = await load();
    /** A task's schedule, and how long before the plan's instant its last run came, if it ran. */
    type Side = Readonly<{ timed: Timed; lastOffset: number | null }>;
    const side: fc.Arbitrary<Side> = fc.record({
      timed,
      lastOffset: fc.option(fc.integer({ min: 1, max: 9 * DAY })),
    });
    const cases = fc.record({
      rawAt: instant,
      zone: fc.constantFrom(...ZONES),
      purge: side,
      backup: side,
    });
    await fc.assert(
      fc.asyncProperty(cases, async ({ rawAt, zone, purge, backup }) => {
        const at = toEpochMs(rawAt);
        const restore = installFakeClock(fixedClock(at));
        try {
          await reset(zone);
          const lastOf = async (key: ScheduledTask['key'], { timed: own, lastOffset }: Side) => {
            if (lastOffset === null) {
              return null;
            }
            const before = toEpochMs(at - lastOffset);
            const last = toEpochMs(
              Math.max(...occurrencesAround(before, own, zone).filter((one) => one <= before)),
            );
            await insertSuccess(key, last);
            return last;
          };
          const registry = [
            task('purge', [scheduleOf(purge.timed)]),
            task('backup', [scheduleOf(backup.timed)]),
          ];
          const expected = [
            {
              task: 'purge',
              dueAt: expectedDue({
                at,
                timed: purge.timed,
                zone,
                last: await lastOf('purge', purge),
              }),
            },
            {
              task: 'backup',
              dueAt: expectedDue({
                at,
                timed: backup.timed,
                zone,
                last: await lastOf('backup', backup),
              }),
            },
          ];
          const plan = await computeWakePlan(db, registry, at);
          expect(plan).toStrictEqual({ computedAt: at, entries: expected, probes: [] });
          await wakePlan.writePlan(plan);
          expect(await wakePlan.readPlan(at)).toMatchObject({
            ok: true,
            earliestDueAt: Math.min(...expected.map(({ dueAt }) => dueAt)),
          });
        } finally {
          restore();
        }
      }),
      { numRuns: 60 },
    );
  });

  it('[CA-TRV-07] keeps a collection set at 22:00 Paris time at 22:00 Paris time across the change to winter time', async () => {
    const { computeWakePlan } = await load();
    await reset('Europe/Paris');
    await insertSuccess('news-collection', utc(10, 24, 20));
    const collection = task('news-collection', [{ kind: 'daily', times: () => ['22:00'] }]);
    const plan = await computeWakePlan(db, [collection], utc(10, 24, 21));
    expect(plan.entries).toStrictEqual([{ task: 'news-collection', dueAt: utc(10, 25, 21) }]);
  });

  it("[TRV-27] moves the slots with the owner's time zone", async () => {
    const { computeWakePlan } = await load();
    await reset('America/New_York');
    await insertSuccess('news-collection', utc(10, 24, 20));
    const collection = task('news-collection', [{ kind: 'daily', times: () => ['22:00'] }]);
    const plan = await computeWakePlan(db, [collection], utc(10, 24, 21));
    expect(plan.entries).toStrictEqual([{ task: 'news-collection', dueAt: utc(10, 25, 2) }]);
  });

  it("[TRV-26] [CL-TRV-08] makes a chained task due at its parent's success, and an owner-computed one at the instant its owner gives", async () => {
    const { computeWakePlan } = await load();
    await reset('Europe/Paris');
    const at = utc(11, 25, 12);
    await insertSuccess('statistics-update', toEpochMs(at - 10 * MINUTE));
    const registry = [
      task('game-tracking', [{ kind: 'chained', after: ['statistics-update', 'recalculation'] }]),
      task('recalculation', [{ kind: 'computed', nextDueAt: answer(toEpochMs(at + 5 * MINUTE)) }]),
      task('link-check', [{ kind: 'computed', nextDueAt: answer(null) }]),
      task('purge', [{ kind: 'daily', times: () => [] }]),
    ];
    const before = await computeWakePlan(db, registry, at);
    expect(before.entries).toStrictEqual([
      { task: 'game-tracking', dueAt: toEpochMs(at - 9 * MINUTE) },
      { task: 'recalculation', dueAt: toEpochMs(at + 5 * MINUTE) },
    ]);
    await insertSuccess('game-tracking', toEpochMs(at - 8 * MINUTE));
    const after = await computeWakePlan(db, registry, at);
    expect(after.entries).toStrictEqual([
      { task: 'recalculation', dueAt: toEpochMs(at + 5 * MINUTE) },
    ]);
  });

  it('[TRV-30] [CL-TRV-23] makes a run to resume or a requested run due at once, and a run waiting for the source due at its cut-off with its probe', async () => {
    const { computeWakePlan } = await load();
    await reset('Europe/Paris');
    const at = utc(11, 25, 15);
    const passId = '00000000-0000-4000-8000-000000000002';
    const probe = {
      kind: 'stats-source-refresh',
      dueAt: toEpochMs(at + 60 * MINUTE),
      state: {},
    } as const;
    let isReady = false;
    const update: ScheduledTask = {
      ...task('statistics-update', [{ kind: 'daily', times: () => ['15:00'] }]),
      readyGuard: {
        probe: 'stats-source-refresh',
        call: answer({ found: true }),
        check: async () => {
          await Promise.resolve();
          return isReady ? { ready: true } : { ready: false, probe };
        },
        cutoff: (dueAt) => toEpochMs(dueAt + 5 * 60 * MINUTE),
      },
    };
    await db.insert(taskRuns).values([
      {
        taskKey: 'statistics-update',
        trigger: 'scheduled',
        dueAt: new Date(at - 60 * MINUTE),
        startedAt: new Date(at - 60 * MINUTE),
        passId,
      },
      {
        taskKey: 'purge',
        trigger: 'scheduled',
        dueAt: new Date(at - DAY),
        startedAt: new Date(at - DAY),
        progressAt: new Date(at - DAY),
        passId,
      },
      {
        taskKey: 'backup',
        trigger: 'scheduled',
        dueAt: new Date(at - DAY),
        startedAt: new Date(at - DAY),
        finishedAt: new Date(at - DAY),
        result: 'interrupted',
        passId,
      },
      { taskKey: 'link-check', trigger: 'on_demand', dueAt: new Date(at - MINUTE) },
    ]);
    const later = task('purge', [{ kind: 'daily', times: () => ['04:00'] }]);
    const registry = [
      update,
      later,
      { ...later, key: 'backup' },
      { ...later, key: 'link-check' },
    ] as const;
    expect(await computeWakePlan(db, registry, at)).toStrictEqual({
      computedAt: at,
      entries: [
        { task: 'statistics-update', dueAt: toEpochMs(at + 4 * 60 * MINUTE) },
        { task: 'purge', dueAt: at },
        { task: 'backup', dueAt: at },
        { task: 'link-check', dueAt: at },
      ],
      probes: [probe],
    });
    isReady = true;
    const ready = await computeWakePlan(db, registry, at);
    expect(ready.entries[0]).toStrictEqual({
      task: 'statistics-update',
      dueAt: at,
    });
  });
});

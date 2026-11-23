import fc from 'fast-check';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, databaseActivityMinutes } from '@/lib/db';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { activeMs, computeEstimate } from './compute';

import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// Tuesday 24 November 2026, 10:00 UTC.
const AT = toEpochMs(Date.UTC(2026, 10, 24, 10));
const MINUTE = 60_000;
const MONTH = { start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 11, 1) };

// The minutes that one active minute keeps the compute up: itself and the five after it.
const TAIL = [0, 1, 2, 3, 4, 5];

/** The minutes covered by an active minute `index`, counted in minutes. */
const coveredBy = (index: number) => TAIL.map((step) => index + step);

/** `count` minutes ten minutes apart from `from`. */
const spaced = (count: number, from: number) =>
  Array.from({ length: count }, (_, index) => from + index * 10 * MINUTE);

/** A copy of the module as a new server instance loads it, with its own id and no minute written. */
async function newInstance() {
  vi.resetModules();
  return import('./compute');
}

describe('the database compute estimate', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(AT);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  const minutes = async () => {
    const rows = await db
      .select()
      .from(databaseActivityMinutes)
      .orderBy(databaseActivityMinutes.minuteAt, databaseActivityMinutes.instanceId);
    return rows.map(({ minuteAt, instanceId }) => ({ minute: minuteAt.getTime(), instanceId }));
  };
  const record = async (...at: readonly number[]) =>
    db.insert(databaseActivityMinutes).values(
      at.map((minute, index) => ({
        minuteAt: new Date(minute),
        instanceId: `instance-${String(index % 2)}`,
      })),
    );

  it('[TRV-03] [TRV-08] writes at most one row a minute per server instance, and no query for the same minute again', async () => {
    const first = await newInstance();
    await first.recordDatabaseActivity(db);
    clock.advance(59_000);
    const insert = vi.spyOn(db, 'insert');
    await first.recordDatabaseActivity(db);
    expect(insert).not.toHaveBeenCalled();
    insert.mockRestore();
    const second = await newInstance();
    await second.recordDatabaseActivity(db);
    clock.advance(1000);
    await first.recordDatabaseActivity(db);

    const rows = await minutes();
    expect(rows.map(({ minute }) => minute)).toStrictEqual([AT, AT, AT + MINUTE]);
    const instances = rows.slice(0, 2).map(({ instanceId }) => instanceId);
    expect(new Set(instances).size).toBe(2);
    expect(instances).toContain(rows[2]?.instanceId);
  });

  it('[TRV-03] [TRV-08] sums the union of the minutes of every instance, each extended by five minutes, at 0.25 CU over the calendar month', async () => {
    await record(
      Date.UTC(2026, 9, 31, 23, 59),
      Date.UTC(2026, 10, 24, 10),
      Date.UTC(2026, 10, 24, 10),
      Date.UTC(2026, 10, 24, 10, 1),
      Date.UTC(2026, 10, 24, 10, 30),
      Date.UTC(2026, 10, 30, 23, 59),
    );

    const estimate = await computeEstimate(db, AT);

    expect(estimate).toStrictEqual({
      computeHours: (14 / 60) * 0.25,
      limitHours: null,
      month: MONTH,
      warning: false,
    });
  });

  it('[TRV-05] warns at the warning share of quotas.database.computeHoursPerMonth', async () => {
    const saved = await db.transaction(async (tx) =>
      setParam(tx, { key: 'quotas.database.computeHoursPerMonth', value: 1, expectedVersion: 0 }),
    );
    expect(saved.ok).toBe(true);
    await record(...spaced(31, Date.UTC(2026, 10, 2)));
    const below = await computeEstimate(db, AT);
    await record(...spaced(1, Date.UTC(2026, 10, 3)));
    const atShare = await computeEstimate(db, AT);

    expect([below.computeHours, below.warning]).toStrictEqual([(186 / 60) * 0.25, false]);
    expect([atShare.computeHours, atShare.limitHours, atShare.warning]).toStrictEqual([
      0.8,
      1,
      true,
    ]);
  });

  it('[TRV-03] counts each minute of compute once, whatever the minutes recorded around it', () => {
    const end = 600;
    const recorded = fc.uniqueArray(fc.integer({ min: 0, max: end }), {
      minLength: 1,
      maxLength: 200,
      size: 'medium',
    });
    fc.assert(
      fc.property(recorded, (indexes) => {
        const sorted = indexes.toSorted((left, right) => left - right);
        const covered = new Set(sorted.flatMap((index) => coveredBy(index)));
        const inMonth = [...covered].filter((index) => index < end).length;

        expect(
          activeMs(
            sorted.map((index) => index * MINUTE),
            end * MINUTE,
          ),
        ).toBe(inMonth * MINUTE);
      }),
    );
  });
});

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, databaseActivityMinutes, databaseSizeSamples } from '@/lib/db';
import { listOpen } from '@/lib/incidents';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { databaseVolume, recordDatabaseSize } from './volume';

import type { Database } from '@/lib/db';
import type { OverridableKey, ParamValue } from '@/lib/params';
import type { FixedClock } from '@/lib/time';

// Wednesday 25 November 2026, 03:00 UTC, the 04:00 purge in Paris.
const PURGE = toEpochMs(Date.UTC(2026, 10, 25, 3));
const DAY = toIsoDate('2026-11-25');
const MEGABYTE = 1_000_000;

describe('the database volume', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;
  const versions = new Map<string, number>();

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(PURGE);
    versions.clear();
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  const enter = async <K extends OverridableKey>(key: K, value: ParamValue<K>) => {
    const expectedVersion = versions.get(key) ?? 0;
    const saved = await db.transaction(async (tx) => setParam(tx, { key, value, expectedVersion }));
    expect(saved.ok).toBe(true);
    versions.set(key, expectedVersion + 1);
  };
  const size = async () => {
    const [row] = await db
      .select({ bytes: sql<number>`pg_database_size(current_database())`.mapWith(Number) })
      .from(sql`(select 1) as measure`);
    return row?.bytes ?? 0;
  };
  const sample = async (day = DAY) => db.transaction(async (tx) => recordDatabaseSize(tx, day));
  const open = async () => {
    const opened = await listOpen(db);
    return opened.map(({ kind, serviceRole }) => ({ kind, serviceRole }));
  };

  it('[TRV-07] [TRV-08] gives the volume used against the capacity entered, warned at the volume warning share', async () => {
    const used = await size();
    const notEntered = await databaseVolume(db);
    await enter('quotas.database.capacityMegabytes', Math.ceil(used / MEGABYTE / 0.8));
    const atShare = await databaseVolume(db);
    await enter('quotas.database.capacityMegabytes', Math.ceil(used / MEGABYTE / 0.8) + 2);
    const below = await databaseVolume(db);

    expect(notEntered).toStrictEqual({ usedBytes: used, capacityBytes: null, warning: false });
    expect(atShare.warning).toBe(atShare.usedBytes * 100 >= (atShare.capacityBytes ?? 0) * 80);
    expect([below.capacityBytes, below.warning]).toStrictEqual([
      (Math.ceil(used / MEGABYTE / 0.8) + 2) * MEGABYTE,
      false,
    ]);
  });

  it('[TRV-07] [TRV-08] samples the size once a day and opens the volume warning at the share of the capacity, closed once below', async () => {
    await enter('quotas.database.capacityMegabytes', 1);
    const full = await sample();
    const warned = await open();
    await enter('quotas.database.capacityMegabytes', 1_000_000);
    const again = await sample();

    expect(full.warning).toBe(true);
    expect(warned).toStrictEqual([{ kind: 'database_volume_warning', serviceRole: null }]);
    expect(await open()).toStrictEqual([]);
    expect(await db.select().from(databaseSizeSamples)).toStrictEqual([
      { sampledOn: DAY, sizeBytes: again.usedBytes },
    ]);
  });

  it("[TRV-05] gives the quota warning of the month's compute estimate with the daily sample, ended once the month renews", async () => {
    await enter('quotas.database.computeHoursPerMonth', 1);
    await db.insert(databaseActivityMinutes).values(
      Array.from({ length: 40 }, (_, index) => ({
        minuteAt: new Date(Date.UTC(2026, 10, 2) + index * 600_000),
        instanceId: 'instance-a',
      })),
    );
    await sample();
    const warned = await open();
    clock.advance(Date.UTC(2026, 11, 1, 3) - PURGE);
    await sample(toIsoDate('2026-12-01'));

    expect(warned).toStrictEqual([{ kind: 'quota_warning', serviceRole: 'database' }]);
    expect(await open()).toStrictEqual([]);
  });
});

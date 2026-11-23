import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import {
  createTestDatabase,
  databaseActivityMinutes,
  databaseSizeSamples,
  quotaUsage,
} from '@/lib/db';
import { toEpochMs, toIsoDate } from '@/lib/time';

import { purgeExpired } from './purge';

import type { Database } from '@/lib/db';

// Wednesday 25 November 2026, 03:00 UTC, the 04:00 purge in Paris.
const PURGE = toEpochMs(Date.UTC(2026, 10, 25, 3));
const DAY = 86_400_000;

describe('the purge of the quota records', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(database.close);
  }, 60_000);

  it('[TRV-08] [TRV-48] deletes the periods and the size samples older than the retention, and the activity minutes before the previous month', async () => {
    const usage = (start: number) => ({
      limitKey: 'quotas.statsSource.requestsPerDay',
      periodStartAt: new Date(start),
      used: 1,
    });
    await db
      .insert(quotaUsage)
      .values([usage(PURGE - 31 * DAY), usage(PURGE - 30 * DAY), usage(PURGE - DAY)]);
    await db.insert(databaseSizeSamples).values([
      { sampledOn: toIsoDate('2026-10-25'), sizeBytes: 1 },
      { sampledOn: toIsoDate('2026-10-26'), sizeBytes: 2 },
    ]);
    await db.insert(databaseActivityMinutes).values([
      { minuteAt: new Date(Date.UTC(2026, 8, 30, 23, 59)), instanceId: 'instance-a' },
      { minuteAt: new Date(Date.UTC(2026, 9, 1)), instanceId: 'instance-a' },
      { minuteAt: new Date(Date.UTC(2026, 10, 24)), instanceId: 'instance-a' },
    ]);

    const deleted = await db.transaction(async (tx) =>
      purgeExpired(tx, { now: PURGE, retentionDays: 30, timeZone: 'Europe/Paris' }),
    );

    expect(deleted).toBe(3);
    const periods = await db.select().from(quotaUsage).orderBy(asc(quotaUsage.periodStartAt));
    expect(periods.map((row) => row.periodStartAt.getTime())).toStrictEqual([
      PURGE - 30 * DAY,
      PURGE - DAY,
    ]);
    expect(await db.select().from(databaseSizeSamples)).toStrictEqual([
      { sampledOn: '2026-10-26', sizeBytes: 2 },
    ]);
    const minutes = await db
      .select()
      .from(databaseActivityMinutes)
      .orderBy(asc(databaseActivityMinutes.minuteAt));
    expect(minutes.map((row) => row.minuteAt.getTime())).toStrictEqual([
      Date.UTC(2026, 9, 1),
      Date.UTC(2026, 10, 24),
    ]);
  });

  it('[TRV-48] deletes nothing when every record is within its retention', async () => {
    await db
      .insert(databaseSizeSamples)
      .values({ sampledOn: toIsoDate('2026-11-24'), sizeBytes: 1 });

    const deleted = await db.transaction(async (tx) =>
      purgeExpired(tx, { now: PURGE, retentionDays: 30, timeZone: 'Europe/Paris' }),
    );

    expect(deleted).toBe(0);
    expect(await db.select().from(databaseSizeSamples)).toHaveLength(1);
  });
});

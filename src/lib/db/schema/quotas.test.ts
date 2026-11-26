import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { createTestDatabase } from '../test-database';
import { databaseActivityMinutes, databaseSizeSamples, quotaHolds, quotaUsage } from './quotas';

import type { Database } from '../types';

// The UTC day of the statistics source's courtesy ceiling, and the next one.
const DAY_START = new Date(toEpochMs(Date.UTC(2026, 10, 18)));
const NEXT_DAY_START = new Date(toEpochMs(Date.UTC(2026, 10, 19)));
// A minute of database activity.
const MINUTE = new Date(toEpochMs(Date.UTC(2026, 10, 18, 3, 1)));
// A count past the range of an integer column, 2,147,483,647.
const BEYOND_INTEGER = 3_000_000_000;

/** The error of a query that a primary key or a unique constraint refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the quota tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('counts the usage of a limit in each period instance from zero, past the range of an integer', async () => {
    await db
      .insert(quotaUsage)
      .values({ limitKey: 'quotas.statsSource.megabytesPerDay', periodStartAt: DAY_START });
    const counted = await db.select().from(quotaUsage);

    await db.update(quotaUsage).set({ used: BEYOND_INTEGER }).where(eq(quotaUsage.id, 1));

    expect(counted).toStrictEqual([
      {
        id: 1,
        limitKey: 'quotas.statsSource.megabytesPerDay',
        periodStartAt: DAY_START,
        used: 0,
        warningGivenAt: null,
        reachedAt: null,
        resetsAt: null,
      },
    ]);
    await expect(db.select({ used: quotaUsage.used }).from(quotaUsage)).resolves.toStrictEqual([
      { used: BEYOND_INTEGER },
    ]);
  });

  it('keeps one count per limit and period instance', async () => {
    await db.insert(quotaUsage).values([
      { limitKey: 'quotas.statsSource.requestsPerDay', periodStartAt: DAY_START },
      { limitKey: 'quotas.statsSource.requestsPerDay', periodStartAt: NEXT_DAY_START },
      { limitKey: 'quotas.statsSource.megabytesPerDay', periodStartAt: DAY_START },
    ]);

    const again = db
      .insert(quotaUsage)
      .values({ limitKey: 'quotas.statsSource.requestsPerDay', periodStartAt: DAY_START });

    await expect(again).rejects.toMatchObject(duplicateOf('quota_usage_key'));
  });

  it('[TRV-04] keeps each hold of an estimate as a row of its own, several on one count, beyond the range of an integer', async () => {
    const held = { limitKey: 'quotas.statsSource.megabytesPerDay', periodStartAt: DAY_START };
    await db.insert(quotaHolds).values([
      { ...held, amount: BEYOND_INTEGER, heldAt: MINUTE },
      { ...held, amount: 1, heldAt: MINUTE },
    ]);

    const withoutInstant = db.insert(quotaHolds).values({ ...held, amount: 1, heldAt: sql`null` });

    await expect(db.select().from(quotaHolds)).resolves.toStrictEqual([
      { id: 1, ...held, amount: BEYOND_INTEGER, heldAt: MINUTE },
      { id: 2, ...held, amount: 1, heldAt: MINUTE },
    ]);
    await expect(withoutInstant).rejects.toMatchObject({
      cause: { code: '23502', column: 'held_at' },
    });
  });

  it('records at most one active minute per server instance', async () => {
    await db.insert(databaseActivityMinutes).values([
      { minuteAt: MINUTE, instanceId: 'fra1-a' },
      { minuteAt: MINUTE, instanceId: 'fra1-b' },
    ]);

    const again = db
      .insert(databaseActivityMinutes)
      .values({ minuteAt: MINUTE, instanceId: 'fra1-a' });

    await expect(again).rejects.toMatchObject(
      duplicateOf('database_activity_minutes_minute_at_instance_id_pk'),
    );
  });

  it("samples the database's size once a day of the owner's calendar", async () => {
    await db.insert(databaseSizeSamples).values({ sampledOn: '2026-11-18', sizeBytes: 52_428_800 });

    const again = db.insert(databaseSizeSamples).values({ sampledOn: '2026-11-18', sizeBytes: 1 });

    await expect(db.select().from(databaseSizeSamples)).resolves.toStrictEqual([
      { sampledOn: '2026-11-18', sizeBytes: 52_428_800 },
    ]);
    await expect(again).rejects.toMatchObject(duplicateOf('database_size_samples_pkey'));
  });
});

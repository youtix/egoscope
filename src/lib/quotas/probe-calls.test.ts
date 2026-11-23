import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, quotaUsage } from '@/lib/db';
import { listOpen } from '@/lib/incidents';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { recordProbeCalls } from './probe-calls';

import type { Database } from '@/lib/db';

// Tuesday 24 November 2026, 19:00 UTC, the probes of the daily statistics update before it.
const PASS = toEpochMs(Date.UTC(2026, 10, 24, 19));
const HOUR = 3_600_000;

describe('the calls of the database-free probes', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(installFakeClock(fixedClock(PASS)));
    return database.close;
  }, 60_000);

  const usage = async () => {
    const rows = await db.select().from(quotaUsage).orderBy(asc(quotaUsage.periodStartAt));
    return rows.map((row) => ({
      key: row.limitKey,
      start: row.periodStartAt.getTime(),
      used: row.used,
    }));
  };

  it("[TRV-03] [CL-TRV-12] counts each probe of the stats source as one file request in the UTC day of its own instant, and Telegram's as none", async () => {
    await db.transaction(async (tx) =>
      recordProbeCalls(tx, [
        { service: 'statsSource', at: toEpochMs(Date.UTC(2026, 10, 23, 23, 30)) },
        { service: 'telegram', at: toEpochMs(PASS - 3 * HOUR) },
        { service: 'statsSource', at: toEpochMs(PASS - 2 * HOUR) },
        { service: 'statsSource', at: toEpochMs(PASS - HOUR) },
      ]),
    );

    expect(await usage()).toStrictEqual([
      { key: 'quotas.statsSource.requestsPerDay', start: Date.UTC(2026, 10, 23), used: 1 },
      { key: 'quotas.statsSource.requestsPerDay', start: Date.UTC(2026, 10, 24), used: 2 },
    ]);
  });

  it('[TRV-05] gives the warning of the stats source when its probes bring its count to the warning share', async () => {
    const saved = await db.transaction(async (tx) =>
      setParam(tx, { key: 'quotas.statsSource.requestsPerDay', value: 5, expectedVersion: 0 }),
    );
    expect(saved.ok).toBe(true);
    const probes = [1, 2, 3, 4].map((hours) => ({
      service: 'statsSource' as const,
      at: toEpochMs(PASS - hours * HOUR),
    }));

    await db.transaction(async (tx) => recordProbeCalls(tx, probes.slice(0, 3)));
    const below = await listOpen(db);
    await db.transaction(async (tx) => recordProbeCalls(tx, probes.slice(3)));

    expect(below).toStrictEqual([]);
    expect(await listOpen(db)).toMatchObject([
      { kind: 'quota_warning', serviceRole: 'stats_source' },
    ]);
  });

  it('[TRV-03] writes nothing when the probes made no call of a counted limit', async () => {
    await db.transaction(async (tx) => recordProbeCalls(tx, [{ service: 'telegram', at: PASS }]));
    await db.transaction(async (tx) => recordProbeCalls(tx, []));

    expect(await usage()).toStrictEqual([]);
  });
});

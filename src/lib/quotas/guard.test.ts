import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, journalEntries, quotaUsage } from '@/lib/db';
import { listOpen } from '@/lib/incidents';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { nextAvailableAt, withQuota } from './guard';

import type { Estimate } from './check';
import type { QuotaService } from './limits';
import type { OutcomeOf } from './readers';
import type { Database } from '@/lib/db';
import type { OverridableKey, ParamValue } from '@/lib/params';
import type { FixedClock } from '@/lib/time';

// Tuesday 24 November 2026, 14:00 UTC, 15:00 in Paris.
const START = toEpochMs(Date.UTC(2026, 10, 24, 14));
const NEXT_UTC_DAY = toEpochMs(Date.UTC(2026, 10, 25));
const HOUR = 3_600_000;

const statsCall = (fileRequests: number, bytesReceived = 0): OutcomeOf['statsSource'] => ({
  ok: true,
  value: null,
  call: { httpRequests: fileRequests, bytesReceived, fileRequests },
});
const statsRefusal = (retryAfterMs: number | null): OutcomeOf['statsSource'] => ({
  ok: false,
  error: { kind: 'rate_limited', retryAfterMs },
  call: { httpRequests: 1, bytesReceived: 0, fileRequests: 0 },
});
const githubCall = (resetsAt: number, isRefused = false): OutcomeOf['backupStorage'] => {
  const meta = {
    requests: 1,
    bytesSent: 0,
    bytesReceived: 0,
    rateLimitResetsAt: toEpochMs(resetsAt),
  };
  return isRefused
    ? { ok: false, error: { kind: 'rate_limited' }, meta }
    : { ok: true, value: null, meta };
};

describe('the quota guard', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;
  const versions = new Map<string, number>();

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(START);
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
  const guarded = async <S extends QuotaService>(
    service: S,
    outcome: OutcomeOf[S],
    options: Readonly<{ priority?: boolean; estimate?: Estimate }> = {},
  ) => {
    let wasCalled = false;
    const request = {
      service,
      estimate: options.estimate ?? { requests: 1 },
      priority: options.priority ?? false,
    };
    const result = await withQuota(db, request, async () => {
      wasCalled = true;
      await Promise.resolve();
      return outcome;
    });
    return { called: wasCalled, result };
  };
  const incidents = async () => {
    const opened = await listOpen(db);
    return opened.map(({ kind, serviceRole, quotaCauses }) => ({ kind, serviceRole, quotaCauses }));
  };
  const journalKeys = async () => {
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    return entries.map(({ messageKey }) => messageKey);
  };
  const usage = async () => {
    const rows = await db.select().from(quotaUsage).orderBy(asc(quotaUsage.id));
    return rows.map((row) => ({
      key: row.limitKey,
      start: row.periodStartAt.getTime(),
      used: row.used,
      reached: row.reachedAt?.getTime() ?? null,
      resetsAt: row.resetsAt?.getTime() ?? null,
    }));
  };

  it('[CA-TRV-02] [TRV-04] [TRV-05] warns at 800 calls of 1,000, then makes no call that day once 1,000 are made and opens the incident', async () => {
    await enter('quotas.statsSource.requestsPerDay', 1000);
    await enter('games.quotaReserveShare', 0);

    await guarded('statsSource', statsCall(799));
    const below = await incidents();
    await guarded('statsSource', statsCall(1));
    const atShare = await incidents();
    await guarded('statsSource', statsCall(199));
    await guarded('statsSource', statsCall(1));
    const refused = await guarded('statsSource', statsCall(1), { priority: true });

    expect([below, atShare]).toStrictEqual([
      [],
      [{ kind: 'quota_warning', serviceRole: 'stats_source', quotaCauses: [] }],
    ]);
    expect(refused).toStrictEqual({
      called: false,
      result: { ok: false, error: { kind: 'deferred', availableAt: NEXT_UTC_DAY } },
    });
    expect(await incidents()).toStrictEqual([
      { kind: 'quota_warning', serviceRole: 'stats_source', quotaCauses: [] },
      { kind: 'quota_reached', serviceRole: 'stats_source', quotaCauses: ['limit_reached'] },
    ]);
    expect(await journalKeys()).toStrictEqual(
      expect.arrayContaining(['warning_opened', 'incident_opened']),
    );
    expect(await usage()).toStrictEqual([
      {
        key: 'quotas.statsSource.requestsPerDay',
        start: Date.UTC(2026, 10, 24),
        used: 1000,
        reached: START,
        resetsAt: NEXT_UTC_DAY,
      },
    ]);
  });

  it('[TRV-05] [CL-TRV-11] [STA-39] closes the stats source incident and its warning when its requests resume in the next UTC day', async () => {
    await enter('quotas.statsSource.requestsPerDay', 1000);
    await enter('games.quotaReserveShare', 0);
    await guarded('statsSource', statsCall(1000));
    clock.advance(NEXT_UTC_DAY - START);

    const resumed = await guarded('statsSource', statsCall(1));

    expect(resumed.called).toBe(true);
    expect(await incidents()).toStrictEqual([]);
    const keys = await journalKeys();
    expect(keys.filter((key) => key === 'incident_closed')).toHaveLength(2);
  });

  it('[STA-39] keeps the reserve for priority calls and opens the incident when other calls stop before it', async () => {
    await enter('quotas.statsSource.requestsPerDay', 200);
    await guarded('statsSource', statsCall(180));

    const career = await guarded('statsSource', statsCall(1));
    const schedule = await guarded('statsSource', statsCall(1), { priority: true });

    expect(career.called).toBe(false);
    expect(schedule.called).toBe(true);
    expect(await incidents()).toContainEqual({
      kind: 'quota_reached',
      serviceRole: 'stats_source',
      quotaCauses: ['limit_reached'],
    });
  });

  it('[CA-TRV-03] [TRV-06] stops its calls for the period after a refusal for quota at the 600th of 1,000 and opens an incident that invites a check of the terms', async () => {
    await enter('quotas.statsSource.requestsPerDay', 1000);
    await guarded('statsSource', statsCall(599));

    const refusal = await guarded('statsSource', statsRefusal(null));
    const after = await guarded('statsSource', statsCall(1), { priority: true });

    expect(refusal.called).toBe(true);
    expect(after).toStrictEqual({
      called: false,
      result: { ok: false, error: { kind: 'deferred', availableAt: NEXT_UTC_DAY } },
    });
    expect(await incidents()).toStrictEqual([
      { kind: 'quota_reached', serviceRole: 'stats_source', quotaCauses: ['refused_before_limit'] },
    ]);
    expect(await usage()).toContainEqual({
      key: 'quotas.statsSource.requestsPerDay',
      start: Date.UTC(2026, 10, 24),
      used: 599,
      reached: START,
      resetsAt: NEXT_UTC_DAY,
    });
  });

  it('[TRV-06] [CL-TRV-12] holds the stats source only until the retry instant its refusal gives', async () => {
    await enter('quotas.statsSource.requestsPerDay', 1000);
    await guarded('statsSource', statsRefusal(90_000));

    const early = await guarded('statsSource', statsCall(1));
    clock.advance(90_000);
    const later = await guarded('statsSource', statsCall(1));

    expect(early.result).toStrictEqual({
      ok: false,
      error: { kind: 'deferred', availableAt: START + 90_000 },
    });
    expect(later.called).toBe(true);
    expect(await incidents()).toStrictEqual([]);
  });

  it('[CL-TRV-12] counts the calls of a limit not entered and never defers them, and the refusal of TRV-06 still applies', async () => {
    await guarded('statsSource', statsCall(5000, 9_000_000_000));
    const counted = await guarded('statsSource', statsCall(1));

    expect(counted.called).toBe(true);
    expect(await usage()).toMatchObject([
      { key: 'quotas.statsSource.requestsPerDay', used: 5001 },
      { key: 'quotas.statsSource.megabytesPerDay', used: 9_000_000_000 },
    ]);
    await guarded('statsSource', statsRefusal(null));
    expect(await incidents()).toStrictEqual([
      { kind: 'quota_reached', serviceRole: 'stats_source', quotaCauses: ['refused_before_limit'] },
    ]);
  });

  it('[TRV-04] gives the instant the service may be called again, now when nothing holds it back', async () => {
    await enter('quotas.statsSource.megabytesPerDay', 2000);

    expect(await nextAvailableAt(db, 'statsSource')).toBe(START);
    await guarded('statsSource', statsCall(1, 2_000_000_000));
    expect(await nextAvailableAt(db, 'statsSource')).toBe(NEXT_UTC_DAY);
  });

  it('[TRV-06] [CL-TRV-11] keeps the refusal before the limit of the backup storage open until a full period passes without one', async () => {
    const reset = START + HOUR / 2;
    await guarded('backupStorage', githubCall(reset, true));
    const held = await guarded('backupStorage', githubCall(reset));
    clock.advance(HOUR / 2);
    await guarded('backupStorage', githubCall(START + 2 * HOUR));
    const stillOpen = await incidents();
    clock.advance(HOUR);
    await guarded('backupStorage', githubCall(START + 2 * HOUR));

    expect(held.result).toStrictEqual({
      ok: false,
      error: { kind: 'deferred', availableAt: reset },
    });
    expect(stillOpen).toStrictEqual([
      {
        kind: 'quota_reached',
        serviceRole: 'backup_storage',
        quotaCauses: ['refused_before_limit'],
      },
    ]);
    expect(await incidents()).toStrictEqual([]);
  });

  it('[TRV-06] [CL-TRV-11] closes the refusal before the limit once the owner saves a new value for that limit', async () => {
    const reset = START + HOUR / 2;
    await enter('quotas.backupStorage.requestsPerHour', 5000);
    await guarded('backupStorage', githubCall(reset, true));
    clock.advance(HOUR / 2);
    await guarded('backupStorage', githubCall(START + 2 * HOUR));
    const beforeSave = await incidents();
    await enter('quotas.backupStorage.requestsPerHour', 4000);
    await guarded('backupStorage', githubCall(START + 2 * HOUR));

    expect(beforeSave).toHaveLength(1);
    expect(await incidents()).toStrictEqual([]);
  });

  it('[TRV-03] [CL-TRV-12] counts the backup storage in the hourly window that its x-ratelimit-reset header reports, without deferring on its count', async () => {
    await enter('quotas.backupStorage.requestsPerHour', 1);
    await guarded('backupStorage', githubCall(START + HOUR / 4));
    const second = await guarded('backupStorage', githubCall(START + HOUR / 4));
    clock.advance(HOUR / 4);
    await guarded('backupStorage', githubCall(START + HOUR));

    expect(second.called).toBe(true);
    expect(await usage()).toStrictEqual([
      {
        key: 'quotas.backupStorage.requestsPerHour',
        start: START,
        used: 2,
        reached: null,
        resetsAt: START + HOUR / 4,
      },
      {
        key: 'quotas.backupStorage.requestsPerHour',
        start: START + HOUR / 4,
        used: 1,
        reached: null,
        resetsAt: START + HOUR,
      },
    ]);
  });

  it('[TRV-04] defers a backup file above the size limit of the storage, which no reset makes room for', async () => {
    await enter('quotas.backupStorage.maxFileMegabytes', 2048);

    const large = await guarded('backupStorage', githubCall(START + HOUR), {
      estimate: { requests: 1, bytes: 2_100_000_000 },
    });

    expect(large).toStrictEqual({
      called: false,
      result: { ok: false, error: { kind: 'deferred', availableAt: null } },
    });
    expect(await incidents()).toStrictEqual([
      { kind: 'quota_reached', serviceRole: 'backup_storage', quotaCauses: ['limit_reached'] },
    ]);
  });
});

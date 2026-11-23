import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, databaseActivityMinutes } from '@/lib/db';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { withQuota } from './guard';
import { usageReport } from './report';

import type { LimitKey } from './limits';
import type { ModelCallMetadata, OutcomeOf } from './readers';
import type { QuotaStatus, UsageLine } from './report';
import type { Database } from '@/lib/db';
import type { Lot, OverridableKey, ParamValue } from '@/lib/params';
import type { FixedClock } from '@/lib/time';

// Tuesday 24 November 2026, 10:00 UTC, 11:00 in Paris.
const AT = toEpochMs(Date.UTC(2026, 10, 24, 10));
const PARIS = 'Europe/Paris';
const SECOND = 1000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

/** A provider's call that answers `outcome` on a later turn. */
const answering =
  <O>(outcome: O) =>
  async (): Promise<O> => {
    await Promise.resolve();
    return outcome;
  };

const statsCall = (fileRequests: number, bytesReceived = 0): OutcomeOf['statsSource'] => ({
  ok: true,
  value: null,
  call: { httpRequests: fileRequests, bytesReceived, fileRequests },
});
const statsRefusal = (retryAfterMs: number): OutcomeOf['statsSource'] => ({
  ok: false,
  error: { kind: 'rate_limited', retryAfterMs },
  call: { httpRequests: 1, bytesReceived: 0, fileRequests: 0 },
});
const model = (call: Partial<ModelCallMetadata>): OutcomeOf['groq'] => ({
  ok: true,
  call: {
    httpRequests: 1,
    tokens: 0,
    neurons: 0,
    requestsResetAt: null,
    tokensResetAt: null,
    ...call,
  },
});

const usage = (key: LimitKey, status: QuotaStatus, text: string): UsageLine => ({
  kind: 'usage',
  key,
  status,
  text,
});
const sent: OutcomeOf['telegram'] = { ok: true, call: { httpRequests: 1, messages: 1 } };

describe('the quota use report', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;
  const versions = new Map<string, number>();

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(AT);
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
  const stats = async (outcome: OutcomeOf['statsSource']) =>
    withQuota(
      db,
      { service: 'statsSource', estimate: { requests: 1 }, priority: false },
      answering(outcome),
    );
  const report = async (lot: Lot) => usageReport(db, { timeZone: PARIS, lot });
  const lines = async (lot: Lot, ...keys: readonly string[]) => {
    const all = await report(lot);
    return keys.map((key) => all.find((line) => line.key === key));
  };

  it("[TRV-46] [CL-TRV-12] writes each limit's use against its value with its reset in the owner's zone, and each limit not entered yet", async () => {
    await enter('quotas.workersAi.neuronsPerDay', 10_000);
    await enter('quotas.statsSource.requestsPerDay', 1000);
    await enter('quotas.statsSource.megabytesPerDay', 500);
    await withQuota(
      db,
      { service: 'workersAi', estimate: { neurons: 52 }, priority: false },
      answering(model({ neurons: 4120 })),
    );
    await stats(statsCall(412, 120_400_000));

    expect(
      await lines(
        2,
        'quotas.workersAi.neuronsPerDay',
        'quotas.statsSource.requestsPerDay',
        'quotas.statsSource.megabytesPerDay',
        'quotas.workersAi.requestsPerMinute',
      ),
    ).toStrictEqual([
      usage(
        'quotas.workersAi.neuronsPerDay',
        'normal',
        'Workers AI: 4,120 of 10,000 neurons today, resets at 01:00',
      ),
      usage(
        'quotas.statsSource.requestsPerDay',
        'normal',
        'Stats source: 412 of 1,000 requests today, resets at 01:00',
      ),
      usage(
        'quotas.statsSource.megabytesPerDay',
        'normal',
        'Stats source: 120 of 500 MB today, resets at 01:00',
      ),
      {
        kind: 'not_entered',
        key: 'quotas.workersAi.requestsPerMinute',
        text: 'Quota limits per service — Workers AI, requests a minute: not entered yet',
      },
    ]);
  });

  it('[TRV-04] [TRV-05] [TRV-06] [TRV-46] gives each limit its status, and the instant a refusal holds it until', async () => {
    const key = 'quotas.statsSource.requestsPerDay';
    await enter(key, 1000);
    await stats(statsCall(800));
    const warning = await lines(1, key);
    await stats(statsRefusal(2 * HOUR));
    const held = await lines(1, key, 'quotas.statsSource.megabytesPerDay');
    clock.advance(2 * HOUR);
    const after = await lines(1, key);
    await stats(statsCall(200));

    expect(warning).toStrictEqual([
      usage(key, 'warning', 'Stats source: 800 of 1,000 requests today, resets at 01:00'),
    ]);
    expect(held).toStrictEqual([
      usage(key, 'reached', 'Stats source: 800 of 1,000 requests today, resets at 13:00'),
      {
        kind: 'not_entered',
        key: 'quotas.statsSource.megabytesPerDay',
        text: 'Quota limits per service — the stats source, megabytes a day: not entered yet',
      },
    ]);
    expect(after).toStrictEqual([
      usage(key, 'warning', 'Stats source: 800 of 1,000 requests today, resets at 01:00'),
    ]);
    expect(await lines(1, key)).toStrictEqual([
      usage(key, 'reached', 'Stats source: 1,000 of 1,000 requests today, resets at 01:00'),
    ]);
  });

  it("[TRV-03] [TRV-46] writes Groq's rolling and reported windows and Telegram's second", async () => {
    await enter('quotas.groq.requestsPerMinute', 30);
    await enter('quotas.groq.requestsPerDay', 1000);
    await enter('quotas.groq.tokensPerMinute', 8000);
    await enter('quotas.groq.tokensPerDay', 200_000);
    await enter('quotas.telegram.messagesPerSecond', 30);
    const call = model({
      httpRequests: 12,
      tokens: 1000,
      requestsResetAt: toEpochMs(AT + 5 * HOUR),
      tokensResetAt: toEpochMs(AT + 7 * SECOND),
    });
    await withQuota(
      db,
      { service: 'groq', estimate: { requests: 1 }, priority: false },
      answering(call),
    );
    await withQuota(
      db,
      { service: 'telegram', estimate: { messages: 1 }, priority: false },
      answering(sent),
    );

    expect(
      await lines(
        2,
        'quotas.groq.requestsPerMinute',
        'quotas.groq.requestsPerDay',
        'quotas.groq.tokensPerMinute',
        'quotas.groq.tokensPerDay',
        'quotas.telegram.messagesPerSecond',
      ),
    ).toStrictEqual([
      usage(
        'quotas.groq.requestsPerMinute',
        'normal',
        'Groq: 12 of 30 requests over the last minute',
      ),
      usage(
        'quotas.groq.requestsPerDay',
        'normal',
        'Groq: 12 of 1,000 requests today, resets at 16:00',
      ),
      usage(
        'quotas.groq.tokensPerMinute',
        'normal',
        'Groq: 1,000 of 8,000 tokens this minute, resets at 11:00',
      ),
      usage(
        'quotas.groq.tokensPerDay',
        'normal',
        'Groq: 1,000 of 200,000 tokens over the last 24 hours',
      ),
      usage(
        'quotas.telegram.messagesPerSecond',
        'normal',
        'Telegram: 1 of 30 messages this second',
      ),
    ]);
  });

  it("[TRV-03] [TRV-05] [TRV-46] writes the month's compute estimate and the reference values, and only Lot 1's limits while Lot 1 runs", async () => {
    await enter('quotas.database.computeHoursPerMonth', 100);
    await enter('quotas.database.capacityMegabytes', 500);
    await enter('quotas.hosting.invocationsPerMonth', 1_000_000);
    await enter('quotas.backupStorage.requestsPerHour', 5000);
    await db.insert(databaseActivityMinutes).values(
      Array.from({ length: 60 }, (_, index) => ({
        minuteAt: new Date(Date.UTC(2026, 10, 2) + index * 10 * MINUTE),
        instanceId: 'instance-a',
      })),
    );
    const keys = [
      'quotas.database.computeHoursPerMonth',
      'quotas.hosting.invocationsPerMonth',
      'quotas.backupStorage.requestsPerHour',
      'quotas.hosting.activeCpuHoursPerMonth',
    ] as const;
    const lotOne = await report(1);
    await enter('quotas.database.computeHoursPerMonth', 1);

    expect(await lines(1, ...keys)).toStrictEqual([
      usage(
        keys[0],
        'warning',
        'Database: 1.5 of 1 compute-hour this month, resets on Tue 1 Dec 2026, 01:00',
      ),
      {
        kind: 'reference',
        key: keys[1],
        text: 'Quota limits per service — the host, invocations a month: 1,000,000 invocations, a reference value that the app does not enforce',
      },
      {
        kind: 'reference',
        key: keys[2],
        text: 'Quota limits per service — the backup storage, requests an hour: 5,000 requests, a reference value that the app does not enforce',
      },
      {
        kind: 'not_entered',
        key: keys[3],
        text: 'Quota limits per service — the host, active CPU hours a month: not entered yet',
      },
    ]);
    expect(lotOne.find((line) => line.key === keys[0])).toStrictEqual(
      usage(
        keys[0],
        'normal',
        'Database: 1.5 of 100 compute-hours this month, resets on Tue 1 Dec 2026, 01:00',
      ),
    );
    expect(
      lotOne.filter((line) => /groq|workersAi|telegram|capacity/.test(line.key)),
    ).toStrictEqual([]);
    expect(lotOne.every((line) => line.key.startsWith('quotas.'))).toBe(true);
  });
});

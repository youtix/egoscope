import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, quotaUsage } from '@/lib/db';
import { listOpen } from '@/lib/incidents';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { nextAvailableAt, withQuota } from './guard';

import type { ModelCallMetadata, OutcomeOf } from './readers';
import type { Database } from '@/lib/db';
import type { OverridableKey, ParamValue } from '@/lib/params';
import type { EpochMs, FixedClock } from '@/lib/time';

// Tuesday 24 November 2026, 22:30 UTC, half an hour before Paris's midnight.
const START = toEpochMs(Date.UTC(2026, 10, 24, 22, 30));
const UTC_MIDNIGHT = toEpochMs(Date.UTC(2026, 10, 25));
const SECOND = 1000;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** A provider's call that answers `outcome` on a later turn. */
const answering =
  <O>(outcome: O) =>
  async (): Promise<O> => {
    await Promise.resolve();
    return outcome;
  };

const model = (call: Partial<ModelCallMetadata>): ModelCallMetadata => ({
  httpRequests: 1,
  tokens: 0,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
  ...call,
});
const answered = (call: Partial<ModelCallMetadata>): OutcomeOf['groq'] => ({
  ok: true,
  call: model(call),
});
const deferredUntil = (availableAt: EpochMs | null) => ({
  ok: false,
  error: { kind: 'deferred', availableAt },
});
const refused = (retryAfterMs: number | null): OutcomeOf['groq'] => ({
  ok: false,
  error: { kind: 'rate_limited', retryAfterMs },
  call: model({}),
});

describe('the use that each service reports', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(START);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  const enter = async <K extends OverridableKey>(key: K, value: ParamValue<K>) => {
    const saved = await db.transaction(async (tx) =>
      setParam(tx, { key, value, expectedVersion: 0 }),
    );
    expect(saved.ok).toBe(true);
  };
  const call = async (service: 'workersAi' | 'groq', outcome: OutcomeOf['groq']) =>
    withQuota(
      db,
      { service, estimate: { requests: 1, tokens: 1000, neurons: 52 }, priority: false },
      answering(outcome),
    );
  const send = async (outcome: OutcomeOf['telegram']) =>
    withQuota(
      db,
      { service: 'telegram', estimate: { messages: 1 }, priority: false },
      answering(outcome),
    );
  const rows = async (key: string) => {
    const stored = await db.select().from(quotaUsage).orderBy(asc(quotaUsage.id));
    return stored
      .filter((row) => row.limitKey === key)
      .map((row) => ({
        start: row.periodStartAt.getTime(),
        used: row.used,
        resetsAt: row.resetsAt?.getTime() ?? null,
      }));
  };
  const openKinds = async () => {
    const opened = await listOpen(db);
    return opened.map(({ kind, serviceRole, quotaCauses }) => ({ kind, serviceRole, quotaCauses }));
  };

  it("[TRV-03] [CL-TRV-12] resets Workers AI's neurons at 00:00 UTC, its declared boundary, not at the owner's midnight", async () => {
    await enter('quotas.workersAi.neuronsPerDay', 10_000);
    await call('workersAi', answered({ neurons: 10_000 }));

    const beforeUtcMidnight = await call('workersAi', answered({ neurons: 52 }));
    clock.advance(UTC_MIDNIGHT - START);
    const afterUtcMidnight = await call('workersAi', answered({ neurons: 52 }));

    expect(beforeUtcMidnight).toStrictEqual(deferredUntil(UTC_MIDNIGHT));
    expect(afterUtcMidnight.ok).toBe(true);
    expect(await rows('quotas.workersAi.neuronsPerDay')).toStrictEqual([
      { start: Date.UTC(2026, 10, 24), used: 10_000, resetsAt: UTC_MIDNIGHT },
      { start: UTC_MIDNIGHT, used: 52, resetsAt: Date.UTC(2026, 10, 26) },
    ]);
  });

  it('[TRV-03] [CL-DET-04] [CL-DET-05] records, defers and warns for a language model, but opens no "quota reached" of its own', async () => {
    await enter('quotas.workersAi.neuronsPerDay', 10_000);
    await call('workersAi', answered({ neurons: 8000 }));
    const warned = await listOpen(db);
    await call('workersAi', answered({ neurons: 2000 }));

    expect(warned.map(({ kind, serviceRole }) => ({ kind, serviceRole }))).toStrictEqual([
      { kind: 'quota_warning', serviceRole: 'language_model' },
    ]);
    expect(await call('workersAi', answered({}))).toStrictEqual(deferredUntil(UTC_MIDNIGHT));
    expect(await openKinds()).toMatchObject([{ kind: 'quota_warning' }]);
  });

  it("[CA-TRV-02] [CL-TRV-12] counts Groq's 1,000 requests a day apart from Workers AI and resets them at the instant x-ratelimit-reset-requests reports", async () => {
    const reported = toEpochMs(START + 5 * 3_600_000);
    await enter('quotas.groq.requestsPerDay', 1000);
    await call('workersAi', answered({ neurons: 52 }));
    await call('groq', answered({ httpRequests: 799, requestsResetAt: reported }));
    const below = await listOpen(db);
    await call('groq', answered({ httpRequests: 201, requestsResetAt: reported }));

    expect(below).toStrictEqual([]);
    expect(await call('groq', answered({}))).toStrictEqual(deferredUntil(reported));
    expect([
      await nextAvailableAt(db, 'groq'),
      await nextAvailableAt(db, 'workersAi'),
    ]).toStrictEqual([reported, START]);
    expect(await rows('quotas.groq.requestsPerDay')).toStrictEqual([
      { start: START, used: 1000, resetsAt: reported },
    ]);
    clock.advance(reported - START);
    expect(await call('groq', answered({}))).toHaveProperty('ok', true);
  });

  it("[CL-TRV-12] resets Groq's tokens a minute at the instant x-ratelimit-reset-tokens reports", async () => {
    const reported = toEpochMs(START + 7 * SECOND);
    await enter('quotas.groq.tokensPerMinute', 8000);
    await call('groq', answered({ tokens: 7500, tokensResetAt: reported }));

    expect(await call('groq', answered({ tokens: 1000 }))).toStrictEqual(deferredUntil(reported));
    expect(await rows('quotas.groq.tokensPerMinute')).toStrictEqual([
      { start: START, used: 7500, resetsAt: reported },
    ]);
  });

  it("[TRV-04] [CL-TRV-12] counts Groq's requests a minute and tokens a day over a rolling minute and a rolling 24 hours", async () => {
    await enter('quotas.groq.requestsPerMinute', 30);
    await enter('quotas.groq.tokensPerDay', 200_000);
    await call('groq', answered({ httpRequests: 30, tokens: 1000 }));
    const fullMinute = await call('groq', answered({}));
    clock.advance(2 * MINUTE);
    await call('groq', answered({ tokens: 199_000 }));
    const fullDay = await call('groq', answered({}));

    expect(fullMinute).toStrictEqual(deferredUntil(toEpochMs(START + 2 * MINUTE)));
    expect(fullDay).toStrictEqual(deferredUntil(toEpochMs(START + DAY + MINUTE)));
  });

  it('[TRV-06] [CL-TRV-12] marks a rolling limit of Groq reached until the retry-after of its 429, or until the window passes', async () => {
    await call('groq', refused(20 * SECOND));
    const held = await call('groq', answered({}));
    clock.advance(20 * SECOND);
    const retried = await call('groq', answered({}));
    await call('groq', refused(null));

    expect(held).toStrictEqual(deferredUntil(toEpochMs(START + 20 * SECOND)));
    expect(retried.ok).toBe(true);
    expect(await call('groq', answered({}))).toStrictEqual(
      deferredUntil(toEpochMs(START + DAY + MINUTE)),
    );
    expect(await listOpen(db)).toStrictEqual([]);
  });

  it("[TRV-03] [TRV-04] [CL-TRV-12] keeps Groq's requests a day and tokens a minute counting to the resets their headers report after a 429 with retry-after", async () => {
    const requestsReset = toEpochMs(START + 5 * 3_600_000);
    const tokensReset = toEpochMs(START + 7 * SECOND);
    await enter('quotas.groq.requestsPerDay', 1000);
    await enter('quotas.groq.tokensPerMinute', 8000);
    await call(
      'groq',
      answered({
        httpRequests: 990,
        tokens: 6500,
        requestsResetAt: requestsReset,
        tokensResetAt: tokensReset,
      }),
    );
    const refusal = await call('groq', refused(2 * SECOND));
    clock.advance(3 * SECOND);
    const after = await call('groq', answered({ httpRequests: 9, tokens: 1000 }));

    expect([refusal.ok, after.ok]).toStrictEqual([true, true]);
    expect(await call('groq', answered({}))).toStrictEqual(deferredUntil(requestsReset));
    expect(await nextAvailableAt(db, 'groq')).toBe(requestsReset);
    expect(await rows('quotas.groq.requestsPerDay')).toStrictEqual([
      { start: START, used: 1000, resetsAt: requestsReset },
    ]);
    expect(await rows('quotas.groq.tokensPerMinute')).toStrictEqual([
      { start: START, used: 7500, resetsAt: tokensReset },
    ]);
  });

  it('[TRV-04] [TRV-05] [CL-TRV-11] paces Telegram at its rate of 1 message a second, with neither a warning nor "quota reached"', async () => {
    await enter('quotas.telegram.messagesPerSecond', 1);
    const message = { ok: true, call: { httpRequests: 1, messages: 1 } } as const;
    const opened = [];

    const first = await send(message);
    opened.push(await openKinds());
    const sameSecond = await send(message);
    opened.push(await openKinds());
    clock.advance(5 * SECOND);
    const later = await send(message);
    clock.advance(MINUTE);
    const last = await send(message);
    opened.push(await openKinds());

    expect([first.ok, later.ok, last.ok]).toStrictEqual([true, true, true]);
    expect(sameSecond).toStrictEqual(deferredUntil(toEpochMs(START + SECOND)));
    expect(opened).toStrictEqual([[], [], []]);
  });

  it("[TRV-04] [CL-TRV-12] counts Workers AI's requests a minute as a rate over a rolling minute, without a warning", async () => {
    await enter('quotas.workersAi.requestsPerMinute', 2);
    await call('workersAi', answered({}));
    await call('workersAi', answered({}));

    expect(await call('workersAi', answered({}))).toStrictEqual(
      deferredUntil(toEpochMs(START + 2 * MINUTE)),
    );
    expect(await openKinds()).toStrictEqual([]);
  });

  it("[TRV-04] [TRV-06] counts Telegram's messages per second and holds them for the retry-after of its refusal", async () => {
    await enter('quotas.telegram.messagesPerSecond', 1);
    await send({ ok: true, call: { httpRequests: 1, messages: 1 } });

    expect(await send({ ok: true, call: { httpRequests: 1, messages: 1 } })).toStrictEqual(
      deferredUntil(toEpochMs(START + SECOND)),
    );
    clock.advance(SECOND);
    await send({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 3 * SECOND },
      call: { httpRequests: 1, messages: 0 },
    });
    expect(await send({ ok: true, call: { httpRequests: 1, messages: 1 } })).toStrictEqual(
      deferredUntil(toEpochMs(START + 4 * SECOND)),
    );
    expect(await openKinds()).toStrictEqual([
      {
        kind: 'quota_reached',
        serviceRole: 'notifications',
        quotaCauses: ['refused_before_limit'],
      },
    ]);
  });
});

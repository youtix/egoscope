import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, quotaUsage } from '@/lib/db';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { nextAvailableAt, withQuota } from './guard';

import type { Estimate } from './check';
import type { OutcomeOf } from './readers';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// Tuesday 24 November 2026, 14:00 UTC.
const START = toEpochMs(Date.UTC(2026, 10, 24, 14));
const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const TOKENS_PER_DAY = 'quotas.groq.tokensPerDay';
const TOKEN_ESTIMATE: Estimate = { requests: 1, tokens: 500 };
const REQUEST_ONLY: Estimate = { requests: 1 };

const groqCall = (tokens: number, isRefused = false): OutcomeOf['groq'] => {
  const call = { httpRequests: 1, tokens, neurons: 0, requestsResetAt: null, tokensResetAt: null };
  return isRefused
    ? { ok: false, error: { kind: 'rate_limited', retryAfterMs: null }, call }
    : { ok: true, call };
};

/** A failure of the call itself, which the guard lets through unchanged. */
class CallFailure extends Error {}

describe("the refusal of Groq's rolling tokens a day", { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(START);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  const enterTokensPerDay = async () => {
    const saved = await db.transaction(async (tx) =>
      setParam(tx, { key: TOKENS_PER_DAY, value: 200_000, expectedVersion: 0 }),
    );
    expect(saved.ok).toBe(true);
  };
  const guarded = async (outcome: OutcomeOf['groq'], estimate: Estimate = REQUEST_ONLY) =>
    withQuota(db, { service: 'groq', estimate, priority: false }, async () => {
      await Promise.resolve();
      return outcome;
    });
  const tokenRows = async () => {
    const rows = await db.select().from(quotaUsage).orderBy(asc(quotaUsage.id));
    return rows
      .filter((row) => row.limitKey === TOKENS_PER_DAY)
      .map((row) => ({
        start: row.periodStartAt.getTime(),
        used: row.used,
        reached: row.reachedAt?.getTime() ?? null,
        resetsAt: row.resetsAt?.getTime() ?? null,
      }));
  };

  it('[TRV-06] [CL-TRV-12] holds the limit after a refusal until its oldest counted bucket leaves the window', async () => {
    await enterTokensPerDay();
    await guarded(groqCall(1000));
    clock.advance(10 * HOUR);

    await guarded(groqCall(0, true));

    const until = START + MINUTE + DAY;
    expect(await tokenRows()).toContainEqual({
      start: START + 10 * HOUR,
      used: 0,
      reached: START + 10 * HOUR,
      resetsAt: until,
    });
    expect(await nextAvailableAt(db, 'groq')).toBe(until);
  });

  it('[TRV-06] [CL-TRV-12] holds the limit after a refusal past an older bucket that a call which threw left empty, until the oldest counted bucket leaves the window', async () => {
    await enterTokensPerDay();
    const failure = new CallFailure('Groq closed the connection.');
    const thrown = withQuota(
      db,
      { service: 'groq', estimate: TOKEN_ESTIMATE, priority: false },
      async () => {
        await Promise.resolve();
        throw failure;
      },
    );
    await expect(thrown).rejects.toBe(failure);
    clock.advance(5 * HOUR);
    await guarded(groqCall(1000), TOKEN_ESTIMATE);
    clock.advance(5 * HOUR);

    await guarded(groqCall(0, true));

    const until = START + 5 * HOUR + MINUTE + DAY;
    expect(await tokenRows()).toStrictEqual([
      { start: START, used: 0, reached: null, resetsAt: null },
      { start: START + 5 * HOUR, used: 1000, reached: null, resetsAt: null },
      { start: START + 10 * HOUR, used: 0, reached: START + 10 * HOUR, resetsAt: until },
    ]);
    expect(await nextAvailableAt(db, 'groq')).toBe(until);
  });

  it('[TRV-06] [CL-TRV-12] holds the limit after a refusal past an older bucket that counted no token, until the oldest counted bucket leaves the window', async () => {
    await enterTokensPerDay();
    await guarded(groqCall(0), TOKEN_ESTIMATE);
    clock.advance(5 * HOUR);
    await guarded(groqCall(1000));
    clock.advance(5 * HOUR);

    await guarded(groqCall(0, true));

    expect(await nextAvailableAt(db, 'groq')).toBe(START + 5 * HOUR + MINUTE + DAY);
  });

  it("[TRV-06] [CL-TRV-12] holds the limit after a refusal that no counted operation precedes until the refusal's own bucket leaves the window", async () => {
    await enterTokensPerDay();
    await guarded(groqCall(0, true));

    expect(await tokenRows()).toContainEqual({
      start: START,
      used: 0,
      reached: START,
      resetsAt: START + MINUTE + DAY,
    });
    expect(await nextAvailableAt(db, 'groq')).toBe(START + MINUTE + DAY);
  });
});

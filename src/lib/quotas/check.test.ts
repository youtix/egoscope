import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { check } from './check';
import { SERVICES } from './limits';

import type { CheckRequest, LimitView } from './check';
import type { LimitState, UsageRow } from './ledger';
import type { CountedLimit, QuotaService } from './limits';
import type { EpochMs } from '@/lib/time';

// Tuesday 24 November 2026, 14:30 UTC.
const AT = toEpochMs(Date.UTC(2026, 10, 24, 14, 30));
const MINUTE = 60_000;
const DAY_END = toEpochMs(Date.UTC(2026, 10, 25));

/** The declared limit `key` of `service`. */
const limitOf = (service: QuotaService, key: string): CountedLimit =>
  SERVICES[service].limits.find((limit) => limit.key === key) ??
  expect.unreachable(`${service} declares no ${key}`);

const REQUESTS_PER_DAY = limitOf('statsSource', 'quotas.statsSource.requestsPerDay');
const MEGABYTES_PER_DAY = limitOf('statsSource', 'quotas.statsSource.megabytesPerDay');
const GROQ_REQUESTS_PER_MINUTE = limitOf('groq', 'quotas.groq.requestsPerMinute');
const GITHUB_REQUESTS_PER_HOUR = limitOf('backupStorage', 'quotas.backupStorage.requestsPerHour');

/** A use, an estimate and a reserve of the stats source's requests a day, for any call. */
const CHECKS = fc.record({
  value: fc.integer({ min: 1, max: 10_000 }),
  used: fc.integer({ min: 0, max: 12_000 }),
  need: fc.integer({ min: 0, max: 500 }),
  reserveShare: fc.integer({ min: 0, max: 50 }),
  priority: fc.boolean(),
});

/** When a call of `need` under `allowance` may be made: now, at the day's end, or never. */
function expectedAvailability(isAllowed: boolean, need: number, allowance: number) {
  if (isAllowed) {
    return AT;
  }
  return need > allowance ? null : DAY_END;
}

const row = (start: EpochMs, used: number): UsageRow => ({
  key: 'quotas.groq.requestsPerMinute',
  start,
  used,
  warningGivenAt: null,
  reachedAt: null,
  resetsAt: null,
});

/** A fixed day's state of `limit` with `used` counted. */
const dayState = (
  limit: CountedLimit,
  used: number,
  blockedUntil: EpochMs | null = null,
): LimitState => ({
  limit,
  period: { start: toEpochMs(Date.UTC(2026, 10, 24)), end: DAY_END },
  used,
  rows: [],
  blockedUntil,
});

const request = (overrides: Partial<CheckRequest> = {}): CheckRequest => ({
  estimate: { requests: 1 },
  priority: false,
  reserveShare: 0,
  callSize: null,
  ...overrides,
});
const view = (state: LimitState, value: number | null): LimitView => ({ state, value });

describe('the check before a call', () => {
  it('[TRV-04] [CA-TRV-02] makes a call that fits under the limit and defers the one that would exceed it to the next UTC day', () => {
    const fits = check([view(dayState(REQUESTS_PER_DAY, 999), 1000)], request(), AT);
    const over = check([view(dayState(REQUESTS_PER_DAY, 1000), 1000)], request(), AT);

    expect(fits).toStrictEqual({ allowed: true, resumes: true, byCount: false, availableAt: AT });
    expect(over).toStrictEqual({
      allowed: false,
      resumes: false,
      byCount: true,
      availableAt: DAY_END,
    });
  });

  it('[TRV-04] defers a download whose estimate would go over the megabytes left, and nothing that no reset can make room for', () => {
    const bytes = check(
      [view(dayState(MEGABYTES_PER_DAY, 1_990_000_000), 2000)],
      request({ estimate: { requests: 1, bytes: 20_000_000 } }),
      AT,
    );
    const tooLargeForAnyDay = check(
      [view(dayState(MEGABYTES_PER_DAY, 0), 2000)],
      request({ estimate: { bytes: 2_000_000_001 } }),
      AT,
    );

    expect(bytes.availableAt).toBe(DAY_END);
    expect(tooLargeForAnyDay).toStrictEqual({
      allowed: false,
      resumes: false,
      byCount: true,
      availableAt: null,
    });
  });

  it('[STA-39] keeps the reserve for priority calls: a non-priority call stops before it, a priority one may use it', () => {
    const state = dayState(REQUESTS_PER_DAY, 180);
    const normal = check([view(state, 200)], request({ reserveShare: 10 }), AT);
    const priority = check([view(state, 200)], request({ reserveShare: 10, priority: true }), AT);
    const priorityAtLimit = check(
      [view(dayState(REQUESTS_PER_DAY, 200), 200)],
      request({ reserveShare: 10, priority: true }),
      AT,
    );

    expect(normal).toStrictEqual({
      allowed: false,
      resumes: false,
      byCount: true,
      availableAt: DAY_END,
    });
    expect(priority).toStrictEqual({
      allowed: true,
      resumes: false,
      byCount: false,
      availableAt: AT,
    });
    expect(priorityAtLimit.allowed).toBe(false);
  });

  it('[CL-TRV-12] counts a limit not entered and a reference value, and never defers for them', () => {
    const notEntered = check([view(dayState(REQUESTS_PER_DAY, 1_000_000), null)], request(), AT);
    const reference = check(
      [
        view(
          { ...dayState(GITHUB_REQUESTS_PER_HOUR, 5000), limit: GITHUB_REQUESTS_PER_HOUR },
          5000,
        ),
      ],
      request(),
      AT,
    );

    expect(notEntered.allowed).toBe(true);
    expect(reference.allowed).toBe(true);
  });

  it('[TRV-06] [CL-TRV-12] holds every call while a refusal for quota still holds, whatever the count', () => {
    const retryAt = toEpochMs(AT + 30_000);
    const held = check(
      [view(dayState(REQUESTS_PER_DAY, 600, retryAt), 1000)],
      request({ priority: true }),
      AT,
    );
    const notEntered = check([view(dayState(REQUESTS_PER_DAY, 3, retryAt), null)], request(), AT);

    expect(held).toStrictEqual({
      allowed: false,
      resumes: false,
      byCount: false,
      availableAt: retryAt,
    });
    expect(notEntered.availableAt).toBe(retryAt);
  });

  it('[TRV-04] [CL-TRV-12] frees a rolling window when enough of its oldest buckets leave it', () => {
    const first = toEpochMs(Date.UTC(2026, 10, 24, 14, 29));
    const state: LimitState = {
      limit: GROQ_REQUESTS_PER_MINUTE,
      period: { start: toEpochMs(AT), end: toEpochMs(first + 2 * MINUTE) },
      used: 30,
      rows: [row(first, 12), row(AT, 18)],
      blockedUntil: null,
    };
    const verdict = check([view(state, 30)], request({ estimate: { requests: 2 } }), AT);
    const tooMany = check([view(state, 30)], request({ estimate: { requests: 31 } }), AT);

    expect(verdict.availableAt).toBe(first + 2 * MINUTE);
    expect(tooMany.availableAt).toBeNull();
  });

  it('[TRV-04] never allows a call whose estimate takes the count over the limit', () => {
    fc.assert(
      fc.property(CHECKS, ({ value, used, need, reserveShare, priority }) => {
        const verdict = check(
          [view(dayState(REQUESTS_PER_DAY, used), value)],
          request({ estimate: { requests: need }, reserveShare, priority }),
          AT,
        );
        const allowance = priority ? value : (value * (100 - reserveShare)) / 100;

        expect(verdict.allowed).toBe(used < allowance && used + need <= allowance);
        expect(verdict.availableAt).toBe(expectedAvailability(verdict.allowed, need, allowance));
      }),
    );
  });

  it('[TRV-04] defers a backup file above the storage size limit with no instant to retry', () => {
    const verdict = check([], request({ estimate: { bytes: 2_100_000_000 }, callSize: 2000 }), AT);
    const fits = check([], request({ estimate: { bytes: 2_000_000_000 }, callSize: 2000 }), AT);

    expect(verdict).toStrictEqual({
      allowed: false,
      resumes: false,
      byCount: true,
      availableAt: null,
    });
    expect(fits.allowed).toBe(true);
  });
});

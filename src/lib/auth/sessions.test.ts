import { randomBytes } from 'node:crypto';

import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { accounts, createTestDatabase, loginFailures, sessions } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { endAllSessions, purgeExpired } from './sessions';

import type { Database } from '@/lib/db';

// Monday 23 November 2026, 10:00 Paris time, a minute, an hour and a day.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9));
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('the sessions of the account', { timeout: 60_000 }, () => {
  type SessionRow = Readonly<{ device: string; expiresAt: number; endReason?: 'logged_out' }>;

  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(installFakeClock(fixedClock(START)));
    await db.insert(accounts).values({
      passwordHash: 'scrypt$hash',
      passwordStatus: 'chosen',
      initialPasswordFingerprint: 'scrypt$fingerprint',
    });
    return database.close;
  }, 60_000);

  const insert = async (...rows: readonly SessionRow[]) =>
    db.insert(sessions).values(
      rows.map(({ device, expiresAt, endReason }) => ({
        tokenHash: randomBytes(32),
        device,
        lastUsedAt: new Date(START - HOUR),
        expiresAt: new Date(expiresAt),
        endedAt: endReason === undefined ? null : new Date(START - HOUR),
        endReason: endReason ?? null,
      })),
    );
  const rows = async () =>
    db
      .select({ device: sessions.device, endedAt: sessions.endedAt, reason: sessions.endReason })
      .from(sessions)
      .orderBy(asc(sessions.id));

  it('[IHM-08] [CL-TRV-05] ends every open session at once with its reason, recorded on the account', async () => {
    await insert(
      { device: 'Phone', expiresAt: START + DAY },
      { device: 'Computer', expiresAt: START + DAY },
      { device: 'Tablet', expiresAt: START - MINUTE },
      { device: 'Old phone', expiresAt: START + DAY, endReason: 'logged_out' },
    );

    const endedAt = await db.transaction(async (tx) => endAllSessions(tx, 'restored'));

    expect(endedAt).toBe(START);
    await expect(rows()).resolves.toStrictEqual([
      { device: 'Phone', endedAt: new Date(START), reason: 'restored' },
      { device: 'Computer', endedAt: new Date(START), reason: 'restored' },
      { device: 'Tablet', endedAt: null, reason: null },
      { device: 'Old phone', endedAt: new Date(START - HOUR), reason: 'logged_out' },
    ]);
    await expect(
      db
        .select({ at: accounts.allSessionsEndedAt, reason: accounts.allSessionsEndReason })
        .from(accounts),
    ).resolves.toStrictEqual([{ at: new Date(START), reason: 'restored' }]);
  });

  it('[TRV-62] [TRV-61] purges the sessions past their idle expiry and the failures outside the observation period', async () => {
    await insert(
      { device: 'Phone', expiresAt: START - MINUTE },
      { device: 'Computer', expiresAt: START + DAY, endReason: 'logged_out' },
      { device: 'Tablet', expiresAt: START },
    );
    await db
      .insert(loginFailures)
      .values([
        { occurredAt: new Date(START - 16 * MINUTE) },
        { occurredAt: new Date(START - 14 * MINUTE) },
      ]);

    const purged = await db.transaction(async (tx) => purgeExpired(tx, { now: START }));

    expect(purged).toBe(3);
    await expect(rows()).resolves.toStrictEqual([
      { device: 'Computer', endedAt: new Date(START - HOUR), reason: 'logged_out' },
    ]);
    await expect(
      db.select({ at: loginFailures.occurredAt }).from(loginFailures),
    ).resolves.toStrictEqual([{ at: new Date(START - 14 * MINUTE) }]);
  });
});

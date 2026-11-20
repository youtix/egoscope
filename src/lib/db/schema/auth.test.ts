import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { createTestDatabase } from '../test-database';
import { accounts, loginFailures, sessions } from './auth';

import type { Database } from '../types';

// The account as the first use creates it, from hashes only (TRV-60, TRV-63).
const ACCOUNT = {
  passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA',
  passwordStatus: 'initial',
  initialPasswordFingerprint: 'scrypt$16384$8$1$c2VsZg$ZmluZ2VycHJpbnQ',
} as const;
// A session's idle expiry, and the instant every session was ended at once.
const EXPIRES_AT = new Date(toEpochMs(Date.UTC(2026, 11, 18, 8)));
const ENDED_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18, 8)));
// The hash of a session token: 32 bytes, never the token itself.
const TOKEN_HASH = new Uint8Array(32).fill(7);
const SESSION = { tokenHash: TOKEN_HASH, device: 'Phone, Safari', expiresAt: EXPIRES_AT };
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the account tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('keeps the single account in one row, id 1, on its initial password until one is chosen', async () => {
    await db.insert(accounts).values(ACCOUNT);

    const second = db.insert(accounts).values({ ...ACCOUNT, id: 2 });
    const status = db
      .update(accounts)
      .set({ passwordStatus: sql`'temporary'` })
      .where(eq(accounts.id, 1));

    await expect(db.select().from(accounts)).resolves.toStrictEqual([
      {
        id: 1,
        ...ACCOUNT,
        passwordChangedAt: ANY_INSTANT,
        loginLockedUntil: null,
        allSessionsEndedAt: null,
        allSessionsEndReason: null,
      },
    ]);
    await expect(second).rejects.toMatchObject(violationOf('accounts_id_check'));
    await expect(status).rejects.toMatchObject(violationOf('accounts_password_status_check'));

    await db.update(accounts).set({ passwordStatus: 'chosen' }).where(eq(accounts.id, 1));

    await expect(
      db.select({ status: accounts.passwordStatus }).from(accounts),
    ).resolves.toStrictEqual([{ status: 'chosen' }]);
  });

  it.each(['logged_out', 'password_changed', 'reset', 'restored'] as const)(
    '[CL-TRV-05] records an ending of every session at once for the reason %s',
    async (reason) => {
      await db
        .insert(accounts)
        .values({ ...ACCOUNT, allSessionsEndedAt: ENDED_AT, allSessionsEndReason: reason });

      await expect(
        db.select({ reason: accounts.allSessionsEndReason }).from(accounts),
      ).resolves.toStrictEqual([{ reason }]);
    },
  );

  it('[CL-TRV-05] records the last ending of every session with its reason, which is never an expiry', async () => {
    await db
      .insert(accounts)
      .values({ ...ACCOUNT, allSessionsEndedAt: ENDED_AT, allSessionsEndReason: 'restored' });

    const expiry = db
      .update(accounts)
      .set({ allSessionsEndReason: sql`'expired'` })
      .where(eq(accounts.id, 1));
    const reasonless = db
      .update(accounts)
      .set({ allSessionsEndReason: null })
      .where(eq(accounts.id, 1));
    const instantless = db
      .update(accounts)
      .set({ allSessionsEndedAt: null })
      .where(eq(accounts.id, 1));

    await expect(
      db
        .select({ at: accounts.allSessionsEndedAt, reason: accounts.allSessionsEndReason })
        .from(accounts),
    ).resolves.toStrictEqual([{ at: ENDED_AT, reason: 'restored' }]);
    await expect(expiry).rejects.toMatchObject(
      violationOf('accounts_all_sessions_end_reason_check'),
    );
    await expect(reasonless).rejects.toMatchObject(
      violationOf('accounts_all_sessions_ended_check'),
    );
    await expect(instantless).rejects.toMatchObject(
      violationOf('accounts_all_sessions_ended_check'),
    );
  });

  it('keeps a session by the hash of its token, one session per token', async () => {
    await db.insert(sessions).values(SESSION);

    const sameToken = db.insert(sessions).values({ ...SESSION, device: 'Laptop, Firefox' });

    await expect(db.select().from(sessions)).resolves.toStrictEqual([
      {
        id: 1,
        ...SESSION,
        openedAt: ANY_INSTANT,
        lastUsedAt: ANY_INSTANT,
        endedAt: null,
        endReason: null,
      },
    ]);
    await expect(sameToken).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'sessions_token_hash_unique' },
    });
  });

  it('[CL-TRV-05] ends a session with one reason of the glossary, restored included', async () => {
    const reasons = ['expired', 'logged_out', 'password_changed', 'reset', 'restored'] as const;
    await db.insert(sessions).values(
      reasons.map((endReason, index) => ({
        ...SESSION,
        tokenHash: new Uint8Array(32).fill(index),
        endedAt: ENDED_AT,
        endReason,
      })),
    );

    const stored = await db
      .select({ reason: sessions.endReason })
      .from(sessions)
      .orderBy(sessions.id);
    const unknown = db
      .insert(sessions)
      .values({ ...SESSION, endedAt: ENDED_AT, endReason: sql`'kicked'` });
    const reasonless = db.insert(sessions).values({ ...SESSION, endedAt: ENDED_AT });
    const unended = db.insert(sessions).values({ ...SESSION, endReason: 'logged_out' });

    expect(stored.map((row) => row.reason)).toStrictEqual(reasons);
    await expect(unknown).rejects.toMatchObject(violationOf('sessions_end_reason_check'));
    await expect(reasonless).rejects.toMatchObject(violationOf('sessions_ended_check'));
    await expect(unended).rejects.toMatchObject(violationOf('sessions_ended_check'));
  });

  it('records each refused login at its instant', async () => {
    await db.insert(loginFailures).values([{}, {}]);

    await expect(db.select().from(loginFailures)).resolves.toStrictEqual([
      { id: 1, occurredAt: ANY_INSTANT },
      { id: 2, occurredAt: ANY_INSTANT },
    ]);
  });
});

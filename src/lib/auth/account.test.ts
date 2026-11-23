import { randomBytes } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { accounts, createTestDatabase, journalEntries, loginFailures, sessions } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { hashPassword, isSamePassword } from './password';

import type { Database, DatabaseResult } from '@/lib/db';

const harness = vi.hoisted(() => ({ getDb: vi.fn<() => Promise<DatabaseResult>>() }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

// Two initial passwords of the deployment configuration, the second set to reset a forgotten one.
const FIRST_INITIAL = 'first-initial-harbor-lantern';
const SECOND_INITIAL = 'second-initial-meadow-violet';
// Monday 23 November 2026, 10:00 Paris time, and an hour.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9));
const HOUR = 3_600_000;
const AN_HOUR_LATER = toEpochMs(START + HOUR);

/** A new server instance, configured with `initialPassword` ('' for none). */
async function instance(initialPassword: string) {
  vi.resetModules();
  vi.stubEnv('INITIAL_PASSWORD', initialPassword);
  return import('./account');
}

describe('the single account', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    onTestFinished(installFakeClock(fixedClock(START)));
    return database.close;
  }, 60_000);

  const ensure = async (initialPassword: string) => {
    const { ensureAccount } = await instance(initialPassword);
    return db.transaction(async (tx) => ensureAccount(tx));
  };
  const account = async () => {
    const [row] = await db.select().from(accounts);
    return row;
  };
  const openSessions = async (count: number) =>
    db.insert(sessions).values(
      Array.from({ length: count }, (_, index) => ({
        tokenHash: randomBytes(32),
        device: `Device ${String(index + 1)}`,
        openedAt: new Date(START - HOUR),
        lastUsedAt: new Date(START - HOUR),
        expiresAt: new Date(START + HOUR),
      })),
    );

  it('[TRV-57] creates the account on first use from the configured initial password, to be replaced', async () => {
    await expect(ensure(FIRST_INITIAL)).resolves.toStrictEqual({ ok: true, value: undefined });
    const created = await account();

    expect(created).toMatchObject({ id: 1, passwordStatus: 'initial', loginLockedUntil: null });
    expect(created?.passwordChangedAt).toStrictEqual(new Date(START));
    expect(created?.initialPasswordFingerprint).toBe(created?.passwordHash);
    await expect(isSamePassword(FIRST_INITIAL, created?.passwordHash ?? '')).resolves.toBe(true);
  });

  it('[TRV-63] leaves the account as it is while the initial password stays the same', async () => {
    await ensure(FIRST_INITIAL);
    const chosen = await hashPassword('chosen-password-of-owner');
    await db
      .update(accounts)
      .set({ passwordHash: chosen, passwordStatus: 'chosen' })
      .where(eq(accounts.id, 1));

    await ensure(FIRST_INITIAL);

    await expect(account()).resolves.toMatchObject({
      passwordHash: chosen,
      passwordStatus: 'chosen',
    });
    await expect(db.select().from(journalEntries)).resolves.toStrictEqual([]);
  });

  it('[TRV-63] [CA-TRV-33] makes a changed initial password the account password, ends every session and lifts the lockout', async () => {
    await ensure(FIRST_INITIAL);
    await db
      .update(accounts)
      .set({ passwordStatus: 'chosen', loginLockedUntil: new Date(START + HOUR) })
      .where(eq(accounts.id, 1));
    await openSessions(2);
    await db.insert(loginFailures).values({ occurredAt: new Date(START - HOUR) });

    await ensure(SECOND_INITIAL);
    const reset = await account();

    expect(reset).toMatchObject({
      passwordStatus: 'initial',
      loginLockedUntil: null,
      allSessionsEndedAt: new Date(START),
      allSessionsEndReason: 'reset',
    });
    await expect(isSamePassword(SECOND_INITIAL, reset?.passwordHash ?? '')).resolves.toBe(true);
    await expect(
      db.select({ endedAt: sessions.endedAt, reason: sessions.endReason }).from(sessions),
    ).resolves.toStrictEqual([
      { endedAt: new Date(START), reason: 'reset' },
      { endedAt: new Date(START), reason: 'reset' },
    ]);
    await expect(db.select().from(loginFailures)).resolves.toStrictEqual([]);
  });

  it('[TRV-63] [CA-TRV-33] resets only once: a new server instance on the same changed initial password keeps the owner password', async () => {
    await ensure(FIRST_INITIAL);
    await ensure(SECOND_INITIAL);
    const chosen = await hashPassword('chosen-password-of-owner');
    await db
      .update(accounts)
      .set({ passwordHash: chosen, passwordStatus: 'chosen' })
      .where(eq(accounts.id, 1));
    const afterReset = await account();
    onTestFinished(installFakeClock(fixedClock(AN_HOUR_LATER)));

    await ensure(SECOND_INITIAL);
    await ensure(SECOND_INITIAL);
    const later = await account();

    expect(later).toMatchObject({
      passwordHash: chosen,
      passwordStatus: 'chosen',
      allSessionsEndedAt: new Date(START),
      allSessionsEndReason: 'reset',
    });
    expect(later?.initialPasswordFingerprint).toBe(afterReset?.initialPasswordFingerprint);
    await expect(
      isSamePassword(SECOND_INITIAL, later?.initialPasswordFingerprint ?? ''),
    ).resolves.toBe(true);
    const entries = await db.select().from(journalEntries);
    expect(entries.map(({ messageKey }) => messageKey)).toStrictEqual(['password_reset']);
  });

  it('[TRV-63] [TRV-64] journals the reset without either password', async () => {
    await ensure(FIRST_INITIAL);

    await ensure(SECOND_INITIAL);
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));

    expect(entries.map(({ messageKey }) => messageKey)).toStrictEqual(['password_reset']);
    expect(JSON.stringify(entries)).not.toMatch(/initial-(harbor|meadow)/u);
  });

  it('refuses to create the account while the configuration lacks the initial password', async () => {
    await expect(ensure('')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-missing' },
    });
    await expect(account()).resolves.toBeUndefined();
  });

  it('refuses to create the account while the deployment configuration is invalid', async () => {
    vi.stubEnv('LOG_LEVEL', 'loud');

    await expect(ensure(FIRST_INITIAL)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-missing' },
    });
  });

  it('treats reading the account before it exists as a bug', async () => {
    const { lockedAccount } = await instance(FIRST_INITIAL);

    await expect(db.transaction(async (tx) => lockedAccount(tx))).rejects.toThrow(
      'The account is read before `ensureAccount` created it.',
    );
  });

  it('[TRV-63] asks nothing of the database when a server instance loads the module', async () => {
    await instance(FIRST_INITIAL);

    expect(harness.getDb).not.toHaveBeenCalled();
  });

  it('[TRV-63] checks the account once per server instance, before its first use', async () => {
    const { readyDatabase } = await instance(FIRST_INITIAL);
    await expect(readyDatabase()).resolves.toStrictEqual({ ok: true, value: db });
    await db
      .update(accounts)
      .set({ initialPasswordFingerprint: await hashPassword('another-initial-password') })
      .where(eq(accounts.id, 1));

    await readyDatabase();
    const sameInstance = await account();
    const next = await instance(FIRST_INITIAL);
    await next.readyDatabase();

    expect(harness.getDb).toHaveBeenCalledTimes(2);
    expect(sameInstance?.allSessionsEndReason).toBeNull();
    await expect(account()).resolves.toMatchObject({ allSessionsEndReason: 'reset' });
  });

  it('tries the check again at the next request after a failure', async () => {
    harness.getDb.mockResolvedValueOnce({ ok: false, error: { kind: 'database-not-configured' } });
    const { readyDatabase } = await instance(FIRST_INITIAL);

    await expect(readyDatabase()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
    await expect(readyDatabase()).resolves.toStrictEqual({ ok: true, value: db });
  });

  it('[TRV-63] tries the check again at the next request after a check that throws', async () => {
    const dropped = new Error('Connection terminated unexpectedly');
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(dropped);
    const { readyDatabase } = await instance(FIRST_INITIAL);

    const meanwhile = await Promise.allSettled([readyDatabase(), readyDatabase()]);

    expect(meanwhile).toStrictEqual([
      { status: 'rejected', reason: dropped },
      { status: 'rejected', reason: dropped },
    ]);
    expect(harness.getDb).toHaveBeenCalledOnce();
    await expect(readyDatabase()).resolves.toStrictEqual({ ok: true, value: db });
    expect(harness.getDb).toHaveBeenCalledTimes(2);
    await expect(account()).resolves.toMatchObject({ id: 1, passwordStatus: 'initial' });
  });
});

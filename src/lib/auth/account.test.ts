import { randomBytes } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { accounts, createTestDatabase, journalEntries, loginFailures, sessions } from '@/lib/db';
import { setParam } from '@/lib/params';
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
// Initial passwords one character short of the default minimum of 12, and just long enough.
const ELEVEN = 'harbor-cove';
const TWELVE = 'violet-ridge';
// A minimum the owner raised above the length of TWELVE.
const RAISED_MINIMUM = 16;
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
  const keys = async () => {
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    return entries.map(({ messageKey }) => messageKey);
  };
  // The account, its sessions and its failures, which a refused or needless check leaves as they are.
  const everything = async () =>
    Promise.all([
      db.select().from(accounts),
      db.select().from(sessions).orderBy(asc(sessions.id)),
      db.select().from(loginFailures).orderBy(asc(loginFailures.id)),
    ]);
  // The owner raises the minimum password length, never set before, to RAISED_MINIMUM.
  const raiseMinimum = async () =>
    expect(
      db.transaction(async (tx) =>
        setParam(tx, {
          key: 'auth.passwordMinLength',
          value: RAISED_MINIMUM,
          expectedVersion: 0,
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
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

  it('[TRV-64] refuses to create the account while the server environment is invalid, naming its variables', async () => {
    vi.stubEnv('LOG_LEVEL', 'loud');

    await expect(ensure(FIRST_INITIAL)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['LOG_LEVEL'] },
    });
    await expect(account()).resolves.toBeUndefined();
  });

  it('[TRV-60] refuses to create the account from an initial password shorter than auth.passwordMinLength', async () => {
    await expect(ensure(ELEVEN)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-too-short', minLength: 12 },
    });
    await expect(account()).resolves.toBeUndefined();
    await expect(db.select().from(journalEntries)).resolves.toStrictEqual([]);

    await expect(ensure(TWELVE)).resolves.toStrictEqual({ ok: true, value: undefined });
    await expect(account()).resolves.toMatchObject({ id: 1, passwordStatus: 'initial' });
  });

  it('[TRV-60] counts the characters of the initial password as a person does, not its code units', async () => {
    // A decomposed é: e and the combining acute accent, one character in two code units.
    const eleven = 'e\u{301}'.repeat(11);
    const twelve = 'e\u{301}'.repeat(12);
    expect([eleven.length, twelve.length]).toStrictEqual([22, 24]);

    await expect(ensure(eleven)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-too-short', minLength: 12 },
    });
    await expect(ensure(twelve)).resolves.toStrictEqual({ ok: true, value: undefined });
  });

  it('[TRV-60] [H-TRV-10] measures the initial password against the auth.passwordMinLength the owner set', async () => {
    await raiseMinimum();

    await expect(ensure(TWELVE)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-too-short', minLength: RAISED_MINIMUM },
    });
    await expect(account()).resolves.toBeUndefined();
  });

  it('[TRV-63] [TRV-60] refuses a reset to a too-short initial password and changes nothing, then resets to a long enough one', async () => {
    await ensure(FIRST_INITIAL);
    await db
      .update(accounts)
      .set({ passwordStatus: 'chosen', loginLockedUntil: new Date(START + HOUR) })
      .where(eq(accounts.id, 1));
    await openSessions(1);
    await db.insert(loginFailures).values({ occurredAt: new Date(START - HOUR) });
    const before = await everything();

    await expect(ensure(ELEVEN)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-too-short', minLength: 12 },
    });
    await expect(Promise.all([everything(), keys()])).resolves.toStrictEqual([before, []]);

    await expect(ensure(SECOND_INITIAL)).resolves.toStrictEqual({ ok: true, value: undefined });
    await expect(account()).resolves.toMatchObject({
      passwordStatus: 'initial',
      loginLockedUntil: null,
      allSessionsEndReason: 'reset',
    });
    await expect(keys()).resolves.toStrictEqual(['password_reset']);
  });

  it('[TRV-63] [TRV-60] does not measure again an initial password that still matches, once the minimum was raised', async () => {
    await ensure(TWELVE);
    await raiseMinimum();
    const before = await everything();

    await expect(ensure(TWELVE)).resolves.toStrictEqual({ ok: true, value: undefined });
    await expect(everything()).resolves.toStrictEqual(before);
    await expect(keys()).resolves.toStrictEqual(['parameter_changed']);
  });

  it('[TRV-64] refuses a too-short initial password with the minimum alone, never the password or its length', async () => {
    const short = 'cove-lamp';
    expect(short).toHaveLength(9);

    const refused = await ensure(short);

    expect(refused).toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-too-short', minLength: 12 },
    });
    const written = JSON.stringify([refused, await db.select().from(journalEntries)]);
    expect(written).not.toMatch(/cove|lamp|9/u);
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

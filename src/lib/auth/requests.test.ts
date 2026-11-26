import { createHash } from 'node:crypto';

import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { incidents, journalEntries, loginFailures, sessions } from '@/lib/db';
import { setParam } from '@/lib/params';
import { toEpochMs } from '@/lib/time';

import {
  accountState,
  check,
  CHOSEN,
  chosenOn,
  cookieJar,
  INITIAL,
  logIn,
  MINUTE,
  NEWER,
  openServer,
  requestHarness,
  START,
  WRONG,
} from './request-harness';
import { endAllSessions, purgeExpired } from './sessions';

import type { Database, DatabaseResult } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// The session cookie of the requests, which the `next/headers` mock below gives them.
const jar = cookieJar();

// The database behind `getDb()`.
const harness = vi.hoisted(() => ({ getDb: vi.fn<() => Promise<DatabaseResult>>() }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

// The cookies of one request: those the device sent, and those the response sets.
vi.mock(import('next/headers'), () => ({ cookies: async () => jar.cookies() }));

// Durations after the start of each test, and the page that a device is sent to.
const HOUR = 3_600_000;
const DAY = 86_400_000;
const LOG_IN = '/log-in?next=%2Fplayers';
// How the owner ends every session at once (IHM-08, CL-TRV-05), and the answers to a login.
const OWNER_REASONS = ['logged_out', 'password_changed', 'reset', 'restored'] as const;
const SESSION_ENDED = { ok: false, error: { kind: 'session-ended' } };
const LOGGED_IN = { ok: true, value: { passwordStatus: 'chosen' } };

const { instance, lastSent, device } = requestHarness(jar, vi);

/** The answer that sends a device to log in, with how its session ended. */
function ended(reason: string | null) {
  return { ok: false, error: { kind: 'log-in', redirect: LOG_IN, ended: reason } };
}

describe('logging in and the sessions of the devices', { timeout: 60_000 }, () => {
  type Auth = Awaited<ReturnType<typeof instance>>;

  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const server = await openServer();
    ({ db, clock } = server);
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    onTestFinished(server.restoreClock);
    return server.close;
  }, 60_000);

  // Wrong passwords two minutes apart, from a stranger's devices; the last one's answer.
  const wrongTimes = async (auth: Auth, times: number): Promise<unknown> => {
    clock.advance(2 * MINUTE);
    const refused = await logIn(auth, device(), WRONG);
    return times > 1 ? wrongTimes(auth, times - 1) : refused;
  };
  // The owner's overrides of parameters never set before, each saved in its own transaction.
  const override = async (...changes: readonly Parameters<typeof setParam>[1][]) => {
    for (const change of changes) {
      await expect(db.transaction(async (tx) => setParam(tx, change))).resolves.toMatchObject({
        ok: true,
      });
    }
  };
  const journal = async () => db.select().from(journalEntries).orderBy(asc(journalEntries.id));
  const keys = async () => {
    const entries = await journal();
    return entries.map(({ messageKey }) => messageKey);
  };

  it('[TRV-62] opens a session in an HttpOnly, Secure, SameSite=Lax cookie whose token only the hash of is stored', async () => {
    const auth = await instance();
    const phone = device();

    await expect(logIn(auth, phone, INITIAL)).resolves.toStrictEqual({
      ok: true,
      value: { passwordStatus: 'initial' },
    });
    const [token = '', loggedInAt] = phone.kept.cookie?.split('.', 2) ?? [];
    const bytes = Buffer.from(token, 'base64url');
    const stored = await db
      .select({ hash: sessions.tokenHash, device: sessions.device })
      .from(sessions);

    expect(lastSent()).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect([bytes.length, Number(loggedInAt)]).toStrictEqual([32, START]);
    expect(stored).toStrictEqual([
      { hash: new Uint8Array(createHash('sha256').update(bytes).digest()), device: 'Phone' },
    ]);
  });

  it('[TRV-61] journals and counts a wrong password, and gives no session', async () => {
    const auth = await instance();
    const phone = device();

    await expect(logIn(auth, phone, WRONG)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'wrong-password', lockedUntil: null },
    });
    expect(phone.kept.cookie).toBeUndefined();
    await expect(keys()).resolves.toStrictEqual(['login_refused']);
    await expect(
      db.select({ at: loginFailures.occurredAt }).from(loginFailures),
    ).resolves.toStrictEqual([{ at: new Date(START) }]);
  });

  it('[TRV-61] [CA-TRV-20] locks logins after five wrong passwords in ten minutes, the right one included, with the incident', async () => {
    const auth = await instance();
    const lockedUntil = START + 25 * MINUTE;

    await expect(wrongTimes(auth, 5)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'wrong-password', lockedUntil },
    });
    await expect(logIn(auth, device(), INITIAL)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'locked', lockedUntil },
    });
    await expect(keys()).resolves.toStrictEqual([
      ...Array.from({ length: 5 }, () => 'login_refused'),
      'login_locked',
      'incident_opened',
      'login_refused_while_locked',
    ]);
    await expect(
      db.select({ kind: incidents.kind, status: incidents.status }).from(incidents),
    ).resolves.toStrictEqual([{ kind: 'logins_refused', status: 'open' }]);
    await expect(auth.lockoutStatus()).resolves.toStrictEqual({ ok: true, value: { lockedUntil } });
  });

  it('[TRV-61] lets the right password in once the lockout ends, which closes the incident, and counts afresh', async () => {
    const auth = await instance();
    await wrongTimes(auth, 5);
    clock.advance(15 * MINUTE);

    await expect(logIn(auth, device(), INITIAL)).resolves.toMatchObject({ ok: true });
    await expect(db.select({ status: incidents.status }).from(incidents)).resolves.toStrictEqual([
      { status: 'closed' },
    ]);
    await expect(logIn(auth, device(), WRONG)).resolves.toMatchObject({
      error: { lockedUntil: null },
    });
    await expect(auth.lockoutStatus()).resolves.toStrictEqual({
      ok: true,
      value: { lockedUntil: null },
    });
  });

  it('[TRV-61] [H-TRV-10] locks logins after auth.loginFailureThreshold failures for auth.lockoutMinutes, then counts afresh', async () => {
    const auth = await instance();
    await override(
      { key: 'auth.loginFailureThreshold', value: 3, expectedVersion: 0 },
      { key: 'auth.lockoutMinutes', value: 5, expectedVersion: 0 },
      { key: 'auth.loginFailureWindowMinutes', value: 30, expectedVersion: 0 },
    );
    const firstLock = START + 11 * MINUTE;

    await expect(wrongTimes(auth, 3)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'wrong-password', lockedUntil: firstLock },
    });
    clock.advance(4 * MINUTE);
    await expect(logIn(auth, device(), INITIAL)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'locked', lockedUntil: firstLock },
    });
    clock.advance(MINUTE);
    await expect(wrongTimes(auth, 2)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'wrong-password', lockedUntil: null },
    });
    await expect(wrongTimes(auth, 1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'wrong-password', lockedUntil: START + 22 * MINUTE },
    });
  });

  it('[TRV-61] [H-TRV-10] counts only the failures within auth.loginFailureWindowMinutes', async () => {
    const auth = await instance();
    await override({ key: 'auth.loginFailureWindowMinutes', value: 7, expectedVersion: 0 });

    await expect(wrongTimes(auth, 6)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'wrong-password', lockedUntil: null },
    });
    clock.advance(MINUTE);
    await expect(logIn(auth, device(), WRONG)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'wrong-password', lockedUntil: START + 28 * MINUTE },
    });
  });

  it('[TRV-64] [TRV-61] keeps every password out of the journal', async () => {
    const auth = await instance();
    await wrongTimes(auth, 5);
    clock.advance(15 * MINUTE);
    await chosenOn(auth, device());

    expect(JSON.stringify(await journal())).not.toMatch(/harbor|meadow|stranger/u);
  });

  it('[TRV-58] asks nothing of the database without a session cookie, and sends the device to log in', async () => {
    const auth = await instance();

    await expect(check(auth, device())).resolves.toStrictEqual(ended(null));
    expect(harness.getDb).not.toHaveBeenCalled();
  });

  it('[TRV-57] sends a session on the initial password to "Choose your password", then lets it in', async () => {
    const auth = await instance();
    const phone = device();
    await logIn(auth, phone, INITIAL);

    await expect(check(auth, phone)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'choose-password', redirect: '/choose-password' },
    });
    await expect(phone.request(async () => auth.choosePassword(CHOSEN))).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    await expect(check(auth, phone)).resolves.toMatchObject({
      ok: true,
      value: { device: 'Phone' },
    });
  });

  it('[TRV-62] [CA-TRV-32] keeps a session used within every 30 days open, and asks for a login after 30 days unused', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);

    clock.advance(29 * DAY);
    await expect(check(auth, phone)).resolves.toMatchObject({ ok: true });
    clock.advance(29 * DAY);
    await expect(check(auth, phone)).resolves.toMatchObject({ ok: true });
    clock.advance(30 * DAY);
    await expect(check(auth, phone)).resolves.toStrictEqual(ended('expired'));
  });

  it('[TRV-62] [H-TRV-10] ends a session unused for the auth.sessionIdleDays the owner set', async () => {
    const auth = await instance();
    await override({ key: 'auth.sessionIdleDays', value: 7, expectedVersion: 0 });
    const phone = device();
    await chosenOn(auth, phone);

    clock.advance(6 * DAY);
    await expect(check(auth, phone)).resolves.toMatchObject({ ok: true });
    clock.advance(6 * DAY);
    await expect(check(auth, phone)).resolves.toMatchObject({ ok: true });
    clock.advance(7 * DAY);
    await expect(check(auth, phone)).resolves.toStrictEqual(ended('expired'));
  });

  it('[TRV-60] [CA-TRV-31] ends the phone session when the password changes on the computer, which continues', async () => {
    const auth = await instance();
    const [phone, computer] = [device(), device('Computer')];
    await chosenOn(auth, computer);
    await logIn(auth, phone, CHOSEN);
    clock.advance(HOUR);

    await expect(
      computer.request(async () =>
        auth.changePassword({ currentPassword: CHOSEN, newPassword: NEWER }),
      ),
    ).resolves.toStrictEqual({ ok: true, value: undefined });

    await expect(check(auth, phone)).resolves.toStrictEqual(ended('password_changed'));
    await expect(check(auth, computer)).resolves.toMatchObject({
      ok: true,
      value: { device: 'Computer', openedAt: START + HOUR, passwordStatus: 'chosen' },
    });
    await expect(logIn(auth, device(), CHOSEN)).resolves.toMatchObject({ ok: false });
    await expect(keys()).resolves.toContain('password_changed');
  });

  it('[TRV-60] refuses a password shorter than auth.passwordMinLength', async () => {
    const auth = await instance();
    const phone = device();
    await logIn(auth, phone, INITIAL);

    await expect(
      phone.request(async () => auth.choosePassword('a'.repeat(11))),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'too-short', minLength: 12 },
    });
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'auth.passwordMinLength', value: 16, expectedVersion: 0 }),
    );
    await expect(
      phone.request(async () => auth.choosePassword('b'.repeat(15))),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'too-short', minLength: 16 },
    });
    await expect(
      phone.request(async () => auth.choosePassword('c'.repeat(16))),
    ).resolves.toMatchObject({
      ok: true,
    });
  });

  it('[TRV-60] refuses a change without the current password, and a second "Choose your password"', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);

    await expect(
      phone.request(async () =>
        auth.changePassword({ currentPassword: WRONG, newPassword: NEWER }),
      ),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'wrong-password', lockedUntil: null } });
    await expect(phone.request(async () => auth.choosePassword(NEWER))).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'password-already-chosen' },
    });
    await expect(
      device().request(async () =>
        auth.changePassword({ currentPassword: CHOSEN, newPassword: NEWER }),
      ),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'no-session' } });
  });

  it('[TRV-60] [TRV-61] refuses a too-short new password before examining the current one, and counts nothing', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);

    await expect(
      phone.request(async () =>
        auth.changePassword({ currentPassword: WRONG, newPassword: 'a'.repeat(11) }),
      ),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'too-short', minLength: 12 } });
    await expect(db.select().from(loginFailures)).resolves.toStrictEqual([]);
    await expect(keys()).resolves.toStrictEqual(['password_changed']);
  });

  it('[TRV-60] [TRV-57] refuses every login while the initial password is shorter than auth.passwordMinLength, and sets no cookie', async () => {
    const short = 'a'.repeat(11);
    const auth = await instance(short);
    const phone = device();

    await expect(logIn(auth, phone, short)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'initial-password-too-short', minLength: 12 },
    });
    expect(lastSent()).toBeUndefined();
    expect(phone.kept.cookie).toBeUndefined();
  });

  it('[IHM-08] tells a device logged out of all devices, even once its token is gone', async () => {
    const auth = await instance();
    const [phone, computer] = [device(), device('Computer')];
    await chosenOn(auth, computer);
    await logIn(auth, phone, CHOSEN);
    clock.advance(HOUR);

    await expect(computer.request(async () => auth.logOut('all-devices'))).resolves.toMatchObject({
      ok: true,
    });
    expect(computer.kept.cookie).toBeUndefined();
    await expect(check(auth, phone)).resolves.toStrictEqual(ended('logged_out'));
    clock.advance(31 * DAY);
    await db.transaction(async (tx) =>
      purgeExpired(tx, { now: toEpochMs(START + HOUR + 31 * DAY) }),
    );
    await expect(check(auth, phone)).resolves.toStrictEqual(ended('logged_out'));
  });

  it('[IHM-08] [DSN-33] tells a device whose session had expired that every device was logged out, before and after the purge', async () => {
    const auth = await instance();
    const [phone, computer] = [device(), device('Computer')];
    await chosenOn(auth, phone);
    clock.advance(31 * DAY);
    await logIn(auth, computer, CHOSEN);

    await computer.request(async () => auth.logOut('all-devices'));

    await expect(check(auth, phone)).resolves.toStrictEqual(ended('logged_out'));
    await db.transaction(async (tx) => purgeExpired(tx, { now: toEpochMs(START + 31 * DAY) }));
    await expect(check(auth, phone)).resolves.toStrictEqual(ended('logged_out'));
  });

  it('[IHM-08] [IHM-11] answers expiry to a device that logged in after the last ending of every session', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);

    clock.advance(31 * DAY);
    await db.transaction(async (tx) => purgeExpired(tx, { now: toEpochMs(START + 31 * DAY) }));

    await expect(check(auth, phone)).resolves.toStrictEqual(ended('expired'));
    await expect(check(auth, device('Phone', 'not-a-session'))).resolves.toStrictEqual(ended(null));
  });

  it('[IHM-08] logs out this device only', async () => {
    const auth = await instance();
    const [phone, computer] = [device(), device('Computer')];
    await chosenOn(auth, computer);
    await logIn(auth, phone, CHOSEN);
    const phoneCookie = phone.kept.cookie;

    await expect(phone.request(async () => auth.logOut('this-device'))).resolves.toMatchObject({
      ok: true,
    });

    await expect(check(auth, device('Phone', phoneCookie))).resolves.toStrictEqual(
      ended('logged_out'),
    );
    await expect(check(auth, computer)).resolves.toMatchObject({ ok: true });
    await expect(phone.request(async () => auth.logOut('this-device'))).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no-session' },
    });
  });

  it('[CL-TRV-05] answers "restored" to a device whose session a restore ended', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);

    await db.transaction(async (tx) => endAllSessions(tx, 'restored'));

    await expect(check(auth, phone)).resolves.toStrictEqual(ended('restored'));
    await expect(
      phone.request(async () =>
        auth.changePassword({ currentPassword: CHOSEN, newPassword: NEWER }),
      ),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'no-session' } });
    await expect(phone.request(async () => auth.logOut('all-devices'))).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no-session' },
    });
  });

  // The owner ends every session, from another device or on the server; the password then.
  type OwnerReason = (typeof OWNER_REASONS)[number];
  const endEverySession = async (auth: Auth, reason: OwnerReason): Promise<string> => {
    if (reason === 'reset' || reason === 'restored') {
      await db.transaction(async (tx) => endAllSessions(tx, reason));
      return CHOSEN;
    }
    const computer = device('Computer');
    await logIn(auth, computer, CHOSEN);
    await computer.request(async () =>
      reason === 'logged_out'
        ? auth.logOut('all-devices')
        : auth.changePassword({ currentPassword: CHOSEN, newPassword: NEWER }),
    );
    return reason === 'logged_out' ? CHOSEN : NEWER;
  };

  it.each(
    OWNER_REASONS.flatMap((reason) => [
      { reason, typed: 'the right password', wrong: false },
      { reason, typed: 'a wrong password', wrong: true },
    ]),
  )(
    '[IHM-08] [CL-IHM-10] [CL-TRV-05] refuses a device whose session ended by $reason, with $typed, before examining it, and opens, counts and journals nothing',
    async ({ reason, wrong }) => {
      const auth = await instance();
      const phone = device();
      await chosenOn(auth, phone);
      const right = await endEverySession(auth, reason);
      await expect(check(auth, phone)).resolves.toStrictEqual(ended(reason));
      const before = await accountState(db, auth);

      await expect(logIn(auth, phone, wrong ? WRONG : right)).resolves.toStrictEqual(SESSION_ENDED);
      expect(lastSent()).toBeUndefined();
      await expect(accountState(db, auth)).resolves.toStrictEqual(before);
    },
  );

  it('[IHM-08] [CL-IHM-10] [TRV-61] refuses a device whose session the owner ended while logins are locked as such, not as locked, and journals and counts nothing', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    await endEverySession(auth, 'logged_out');
    await wrongTimes(auth, 5);
    const before = await accountState(db, auth);

    expect(before.lockout).toStrictEqual({ ok: true, value: { lockedUntil: START + 25 * MINUTE } });
    await expect(logIn(auth, phone, CHOSEN)).resolves.toStrictEqual(SESSION_ENDED);
    expect(lastSent()).toBeUndefined();
    await expect(accountState(db, auth)).resolves.toStrictEqual(before);
  });

  it('[IHM-08] [CL-TRV-05] refuses a device that logged in again between two endings of every session, with the cookie of its second session', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    await endEverySession(auth, 'logged_out');
    // The step of the login page removes the cookie of the ended session.
    phone.kept.cookie = undefined;
    clock.advance(MINUTE);
    await expect(logIn(auth, phone, CHOSEN)).resolves.toStrictEqual(LOGGED_IN);
    const second = phone.kept.cookie;
    clock.advance(MINUTE);
    await endEverySession(auth, 'restored');

    await expect(logIn(auth, phone, CHOSEN)).resolves.toStrictEqual(SESSION_ENDED);
    expect([second, phone.kept.cookie]).toStrictEqual([expect.any(String), second]);
  });

  it('[IHM-08] [DSN-33] refuses a device whose session had expired when every device was logged out, before and after the purge', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    clock.advance(31 * DAY);
    await endEverySession(auth, 'logged_out');

    await expect(logIn(auth, phone, CHOSEN)).resolves.toStrictEqual(SESSION_ENDED);
    await db.transaction(async (tx) => purgeExpired(tx, { now: toEpochMs(START + 31 * DAY) }));
    await expect(logIn(auth, phone, CHOSEN)).resolves.toStrictEqual(SESSION_ENDED);
  });

  it('[IHM-11] [TRV-62] logs in a device whose session expired with no ending since, in a new session', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    const expired = phone.kept.cookie;
    clock.advance(31 * DAY);
    await expect(check(auth, phone)).resolves.toStrictEqual(ended('expired'));
    const before = await accountState(db, auth);

    await expect(logIn(auth, phone, CHOSEN)).resolves.toStrictEqual(LOGGED_IN);
    expect(lastSent()?.value).toBe(phone.kept.cookie);
    expect(phone.kept.cookie).not.toBe(expired);
    const { sessions: after } = await accountState(db, auth);
    expect(after).toHaveLength(before.sessions.length + 1);
  });

  it('[TRV-62] logs in as before a device with an open session, and one with a cookie that names no session', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    const open = phone.kept.cookie;
    const stranger = device('Computer', 'not-a-session');

    await expect(logIn(auth, phone, CHOSEN)).resolves.toStrictEqual(LOGGED_IN);
    await expect(logIn(auth, stranger, CHOSEN)).resolves.toStrictEqual(LOGGED_IN);
    expect(phone.kept.cookie).not.toBe(open);
    expect(stranger.kept.cookie).not.toBe('not-a-session');
  });

  it.each([
    ['logIn', async (auth: Auth) => auth.logIn({ password: INITIAL, device: 'Phone' })],
    ['lockoutStatus', async (auth: Auth) => auth.lockoutStatus()],
    ['currentSession', async (auth: Auth) => auth.currentSession()],
    ['requireSession', async (auth: Auth) => auth.requireSession('/players')],
    ['choosePassword', async (auth: Auth) => auth.choosePassword(CHOSEN)],
    ['logOut', async (auth: Auth) => auth.logOut('this-device')],
  ])('%s says so when no database is configured', async (_, call) => {
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });
    const auth = await instance();

    await expect(
      device('Phone', 'a-cookie').request(async () => call(auth)),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
  });
});

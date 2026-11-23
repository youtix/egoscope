import { createHash } from 'node:crypto';

import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, incidents, journalEntries, loginFailures, sessions } from '@/lib/db';
import { setParam } from '@/lib/params';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { endAllSessions, purgeExpired } from './sessions';

import type { Database, DatabaseResult } from '@/lib/db';
import type { FixedClock } from '@/lib/time';
import type { NextResponse } from 'next/server';

type SentCookie = ReturnType<NextResponse['cookies']['get']>;

// The database behind `getDb()`, the session cookie the device sends and the one it receives.
const harness = vi.hoisted(() => ({
  name: '__Host-egoscope-session',
  getDb: vi.fn<() => Promise<DatabaseResult>>(),
  incoming: undefined as string | undefined,
  sent: undefined as SentCookie,
}));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

// The cookies of one request: those the device sent, and those the response sets.
vi.mock(import('next/headers'), () => ({
  cookies: async () => {
    const server = await import('next/server');
    const incoming = new server.NextRequest('https://egoscope.test/').cookies;
    if (harness.incoming !== undefined) {
      incoming.set(harness.name, harness.incoming);
    }
    const outgoing = new server.NextResponse().cookies;
    const set = (...args: Parameters<typeof outgoing.set>) => {
      harness.sent = outgoing.set(...args).get(harness.name);
      return outgoing;
    };
    return Object.assign(incoming, { set, delete: outgoing.delete.bind(outgoing) });
  },
}));

const INITIAL = 'initial-harbor-lantern';
const CHOSEN = 'chosen-meadow-violet-quartz';
const NEWER = 'newer-copper-falcon-river';
const WRONG = 'wrong-guess-of-a-stranger';
// Monday 23 November 2026, 10:00 Paris time, and durations.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9));
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const LOG_IN = '/log-in?next=%2Fplayers';

type Auth = Awaited<ReturnType<typeof instance>>;

/** A new server instance, configured with the initial password. */
async function instance() {
  vi.resetModules();
  vi.stubEnv('INITIAL_PASSWORD', INITIAL);
  return import('./requests');
}

/** The cookie the last request set, read after the request has run. */
function lastSent(): SentCookie {
  return harness.sent;
}

/** A browser: the session cookie it keeps, sent with each request and replaced by the one it gets. */
function device(name = 'Phone', cookie?: string) {
  const kept: { cookie: string | undefined } = { cookie };
  const request = async <T>(call: () => Promise<T>): Promise<T> => {
    harness.incoming = kept.cookie;
    harness.sent = undefined;
    const result = await call();
    const sent = lastSent();
    if (sent !== undefined) {
      kept.cookie = sent.maxAge === 0 ? undefined : sent.value;
    }
    return result;
  };
  return { name, kept, request };
}

type Device = ReturnType<typeof device>;

/** Logs `on` in with `password`. */
async function logIn(auth: Auth, on: Device, password: string) {
  return on.request(async () => auth.logIn({ password, device: on.name }));
}

/** The session check of a page that `on` opens. */
async function check(auth: Auth, on: Device) {
  return on.request(async () => auth.requireSession('/players'));
}

/** Logs `on` in with the initial password, then replaces it. */
async function chosenOn(auth: Auth, on: Device) {
  await logIn(auth, on, INITIAL);
  await on.request(async () => auth.choosePassword(CHOSEN));
}

/** The answer that sends a device to log in, with how its session ended. */
function ended(reason: string | null) {
  return { ok: false, error: { kind: 'log-in', redirect: LOG_IN, ended: reason } };
}

describe('logging in and the sessions of the devices', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    clock = fixedClock(START);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  // Wrong passwords two minutes apart, from a stranger's devices; the last one's answer.
  const wrongTimes = async (auth: Auth, times: number): Promise<unknown> => {
    clock.advance(2 * MINUTE);
    const refused = await logIn(auth, device(), WRONG);
    return times > 1 ? wrongTimes(auth, times - 1) : refused;
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
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'wrong-password' } });
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

import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { accounts, incidents, journalEntries, loginFailures, sessions } from '@/lib/db';

import {
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

import type { Database, DatabaseResult } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// The lockout of logins (TRV-61) as the requests reach it, for a wrong current password at a
// password change; the lockout by wrong logins alone is proven in `requests.test.ts`.

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

const { instance, device } = requestHarness(jar, vi);

type Auth = Awaited<ReturnType<typeof instance>>;
type Device = ReturnType<typeof device>;

/** Asks from `on` to change the password from `currentPassword` to `newPassword`. */
async function change(
  auth: Auth,
  on: Device,
  [currentPassword, newPassword]: readonly [string, string],
) {
  return on.request(async () => auth.changePassword({ currentPassword, newPassword }));
}

describe('the lockout of logins at a password change', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const server = await openServer();
    ({ db, clock } = server);
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    onTestFinished(server.restoreClock);
    return server.close;
  }, 60_000);

  // Wrong passwords two minutes apart, from a stranger's devices.
  const wrongLogins = async (auth: Auth, times: number): Promise<void> => {
    clock.advance(2 * MINUTE);
    await logIn(auth, device(), WRONG);
    if (times > 1) {
      await wrongLogins(auth, times - 1);
    }
  };
  // Wrong current passwords at a change from `on`, a minute apart; every answer, in order.
  const wrongChanges = async (auth: Auth, on: Device, times: number): Promise<unknown[]> => {
    clock.advance(MINUTE);
    const refused = await change(auth, on, [WRONG, NEWER]);
    return times > 1 ? [refused, ...(await wrongChanges(auth, on, times - 1))] : [refused];
  };
  const failures = async () =>
    db.select({ at: loginFailures.occurredAt }).from(loginFailures).orderBy(asc(loginFailures.id));
  const journal = async () => db.select().from(journalEntries).orderBy(asc(journalEntries.id));
  const keys = async () => {
    const entries = await journal();
    return entries.map(({ messageKey }) => messageKey);
  };
  // The account's row, its sessions and its failures, which a refusal while locked leaves alone.
  const accountState = async () =>
    Promise.all([
      db.select().from(accounts),
      db.select().from(sessions).orderBy(asc(sessions.id)),
      failures(),
    ]);

  it('[TRV-61] [CL-TRV-29] [IHM-09] counts and journals a wrong current password at a change as a wrong login, and locks logins at the fifth', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    const notYet = { ok: false, error: { kind: 'wrong-password', lockedUntil: null } };
    const lockedUntil = START + 20 * MINUTE;

    await expect(wrongChanges(auth, phone, 5)).resolves.toStrictEqual([
      notYet,
      notYet,
      notYet,
      notYet,
      { ok: false, error: { kind: 'wrong-password', lockedUntil } },
    ]);
    await expect(failures()).resolves.toStrictEqual(
      [1, 2, 3, 4, 5].map((minutes) => ({ at: new Date(START + minutes * MINUTE) })),
    );
    await expect(keys()).resolves.toStrictEqual([
      'password_changed',
      ...Array.from({ length: 5 }, () => 'password_change_refused'),
      'login_locked',
      'incident_opened',
    ]);
    await expect(
      db.select({ kind: incidents.kind, status: incidents.status }).from(incidents),
    ).resolves.toStrictEqual([{ kind: 'logins_refused', status: 'open' }]);
    await expect(auth.lockoutStatus()).resolves.toStrictEqual({ ok: true, value: { lockedUntil } });
  });

  it('[TRV-61] [CL-TRV-29] [IHM-07] [IHM-09] [CA-TRV-31] refuses a change while logins are locked without examining either password, and allows it once the lock ends', async () => {
    const auth = await instance();
    const [phone, computer] = [device(), device('Computer')];
    await chosenOn(auth, computer);
    await logIn(auth, phone, CHOSEN);
    await wrongChanges(auth, computer, 5);
    const lockedUntil = START + 20 * MINUTE;
    const locked = { ok: false, error: { kind: 'locked', lockedUntil } };
    const before = await accountState();

    expect([
      await change(auth, computer, [CHOSEN, NEWER]),
      await change(auth, computer, [WRONG, 'short']),
      await logIn(auth, device(), CHOSEN),
    ]).toStrictEqual([locked, locked, locked]);
    await expect(accountState()).resolves.toStrictEqual(before);
    await expect(keys()).resolves.toStrictEqual([
      'password_changed',
      ...Array.from({ length: 5 }, () => 'password_change_refused'),
      'login_locked',
      'incident_opened',
      'password_change_refused_while_locked',
      'password_change_refused_while_locked',
      'login_refused_while_locked',
    ]);
    const entries = await journal();
    expect(entries.slice(-3).map(({ messageParams }) => messageParams)).toStrictEqual(
      Array.from({ length: 3 }, () => ({ lockedUntilAt: lockedUntil })),
    );

    clock.advance(15 * MINUTE);
    // A change is no login: the incident stays open and the failures stay counted.
    expect([
      await change(auth, computer, [CHOSEN, NEWER]),
      await check(auth, phone),
      await check(auth, computer),
      await db.select({ status: incidents.status }).from(incidents),
      await failures(),
    ]).toStrictEqual([
      { ok: true, value: undefined },
      {
        ok: false,
        error: { kind: 'log-in', redirect: '/log-in?next=%2Fplayers', ended: 'password_changed' },
      },
      expect.objectContaining({ ok: true }),
      [{ status: 'open' }],
      before[2],
    ]);
  });

  it('[TRV-61] [CL-TRV-29] [IHM-09] adds up the failures of logins and of changes: three wrong logins and two wrong current passwords lock logins', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    const lockedUntil = START + 23 * MINUTE;

    await wrongLogins(auth, 3);
    await expect(wrongChanges(auth, phone, 2)).resolves.toStrictEqual([
      { ok: false, error: { kind: 'wrong-password', lockedUntil: null } },
      { ok: false, error: { kind: 'wrong-password', lockedUntil } },
    ]);
    await expect(logIn(auth, device(), CHOSEN)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'locked', lockedUntil },
    });
    await expect(keys()).resolves.toStrictEqual([
      'password_changed',
      'login_refused',
      'login_refused',
      'login_refused',
      'password_change_refused',
      'password_change_refused',
      'login_locked',
      'incident_opened',
      'login_refused_while_locked',
    ]);
  });

  it('[TRV-64] [TRV-61] [CL-TRV-29] keeps every password out of the journal and the failures of a change', async () => {
    const auth = await instance();
    const phone = device();
    await chosenOn(auth, phone);
    await wrongChanges(auth, phone, 5);
    await change(auth, phone, [CHOSEN, NEWER]);
    clock.advance(15 * MINUTE);

    await expect(change(auth, phone, [CHOSEN, NEWER])).resolves.toMatchObject({ ok: true });
    const written = JSON.stringify([await journal(), await db.select().from(loginFailures)]);
    expect(written).not.toMatch(/harbor|stranger|meadow|copper/u);
  });

  it('[TRV-57] [TRV-61] [CL-TRV-29] lets the first device choose its password while logins are locked, without counting or journaling a refusal', async () => {
    const auth = await instance();
    const phone = device();
    await logIn(auth, phone, INITIAL);
    await wrongLogins(auth, 5);
    clock.advance(MINUTE);

    await expect(phone.request(async () => auth.choosePassword(CHOSEN))).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect([
      await failures(),
      await keys(),
      await db.select({ kind: incidents.kind, status: incidents.status }).from(incidents),
      await auth.lockoutStatus(),
      await db.select({ passwordStatus: accounts.passwordStatus }).from(accounts),
      await check(auth, phone),
    ]).toStrictEqual([
      [2, 4, 6, 8, 10].map((minutes) => ({ at: new Date(START + minutes * MINUTE) })),
      [
        ...Array.from({ length: 5 }, () => 'login_refused'),
        'login_locked',
        'incident_opened',
        'password_changed',
      ],
      [{ kind: 'logins_refused', status: 'open' }],
      { ok: true, value: { lockedUntil: START + 25 * MINUTE } },
      [{ passwordStatus: 'chosen' }],
      {
        ok: true,
        value: { id: 2, device: 'Phone', openedAt: START + 11 * MINUTE, passwordStatus: 'chosen' },
      },
    ]);
  });
});

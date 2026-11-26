import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, incidents, journalEntries, loginFailures, sessions } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { LogInState } from './actions';
import type { Database, DatabaseResult } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// The database behind `getDb()`, the request's session cookie and User-Agent, the cookie
// its answer sets, and the address that `redirect()` sends the device to.
const harness = vi.hoisted(() => ({
  name: '__Host-egoscope-session',
  getDb: vi.fn<() => Promise<DatabaseResult>>(),
  incoming: undefined as string | undefined,
  sent: undefined as string | undefined,
  userAgent: null as string | null,
}));

/** What `redirect()` throws in these tests: the address it sends the device to. */
class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`Redirected to ${to}`);
    this.to = to;
  }
}

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

// The cookies and headers of one request: those the device sent, and the cookie the answer sets.
vi.mock(import('next/headers'), async (importOriginal) => ({
  ...(await importOriginal()),
  headers: async () => {
    const server = await import('next/server');
    const sent = harness.userAgent === null ? {} : { 'user-agent': harness.userAgent };
    return new server.NextRequest('https://egoscope.test/', { headers: sent }).headers;
  },
  cookies: async () => {
    const server = await import('next/server');
    const incoming = new server.NextRequest('https://egoscope.test/').cookies;
    if (harness.incoming !== undefined) {
      incoming.set(harness.name, harness.incoming);
    }
    const outgoing = new server.NextResponse().cookies;
    const set = (...args: Parameters<typeof outgoing.set>) => {
      harness.sent = outgoing.set(...args).get(harness.name)?.value;
      return outgoing;
    };
    return Object.assign(incoming, { set, delete: outgoing.delete.bind(outgoing) });
  },
}));

const INITIAL = 'initial-harbor-lantern';
const RESET_TO = 'second-initial-orchard-kite';
const CHOSEN = 'chosen-meadow-violet-quartz';
const WRONG = 'wrong-guess-of-a-stranger';
const PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
// Monday 23 November 2026, 10:00 Paris time, and a minute.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9));
const MINUTE = 60_000;
const NEXT = '/players/12?tab=cases';
const NOTHING_YET: LogInState = { lockout: null };
const WRONG_PASSWORD = { password: 'This password is wrong: type it again.' };
const NOT_CHECKED = {
  message: 'The app cannot check your password right now: try again in a few minutes.',
  lockout: null,
};

type Actions = Awaited<ReturnType<typeof instance>>;

/** Where a sent form leads: another address, or what the form shows; and the cookie set. */
type Outcome = Readonly<{ to?: string; state?: LogInState; cookie: string | undefined }>;

/** A new server instance, configured with the initial password `initial`. */
async function instance(initial = INITIAL) {
  vi.resetModules();
  vi.stubEnv('INITIAL_PASSWORD', initial);
  const auth = await import('@/lib/auth');
  const actions = await import('./actions');
  return { ...auth, ...actions };
}

/** A new server instance, its environment set to `variables`. */
async function serverWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./actions');
}

/** The form of the login screen, holding `password`. */
function form(password: string | null): FormData {
  const data = new FormData();
  if (password !== null) {
    data.set('password', password);
  }
  return data;
}

/**
 * The login form sent by a device without a session, for the screen `next`: where it
 * goes, or what the form shows; and the cookie it holds afterwards.
 */
async function submit(
  on: Actions,
  password: string | null,
  next: unknown = NEXT,
): Promise<Outcome> {
  harness.incoming = undefined;
  harness.sent = undefined;
  try {
    const state = await on.logInAction(next, NOTHING_YET, form(password));
    return { state, cookie: harness.sent };
  } catch (error) {
    if (error instanceof Redirected) {
      return { to: error.to, cookie: harness.sent };
    }
    throw error;
  }
}

describe('the login action', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    harness.userAgent = PHONE;
    clock = fixedClock(START);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  const keys = async () => {
    const entries = await db.select().from(journalEntries).orderBy(asc(journalEntries.id));
    return entries.map(({ messageKey }) => messageKey);
  };

  /** Logs a device in with the initial password, then replaces it with `CHOSEN`. */
  async function chooseOn(on: Actions): Promise<string | undefined> {
    const first = await submit(on, INITIAL);
    harness.incoming = first.cookie;
    await expect(on.choosePassword(CHOSEN)).resolves.toStrictEqual({ ok: true, value: undefined });
    return harness.sent;
  }

  /** Wrong passwords two minutes apart; the answer to the last one. */
  async function wrongTimes(on: Actions, times: number): Promise<Outcome> {
    clock.advance(2 * MINUTE);
    const refused = await submit(on, WRONG);
    return times > 1 ? wrongTimes(on, times - 1) : refused;
  }

  it('[TRV-57] [IHM-06] [CA-IHM-19] [CA-TRV-30] [IHM-11] sends a first login with the initial password to "Choose your password", with the screen asked for', async () => {
    const actions = await instance();

    const first = await submit(actions, INITIAL);

    expect(first.to).toBe('/choose-password?next=%2Fplayers%2F12%3Ftab%3Dcases');
    expect(first.cookie).toMatch(/^[\w-]{43}\.\d+$/u);
  });

  it('[CA-TRV-30] lets no other password than the initial one in on a new installation', async () => {
    const actions = await instance();

    await expect(submit(actions, CHOSEN)).resolves.toStrictEqual({
      state: { errors: WRONG_PASSWORD, lockout: null },
      cookie: undefined,
    });
  });

  it('[IHM-11] sends a login on the chosen password to the screen asked for', async () => {
    const actions = await instance();
    await chooseOn(actions);

    const login = await submit(actions, CHOSEN);

    expect(login.to).toBe(NEXT);
    expect(login.cookie).toBeDefined();
  });

  it.each([
    ['the address of another site', 'https://other.example/players'],
    ['an address without a scheme', '//other.example/players'],
    ['the login page', '/log-in'],
    ['no screen', null],
  ])('[IHM-10] [IHM-11] sends a login whose next is %s to Home', async (_case, next) => {
    const actions = await instance();
    await chooseOn(actions);

    await expect(submit(actions, CHOSEN, next)).resolves.toMatchObject({ to: '/' });
  });

  it('[IHM-10] writes neither the password nor the session token in the address it sends the device to', async () => {
    const actions = await instance();
    const first = await submit(actions, INITIAL, `/players?seen=${INITIAL}`);
    const token = first.cookie?.split('.', 1)[0] ?? '';

    expect(first.to).toBe(`/choose-password?next=%2Fplayers%3Fseen%3D${INITIAL}`);
    expect(token).toHaveLength(43);
    expect(decodeURIComponent(first.to ?? '')).not.toContain(token);
  });

  it('[IHM-06] [H-IHM-06] keeps the browser and the system of the device in its session', async () => {
    const actions = await instance();

    await submit(actions, INITIAL);

    await expect(db.select({ device: sessions.device }).from(sessions)).resolves.toStrictEqual([
      { device: 'Chrome on Android' },
    ]);
  });

  it.each([
    ['an empty field', ''],
    ['no field', null],
  ])(
    '[IHM-06] asks for the password on %s, without counting an attempt',
    async (_case, password) => {
      const actions = await instance();

      await expect(submit(actions, password)).resolves.toStrictEqual({
        state: { errors: { password: 'Type your password.' }, lockout: null },
        cookie: undefined,
      });
      await expect(db.select().from(loginFailures)).resolves.toStrictEqual([]);
      await expect(keys()).resolves.toStrictEqual([]);
    },
  );

  it('[TRV-61] [IHM-07] tells a wrong password beside its field and journals it', async () => {
    const actions = await instance();

    await expect(submit(actions, WRONG)).resolves.toStrictEqual({
      state: { errors: WRONG_PASSWORD, lockout: null },
      cookie: undefined,
    });
    await expect(keys()).resolves.toStrictEqual(['login_refused']);
  });

  it('[TRV-61] [CA-TRV-20] [IHM-07] shows until when logins are locked from the fifth wrong password', async () => {
    const actions = await instance();

    await expect(wrongTimes(actions, 5)).resolves.toStrictEqual({
      state: {
        errors: WRONG_PASSWORD,
        lockout: {
          until: START + 25 * MINUTE,
          notice: 'Login locked until Monday 23 November 2026, 10:25 Paris time',
        },
      },
      cookie: undefined,
    });
  });

  it('[TRV-61] [CA-TRV-20] [IHM-07] [CA-IHM-03] refuses the right password during the lockout without examining it, journals the attempt and opens the incident', async () => {
    const actions = await instance();
    await wrongTimes(actions, 5);
    clock.advance(MINUTE);

    await expect(submit(actions, INITIAL)).resolves.toStrictEqual({
      state: {
        lockout: {
          until: START + 25 * MINUTE,
          notice: 'Login locked until Monday 23 November 2026, 10:25 Paris time',
        },
      },
      cookie: undefined,
    });
    await expect(db.select().from(sessions)).resolves.toStrictEqual([]);
    await expect(keys()).resolves.toContain('login_refused_while_locked');
    await expect(
      db.select({ kind: incidents.kind, status: incidents.status }).from(incidents),
    ).resolves.toStrictEqual([{ kind: 'logins_refused', status: 'open' }]);
  });

  it('[TRV-61] [IHM-07] lets the right password in once the lockout ends', async () => {
    const actions = await instance();
    await wrongTimes(actions, 5);
    clock.advance(15 * MINUTE);

    await expect(submit(actions, INITIAL)).resolves.toMatchObject({
      to: '/choose-password?next=%2Fplayers%2F12%3Ftab%3Dcases',
    });
  });

  it('[TRV-63] [CA-TRV-33] after a reset, ends both sessions, refuses the old password and sends the new initial one to "Choose your password"', async () => {
    const first = await instance();
    const phone = await chooseOn(first);
    const { cookie: laptop } = await submit(first, CHOSEN);
    const reset = await instance(RESET_TO);
    const stateOf = async (cookie: string | undefined) => {
      harness.incoming = cookie;
      return reset.currentSession();
    };
    const ended = { ok: true, value: { state: 'ended', reason: 'reset' } };

    await expect(stateOf(phone)).resolves.toStrictEqual(ended);
    await expect(stateOf(laptop)).resolves.toStrictEqual(ended);
    await expect(submit(reset, CHOSEN)).resolves.toMatchObject({
      state: { errors: WRONG_PASSWORD },
    });
    await expect(submit(reset, RESET_TO)).resolves.toMatchObject({
      to: '/choose-password?next=%2Fplayers%2F12%3Ftab%3Dcases',
    });
  });

  it.each([
    ['no initial password', { INITIAL_PASSWORD: '' }],
    ['a too-short initial password', { INITIAL_PASSWORD: 'too-short' }],
    ['an invalid environment', { INITIAL_PASSWORD: INITIAL, LOG_LEVEL: 'INFO' }],
  ])(
    '[TRV-64] tells the device that the server cannot check passwords with %s',
    async (_case, variables) => {
      const { logInAction } = await serverWith(variables);

      await expect(logInAction(NEXT, NOTHING_YET, form(INITIAL))).resolves.toStrictEqual(
        NOT_CHECKED,
      );
    },
  );

  it('[TRV-64] tells the device that the server cannot check passwords without a database', async () => {
    const actions = await instance();
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(submit(actions, INITIAL)).resolves.toStrictEqual({
      state: NOT_CHECKED,
      cookie: undefined,
    });
  });

  it('[IHM-07] tells the device that the server cannot check passwords when it cannot read the lockout', async () => {
    const actions = await instance();
    await wrongTimes(actions, 4);
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });
    clock.advance(2 * MINUTE);

    await expect(submit(actions, WRONG)).resolves.toStrictEqual({
      state: NOT_CHECKED,
      cookie: undefined,
    });
  });
});

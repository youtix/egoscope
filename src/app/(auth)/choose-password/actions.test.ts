import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { ChoosePasswordState } from './actions';
import type { DatabaseResult } from '@/lib/db';

// The database behind `getDb()`, the request's session cookie, the cookie its answer sets,
// and the address that `redirect()` sends the device to.
const harness = vi.hoisted(() => ({
  name: '__Host-egoscope-session',
  getDb: vi.fn<() => Promise<DatabaseResult>>(),
  incoming: undefined as string | undefined,
  sent: undefined as string | undefined,
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

// The cookies of one request: those the device sent, and those the response sets.
vi.mock(import('next/headers'), async (importOriginal) => ({
  ...(await importOriginal()),
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
const CHOSEN = 'chosen-meadow-violet-quartz';
// Monday 23 November 2026, 10:00 Paris time.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9));
const NEXT = '/players?tab=cases';
const LOG_IN = '/log-in?next=%2Fplayers%3Ftab%3Dcases';
const NOTHING_YET: ChoosePasswordState = {};

type Server = Awaited<ReturnType<typeof instance>>;

/** Where a sent form leads: another address, or what the form shows; and the cookie set. */
type Outcome = Readonly<{ to?: string; state?: ChoosePasswordState; cookie: string | undefined }>;

/** A new server instance, configured with the initial password. */
async function instance() {
  vi.resetModules();
  vi.stubEnv('INITIAL_PASSWORD', INITIAL);
  const auth = await import('@/lib/auth');
  const actions = await import('./actions');
  return { ...auth, ...actions };
}

/** Runs `call` as a request of the device that holds `cookie`. */
async function request<T>(cookie: string | undefined, call: () => Promise<T>): Promise<T> {
  harness.incoming = cookie;
  harness.sent = undefined;
  return call();
}

/** Logs a device in with the initial password; the session cookie it then holds. */
async function logIn(on: Server): Promise<string | undefined> {
  await request(undefined, async () => on.logIn({ password: INITIAL, device: 'Phone' }));
  return harness.sent;
}

/**
 * The form of "Choose your password", holding `password`, for the screen `next`, sent by
 * the device that holds `cookie`.
 */
async function submit(
  on: Server,
  cookie: string | undefined,
  { password, next }: Readonly<{ password: string | null; next: unknown }>,
): Promise<Outcome> {
  const data = new FormData();
  if (password !== null) {
    data.set('password', password);
  }
  try {
    const state = await request(cookie, async () =>
      on.choosePasswordAction(next, NOTHING_YET, data),
    );
    return { state, cookie: harness.sent };
  } catch (error) {
    if (error instanceof Redirected) {
      return { to: error.to, cookie: harness.sent };
    }
    throw error;
  }
}

describe('the action of "Choose your password"', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  beforeEach(async () => {
    const database = await createTestDatabase();
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db: database.db });
    onTestFinished(installFakeClock(fixedClock(START)));
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  it.each([
    ['a too-short password', 'eleven-char'],
    ['an empty field', ''],
    ['no field', null],
  ])('[TRV-60] refuses %s, saying the minimum length', async (_case, password) => {
    const server = await instance();
    const phone = await logIn(server);

    await expect(submit(server, phone, { password, next: NEXT })).resolves.toStrictEqual({
      state: { errors: { password: 'This password is too short: use at least 12 characters.' } },
      cookie: undefined,
    });
  });

  it('[TRV-57] [TRV-60] [CL-TRV-15] [CA-IHM-19] [CA-TRV-30] replaces the initial password, logs every other device out, and sends this one through the login page to the screen it asked for', async () => {
    const server = await instance();
    const phone = await logIn(server);
    const laptop = await logIn(server);

    const chosen = await submit(server, phone, { password: CHOSEN, next: NEXT });

    expect(chosen.to).toBe(LOG_IN);
    await expect(
      request(chosen.cookie, async () => server.currentSession()),
    ).resolves.toMatchObject({
      ok: true,
      value: { state: 'open', session: { passwordStatus: 'chosen' } },
    });
    await expect(request(laptop, async () => server.currentSession())).resolves.toStrictEqual({
      ok: true,
      value: { state: 'ended', reason: 'password_changed' },
    });
  });

  it('[IHM-10] passes the screen asked for to the login page, which alone judges it, and never the password', async () => {
    const server = await instance();
    const phone = await logIn(server);

    const chosen = await submit(server, phone, {
      password: CHOSEN,
      next: 'https://other.example/',
    });

    expect(chosen.to).toBe('/log-in?next=https%3A%2F%2Fother.example%2F');
    expect(decodeURIComponent(chosen.to ?? '')).not.toContain(CHOSEN);
  });

  it.each([
    ['a screen that is not a text', ['/players', '/rankings']],
    ['no screen', undefined],
  ])('[IHM-11] sends the device to the login page for Home with %s', async (_case, next) => {
    const server = await instance();
    const phone = await logIn(server);

    await expect(submit(server, phone, { password: CHOSEN, next })).resolves.toMatchObject({
      to: '/log-in?next=%2F',
    });
  });

  it('[TRV-57] sends a device without a session to the login page', async () => {
    const server = await instance();

    await expect(
      submit(server, undefined, { password: CHOSEN, next: NEXT }),
    ).resolves.toStrictEqual({
      to: LOG_IN,
      cookie: undefined,
    });
  });

  it('[TRV-57] sends a device to the login page once the initial password is replaced', async () => {
    const server = await instance();
    const phone = await logIn(server);
    const chosen = await submit(server, phone, { password: CHOSEN, next: NEXT });

    await expect(
      submit(server, chosen.cookie, { password: 'another-long-password', next: NEXT }),
    ).resolves.toStrictEqual({
      to: LOG_IN,
      cookie: undefined,
    });
  });

  it('[TRV-64] says that the password cannot be saved now when the server cannot reach its database', async () => {
    const server = await instance();
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(
      submit(server, 'a-cookie.1795424400000', { password: CHOSEN, next: NEXT }),
    ).resolves.toStrictEqual({
      state: {
        message: 'The app cannot save your password right now: try again in a few minutes.',
      },
      cookie: undefined,
    });
  });
});

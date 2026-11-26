import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, sessions } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { Database, DatabaseResult } from '@/lib/db';

// The database behind `getDb()`, the request's session cookie and the one its answer sets.
const harness = vi.hoisted(() => ({
  name: '__Host-egoscope-session',
  getDb: vi.fn<() => Promise<DatabaseResult>>(),
  incoming: undefined as string | undefined,
  sent: undefined as string | undefined,
}));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// The cookies of one request: those the device sent, then those its answer sets, which
// Next.js reads back during the same request, as the control does between a login and the
// choice of the password.
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
      harness.incoming = harness.sent;
      return outgoing;
    };
    return Object.assign(incoming, { set, delete: outgoing.delete.bind(outgoing) });
  },
}));

const INITIAL = 'initial-harbor-lantern';
const WRONG = 'wrong-guess-of-a-stranger';
// Monday 23 November 2026, 10:00 Paris time.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9));
const WRONG_ATTEMPTS = 5;

/** A new hermetic server instance, configured with the initial password. */
async function hermetic() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'all');
  vi.stubEnv('INITIAL_PASSWORD', INITIAL);
  const auth = await import('@/lib/auth');
  const control = await import('./route');
  return { ...auth, ...control };
}

type Server = Awaited<ReturnType<typeof hermetic>>;

/** A request to the control from a device without a session: the answer and the cookie it sets. */
async function post(server: Server) {
  harness.incoming = undefined;
  harness.sent = undefined;
  const response = await server.POST();
  return { status: response.status, body: await response.text(), cookie: harness.sent };
}

/** `times` wrong passwords in a row, from a stranger's device. */
async function wrongTimes(server: Server, times: number): Promise<void> {
  await server.logIn({ password: WRONG, device: 'Stranger' });
  return times > 1 ? wrongTimes(server, times - 1) : undefined;
}

/** The state of the session that `cookie` stands for. */
async function stateOf(server: Server, cookie: string | undefined) {
  harness.incoming = cookie;
  const current = await server.currentSession();
  return current.ok ? current.value.state : current.error.kind;
}

describe('POST /api/test/session', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    onTestFinished(installFakeClock(fixedClock(START)));
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  const endings = async () =>
    db.select({ reason: sessions.endReason }).from(sessions).orderBy(asc(sessions.id));

  it('answers 404 with an empty body outside the hermetic mode', async () => {
    vi.resetModules();
    vi.stubEnv('INITIAL_PASSWORD', INITIAL);
    const { POST } = await import('./route');

    const response = await POST();

    expect([response.status, response.headers.get('cache-control')]).toStrictEqual([
      404,
      'no-store',
    ]);
    await expect(response.text()).resolves.toBe('');
    await expect(endings()).resolves.toStrictEqual([]);
  });

  it('[TRV-57] on a new account, logs in with the initial password, chooses a password and sets the cookie of a session on it', async () => {
    const server = await hermetic();

    const opened = await post(server);

    expect([opened.status, opened.body]).toStrictEqual([204, '']);
    await expect(stateOf(server, opened.cookie)).resolves.toBe('open');
    await expect(server.lockoutStatus()).resolves.toStrictEqual({
      ok: true,
      value: { lockedUntil: null },
    });
    await expect(endings()).resolves.toStrictEqual([
      { reason: 'password_changed' },
      { reason: null },
    ]);
  });

  it('logs in with the chosen password on later requests, leaving the earlier sessions open', async () => {
    const server = await hermetic();
    const first = await post(server);

    const second = await post(server);

    expect(second.status).toBe(204);
    await expect(stateOf(server, first.cookie)).resolves.toBe('open');
    await expect(stateOf(server, second.cookie)).resolves.toBe('open');
  });

  it('serves requests that arrive together one after another, so that every session they open stays open', async () => {
    const server = await hermetic();

    const answers = await Promise.all([server.POST(), server.POST(), server.POST()]);

    expect(answers.map(({ status }) => status)).toStrictEqual([204, 204, 204]);
    await expect(endings()).resolves.toStrictEqual([
      { reason: 'password_changed' },
      { reason: null },
      { reason: null },
      { reason: null },
    ]);
  });

  it('[TRV-61] answers 409 with the refusal while logins are locked', async () => {
    const server = await hermetic();
    await wrongTimes(server, WRONG_ATTEMPTS);

    await expect(post(server)).resolves.toStrictEqual({
      status: 409,
      body: JSON.stringify({ refused: 'locked' }),
      cookie: undefined,
    });
  });

  it('answers 409 with the refusal when the server has no database', async () => {
    const server = await hermetic();
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(post(server)).resolves.toStrictEqual({
      status: 409,
      body: JSON.stringify({ refused: 'database-not-configured' }),
      cookie: undefined,
    });
  });

  it('answers 409 with the refusal when the server has no initial password', async () => {
    vi.resetModules();
    vi.stubEnv('EGOSCOPE_FAKES', 'all');
    const { POST } = await import('./route');

    const response = await POST();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toStrictEqual({ refused: 'initial-password-missing' });
  });
});

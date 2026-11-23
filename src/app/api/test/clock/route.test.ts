import { connection } from 'next/server';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// A connection string that the schema accepts, which a hermetic server never holds.
const DATABASE_URL = 'postgresql://app@db.example.invalid/egoscope?sslmode=verify-full';
const TESTING_CLOCK = Symbol.for('egoscope.testing.fixed-clock');
// The clock that runs before the route sets one, itself stopped, so that a release shows.
const BEFORE = toEpochMs(Date.UTC(2026, 0, 5, 12));

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

/** A request to the route whose body is `body`, JSON unless it is already a text. */
const command = (body: unknown) =>
  new Request('http://localhost/api/test/clock', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** The route of a hermetic server, its environment freshly loaded. */
async function hermeticRoute() {
  vi.stubEnv('EGOSCOPE_FAKES', 'all');
  return import('./route');
}

describe('POST /api/test/clock', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    // The clock that the route sets goes with the clock before it, and its record with
    // the stubbed globals.
    vi.stubGlobal(TESTING_CLOCK, undefined);
    onTestFinished(installFakeClock(fixedClock(BEFORE)));
  });

  it("sets the server's clock at an instant and answers the instant it reads, uncached", async () => {
    const { POST } = await hermeticRoute();

    const response = await POST(command({ at: '2026-11-20T03:15:00-05:00' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({ now: '2026-11-20T08:15:00.000Z' });
    expect(now()).toBe(Date.UTC(2026, 10, 20, 8, 15));
  });

  it('moves the clock it set on, then releases it', async () => {
    const { POST } = await hermeticRoute();
    await POST(command({ at: '2026-11-20T08:15:00Z' }));

    const moved = await POST(command({ advanceMs: 90_000 }));
    const released = await POST(command({ release: true }));

    await expect(moved.json()).resolves.toStrictEqual({ now: '2026-11-20T08:16:30.000Z' });
    await expect(released.json()).resolves.toStrictEqual({ now: '2026-01-05T12:00:00.000Z' });
  });

  it('answers 409 to a move when no clock was set', async () => {
    const { POST } = await hermeticRoute();

    const response = await POST(command({ advanceMs: 90_000 }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toStrictEqual({ kind: 'no_fixed_clock' });
  });

  it.each([
    ['a body that is no JSON', '{ "at": '],
    ['an instant without its offset', { at: '2026-11-20T08:15:00' }],
  ])('answers 400 to %s, and changes nothing', async (_case, body) => {
    const { POST } = await hermeticRoute();

    const response = await POST(command(body));

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ kind: 'invalid_command' });
    expect(now()).toBe(BEFORE);
  });

  it.each([
    ['without fakes', {}],
    ['with fakes for some ports only', { EGOSCOPE_FAKES: 'telegram' }],
    ['with all the fakes beside a database URL', { EGOSCOPE_FAKES: 'all', DATABASE_URL }],
    [
      'with all the fakes on a production deployment',
      { EGOSCOPE_FAKES: 'all', VERCEL_ENV: 'production' },
    ],
  ])('answers 404 with an empty body outside the hermetic mode: %s', async (_case, variables) => {
    stubVariables(variables);
    const { POST } = await import('./route');

    const response = await POST(command({ at: '2026-11-20T08:15:00Z' }));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('');
    expect(now()).toBe(BEFORE);
  });

  it('runs at request time instead of being prerendered with the environment of the build', async () => {
    const { POST } = await import('./route');

    await POST(command({ release: true }));

    expect(vi.mocked(connection)).toHaveBeenCalledOnce();
  });
});

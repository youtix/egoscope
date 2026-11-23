import { asc } from 'drizzle-orm';
import { connection } from 'next/server';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, followedPlayers } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { Database, DatabaseResult } from '@/lib/db';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// What `getDb()` gives the route: a database that is not configured, unless a test
// serves one of its own.
const NOT_CONFIGURED: DatabaseResult = { ok: false, error: { kind: 'database-not-configured' } };
const getDb = vi.hoisted(() => vi.fn<() => Promise<DatabaseResult>>());
vi.mock(import('@/lib/db'), async (importOriginal) => ({ ...(await importOriginal()), getDb }));

// A connection string that the schema accepts, which a hermetic server never holds.
const DATABASE_URL = 'postgresql://app@db.example.invalid/egoscope?sslmode=verify-full';
const AT = toEpochMs(Date.UTC(2026, 10, 20, 8));

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

/** A request to the route whose body is `body`, JSON unless it is already a text. */
const seed = (body: unknown) =>
  new Request('http://localhost/api/test/seed', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** A database of the test's own, which the route reaches through `getDb()`. */
async function servedDatabase(): Promise<Database> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  getDb.mockResolvedValue({ ok: true, db: database.db });
  return database.db;
}

/** The route of a hermetic server, its environment freshly loaded. */
async function hermeticRoute() {
  vi.stubEnv('EGOSCOPE_FAKES', 'all');
  return import('./route');
}

describe('POST /api/test/seed', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    getDb.mockResolvedValue(NOT_CONFIGURED);
    onTestFinished(installFakeClock(fixedClock(AT)));
  });

  it('applies the scenarios named, in the order given, and answers which, uncached', async () => {
    const db = await servedDatabase();
    const { POST } = await hermeticRoute();

    const response = await POST(seed({ scenarios: ['request-to-do', 'player-without-backtest'] }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({
      applied: ['request-to-do', 'player-without-backtest'],
    });
    await expect(
      db
        .select({ name: followedPlayers.displayName })
        .from(followedPlayers)
        .orderBy(asc(followedPlayers.displayName)),
    ).resolves.toStrictEqual([{ name: 'Corwin Ashgrove' }, { name: 'Soren Vail' }]);
  });

  it('applies nothing and names the unknown scenarios', async () => {
    const db = await servedDatabase();
    const { POST } = await hermeticRoute();

    const response = await POST(seed({ scenarios: ['request-to-do', 'a-world-nobody-wrote'] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      kind: 'unknown_scenarios',
      names: ['a-world-nobody-wrote'],
    });
    await expect(db.select().from(followedPlayers)).resolves.toStrictEqual([]);
  });

  it.each([
    ['a body that is no JSON', '{ "scenarios": '],
    ['no list of scenarios', { scenario: 'request-to-do' }],
    ['a name that is no text', { scenarios: [7] }],
    ['an unknown key', { scenarios: [], reset: true }],
  ])('refuses %s, without asking for the database', async (_case, body) => {
    const { POST } = await hermeticRoute();

    const response = await POST(seed(body));

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({
      error: 'Expected { "scenarios": [names] }.',
    });
  });

  it('answers 503 with the reason when the database cannot be reached', async () => {
    const { POST } = await hermeticRoute();

    const response = await POST(seed({ scenarios: [] }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toStrictEqual({ kind: 'database-not-configured' });
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

    const response = await POST(seed({ scenarios: ['request-to-do'] }));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('');
  });

  it('runs at request time instead of being prerendered with the environment of the build', async () => {
    const { POST } = await import('./route');

    await POST(seed({ scenarios: [] }));

    expect(vi.mocked(connection)).toHaveBeenCalledOnce();
  });
});

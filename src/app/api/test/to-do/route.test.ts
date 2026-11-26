import { connection } from 'next/server';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import { todoCount } from '@/lib/todo';

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
const AT = toEpochMs(Date.UTC(2026, 10, 26, 9));

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

/** A request to the route with the method `method`, whose body is `body`, JSON unless it is already a text. */
const toDo = (method: 'POST' | 'DELETE', body: unknown) =>
  new Request('http://localhost/api/test/to-do', {
    method,
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

describe('/api/test/to-do', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    getDb.mockResolvedValue(NOT_CONFIGURED);
    onTestFinished(installFakeClock(fixedClock(AT)));
  });

  it('[IHM-16] opens the item named and answers the number of items to do, uncached', async () => {
    const db = await servedDatabase();
    const { POST } = await hermeticRoute();

    const first = await POST(toDo('POST', { name: 'desktop' }));
    const second = await POST(toDo('POST', { name: 'phone' }));

    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    await expect(first.json()).resolves.toStrictEqual({ count: 1 });
    await expect(second.json()).resolves.toStrictEqual({ count: 2 });
    await expect(todoCount(db)).resolves.toBe(2);
  });

  it('[IHM-16] closes the item named and answers the number of items to do', async () => {
    const db = await servedDatabase();
    const { DELETE, POST } = await hermeticRoute();
    await POST(toDo('POST', { name: 'desktop' }));
    await POST(toDo('POST', { name: 'phone' }));

    const response = await DELETE(toDo('DELETE', { name: 'desktop' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({ count: 1 });
    await expect(todoCount(db)).resolves.toBe(1);
  });

  it.each([
    ['a body that is no JSON', '{ "name": '],
    ['no name', { item: 'desktop' }],
    ['an empty name', { name: '' }],
    ['a name that is no text', { name: 7 }],
    ['an unknown key', { name: 'desktop', count: 3 }],
  ])('refuses %s, without asking for the database', async (_case, body) => {
    const { DELETE, POST } = await hermeticRoute();

    for (const response of [await POST(toDo('POST', body)), await DELETE(toDo('DELETE', body))]) {
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toStrictEqual({ error: 'Expected { "name": text }.' });
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it('answers 503 with the reason when the database cannot be reached', async () => {
    const { POST } = await hermeticRoute();

    const response = await POST(toDo('POST', { name: 'desktop' }));

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
    const { DELETE, POST } = await import('./route');

    for (const response of [
      await POST(toDo('POST', { name: 'desktop' })),
      await DELETE(toDo('DELETE', { name: 'desktop' })),
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.text()).resolves.toBe('');
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it('runs at request time instead of being prerendered with the environment of the build', async () => {
    const { DELETE, POST } = await import('./route');

    await POST(toDo('POST', { name: 'desktop' }));
    await DELETE(toDo('DELETE', { name: 'desktop' }));

    expect(vi.mocked(connection)).toHaveBeenCalledTimes(2);
  });
});

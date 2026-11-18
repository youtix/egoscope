import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// A connection string that the schema accepts, which a hermetic server never holds.
const DATABASE_URL = 'postgresql://app@db.example.invalid/egoscope?sslmode=verify-full';

/**
 * Exports what a developer's shell may: the fakes switch of .env.example, and a
 * connection string and a log level that the schema refuses. The environment is
 * valid or invalid as one whole, so every test here starts as if the shell did,
 * and fails if it reads them.
 */
function exportShellVariables(): void {
  vi.stubEnv('EGOSCOPE_FAKES', 'all');
  vi.stubEnv('DATABASE_URL', 'postgresql://app@db.example.invalid/egoscope?sslmode=require');
  vi.stubEnv('LOG_LEVEL', 'INFO');
}

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

describe('GET /api/test/ping', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    exportShellVariables();
    // Whatever the shell exports, each test starts from every variable of the
    // server environment pinned: no fakes, outside Vercel with no database, at
    // the default log level, with NODE_ENV as Vitest sets it.
    vi.stubEnv('EGOSCOPE_FAKES', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('LOG_LEVEL', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('answers that the server is hermetic, uncached, in the hermetic mode', async () => {
    vi.stubEnv('EGOSCOPE_FAKES', 'all');
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({ hermetic: true });
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
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('');
  });

  it('runs at request time instead of being prerendered with the environment of the build', async () => {
    const { GET } = await import('./route');

    await GET();

    expect(vi.mocked(connection)).toHaveBeenCalledOnce();
  });
});

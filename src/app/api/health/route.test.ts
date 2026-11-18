import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// A database that fails on any use: the probe answers from the environment
// alone, so that an outside monitor never wakes the database, whose compute is
// billed for five minutes after each query.
vi.mock(import('@/lib/db'), () => {
  const refuse = (): never => {
    throw new Error('/api/health must not touch the database.');
  };
  return { getDb: refuse, getDirectDb: refuse, ping: refuse, migrateDatabase: refuse };
});

// A connection string in the form that Neon's console offers, which a shell may
// export: the schema refuses it, since it asks for no check of the certificate.
const REFUSED_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=require&channel_binding=require';

/**
 * Exports what a developer's shell may and the schema refuses. The environment
 * is valid or invalid as one whole, so one refused variable turns the probe to
 * 503 and joins the logged names. CI exports none of these, so every test here
 * starts as if the shell did, and fails if it reads them.
 */
function exportRefusedVariables(): void {
  vi.stubEnv('DATABASE_URL', REFUSED_URL);
  vi.stubEnv('DATABASE_URL_UNPOOLED', REFUSED_URL);
  vi.stubEnv('VERCEL_ENV', 'staging');
  vi.stubEnv('NODE_ENV', 'debugging');
}

describe('GET /api/health', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    exportRefusedVariables();
    // Whatever the shell exports, each test starts outside Vercel with no
    // database configured, then stubs what it needs.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('answers 200 with an uncached body while the environment is valid', async () => {
    vi.stubEnv('LOG_LEVEL', 'info');
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({ status: 'ok' });
  });

  it('answers from the environment alone while a database that fails on any query is configured', async () => {
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.stubEnv('DATABASE_URL', 'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full');
    vi.stubEnv(
      'DATABASE_URL_UNPOOLED',
      'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full',
    );
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ status: 'ok' });
  });

  it('runs at request time instead of being prerendered', async () => {
    const { GET } = await import('./route');

    await GET();

    expect(vi.mocked(connection)).toHaveBeenCalledOnce();
  });

  it('[TRV-64] answers 503 and logs the variable name, never its value, when the environment is invalid', async () => {
    vi.stubEnv('LOG_LEVEL', 'hunter2-secret');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { GET } = await import('./route');

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(body)).toStrictEqual({ status: 'unavailable' });
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '{"level":"error","message":"The server environment is invalid.","context":{"variables":["LOG_LEVEL"]}}',
    );
    expect(body).not.toContain('LOG_LEVEL');
  });
});

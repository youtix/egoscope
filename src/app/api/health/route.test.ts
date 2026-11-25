import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

import type { requireSession } from '@/lib/auth';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// A database that fails on any use: beyond the session check, the probe answers from the
// environment alone, so that it never wakes the database for anything else, whose compute
// is billed for five minutes after each query.
vi.mock(import('@/lib/db'), () => {
  const refuse = (): never => {
    throw new Error('/api/health must not touch the database.');
  };
  return { getDb: refuse, getDirectDb: refuse, ping: refuse, migrateDatabase: refuse };
});

const checkSession = vi.hoisted(() => vi.fn<typeof requireSession>());

vi.mock(import('@/lib/auth'), () => ({ requireSession: checkSession }));

const SESSION = {
  id: 1,
  device: 'Phone',
  openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
  passwordStatus: 'chosen',
} as const;

describe('GET /api/health', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    checkSession.mockReset().mockResolvedValue({ ok: true, value: SESSION });
  });

  it('[CL-TRV-13] answers 200 with an uncached body to a valid session while the environment is valid', async () => {
    vi.stubEnv('LOG_LEVEL', 'info');
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({ status: 'ok' });
    expect(checkSession).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('asks nothing of a configured database beyond the session check', async () => {
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

  it.each([
    [{ kind: 'log-in', redirect: '/log-in?next=%2F', ended: 'logged_out' }, 'logged_out'],
    [{ kind: 'log-in', redirect: '/log-in?next=%2F', ended: null }, null],
    [{ kind: 'choose-password', redirect: '/choose-password' }, null],
  ] as const)(
    '[CL-TRV-13] [IHM-08] answers 401 with how the session ended to a refused session: %o',
    async (refusal, ended) => {
      checkSession.mockResolvedValue({ ok: false, error: refusal });
      const { GET } = await import('./route');

      const response = await GET();

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toStrictEqual({ status: 'unauthorized', ended });
    },
  );

  it.each([
    { kind: 'database-not-configured' },
    { kind: 'initial-password-missing' },
    { kind: 'initial-password-too-short', minLength: 12 },
  ] as const)(
    '[TRV-64] answers 503 and logs the cause alone when the session cannot be checked: %o',
    async (error) => {
      checkSession.mockResolvedValue({ ok: false, error });
      const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { GET } = await import('./route');

      const response = await GET();

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toStrictEqual({ status: 'unavailable' });
      expect(logError).toHaveBeenCalledExactlyOnceWith(
        `{"level":"error","message":"The session could not be checked.","context":{"cause":"${error.kind}"}}`,
      );
    },
  );

  it('[TRV-64] answers 503 and logs the variable names when the session check finds the environment invalid', async () => {
    checkSession.mockResolvedValue({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['LOG_LEVEL'] },
    });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { GET } = await import('./route');

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toStrictEqual({ status: 'unavailable' });
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '{"level":"error","message":"The server environment is invalid.","context":{"variables":["LOG_LEVEL"]}}',
    );
    expect(body).not.toContain('LOG_LEVEL');
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

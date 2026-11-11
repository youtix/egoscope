import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

describe('GET /api/health', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
  });

  it('answers 200 with an uncached body while the environment is valid', async () => {
    vi.stubEnv('LOG_LEVEL', 'info');
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
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

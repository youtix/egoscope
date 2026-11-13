import { describe, expect, it, vi } from 'vitest';

import { parseServerEnv } from './server-env';

describe('parseServerEnv', () => {
  it('defaults LOG_LEVEL to info when it is unset', () => {
    expect(parseServerEnv({})).toStrictEqual({ ok: true, env: { LOG_LEVEL: 'info' } });
  });

  it('treats an empty value as unset', () => {
    expect(parseServerEnv({ LOG_LEVEL: '' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info' },
    });
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('accepts LOG_LEVEL=%s', (level) => {
    expect(parseServerEnv({ LOG_LEVEL: level })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: level },
    });
  });

  it('ignores variables outside the schema', () => {
    expect(parseServerEnv({ HOME: '/home/someone' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info' },
    });
  });

  it('[TRV-64] names an invalid variable without echoing its value', () => {
    const result = parseServerEnv({ LOG_LEVEL: 'sk-live-not-a-level' });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['LOG_LEVEL'] },
    });
    expect(JSON.stringify(result)).not.toContain('sk-live-not-a-level');
  });

  it('reads the deployment kind that Vercel sets and the mode that Next.js sets', () => {
    expect(parseServerEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info', VERCEL_ENV: 'preview', NODE_ENV: 'production' },
    });
  });

  it.each([
    ['VERCEL_ENV', 'staging'],
    ['NODE_ENV', 'debugging'],
  ])('refuses %s=%s, which no platform sets', (name, value) => {
    expect(parseServerEnv({ [name]: value })).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: [name] },
    });
  });
});

describe('parseServerEnv, database URLs', () => {
  const POOLED = 'postgresql://app@pooled.example.invalid/egoscope?sslmode=verify-full';
  const DIRECT = 'postgres://app@direct.example.invalid/egoscope?sslmode=verify-full';

  it('[TRV-14] accepts both connection strings when they ask for a verified encrypted connection', () => {
    const result = parseServerEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });

    expect(result.ok && result.env.DATABASE_URL?.reveal()).toBe(POOLED);
    expect(result.ok && result.env.DATABASE_URL_UNPOOLED?.reveal()).toBe(DIRECT);
  });

  it.each([
    ['without sslmode', 'postgresql://app@db.example.invalid/egoscope'],
    ['with sslmode=require', 'postgresql://app@db.example.invalid/egoscope?sslmode=require'],
    ['with sslmode=disable', 'postgresql://app@db.example.invalid/egoscope?sslmode=disable'],
    [
      'whose last sslmode, the one pg obeys, is weaker',
      'postgresql://app@db.example.invalid/egoscope?sslmode=verify-full&sslmode=no-verify',
    ],
    ['of another protocol', 'https://db.example.invalid/egoscope?sslmode=verify-full'],
    ['that is no URL', 'host=db.example.invalid sslmode=verify-full'],
  ])('[TRV-14] refuses a connection string %s, in both variables', (_case, url) => {
    const result = parseServerEnv({ DATABASE_URL: url, DATABASE_URL_UNPOOLED: url });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'] },
    });
    expect(JSON.stringify(result)).not.toContain('db.example.invalid');
  });

  it('[TRV-64] keeps both connection strings secret: they print and serialize as a mask', () => {
    const result = parseServerEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });
    const env = result.ok ? result.env : undefined;

    expect(JSON.stringify(env)).toBe(
      '{"LOG_LEVEL":"info","DATABASE_URL":"[secret]","DATABASE_URL_UNPOOLED":"[secret]"}',
    );
    expect(`${String(env?.DATABASE_URL)} ${String(env?.DATABASE_URL_UNPOOLED)}`).toBe(
      '[secret] [secret]',
    );
  });

  it('leaves both connection strings out when they are unset, as on a preview deployment', () => {
    expect(parseServerEnv({ VERCEL_ENV: 'preview' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info', VERCEL_ENV: 'preview' },
    });
  });
});

describe('readServerEnv', () => {
  it('validates process.env once, when the module loads', async () => {
    vi.resetModules();
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('NODE_ENV', 'test');
    const { readServerEnv } = await import('./server-env');

    const first = readServerEnv();
    vi.stubEnv('LOG_LEVEL', 'error');

    expect(first).toStrictEqual({ ok: true, env: { LOG_LEVEL: 'debug', NODE_ENV: 'test' } });
    expect(readServerEnv()).toBe(first);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { isCredential, parseServerEnv, realCredentials } from './server-env';

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

describe('parseServerEnv, the fakes switch', () => {
  const POOLED = 'postgresql://app@pooled.example.invalid/egoscope?sslmode=verify-full';
  const DIRECT = 'postgres://app@direct.example.invalid/egoscope?sslmode=verify-full';

  it.each([
    ['all', 'all'],
    ['telegram', ['telegram']],
    ['stats-source,press-feeds', ['stats-source', 'press-feeds']],
    ['language-model, link-check', ['language-model', 'link-check']],
    [
      'stats-source,link-check,backup-storage,runtime-cache,language-model,press-feeds,telegram',
      [
        'stats-source',
        'link-check',
        'backup-storage',
        'runtime-cache',
        'language-model',
        'press-feeds',
        'telegram',
      ],
    ],
  ])('reads EGOSCOPE_FAKES=%s', (value, fakes) => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: value })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info', EGOSCOPE_FAKES: fakes },
    });
  });

  it.each([
    ['a port that does not exist', 'telegarm'],
    ['all among ports', 'all,telegram'],
    ['an empty entry', 'telegram,,press-feeds'],
    ['a list of no port', ','],
    ['all in capitals', 'ALL'],
  ])('refuses %s', (_case, value) => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: value })).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['EGOSCOPE_FAKES'] },
    });
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: POOLED }, ['DATABASE_URL', 'EGOSCOPE_FAKES']],
    [
      'DATABASE_URL_UNPOOLED',
      { DATABASE_URL_UNPOOLED: DIRECT },
      ['DATABASE_URL_UNPOOLED', 'EGOSCOPE_FAKES'],
    ],
    [
      'both database URLs',
      { DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT },
      ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'EGOSCOPE_FAKES'],
    ],
  ])(
    '[TRV-64] refuses the fakes switch beside %s, without any Vercel variable, and names it without its value',
    (_case, credentials, variables) => {
      const result = parseServerEnv({ EGOSCOPE_FAKES: 'all', ...credentials });

      expect(result).toStrictEqual({ ok: false, error: { kind: 'invalid-server-env', variables } });
      expect(JSON.stringify(result)).not.toContain('example.invalid');
    },
  );

  it('refuses a list of ports beside a database URL as it refuses all', () => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: 'telegram', DATABASE_URL: POOLED })).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['DATABASE_URL', 'EGOSCOPE_FAKES'] },
    });
  });

  it('refuses the fakes switch beside a connection string that is invalid on its own', () => {
    const neonConsoleUrl = 'postgresql://app@db.example.invalid/egoscope?sslmode=require';

    expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', DATABASE_URL: neonConsoleUrl })).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['DATABASE_URL', 'EGOSCOPE_FAKES'] },
    });
  });

  it('refuses the fakes switch on a production deployment', () => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', VERCEL_ENV: 'production' })).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['VERCEL_ENV', 'EGOSCOPE_FAKES'] },
    });
  });

  it.each(['preview', 'development'])(
    'accepts the fakes switch on a Vercel %s deployment that carries no credential',
    (vercelEnv) => {
      expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', VERCEL_ENV: vercelEnv })).toStrictEqual({
        ok: true,
        env: { LOG_LEVEL: 'info', VERCEL_ENV: vercelEnv, EGOSCOPE_FAKES: 'all' },
      });
    },
  );

  it('accepts the database URLs and a production deployment when the switch is unset or empty', () => {
    const production = { VERCEL_ENV: 'production', DATABASE_URL: POOLED };

    expect(parseServerEnv({ ...production, EGOSCOPE_FAKES: '' }).ok).toBe(true);
    expect(parseServerEnv(production).ok).toBe(true);
  });

  it('names every invalid variable in schema order, the refused switch among them', () => {
    expect(
      parseServerEnv({ LOG_LEVEL: 'INFO', EGOSCOPE_FAKES: 'all', DATABASE_URL: POOLED }),
    ).toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid-server-env',
        variables: ['LOG_LEVEL', 'DATABASE_URL', 'EGOSCOPE_FAKES'],
      },
    });
  });
});

describe('isCredential', () => {
  it.each([
    ['as the last call', z.string().optional().register(realCredentials)],
    ['before .optional()', z.string().register(realCredentials).optional()],
    ['before .default()', z.string().register(realCredentials).default('unset')],
    ['before .nullable()', z.string().register(realCredentials).nullable()],
    [
      'before .transform()',
      z
        .string()
        .register(realCredentials)
        .transform((value) => value.length),
    ],
    [
      'under several wrappers',
      z
        .string()
        .register(realCredentials)
        .transform((value) => value.length)
        .optional(),
    ],
    ['before a check, .min()', z.string().register(realCredentials).min(1)],
    ['before .trim()', z.string().register(realCredentials).trim()],
    [
      'before .refine()',
      z
        .string()
        .register(realCredentials)
        .refine((value) => value !== ''),
    ],
    ['before .describe()', z.string().register(realCredentials).describe('A token')],
    [
      'before a check, a pipe and a wrapper',
      z
        .string()
        .register(realCredentials)
        .min(1)
        .transform((value) => value.length)
        .optional(),
    ],
  ])('finds the mark of a real credential placed %s', (_place, schema) => {
    expect(isCredential(schema)).toBe(true);
  });

  it.each([
    ['a plain value', z.string()],
    ['a value under a check', z.string().min(1)],
    ['a value under a wrapper', z.enum(['info']).default('info')],
    [
      'a value under a pipe',
      z
        .string()
        .transform((value) => value.length)
        .optional(),
    ],
  ])('finds no mark on %s', (_kind, schema) => {
    expect(isCredential(schema)).toBe(false);
  });
});

describe('readServerEnv', () => {
  it('validates process.env once, when the module loads', async () => {
    vi.resetModules();
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('NODE_ENV', 'test');
    // Unset, whatever the shell that runs the tests exports.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('EGOSCOPE_FAKES', '');
    const { readServerEnv } = await import('./server-env');

    const first = readServerEnv();
    vi.stubEnv('LOG_LEVEL', 'error');

    expect(first).toStrictEqual({ ok: true, env: { LOG_LEVEL: 'debug', NODE_ENV: 'test' } });
    expect(readServerEnv()).toBe(first);
  });
});

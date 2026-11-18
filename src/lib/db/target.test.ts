import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '@/lib/env';

import { databaseTarget } from './target';

const POOLED = 'postgresql://app@pooled.example.invalid/egoscope?sslmode=verify-full';
const DIRECT = 'postgresql://app@direct.example.invalid/egoscope?sslmode=verify-full';
const NOT_CONFIGURED = { kind: 'not-configured' };

/** The connection string a target reaches, or its kind when it reaches none. */
function reached(
  variables: Readonly<Record<string, string>>,
  connection: 'pooled' | 'direct',
): string {
  const target = databaseTarget(parseServerEnv(variables), connection);
  return target.kind === 'postgres' ? target.url.reveal() : target.kind;
}

describe('databaseTarget', () => {
  it.each(['production', 'preview', 'development'])(
    '[TRV-14] reaches Neon through the pooled URL for the application, on %s',
    (vercelEnv) => {
      const variables = {
        VERCEL_ENV: vercelEnv,
        DATABASE_URL: POOLED,
        DATABASE_URL_UNPOOLED: DIRECT,
      };

      expect(reached(variables, 'pooled')).toBe(POOLED);
    },
  );

  it('[TRV-14] reaches Neon through the direct URL for migrations and long reads', () => {
    const variables = {
      VERCEL_ENV: 'production',
      DATABASE_URL: POOLED,
      DATABASE_URL_UNPOOLED: DIRECT,
    };

    expect(reached(variables, 'direct')).toBe(DIRECT);
  });

  it('reaches Neon from outside Vercel too, whenever a URL is set', () => {
    expect(reached({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT }, 'pooled')).toBe(POOLED);
  });

  it('gives no direct connection when only the pooled URL is set', () => {
    expect(reached({ VERCEL_ENV: 'production', DATABASE_URL: POOLED }, 'direct')).toBe(
      'not-configured',
    );
  });

  it.each(['production', 'preview', 'development'])(
    'is "not configured" on Vercel (%s) without a URL, and never falls back to PGlite',
    (vercelEnv) => {
      const env = parseServerEnv({ VERCEL_ENV: vercelEnv, DATABASE_URL_UNPOOLED: DIRECT });

      expect(databaseTarget(env, 'pooled')).toStrictEqual(NOT_CONFIGURED);
      expect(databaseTarget(env, 'direct')).toStrictEqual(NOT_CONFIGURED);
    },
  );

  it('keeps the database of `next dev` on disk, outside Vercel without a URL', () => {
    const env = parseServerEnv({ NODE_ENV: 'development' });

    expect(databaseTarget(env, 'pooled')).toStrictEqual({ kind: 'pglite', isPersistent: true });
    expect(databaseTarget(env, 'direct')).toStrictEqual({ kind: 'pglite', isPersistent: true });
  });

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['NODE_ENV=test', { NODE_ENV: 'test' }],
    ['NODE_ENV unset', {}],
  ])(
    'keeps the database in memory with %s, so that every start is a fresh one',
    (_case, variables) => {
      const env = parseServerEnv(variables);

      expect(databaseTarget(env, 'pooled')).toStrictEqual({ kind: 'pglite', isPersistent: false });
    },
  );

  it('is "not configured" while the environment is invalid', () => {
    const env = parseServerEnv({ LOG_LEVEL: 'verbose' });

    expect(databaseTarget(env, 'pooled')).toStrictEqual(NOT_CONFIGURED);
  });
});

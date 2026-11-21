import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { isCredential, parseServerEnv, realCredentials, SERVER_ENV_VARIABLES } from './server-env';

const POOLED = 'postgresql://app@pooled.example.invalid/egoscope?sslmode=verify-full';
const DIRECT = 'postgres://app@direct.example.invalid/egoscope?sslmode=verify-full';
// Made-up keys of 32 bytes, in base64url as the owner generates them, and in base64.
const KEY = 'k'.repeat(43);
const BACKUP_KEY = `${'b'.repeat(41)}+/=`;
const PASSWORD = 'a made-up password';

// Every value that a Lot 1 deployment requires (accounts-and-keys sheet).
const LOT_1_DEPLOYMENT = {
  APP_BASE_URL: 'https://egoscope.example.invalid',
  DATABASE_URL: POOLED,
  DATABASE_URL_UNPOOLED: DIRECT,
  CRON_SECRET: KEY,
  INITIAL_PASSWORD: PASSWORD,
  FINGERPRINT_KEY: KEY,
};

// Every value that a Lot 2 deployment requires beyond those of Lot 1.
const LOT_2_VALUES = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_AI_API_TOKEN: 'a made-up Workers AI token',
  TELEGRAM_BOT_TOKEN: '123456:a made-up bot token',
  TELEGRAM_WEBHOOK_SECRET: KEY,
};

// The real credentials of the sheet, each with a value that the schema accepts.
const CREDENTIALS = {
  DATABASE_URL: POOLED,
  DATABASE_URL_UNPOOLED: DIRECT,
  BACKUP_GITHUB_TOKEN: 'a made-up GitHub token',
  CLOUDFLARE_AI_API_TOKEN: 'a made-up Workers AI token',
  GROQ_API_KEY: 'a made-up Groq key',
  TELEGRAM_BOT_TOKEN: '123456:a made-up bot token',
};

/** The result that names `variables` as invalid. */
const invalid = (...variables: readonly string[]) => ({
  ok: false,
  error: { kind: 'invalid-server-env', variables },
});

describe('parseServerEnv', () => {
  it('defaults LOG_LEVEL to info and EGOSCOPE_LOT to 1 when they are unset', () => {
    expect(parseServerEnv({})).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info', EGOSCOPE_LOT: 1 },
    });
  });

  it('treats an empty value as unset', () => {
    expect(parseServerEnv({ LOG_LEVEL: '', EGOSCOPE_LOT: '', VERCEL_ENV: '' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info', EGOSCOPE_LOT: 1 },
    });
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('accepts LOG_LEVEL=%s', (level) => {
    expect(parseServerEnv({ LOG_LEVEL: level })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: level, EGOSCOPE_LOT: 1 },
    });
  });

  it('ignores variables outside the schema', () => {
    expect(parseServerEnv({ HOME: '/home/someone' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info', EGOSCOPE_LOT: 1 },
    });
  });

  it('[TRV-64] names an invalid variable without echoing its value', () => {
    const result = parseServerEnv({ LOG_LEVEL: 'sk-live-not-a-level' });

    expect(result).toStrictEqual(invalid('LOG_LEVEL'));
    expect(JSON.stringify(result)).not.toContain('sk-live-not-a-level');
  });

  it('reads the deployment that Vercel sets and the mode that Next.js sets', () => {
    const result = parseServerEnv({
      ...LOT_1_DEPLOYMENT,
      VERCEL_ENV: 'preview',
      VERCEL_DEPLOYMENT_ID: 'dpl_madeUp',
      NODE_ENV: 'production',
    });

    expect(result.ok && [result.env.VERCEL_ENV, result.env.VERCEL_DEPLOYMENT_ID]).toStrictEqual([
      'preview',
      'dpl_madeUp',
    ]);
    expect(result.ok && result.env.NODE_ENV).toBe('production');
  });

  it.each([
    ['VERCEL_ENV', 'staging'],
    ['NODE_ENV', 'debugging'],
  ])('refuses %s=%s, which no platform sets', (name, value) => {
    expect(parseServerEnv({ ...LOT_1_DEPLOYMENT, [name]: value })).toStrictEqual(invalid(name));
  });
});

describe('parseServerEnv, the deployment values', () => {
  it('[TRV-37] declares every variable of the accounts-and-keys sheet and no session secret', () => {
    expect(SERVER_ENV_VARIABLES).toStrictEqual([
      'LOG_LEVEL',
      'NODE_ENV',
      'VERCEL_ENV',
      'VERCEL_DEPLOYMENT_ID',
      'APP_BASE_URL',
      'DATABASE_URL',
      'DATABASE_URL_UNPOOLED',
      'CRON_SECRET',
      'INITIAL_PASSWORD',
      'FINGERPRINT_KEY',
      'BACKUP_GITHUB_REPOSITORY',
      'BACKUP_GITHUB_TOKEN',
      'BACKUP_ENCRYPTION_KEY',
      'STATS_SOURCE_BASE_URL',
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_AI_API_TOKEN',
      'GROQ_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'EGOSCOPE_LOT',
      'EGOSCOPE_FAKES',
    ]);
  });

  it('[TRV-37] [TRV-64] reads every value of a Lot 2 deployment, each secret one held as a Secret', () => {
    const result = parseServerEnv({
      ...LOT_1_DEPLOYMENT,
      ...LOT_2_VALUES,
      ...CREDENTIALS,
      VERCEL_ENV: 'production',
      VERCEL_DEPLOYMENT_ID: 'dpl_madeUp',
      LOG_LEVEL: 'warn',
      BACKUP_GITHUB_REPOSITORY: 'owner/egoscope-backups',
      BACKUP_ENCRYPTION_KEY: BACKUP_KEY,
      STATS_SOURCE_BASE_URL: 'http://127.0.0.1:8080/files',
      EGOSCOPE_LOT: '2',
    });
    const env = result.ok ? result.env : undefined;
    // Each value as a string template prints it: a Secret as its mask.
    const printed = Object.fromEntries(
      Object.entries(env ?? {}).map(([name, value]) => [name, String(value)]),
    );

    expect(printed).toStrictEqual({
      LOG_LEVEL: 'warn',
      VERCEL_ENV: 'production',
      VERCEL_DEPLOYMENT_ID: 'dpl_madeUp',
      APP_BASE_URL: 'https://egoscope.example.invalid',
      DATABASE_URL: '[secret]',
      DATABASE_URL_UNPOOLED: '[secret]',
      CRON_SECRET: '[secret]',
      INITIAL_PASSWORD: '[secret]',
      FINGERPRINT_KEY: '[secret]',
      BACKUP_GITHUB_REPOSITORY: 'owner/egoscope-backups',
      BACKUP_GITHUB_TOKEN: '[secret]',
      BACKUP_ENCRYPTION_KEY: '[secret]',
      STATS_SOURCE_BASE_URL: 'http://127.0.0.1:8080/files',
      CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_AI_API_TOKEN: '[secret]',
      GROQ_API_KEY: '[secret]',
      TELEGRAM_BOT_TOKEN: '[secret]',
      TELEGRAM_WEBHOOK_SECRET: '[secret]',
      EGOSCOPE_LOT: '2',
    });
    expect(env?.EGOSCOPE_LOT).toBe(2);
    expect([env?.INITIAL_PASSWORD?.reveal(), env?.BACKUP_ENCRYPTION_KEY?.reveal()]).toStrictEqual([
      PASSWORD,
      BACKUP_KEY,
    ]);
  });

  it.each([undefined, '1'])(
    '[TRV-37] validates a Lot 1 deployment that sets no Lot 2 variable, with EGOSCOPE_LOT=%s',
    (lot) => {
      const result = parseServerEnv({
        ...LOT_1_DEPLOYMENT,
        VERCEL_ENV: 'production',
        EGOSCOPE_LOT: lot,
      });

      expect(result.ok && result.env.EGOSCOPE_LOT).toBe(1);
    },
  );

  it('[TRV-37] names every value that a Lot 2 deployment lacks, never asking for GROQ_API_KEY', () => {
    const deployment = { ...LOT_1_DEPLOYMENT, VERCEL_ENV: 'production', EGOSCOPE_LOT: '2' };

    expect(parseServerEnv(deployment)).toStrictEqual(
      invalid(
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_AI_API_TOKEN',
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_WEBHOOK_SECRET',
      ),
    );
    expect(parseServerEnv({ ...deployment, ...LOT_2_VALUES }).ok).toBe(true);
  });

  it('asks a deployment whose EGOSCOPE_LOT is invalid for the values of the default lot only', () => {
    expect(
      parseServerEnv({ ...LOT_1_DEPLOYMENT, VERCEL_ENV: 'production', EGOSCOPE_LOT: '3' }),
    ).toStrictEqual(invalid('EGOSCOPE_LOT'));
  });

  it.each(Object.keys(LOT_1_DEPLOYMENT))(
    '[TRV-37] [TRV-64] names %s when a production deployment lacks it, and no value',
    (name) => {
      const result = parseServerEnv({ ...LOT_1_DEPLOYMENT, VERCEL_ENV: 'production', [name]: '' });

      expect(result).toStrictEqual(invalid(name));
      expect(JSON.stringify(result)).not.toContain('example.invalid');
    },
  );

  it('[TRV-37] gives a preview deployment, which carries no database variable, the invalid result naming what it lacks', () => {
    expect(parseServerEnv({ VERCEL_ENV: 'preview' })).toStrictEqual(
      invalid(
        'APP_BASE_URL',
        'DATABASE_URL',
        'DATABASE_URL_UNPOOLED',
        'CRON_SECRET',
        'INITIAL_PASSWORD',
        'FINGERPRINT_KEY',
      ),
    );
  });

  it('lets a deployment without its backup values run, so that the backup task can open "backup failed"', () => {
    const result = parseServerEnv({ ...LOT_1_DEPLOYMENT, VERCEL_ENV: 'production' });

    expect(
      result.ok && [result.env.BACKUP_GITHUB_TOKEN, result.env.BACKUP_ENCRYPTION_KEY],
    ).toStrictEqual([undefined, undefined]);
  });

  it('asks nothing of a configuration outside Vercel, where development and the tests run', () => {
    expect(parseServerEnv({ EGOSCOPE_LOT: '2' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info', EGOSCOPE_LOT: 2 },
    });
  });

  it.each([
    ['APP_BASE_URL', 'http://127.0.0.1:3000'],
    ['APP_BASE_URL', 'egoscope.example.invalid'],
    ['CRON_SECRET', 'k'.repeat(42)],
    ['CRON_SECRET', 'k'.repeat(44)],
    ['CRON_SECRET', `${'k'.repeat(42)}+`],
    ['FINGERPRINT_KEY', `${'k'.repeat(40)}...`],
    ['TELEGRAM_WEBHOOK_SECRET', BACKUP_KEY],
    ['BACKUP_ENCRYPTION_KEY', KEY],
    ['BACKUP_ENCRYPTION_KEY', 'b'.repeat(44)],
    ['BACKUP_ENCRYPTION_KEY', `${'b'.repeat(42)}==`],
    ['BACKUP_GITHUB_REPOSITORY', 'egoscope-backups'],
    ['BACKUP_GITHUB_REPOSITORY', 'owner/egoscope-backups/releases'],
    ['BACKUP_GITHUB_REPOSITORY', 'https://github.com/owner/egoscope-backups'],
    ['STATS_SOURCE_BASE_URL', 'file:///srv/statistics'],
    ['EGOSCOPE_LOT', '3'],
    ['EGOSCOPE_LOT', '0'],
    ['EGOSCOPE_LOT', ' 2'],
  ])('[TRV-64] refuses %s=%s and names it without its value', (name, value) => {
    const result = parseServerEnv({ [name]: value });

    expect(result).toStrictEqual(invalid(name));
    expect(JSON.stringify(result)).not.toContain(value);
  });
});

describe('parseServerEnv, database URLs', () => {
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

    expect(result).toStrictEqual(invalid('DATABASE_URL', 'DATABASE_URL_UNPOOLED'));
    expect(JSON.stringify(result)).not.toContain('db.example.invalid');
  });

  it('[TRV-64] keeps both connection strings secret: they print and serialize as a mask', () => {
    const result = parseServerEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });
    const env = result.ok ? result.env : undefined;

    expect(JSON.stringify(env)).toBe(
      '{"LOG_LEVEL":"info","DATABASE_URL":"[secret]","DATABASE_URL_UNPOOLED":"[secret]","EGOSCOPE_LOT":1}',
    );
    expect(`${String(env?.DATABASE_URL)} ${String(env?.DATABASE_URL_UNPOOLED)}`).toBe(
      '[secret] [secret]',
    );
  });
});

describe('parseServerEnv, the fakes switch', () => {
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
      env: { LOG_LEVEL: 'info', EGOSCOPE_LOT: 1, EGOSCOPE_FAKES: fakes },
    });
  });

  it.each([
    ['a port that does not exist', 'telegarm'],
    ['all among ports', 'all,telegram'],
    ['an empty entry', 'telegram,,press-feeds'],
    ['a list of no port', ','],
    ['all in capitals', 'ALL'],
  ])('refuses %s', (_case, value) => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: value })).toStrictEqual(invalid('EGOSCOPE_FAKES'));
  });

  it.each(Object.entries(CREDENTIALS))(
    '[TRV-64] refuses the fakes switch beside %s, without any Vercel variable, and names it without its value',
    (name, value) => {
      const result = parseServerEnv({ EGOSCOPE_FAKES: 'all', [name]: value });

      expect(result).toStrictEqual(invalid(name, 'EGOSCOPE_FAKES'));
      expect(JSON.stringify(result)).not.toContain(value);
    },
  );

  it('[TRV-64] refuses the fakes switch beside every real credential, naming them all', () => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', ...CREDENTIALS })).toStrictEqual(
      invalid(...Object.keys(CREDENTIALS), 'EGOSCOPE_FAKES'),
    );
  });

  it('accepts the fakes switch beside the secrets that reach no outside service', () => {
    const ownSecrets = {
      CRON_SECRET: KEY,
      INITIAL_PASSWORD: PASSWORD,
      FINGERPRINT_KEY: KEY,
      BACKUP_ENCRYPTION_KEY: BACKUP_KEY,
      TELEGRAM_WEBHOOK_SECRET: KEY,
    };

    expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', ...ownSecrets }).ok).toBe(true);
  });

  it('refuses a list of ports beside a database URL as it refuses all', () => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: 'telegram', DATABASE_URL: POOLED })).toStrictEqual(
      invalid('DATABASE_URL', 'EGOSCOPE_FAKES'),
    );
  });

  it('refuses the fakes switch beside a connection string that is invalid on its own', () => {
    const neonConsoleUrl = 'postgresql://app@db.example.invalid/egoscope?sslmode=require';

    expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', DATABASE_URL: neonConsoleUrl })).toStrictEqual(
      invalid('DATABASE_URL', 'EGOSCOPE_FAKES'),
    );
  });

  it('refuses the fakes switch on a production deployment', () => {
    expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', VERCEL_ENV: 'production' })).toStrictEqual(
      invalid('VERCEL_ENV', 'EGOSCOPE_FAKES'),
    );
  });

  it.each(['preview', 'development'])(
    'accepts the fakes switch on a Vercel %s deployment that carries no credential',
    (vercelEnv) => {
      expect(parseServerEnv({ EGOSCOPE_FAKES: 'all', VERCEL_ENV: vercelEnv })).toStrictEqual({
        ok: true,
        env: { LOG_LEVEL: 'info', VERCEL_ENV: vercelEnv, EGOSCOPE_LOT: 1, EGOSCOPE_FAKES: 'all' },
      });
    },
  );

  it('accepts the database URLs and a production deployment when the switch is unset or empty', () => {
    const production = { ...LOT_1_DEPLOYMENT, VERCEL_ENV: 'production' };

    expect(parseServerEnv({ ...production, EGOSCOPE_FAKES: '' }).ok).toBe(true);
    expect(parseServerEnv(production).ok).toBe(true);
  });

  it('names every invalid variable in schema order, the refused switch among them', () => {
    expect(
      parseServerEnv({ LOG_LEVEL: 'INFO', EGOSCOPE_FAKES: 'all', DATABASE_URL: POOLED }),
    ).toStrictEqual(invalid('LOG_LEVEL', 'DATABASE_URL', 'EGOSCOPE_FAKES'));
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
    ['at the output of .pipe()', z.string().pipe(z.string().register(realCredentials))],
    [
      'at the output of z.preprocess()',
      z.preprocess((value) => value, z.string().register(realCredentials)),
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
  it('[TRV-76] starts every test with every variable of the schema unset, whatever the shell exports', () => {
    const pinned = Object.fromEntries(
      SERVER_ENV_VARIABLES.map((name) => [name, process.env[name]]),
    );

    expect(pinned).toStrictEqual(
      Object.fromEntries(
        SERVER_ENV_VARIABLES.map((name) => [name, name === 'NODE_ENV' ? 'test' : '']),
      ),
    );
  });

  it('validates process.env once, when the module loads', async () => {
    vi.resetModules();
    vi.stubEnv('LOG_LEVEL', 'debug');
    const { readServerEnv } = await import('./server-env');

    const first = readServerEnv();
    vi.stubEnv('LOG_LEVEL', 'error');

    expect(first).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'debug', NODE_ENV: 'test', EGOSCOPE_LOT: 1 },
    });
    expect(readServerEnv()).toBe(first);
  });
});

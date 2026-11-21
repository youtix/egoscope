import { beforeEach, describe, expect, it, vi } from 'vitest';

// A connection string that the schema accepts, which a server must never use beside fakes.
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

describe('the hermetic mode', () => {
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

  describe('isHermetic', () => {
    it('is on when every outside service is a fake and no credential is set', async () => {
      vi.stubEnv('EGOSCOPE_FAKES', 'all');
      const { isHermetic } = await import('./hermetic');

      expect(isHermetic()).toBe(true);
    });

    it.each([
      ['no fakes at all', {}],
      ['fakes for some ports only', { EGOSCOPE_FAKES: 'telegram,press-feeds' }],
      ['all the fakes beside a database URL', { EGOSCOPE_FAKES: 'all', DATABASE_URL }],
      [
        'all the fakes on a production deployment',
        { EGOSCOPE_FAKES: 'all', VERCEL_ENV: 'production' },
      ],
      [
        'all the fakes in an environment invalid for another reason',
        { EGOSCOPE_FAKES: 'all', LOG_LEVEL: 'INFO' },
      ],
    ])('is off with %s', async (_case, variables) => {
      stubVariables(variables);
      const { isHermetic } = await import('./hermetic');

      expect(isHermetic()).toBe(false);
    });
  });

  describe('checkFakesSwitch', () => {
    it.each([
      ['no fakes at all', {}],
      ['all the fakes and no credential', { EGOSCOPE_FAKES: 'all' }],
      ['fakes for some ports only', { EGOSCOPE_FAKES: 'telegram' }],
      ['a database URL and no fakes', { DATABASE_URL }],
      ['an environment invalid for another reason', { LOG_LEVEL: 'INFO' }],
    ])('lets a server start with %s', async (_case, variables) => {
      stubVariables(variables);
      const { checkFakesSwitch } = await import('./hermetic');

      expect(checkFakesSwitch()).toStrictEqual({ ok: true });
    });

    it.each([
      ['beside a database URL', { DATABASE_URL }, ['DATABASE_URL', 'EGOSCOPE_FAKES']],
      [
        'on a production deployment',
        { VERCEL_ENV: 'production' },
        ['VERCEL_ENV', 'EGOSCOPE_FAKES'],
      ],
      [
        'beside a database URL in an environment invalid for another reason',
        { DATABASE_URL, LOG_LEVEL: 'INFO' },
        ['LOG_LEVEL', 'DATABASE_URL', 'EGOSCOPE_FAKES'],
      ],
    ])(
      '[TRV-64] refuses the fakes switch %s, naming the variables without their values',
      async (_case, variables, refusing) => {
        stubVariables({ EGOSCOPE_FAKES: 'all', ...variables });
        const { checkFakesSwitch } = await import('./hermetic');

        const check = checkFakesSwitch();

        expect(check).toStrictEqual({
          ok: false,
          error: { kind: 'refused-fakes', variables: refusing },
        });
        expect(JSON.stringify(check)).not.toContain('example.invalid');
      },
    );

    it('refuses a misspelled list of ports, which must not fall back on real services', async () => {
      vi.stubEnv('EGOSCOPE_FAKES', 'telegarm');
      const { checkFakesSwitch } = await import('./hermetic');

      expect(checkFakesSwitch()).toStrictEqual({
        ok: false,
        error: { kind: 'refused-fakes', variables: ['EGOSCOPE_FAKES'] },
      });
    });
  });
});

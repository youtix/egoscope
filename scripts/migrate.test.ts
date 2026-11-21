import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
// Ports where nothing listens, so that a connection is refused at once.
const POOLED_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full';
const DIRECT_URL = 'postgresql://app@127.0.0.1:2/egoscope?sslmode=verify-full';

// A production deployment, with every value that it requires but those of its
// database (accounts-and-keys sheet), all made up.
const PRODUCTION = {
  VERCEL_ENV: 'production',
  APP_BASE_URL: 'https://egoscope.example.invalid',
  CRON_SECRET: 'k'.repeat(43),
  INITIAL_PASSWORD: 'p'.repeat(12),
  FINGERPRINT_KEY: 'k'.repeat(43),
};

type Outcome = Readonly<{ status: number | null; output: string }>;

/**
 * Runs the deploy step as the production build does, with these deployment
 * variables only: it inherits the environment of the test, where every variable
 * of the server environment starts unset (vitest.config.ts).
 */
function migrate(variables: Readonly<Record<string, string>>): Outcome {
  const result = spawnSync('bun', ['run', 'db:migrate'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...variables },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('the deploy step', { timeout: 60_000 }, () => {
  it.each([
    ['a preview', { VERCEL_ENV: 'preview' }],
    ['a local run', {}],
  ])('[TRV-76] leaves the database untouched on %s', (_where, variables) => {
    const { status, output } = migrate(variables);

    expect(status).toBe(0);
    expect(output).toContain('not a production deployment, so the database is left untouched');
  });

  it('[TRV-76] fails the build when the production database is not configured', () => {
    const { status, output } = migrate({ ...PRODUCTION, DATABASE_URL: POOLED_URL });

    expect(status).toBe(1);
    expect(output).toContain('the server environment is invalid: DATABASE_URL_UNPOOLED.');
  });

  it('[TRV-76] [TRV-64] fails the build when the migrations cannot be applied, and never names the database host', () => {
    const { status, output } = migrate({
      ...PRODUCTION,
      DATABASE_URL: POOLED_URL,
      DATABASE_URL_UNPOOLED: DIRECT_URL,
    });

    expect(status).toBe(1);
    expect(output).toContain(
      'the migrations could not be applied, and the structure is unchanged: ECONNREFUSED',
    );
    expect(output).not.toContain('127.0.0.1');
  });

  it('[TRV-14] [TRV-64] refuses a connection string without sslmode=verify-full, and never prints it', () => {
    const { status, output } = migrate({
      ...PRODUCTION,
      DATABASE_URL: 'postgresql://app:hunter2-value@127.0.0.1:1/egoscope',
      DATABASE_URL_UNPOOLED: DIRECT_URL,
    });

    expect(status).toBe(1);
    expect(output).toContain('the server environment is invalid: DATABASE_URL.');
    expect(output).not.toContain('hunter2-value');
  });

  it('[TRV-76] runs before next build in the production build', () => {
    const manifest: unknown = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      scripts: { 'vercel-build': 'bun run db:migrate && next build' },
    });
  });
});

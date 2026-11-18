import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
// Ports where nothing listens, so that a connection is refused at once.
const POOLED_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full';
const DIRECT_URL = 'postgresql://app@127.0.0.1:2/egoscope?sslmode=verify-full';

type Outcome = Readonly<{ status: number | null; output: string }>;

// Every variable of the server environment (src/lib/env/server-env.ts), which the
// deploy step validates as one whole, pinned whatever the shell that runs the
// tests exports: NODE_ENV as Vitest sets it, and the others left out.
const PINNED_SERVER_ENV = {
  LOG_LEVEL: undefined,
  NODE_ENV: 'test',
  VERCEL_ENV: undefined,
  DATABASE_URL: undefined,
  DATABASE_URL_UNPOOLED: undefined,
} as const;

/**
 * Exports what a developer's shell may: the production connection strings, for
 * example to run pg_dump, with VERCEL_ENV=production, and a LOG_LEVEL and a
 * NODE_ENV that the schema refuses, each of which makes the whole environment
 * invalid. CI exports none of these, so every test here starts as if the shell
 * did, and a deploy step that inherited them would migrate the database they
 * name or stop on an invalid environment (TRV-76).
 */
function exportShellVariables(): void {
  vi.stubEnv('DATABASE_URL', POOLED_URL);
  vi.stubEnv('DATABASE_URL_UNPOOLED', POOLED_URL);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('LOG_LEVEL', 'INFO');
  vi.stubEnv('NODE_ENV', 'staging');
}

/** Runs the deploy step as the production build does, with these deployment variables only. */
function migrate(variables: Readonly<Record<string, string>>): Outcome {
  const result = spawnSync('bun', ['run', 'db:migrate'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...PINNED_SERVER_ENV, ...variables },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('the deploy step', { timeout: 60_000 }, () => {
  beforeEach(() => {
    exportShellVariables();
  });

  it.each([
    ['a preview', { VERCEL_ENV: 'preview' }],
    ['a local run', {}],
  ])('[TRV-76] leaves the database untouched on %s', (_where, variables) => {
    const { status, output } = migrate(variables);

    expect(status).toBe(0);
    expect(output).toContain('not a production deployment, so the database is left untouched');
  });

  it('[TRV-76] fails the build when the production database is not configured', () => {
    const { status, output } = migrate({ VERCEL_ENV: 'production', DATABASE_URL: POOLED_URL });

    expect(status).toBe(1);
    expect(output).toContain(
      'DATABASE_URL and DATABASE_URL_UNPOOLED must both be set for Production in Vercel.',
    );
  });

  it('[TRV-76] [TRV-64] fails the build when the migrations cannot be applied, and never names the database host', () => {
    const { status, output } = migrate({
      VERCEL_ENV: 'production',
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
      VERCEL_ENV: 'production',
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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

/** A local port where nothing listens: connecting to it is refused at once. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return typeof address === 'object' && address !== null ? address.port : 0;
}

const urlOf = (port: number): string =>
  `postgresql://app@127.0.0.1:${String(port)}/egoscope?sslmode=verify-full`;

// Where the shell's connection strings lead in these tests: a port where nothing listens.
const SHELL_DATABASE_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full';

/**
 * Exports what a developer's shell may, for example the production connection
 * strings to run pg_dump. CI exports no database variable, so every test here
 * starts as if the shell did, and a test that read them would fail instead of
 * migrating the database they name (TRV-76).
 */
function exportShellVariables(): void {
  vi.stubEnv('DATABASE_URL', SHELL_DATABASE_URL);
  vi.stubEnv('DATABASE_URL_UNPOOLED', SHELL_DATABASE_URL);
  vi.stubEnv('VERCEL_ENV', 'production');
}

/** An empty project root of its own as the working directory, and its drizzle/ folder. */
function projectFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-deploy-'));
  vi.spyOn(process, 'cwd').mockReturnValue(folder);
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return path.join(folder, 'drizzle');
}

/** A project root of its own whose one migration runs `statement`, as drizzle-kit writes it. */
function projectWith(statement: string): void {
  const migrations = projectFolder();
  mkdirSync(path.join(migrations, 'meta'), { recursive: true });
  writeFileSync(path.join(migrations, '0000_probe.sql'), statement);
  const entry = { idx: 0, version: '7', when: 1, tag: '0000_probe', breakpoints: true };
  writeFileSync(
    path.join(migrations, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries: [entry] }),
  );
}

describe('migrateDatabase', { timeout: 60_000 }, () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    exportShellVariables();
    // Whatever the shell exports, each test starts outside Vercel with no
    // database configured, then stubs what it needs.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
  });

  it('[TRV-76] migrates through the direct connection string, never the pooled one', async () => {
    const [pooled, direct] = await Promise.all([closedPort(), closedPort()]);
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', urlOf(pooled));
    vi.stubEnv('DATABASE_URL_UNPOOLED', urlOf(direct));
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'migration-failed',
        reason: `Error: connect ECONNREFUSED 127.0.0.1:${String(direct)}`,
      },
    });
  });

  it('[TRV-76] reports the database not configured on Vercel without a URL', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
  });

  it('[TRV-76] reports the database not configured without the direct URL', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', urlOf(await closedPort()));
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
  });

  it('[TRV-76] fails, before connecting, when the migrations are missing', async () => {
    projectFolder();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', urlOf(await closedPort()));
    vi.stubEnv('DATABASE_URL_UNPOOLED', urlOf(await closedPort()));
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'migration-failed', reason: "Error: Can't find meta/_journal.json file" },
    });
  });

  it('[TRV-76] brings PGlite up to date outside Vercel', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({ ok: true });
  });

  it('[TRV-76] reports a migration that fails, with the reason Postgres gives', async () => {
    projectWith('SELECT * FROM "missing";');
    vi.stubEnv('NODE_ENV', 'test');
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'migration-failed', reason: 'error: relation "missing" does not exist' },
    });
  });
});

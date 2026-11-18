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

/**
 * The connection string of a local server in the place of Postgres that turns
 * down the request for TLS, so that a client fails on it another way than on a
 * closed port.
 */
async function serverWithoutTls(): Promise<string> {
  const server = createServer((socket) => {
    socket.once('data', () => socket.end('N'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => {
    server.close();
  });
  const address = server.address();
  return urlOf(typeof address === 'object' && address !== null ? address.port : 0);
}

// Where the shell's connection strings lead in these tests: a port where nothing listens.
const SHELL_DATABASE_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full';
// Where every copy of the db module keeps the databases that the process opened.
const OPENED_DATABASES = Symbol.for('egoscope.db.opened-databases');

/**
 * Exports what a developer's shell may: the production connection strings, for
 * example to run pg_dump, the fakes switch of .env.example, which no database URL
 * may join, and a LOG_LEVEL and a NODE_ENV that the schema refuses, each of which
 * makes the whole environment invalid. CI exports none of these, so every test
 * here starts as if the shell did, and a test that read them would fail instead
 * of migrating the database they name (TRV-76).
 */
function exportShellVariables(): void {
  vi.stubEnv('DATABASE_URL', SHELL_DATABASE_URL);
  vi.stubEnv('DATABASE_URL_UNPOOLED', SHELL_DATABASE_URL);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('LOG_LEVEL', 'INFO');
  vi.stubEnv('NODE_ENV', 'staging');
  vi.stubEnv('EGOSCOPE_FAKES', 'all');
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
    // Each test is a fresh process: its modules load again, reading the
    // environment, and it has opened no database yet.
    vi.resetModules();
    vi.stubGlobal(OPENED_DATABASES, undefined);
    exportShellVariables();
    // Whatever the shell exports, each test starts from every variable of the
    // server environment pinned: outside Vercel with no database configured and
    // no fakes, at the default log level, and with NODE_ENV as Vitest sets it.
    // Then it stubs what it needs.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('LOG_LEVEL', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EGOSCOPE_FAKES', '');
  });

  it('[TRV-76] migrates through the direct connection string, never the pooled one', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', urlOf(await closedPort()));
    vi.stubEnv('DATABASE_URL_UNPOOLED', await serverWithoutTls());
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'migration-failed',
        reason: 'Error: The server does not support SSL connections',
      },
    });
  });

  it('[TRV-64] reports a connection that fails by its code, never by the host and port it names', async () => {
    const url = urlOf(await closedPort());
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('DATABASE_URL', url);
    vi.stubEnv('DATABASE_URL_UNPOOLED', url);
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'migration-failed', reason: 'ECONNREFUSED' },
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

  it('[TRV-76] reports a migration that fails, with the SQLSTATE that Postgres gives', async () => {
    projectWith('SELECT * FROM "missing";');
    vi.stubEnv('NODE_ENV', 'test');
    const { migrateDatabase } = await import('./migrate-database');

    await expect(migrateDatabase()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'migration-failed', reason: '42P01' },
    });
  });
});

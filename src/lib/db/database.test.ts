import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { PoolConfig } from 'pg';

// Counts what the module creates: node-postgres pools, and PGlite instances.
const created = vi.hoisted(() => ({ pools: 0, pglites: 0 }));

vi.mock(import('pg'), async (importOriginal) => {
  const pg = await importOriginal();
  class CountedPool extends pg.Pool {
    constructor(config?: PoolConfig) {
      super(config);
      created.pools += 1;
    }
  }
  return { ...pg, Pool: CountedPool };
});

// PGlite itself cannot be wrapped: a second copy of its module breaks its wire
// protocol. Its one starter is counted instead, and still starts it.
vi.mock(import('./pglite'), async (importOriginal) => {
  const { startPglite } = await importOriginal();
  return {
    startPglite: async (options) => {
      created.pglites += 1;
      return startPglite(options);
    },
  };
});

type Server = Readonly<{ url: string; connections: () => number }>;

/** The database of a result, or undefined when there is none. */
const dbOf = <T>(result: Readonly<{ ok: true; db: T }> | Readonly<{ ok: false }>): T | undefined =>
  result.ok ? result.db : undefined;

/**
 * A local server in the place of Postgres, which counts the connections it
 * receives and turns down their request for TLS, so that every query fails.
 */
async function serverWithoutTls(): Promise<Server> {
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.once('data', () => socket.end('N'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => {
    server.close();
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `postgresql://app@127.0.0.1:${String(port)}/egoscope?sslmode=verify-full`,
    connections: () => connections,
  };
}

/** A project root of its own, holding a copy of the migrations, as the working directory. */
function projectFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-db-'));
  cpSync(path.join(process.cwd(), 'drizzle'), path.join(folder, 'drizzle'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(folder);
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

describe('getDb and getDirectDb', { timeout: 60_000 }, () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    created.pools = 0;
    created.pglites = 0;
  });

  it('[TRV-14] create no pool and open no connection when the module is imported', async () => {
    const server = await serverWithoutTls();
    vi.stubEnv('DATABASE_URL', server.url);
    vi.stubEnv('DATABASE_URL_UNPOOLED', server.url);

    await import('.');

    expect(created).toStrictEqual({ pools: 0, pglites: 0 });
    expect(server.connections()).toBe(0);
  });

  it('[TRV-14] create the pool on the first call and its first connection on the first query', async () => {
    const server = await serverWithoutTls();
    vi.stubEnv('DATABASE_URL', server.url);
    const { getDb } = await import('.');

    const db = dbOf(await getDb());
    const before = server.connections();

    expect(created.pools).toBe(1);
    expect(before).toBe(0);
    await expect(db?.execute(sql`select 1`)).rejects.toThrow('Failed query: select 1');
    expect(server.connections()).toBe(1);
  });

  it('[TRV-14] keep one database per connection string for the life of the server', async () => {
    const pooled = await serverWithoutTls();
    const direct = await serverWithoutTls();
    vi.stubEnv('DATABASE_URL', pooled.url);
    vi.stubEnv('DATABASE_URL_UNPOOLED', direct.url);
    const { getDb, getDirectDb } = await import('.');

    const [first, second, migrations] = await Promise.all([getDb(), getDb(), getDirectDb()]);

    expect(dbOf(first)).toBe(dbOf(second));
    expect(dbOf(migrations)).not.toBe(dbOf(first));
    await expect(dbOf(migrations)?.execute(sql`select 1`)).rejects.toThrow(
      'Failed query: select 1',
    );
    expect([pooled.connections(), direct.connections()]).toStrictEqual([0, 1]);
  });

  it('report "database not configured" on Vercel without a URL, and start no PGlite', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const { getDb, getDirectDb } = await import('.');

    const results = await Promise.all([getDb(), getDirectDb()]);

    expect(results).toStrictEqual([
      { ok: false, error: { kind: 'database-not-configured' } },
      { ok: false, error: { kind: 'database-not-configured' } },
    ]);
    expect(created).toStrictEqual({ pools: 0, pglites: 0 });
  });

  it('report "database not configured" while the environment is invalid', async () => {
    vi.stubEnv('LOG_LEVEL', 'verbose');
    const { getDb } = await import('.');

    await expect(getDb()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
  });

  it('[TRV-76] start PGlite in memory outside Vercel, migrated, and share it between both connections', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { getDb, getDirectDb, installation } = await import('.');

    const importedPglites = created.pglites;
    const [pooled, direct] = await Promise.all([getDb(), getDirectDb()]);

    expect(importedPglites).toBe(0);
    expect(created.pglites).toBe(1);
    await expect(dbOf(pooled)?.select().from(installation)).resolves.toStrictEqual([]);
    expect(dbOf(direct)).toBe(dbOf(pooled));
  });

  it('[TRV-76] keep the database of `next dev` on disk, under .pglite/ in the project', async () => {
    const folder = projectFolder();
    vi.stubEnv('NODE_ENV', 'development');
    const { getDb, sequenceCounters } = await import('.');

    const db = dbOf(await getDb());

    await expect(db?.select().from(sequenceCounters)).resolves.toStrictEqual([]);
    expect(existsSync(path.join(folder, '.pglite', 'PG_VERSION'))).toBe(true);
  });
});

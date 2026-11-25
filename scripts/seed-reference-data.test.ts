import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
// Ports where nothing listens, so that a connection is refused at once.
const POOLED_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full';
const DIRECT_URL = 'postgresql://app@127.0.0.1:2/egoscope?sslmode=verify-full';
const OPENED_DATABASES = Symbol.for('egoscope.db.opened-databases');
const TIMEOUT_MS = 60_000;

// The databases that a test opened, which `@/lib/db` keeps on globalThis.
async function closeOpenedDatabases(): Promise<void> {
  const opened: unknown = Reflect.get(globalThis, OPENED_DATABASES);
  if (opened instanceof Map) {
    for (const pending of opened.values()) {
      // PGlite, which holds about 200 MB, closes; a pool closes itself once idle.
      const database: unknown = await pending;
      const close: unknown =
        typeof database === 'object' && database !== null
          ? Reflect.get(database, 'close')
          : undefined;
      if (typeof close === 'function') {
        await Reflect.apply(close, database, []);
      }
    }
  }
}

describe('the seeding of the reference data', { timeout: TIMEOUT_MS }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(OPENED_DATABASES, undefined);
  });

  afterEach(async () => {
    await closeOpenedDatabases();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('[TAX-15] [TRV-76] seeds the database that the environment names, as often as asked, with the nine types once', async () => {
    const { getDb, eventTypes, installation } = await import('@/lib/db');
    const { seedReferenceData } = await import('./seed-reference-data');

    await expect(seedReferenceData()).resolves.toStrictEqual({ ok: true });
    await expect(seedReferenceData()).resolves.toStrictEqual({ ok: true });

    const database = await getDb();
    assert(database.ok, 'The test database is not configured.');
    const types = await database.db.select({ id: eventTypes.id }).from(eventTypes);
    const installed = await database.db.select({ id: installation.id }).from(installation);
    expect(types).toHaveLength(9);
    expect(installed).toStrictEqual([{ id: 1 }]);
  });

  it('[TAX-15] [TRV-76] fails, saying so, when the database is not configured', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const { seedReferenceData } = await import('./seed-reference-data');

    await expect(seedReferenceData()).resolves.toStrictEqual({
      ok: false,
      reason: 'the database is not configured',
    });
  });

  it('[TAX-15] [TRV-64] fails with the code of the error alone when the database cannot be reached', async () => {
    vi.stubEnv('DATABASE_URL', POOLED_URL);
    vi.stubEnv('DATABASE_URL_UNPOOLED', DIRECT_URL);
    const { seedReferenceData } = await import('./seed-reference-data');

    await expect(seedReferenceData()).resolves.toStrictEqual({ ok: false, reason: 'ECONNREFUSED' });
  });
});

describe('the local seeding script', { timeout: TIMEOUT_MS }, () => {
  it('[TAX-15] [TRV-76] refuses a database URL, so that no shell can seed a deployed database through it', () => {
    const result = spawnSync('bun', ['run', 'db:seed'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: POOLED_URL, DATABASE_URL_UNPOOLED: DIRECT_URL },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'a database URL is set, and this script seeds the local database only',
    );
  });
});

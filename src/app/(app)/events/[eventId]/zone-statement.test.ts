import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, parameterOverrides } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';

import { zoneStatement } from './zone-statement';

import type { getDb } from '@/lib/db';

// The database that `getDb()` gives the page: each test serves one of its own, or none.
const harness = vi.hoisted(() => ({ getDb: vi.fn<typeof getDb>() }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

describe('zoneStatement', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[CL-IHM-04] [IHM-14] states the owner’s zone, the display.timeZone setting', async () => {
    const database = await createTestDatabase();
    onTestFinished(database.close);
    harness.getDb.mockResolvedValue({ ok: true, db: database.db });
    await database.db
      .insert(parameterOverrides)
      .values({ parameterKey: 'display.timeZone', value: 'America/New_York' });

    await expect(zoneStatement()).resolves.toBe('Times in New York time');
  });

  it('[CL-IHM-04] states the default zone, Paris time, while the database cannot be read', async () => {
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(zoneStatement()).resolves.toBe('Times in Paris time');
  });
});

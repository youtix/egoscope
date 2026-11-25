import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { setParam } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import { lockoutUntil } from './lockout';

import type { DatabaseResult } from '@/lib/db';

// The database behind `getDb()`.
const harness = vi.hoisted(() => ({ getDb: vi.fn<() => Promise<DatabaseResult>>() }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

// Monday 23 November 2026, 10:25 Paris time: the end of a lockout.
const UNTIL = toEpochMs(Date.UTC(2026, 10, 23, 9, 25));

/** A database of its own for the test, behind `getDb()`. */
async function database() {
  const created = await createTestDatabase();
  onTestFinished(created.close);
  harness.getDb.mockResolvedValue({ ok: true, db: created.db });
  return created.db;
}

describe('the lockout as the login screen shows it', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[TRV-61] [IHM-07] [CL-IHM-04] writes the end of the lockout in full, in the owner zone', async () => {
    await database();

    await expect(lockoutUntil(UNTIL)).resolves.toStrictEqual({
      ok: true,
      value: {
        until: UNTIL,
        notice: 'Login locked until Monday 23 November 2026, 10:25 Paris time',
      },
    });
  });

  it('[IHM-07] [CL-IHM-05] follows the time zone that the owner set', async () => {
    const db = await database();
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'display.timeZone', value: 'America/New_York', expectedVersion: 0 }),
    );

    await expect(lockoutUntil(UNTIL)).resolves.toStrictEqual({
      ok: true,
      value: {
        until: UNTIL,
        notice: 'Login locked until Monday 23 November 2026, 04:25 New York time',
      },
    });
  });

  it('[IHM-07] answers that the database is not configured, when it is not', async () => {
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(lockoutUntil(UNTIL)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
  });
});

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { parameterOverrides, uiState } from './schema';
import { createTestDatabase } from './test-database';
import { updateVersioned } from './versioned';

import type { Database } from './types';

const RETENTION = 'journal.retentionDays';
const PAGE_SIZE = 'display.listPageSize';
const CHANGED_AT = new Date(Date.UTC(2026, 10, 20, 9));
// The version that the screen showed when the owner began to edit the retention.
const SHOWN_VERSION = 3;

describe('updateVersioned', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await db.insert(parameterOverrides).values([
      { parameterKey: RETENTION, value: 120, changedAt: CHANGED_AT, rowVersion: 3 },
      { parameterKey: PAGE_SIZE, value: 20, changedAt: CHANGED_AT, rowVersion: 3 },
    ]);
    return database.close;
  }, 60_000);

  /** Saves 180 as the retention, sent with the version the screen showed. */
  async function saveRetention() {
    return db.transaction(async (tx) =>
      updateVersioned(tx, parameterOverrides, {
        where: eq(parameterOverrides.parameterKey, RETENTION),
        expectedVersion: SHOWN_VERSION,
        set: { value: 180 },
      }),
    );
  }

  it('[CL-IHM-18] saves a change sent with the version the screen showed, and moves the version on', async () => {
    const result = await saveRetention();

    expect(result).toStrictEqual({
      ok: true,
      value: { parameterKey: RETENTION, value: 180, changedAt: CHANGED_AT, rowVersion: 4 },
    });
    await expect(
      db.select().from(parameterOverrides).orderBy(parameterOverrides.parameterKey),
    ).resolves.toStrictEqual([
      { parameterKey: PAGE_SIZE, value: 20, changedAt: CHANGED_AT, rowVersion: 3 },
      { parameterKey: RETENTION, value: 180, changedAt: CHANGED_AT, rowVersion: 4 },
    ]);
  });

  it('[CL-IHM-18] refuses a change sent with a stale version, and returns the current row to show', async () => {
    await saveRetention();

    const result = await saveRetention();

    expect(result).toStrictEqual({
      ok: false,
      error: {
        kind: 'changed_elsewhere',
        current: { parameterKey: RETENTION, value: 180, changedAt: CHANGED_AT, rowVersion: 4 },
      },
    });
    await expect(
      db
        .select({ rowVersion: parameterOverrides.rowVersion })
        .from(parameterOverrides)
        .orderBy(parameterOverrides.parameterKey),
    ).resolves.toStrictEqual([{ rowVersion: 3 }, { rowVersion: 4 }]);
  });

  it('[CL-IHM-19] says that the row no longer exists when it was deleted meanwhile', async () => {
    await db.delete(parameterOverrides).where(eq(parameterOverrides.parameterKey, RETENTION));

    await expect(saveRetention()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no_longer_exists' },
    });
  });

  it('[CL-IHM-18] versions any table that carries a row version, such as the interface settings', async () => {
    await db.insert(uiState).values({ id: 1 });

    const result = await db.transaction(async (tx) =>
      updateVersioned(tx, uiState, {
        where: eq(uiState.id, 1),
        expectedVersion: 1,
        set: { onboardingGuideHidden: true },
      }),
    );

    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: 1,
        onboardingGuideHidden: true,
        firstProfileViewedAt: null,
        inProgressBannerHiddenAt: null,
        rowVersion: 2,
      },
    });
  });
});

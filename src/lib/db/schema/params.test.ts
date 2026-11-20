import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '../test-database';
import { journalEntries } from './journal';
import {
  OVERRIDABLE_PARAMETER_KEYS,
  parameterChanges,
  parameterOverrides,
  parameterSnapshots,
  uiState,
} from './params';

import type { Database } from '../types';

// The journal's retention, changed from its default of 90 days to 120.
const CHANGE = {
  parameterKey: 'journal.retentionDays',
  oldValue: 90,
  newValue: 120,
  affectsCalculations: false,
} as const;
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a primary key or a unique constraint refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the parameter tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('keeps an override of each of the 130 keys of the module map that hold a value, at version 1', async () => {
    await db
      .insert(parameterOverrides)
      .values(OVERRIDABLE_PARAMETER_KEYS.map((parameterKey) => ({ parameterKey, value: 1 })));

    const stored = await db.select().from(parameterOverrides);

    expect(new Set(stored.map((row) => row.parameterKey))).toStrictEqual(
      new Set(OVERRIDABLE_PARAMETER_KEYS),
    );
    expect(stored).toHaveLength(130);
    expect(stored).toContainEqual({
      parameterKey: 'display.timeZone',
      value: 1,
      changedAt: ANY_INSTANT,
      rowVersion: 1,
    });
  });

  it('refuses an override of the criterion switch, whose values live on the type sheets, or of an unknown key', async () => {
    await db
      .insert(parameterOverrides)
      .values({ parameterKey: 'display.timeZone', value: 'America/New_York' });

    const switched = db
      .insert(parameterOverrides)
      .values({ parameterKey: sql`'taxonomy.switchedOffCriterion'`, value: 'SEN-13' });
    const unknown = db
      .insert(parameterOverrides)
      .values({ parameterKey: sql`'display.theme'`, value: 'dark' });
    const second = db
      .insert(parameterOverrides)
      .values({ parameterKey: 'display.timeZone', value: 'Europe/Paris' });

    expect<readonly string[]>(OVERRIDABLE_PARAMETER_KEYS).not.toContain(
      'taxonomy.switchedOffCriterion',
    );
    await expect(switched).rejects.toMatchObject(
      violationOf('parameter_overrides_parameter_key_check'),
    );
    await expect(unknown).rejects.toMatchObject(
      violationOf('parameter_overrides_parameter_key_check'),
    );
    await expect(second).rejects.toMatchObject(duplicateOf('parameter_overrides_pkey'));
  });

  it('keeps every parameter change with its values, after its journal entry is gone', async () => {
    await db
      .insert(journalEntries)
      .values({ category: 'parameter_change', level: 'info', messageKey: 'parameter_changed' });
    await db.insert(parameterChanges).values({ ...CHANGE, journalEntryId: 1 });

    await db.delete(journalEntries).where(eq(journalEntries.id, 1));

    await expect(db.select().from(parameterChanges)).resolves.toStrictEqual([
      { id: 1, ...CHANGE, changedAt: ANY_INSTANT, journalEntryId: null },
    ]);
  });

  it('stores each set of calculation values once, by its hash', async () => {
    const snapshot = {
      values: { 'games.minutesFloor': 15, 'sensitivity.minValidCases': 5 },
      valuesHash: 'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78',
    };
    await db.insert(parameterSnapshots).values(snapshot);

    const again = db.insert(parameterSnapshots).values(snapshot);

    await expect(db.select().from(parameterSnapshots)).resolves.toStrictEqual([
      { id: 1, capturedAt: ANY_INSTANT, ...snapshot },
    ]);
    await expect(again).rejects.toMatchObject(
      duplicateOf('parameter_snapshots_values_hash_unique'),
    );
  });

  it('keeps the interface settings in one row, id 1, with the guide shown', async () => {
    await db.insert(uiState).values({});

    const second = db.insert(uiState).values({ id: 2 });
    const again = db.insert(uiState).values({});

    await expect(db.select().from(uiState)).resolves.toStrictEqual([
      {
        id: 1,
        onboardingGuideHidden: false,
        firstProfileViewedAt: null,
        inProgressBannerHiddenAt: null,
        rowVersion: 1,
      },
    ]);
    await expect(second).rejects.toMatchObject(violationOf('ui_state_id_check'));
    await expect(again).rejects.toMatchObject(duplicateOf('ui_state_pkey'));
  });
});

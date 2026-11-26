import { eq } from 'drizzle-orm';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, parameterSnapshots } from '@/lib/db';
import { setParam, snapshotCalculationParams } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS, DEFAULT_PARAMS } from '@/lib/testing';

import { paramsInForce, snapshotParams } from './engine-params';

describe('the engine parameters of a calculation', () => {
  it(
    '[TRV-34] [TRV-35] reads the parameters in force: the registry defaults, then an override of the owner',
    async () => {
      const database = await createTestDatabase();
      onTestFinished(database.close);
      const { db } = database;

      await expect(paramsInForce(db)).resolves.toStrictEqual(DEFAULT_PARAMS);
      await db.transaction(async (tx) =>
        setParam(tx, { key: 'sensitivity.minValidCases', value: 6, expectedVersion: 0 }),
      );
      await expect(paramsInForce(db)).resolves.toStrictEqual({
        ...DEFAULT_PARAMS,
        sensitivity: { ...DEFAULT_PARAMS.sensitivity, minValidCases: 6 },
      });
    },
    DATABASE_TEST_TIMEOUT_MS,
  );

  it(
    '[SEN-36] reads the parameters of a snapshot as it holds them',
    async () => {
      const database = await createTestDatabase();
      onTestFinished(database.close);
      const { db } = database;
      await db.transaction(async (tx) =>
        setParam(tx, { key: 'sensitivity.minValidCases', value: 7, expectedVersion: 0 }),
      );
      const snapshotId = await snapshotCalculationParams(db);
      const [snapshot] = await db
        .select({ values: parameterSnapshots.values })
        .from(parameterSnapshots)
        .where(eq(parameterSnapshots.id, snapshotId));

      expect(snapshotParams(snapshot?.values).sensitivity.minValidCases).toBe(7);
    },
    DATABASE_TEST_TIMEOUT_MS,
  );

  it('[SEN-36] [TRV-35] takes the default of a value that a snapshot lacks or that the registry refuses', () => {
    expect(snapshotParams({})).toStrictEqual(DEFAULT_PARAMS);
    expect(
      snapshotParams({ 'sensitivity.minValidCases': 'five', 'games.minutesFloor': 4 }),
    ).toStrictEqual({
      ...DEFAULT_PARAMS,
      games: { ...DEFAULT_PARAMS.games, minutesFloor: 4 },
    });
  });
});

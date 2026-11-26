import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, journalEntries, parameterChanges, parameterOverrides } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { engineParamsOf, setOwnerParam } from './params';

import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8));

describe('the parameters of the factories', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it("[TRV-36] gives the engine's parameters at the registry's defaults when nothing is overridden", async () => {
    await expect(engineParamsOf(db)).resolves.toStrictEqual(engineParams);
  });

  it("[TRV-35] [TRV-36] saves the owner's values through the registry, which the engine's parameters then follow", async () => {
    await setOwnerParam(db, 'games.correctionWindowDays', 5);
    await setOwnerParam(db, 'games.correctionWindowDays', 6);
    await setOwnerParam(db, 'sensitivity.coOccurringCasesDoubtful', true);

    const params = await engineParamsOf(db);

    expect(params.games).toStrictEqual({ ...engineParams.games, correctionWindowDays: 6 });
    expect(params.sensitivity).toStrictEqual({
      ...engineParams.sensitivity,
      coOccurringCasesDoubtful: true,
    });
    await expect(
      db
        .select({
          key: parameterChanges.parameterKey,
          oldValue: parameterChanges.oldValue,
          newValue: parameterChanges.newValue,
        })
        .from(parameterChanges)
        .orderBy(asc(parameterChanges.id)),
    ).resolves.toStrictEqual([
      { key: 'games.correctionWindowDays', oldValue: 7, newValue: 5 },
      { key: 'games.correctionWindowDays', oldValue: 5, newValue: 6 },
      { key: 'sensitivity.coOccurringCasesDoubtful', oldValue: false, newValue: true },
    ]);
    await expect(db.$count(journalEntries)).resolves.toBe(3);
  });

  it('[TRV-35] throws on a value that the registry refuses, and writes nothing', async () => {
    await expect(setOwnerParam(db, 'games.correctionWindowDays', -1)).rejects.toThrow(
      /^The registry refused games\.correctionWindowDays = -1: \{"kind":"out_of_bounds"/u,
    );
    await expect(db.$count(parameterOverrides)).resolves.toBe(0);
  });
});

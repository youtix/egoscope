import { describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, recalculationJobs } from '@/lib/db';
import { BIRTHDAY, DATABASE_TEST_TIMEOUT_MS, leaguePlayerId, MEDIA_STORM } from '@/lib/testing';

import { isProfileRecalculating } from './profile-recalculation';

import type { Database } from '@/lib/db';

const HIM = leaguePlayerId('p01');
const OTHER = leaguePlayerId('p02');
const PROFILE = { playerId: HIM, eventTypeId: MEDIA_STORM };
const JOB = { scope: 'event_or_case_change', cause: 'event_corrected_or_removed' } as const;

/** A fresh database holding `jobs`, closed when the test ends. */
async function withJobs(
  ...jobs: readonly (typeof recalculationJobs.$inferInsert)[]
): Promise<Database> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  if (jobs.length > 0) {
    await database.db.insert(recalculationJobs).values([...jobs]);
  }
  return database.db;
}

describe('whether a job covers a profile', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[SEN-36] [CL-SEN-16] answers no while no job is recorded', async () => {
    await expect(isProfileRecalculating(await withJobs(), PROFILE)).resolves.toBe(false);
  });

  it('[SEN-36] [CL-SEN-16] covers every profile by a full job', async () => {
    const db = await withJobs({ scope: 'full', cause: 'parameter_change' });

    await expect(isProfileRecalculating(db, PROFILE)).resolves.toBe(true);
  });

  it('[SEN-36] [CL-SEN-16] covers his profile by a job naming him, among others, with no type', async () => {
    const db = await withJobs({ ...JOB, playerIds: [OTHER, HIM] });

    await expect(isProfileRecalculating(db, PROFILE)).resolves.toBe(true);
  });

  it('[SEN-36] [CL-SEN-16] covers his profile by a job naming him with its type among others', async () => {
    const db = await withJobs({ ...JOB, playerIds: [HIM], eventTypeIds: [BIRTHDAY, MEDIA_STORM] });

    await expect(isProfileRecalculating(db, PROFILE)).resolves.toBe(true);
  });

  it('[SEN-36] [CL-SEN-16] does not cover his profile by his job of another type, nor by another player’s job of its type or of every type', async () => {
    const db = await withJobs(
      { ...JOB, playerIds: [HIM], eventTypeIds: [BIRTHDAY] },
      { ...JOB, playerIds: [OTHER], eventTypeIds: [MEDIA_STORM] },
      { ...JOB, playerIds: [OTHER] },
      { scope: 'statistics_update', cause: 'new_cases', playerIds: [OTHER], gameIds: [1] },
    );

    await expect(isProfileRecalculating(db, PROFILE)).resolves.toBe(false);
  });
});

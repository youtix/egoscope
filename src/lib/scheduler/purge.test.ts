import { asc } from 'drizzle-orm';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, taskRuns } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import { purgeExpired } from '.';

const DAY = 86_400_000;
const PURGE_AT = toEpochMs(Date.UTC(2026, 10, 25, 3));
const RETENTION_DAYS = 90;
const PASS = '00000000-0000-4000-8000-000000000002';
const daysAgo = (days: number) => new Date(PURGE_AT - days * DAY);

describe('the purge of task runs', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[TRV-48] deletes the finished runs older than the journal retention, never a running or waiting one', async () => {
    const database = await createTestDatabase();
    onTestFinished(database.close);
    const { db } = database;
    const started = (days: number) => ({
      dueAt: daysAgo(days),
      startedAt: daysAgo(days),
      passId: PASS,
    });
    const finished = (days: number) => ({
      ...started(days),
      finishedAt: daysAgo(days),
      result: 'succeeded' as const,
    });
    await db.insert(taskRuns).values([
      { taskKey: 'purge', trigger: 'scheduled', ...finished(91) },
      { taskKey: 'backup', trigger: 'scheduled', ...finished(90) },
      { taskKey: 'recalculation', trigger: 'on_demand', ...started(200) },
      { taskKey: 'link-check', trigger: 'on_demand', dueAt: daysAgo(200) },
    ]);
    const deleted = await db.transaction(async (tx) =>
      purgeExpired(tx, { now: PURGE_AT, retentionDays: RETENTION_DAYS }),
    );
    expect(deleted).toBe(1);
    const kept = await db
      .select({ taskKey: taskRuns.taskKey })
      .from(taskRuns)
      .orderBy(asc(taskRuns.id));
    expect(kept).toStrictEqual([
      { taskKey: 'backup' },
      { taskKey: 'recalculation' },
      { taskKey: 'link-check' },
    ]);
  });
});

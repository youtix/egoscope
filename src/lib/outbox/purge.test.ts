import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, outboxFacts } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { deleteFactsOf, purgeConsumed } from './purge';

import type { Database } from '@/lib/db';

// The purge of Tuesday 24 November 2026 at 04:00 Paris time, with the default retention.
const PURGE_AT = toEpochMs(Date.UTC(2026, 10, 24, 3));
const RETENTION_DAYS = 90;
const daysBefore = (days: number) => new Date(PURGE_AT - days * 86_400_000);

describe('the deletion of the facts', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  const left = async () =>
    db
      .select({ kind: outboxFacts.kind, subject: outboxFacts.lot2SubjectId })
      .from(outboxFacts)
      .orderBy(asc(outboxFacts.id));

  it('[TEL-17] [TEL-23] deletes the consumed facts, and the others once older than the retention', async () => {
    await db.insert(outboxFacts).values([
      {
        kind: 'alert_sheet_produced',
        lot2SubjectId: 1,
        createdAt: daysBefore(1),
        consumedAt: daysBefore(1),
      },
      { kind: 'alert_sheet_produced', lot2SubjectId: 2, createdAt: daysBefore(91) },
      { kind: 'alert_sheet_produced', lot2SubjectId: 3, createdAt: daysBefore(90) },
      { kind: 'alert_sheet_produced', lot2SubjectId: 4, createdAt: daysBefore(1) },
    ]);

    await expect(
      db.transaction(async (tx) =>
        purgeConsumed(tx, { now: PURGE_AT, retentionDays: RETENTION_DAYS }),
      ),
    ).resolves.toBe(2);

    await expect(left()).resolves.toStrictEqual([
      { kind: 'alert_sheet_produced', subject: 3 },
      { kind: 'alert_sheet_produced', subject: 4 },
    ]);
  });

  it('[CL-DSN-16] [CL-ALE-16] deletes the fact of one Lot 2 subject, consumed or not, and leaves the others', async () => {
    await db.insert(outboxFacts).values([
      { kind: 'alert_sheet_produced', lot2SubjectId: 6, consumedAt: daysBefore(1) },
      { kind: 'alert_sheet_updated', lot2SubjectId: 6 },
      { kind: 'alert_sheet_produced', lot2SubjectId: 9 },
      { kind: 'tracked_result_ready', lot2SubjectId: 6 },
    ]);
    const deleteOf = async (subject: Parameters<typeof deleteFactsOf>[1]) =>
      db.transaction(async (tx) => deleteFactsOf(tx, subject));

    await expect(deleteOf({ kind: 'alert_sheet_produced', lot2SubjectId: 6 })).resolves.toBe(1);
    await expect(deleteOf({ kind: 'tracked_result_ready', lot2SubjectId: 9 })).resolves.toBe(0);

    await expect(left()).resolves.toStrictEqual([
      { kind: 'alert_sheet_updated', subject: 6 },
      { kind: 'alert_sheet_produced', subject: 9 },
      { kind: 'tracked_result_ready', subject: 6 },
    ]);
  });
});

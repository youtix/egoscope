import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, incidents, outboxFacts } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { purgeExpired } from './purge';
import { listOpen } from './read';

import type { Database } from '@/lib/db';

// The purge of Tuesday 24 November 2026 at 04:00 Paris time, with the default retention.
const PURGE_AT = toEpochMs(Date.UTC(2026, 10, 24, 3));
const RETENTION_DAYS = 90;
const daysBefore = (days: number) => new Date(PURGE_AT - days * 86_400_000);

describe('the purge of the incidents', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('[TRV-48] deletes the incidents closed for longer than the retention, with their facts, and keeps the open ones however old', async () => {
    const closedSince = (days: number) =>
      ({ status: 'closed', openedAt: daysBefore(days + 1), closedAt: daysBefore(days) }) as const;
    await db.insert(incidents).values([
      { kind: 'task_not_run', causeKey: 'purge', ...closedSince(91) },
      { kind: 'task_not_run', causeKey: 'backup', ...closedSince(90) },
      { kind: 'backup_failed', causeKey: 'upload_failed', openedAt: daysBefore(200) },
    ]);
    await db.insert(outboxFacts).values([
      { kind: 'incident_opened', incidentId: 1 },
      { kind: 'incident_closed', incidentId: 1 },
      { kind: 'incident_opened', incidentId: 2 },
    ]);

    await expect(
      db.transaction(async (tx) =>
        purgeExpired(tx, { now: PURGE_AT, retentionDays: RETENTION_DAYS }),
      ),
    ).resolves.toBe(1);

    await expect(
      db.select({ id: incidents.id }).from(incidents).orderBy(asc(incidents.id)),
    ).resolves.toStrictEqual([{ id: 2 }, { id: 3 }]);
    await expect(
      db.select({ incidentId: outboxFacts.incidentId }).from(outboxFacts),
    ).resolves.toStrictEqual([{ incidentId: 2 }]);
    await expect(listOpen(db)).resolves.toMatchObject([{ id: 3, kind: 'backup_failed' }]);
  });
});

import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, incidents, journalEntries, journalTechnicalDetails } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { purgeExpired } from './purge';
import { record } from './record';

import type { JournalEntryInput } from './record';
import type { Database } from '@/lib/db';

// The purge of Friday 20 November 2026 at 04:00 Paris time, with the default retention.
const PURGE_AT = toEpochMs(Date.UTC(2026, 10, 20, 3));
const RETENTION_DAYS = 90;
const daysBefore = (days: number) => toEpochMs(PURGE_AT - days * 86_400_000);

describe('purgeExpired', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  /** Records `entries` in one transaction. */
  async function write(entries: readonly JournalEntryInput[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const entry of entries) {
        await record(tx, entry);
      }
    });
  }

  /** Runs the purge's step, and gives the number deleted and the entries left. */
  async function purge() {
    const deleted = await db.transaction(async (tx) =>
      purgeExpired(tx, { now: PURGE_AT, retentionDays: RETENTION_DAYS }),
    );
    const left = await db
      .select({ messageKey: journalEntries.messageKey })
      .from(journalEntries)
      .orderBy(asc(journalEntries.id));
    return { deleted, left: left.map((entry) => entry.messageKey) };
  }

  it('[TRV-48] deletes the entries older than the retention, with their technical details, and keeps the others', async () => {
    await write([
      {
        messageKey: 'service_call_failed',
        params: { service: 'stats_source' },
        occurredAt: daysBefore(91),
        technicalDetails: { httpStatus: 503 },
      },
      { messageKey: 'login_refused', occurredAt: daysBefore(90) },
      { messageKey: 'trigger_refused', occurredAt: daysBefore(89) },
    ]);

    await expect(purge()).resolves.toStrictEqual({
      deleted: 1,
      left: ['login_refused', 'trigger_refused'],
    });
    await expect(db.$count(journalTechnicalDetails)).resolves.toBe(0);
  });

  it('[TRV-48] keeps the old entries of an incident still open, until it closes', async () => {
    const [open, closed] = await db
      .insert(incidents)
      .values([
        { kind: 'backup_failed', causeKey: 'storage_unreachable' },
        {
          kind: 'task_not_run',
          causeKey: 'backup',
          status: 'closed',
          closedAt: new Date(daysBefore(95)),
        },
      ])
      .returning({ id: incidents.id });
    await write([
      {
        messageKey: 'incident_opened',
        incidentId: open?.id ?? 0,
        params: { incident: { kind: 'backup_failed' } },
        occurredAt: daysBefore(120),
      },
      {
        messageKey: 'incident_opened',
        incidentId: closed?.id ?? 0,
        params: { incident: { kind: 'task_not_run' } },
        occurredAt: daysBefore(120),
      },
    ]);

    await expect(purge()).resolves.toStrictEqual({ deleted: 1, left: ['incident_opened'] });
    await expect(
      db.select({ incidentId: journalEntries.incidentId }).from(journalEntries),
    ).resolves.toStrictEqual([{ incidentId: open?.id }]);

    await db
      .update(incidents)
      .set({ status: 'closed', closedAt: new Date(PURGE_AT) })
      .where(eq(incidents.id, open?.id ?? 0));

    await expect(purge()).resolves.toStrictEqual({ deleted: 1, left: [] });
  });
});

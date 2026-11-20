import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { createTestDatabase } from '../test-database';
import { backups, exportDownloads, restoreReportEvents, restoreReports } from './backups';

import type { Database } from '../types';

// The weekly backup of Monday 2026-11-16, 04:00 UTC, stored under its instant and kind.
const STARTED_AT = new Date(toEpochMs(Date.UTC(2026, 10, 16, 4)));
const STORED = {
  kind: 'weekly',
  status: 'done',
  startedAt: STARTED_AT,
  objectName: 'egoscope-backup-20261116T040000Z-weekly.bin',
} as const;
// A restore of that backup into the current database.
const REPORT = {
  backupCreatedAt: STARTED_AT,
  sourceKind: 'backup',
  tableCounts: { teams: 30, games: 1312 },
  playersDeletedAgain: 1,
  eventsWithdrawnAgain: 2,
  ledgerCarriedOver: true,
  olderThanHorizon: false,
  consistencyCheckPassed: true,
} as const;
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the backup tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('registers a stored backup with its object, and a failed one with its cause', async () => {
    await db.insert(backups).values([
      { ...STORED, sizeBytes: 12_582_912 },
      { kind: 'manual', status: 'failed', failureCause: 'storage_not_private' },
    ]);

    await expect(db.select().from(backups).orderBy(backups.id)).resolves.toStrictEqual([
      {
        id: 1,
        ...STORED,
        finishedAt: null,
        sizeBytes: 12_582_912,
        failureCause: null,
        deletedAt: null,
        deletionFailedAt: null,
      },
      {
        id: 2,
        kind: 'manual',
        status: 'failed',
        startedAt: ANY_INSTANT,
        finishedAt: null,
        objectName: null,
        sizeBytes: null,
        failureCause: 'storage_not_private',
        deletedAt: null,
        deletionFailedAt: null,
      },
    ]);
  });

  it('[CL-TRV-04] requires the object of a stored backup and the cause of a failed one, never the other way', async () => {
    const objectless = db.insert(backups).values({ ...STORED, objectName: null });
    const failedWithObject = db
      .insert(backups)
      .values({ ...STORED, status: 'failed', failureCause: 'upload_failed' });
    const causeless = db.insert(backups).values({ kind: 'weekly', status: 'failed' });
    const storedWithCause = db.insert(backups).values({ ...STORED, failureCause: 'upload_failed' });

    await expect(objectless).rejects.toMatchObject(violationOf('backups_done_check'));
    await expect(failedWithObject).rejects.toMatchObject(violationOf('backups_done_check'));
    await expect(causeless).rejects.toMatchObject(violationOf('backups_failed_check'));
    await expect(storedWithCause).rejects.toMatchObject(violationOf('backups_failed_check'));
  });

  it('[CL-TRV-04] accepts the backup kinds and failure causes of the data model, and refuses others', async () => {
    const causes = [
      'missing_key',
      'missing_token',
      'storage_unreachable',
      'storage_not_private',
      'upload_failed',
      'verification_failed',
    ] as const;
    await db.insert(backups).values([
      ...causes.map((failureCause) => ({
        kind: 'before_update' as const,
        status: 'failed' as const,
        failureCause,
      })),
      { ...STORED, kind: 'manual' },
    ]);

    const kind = db.insert(backups).values({ ...STORED, kind: sql`'daily'` });
    const status = db.insert(backups).values({ kind: 'weekly', status: sql`'pending'` });
    const cause = db
      .insert(backups)
      .values({ kind: 'weekly', status: 'failed', failureCause: sql`'disk_full'` });

    await expect(db.select().from(backups)).resolves.toHaveLength(7);
    await expect(kind).rejects.toMatchObject(violationOf('backups_kind_check'));
    await expect(status).rejects.toMatchObject(violationOf('backups_status_check'));
    await expect(cause).rejects.toMatchObject(violationOf('backups_failure_cause_check'));
  });

  it('records each export downloaded, of the five kinds of the data model', async () => {
    const kinds = ['full', 'players', 'events', 'cases', 'profiles'] as const;
    await db.insert(exportDownloads).values(kinds.map((kind) => ({ kind })));

    const stored = await db.select().from(exportDownloads).orderBy(exportDownloads.id);
    const unknown = db.insert(exportDownloads).values({ kind: sql`'teams'` });

    expect(stored).toStrictEqual(
      kinds.map((kind, index) => ({ id: index + 1, kind, downloadedAt: ANY_INSTANT })),
    );
    await expect(unknown).rejects.toMatchObject(violationOf('export_downloads_kind_check'));
  });

  it('[CL-TRV-06] keeps the summary of a restore, of a backup or a full export, and the events it left to check, which go with it', async () => {
    await db.insert(restoreReports).values([REPORT, { ...REPORT, sourceKind: 'full_export' }]);
    await db.insert(restoreReportEvents).values([
      { restoreReportId: 1, playerEventId: 12 },
      { restoreReportId: 1, playerEventId: 13 },
    ]);
    const twice = db.insert(restoreReportEvents).values({ restoreReportId: 1, playerEventId: 12 });
    const unknown = db.insert(restoreReports).values({ ...REPORT, sourceKind: sql`'snapshot'` });
    await expect(twice).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint: 'restore_report_events_restore_report_id_player_event_id_pk',
      },
    });
    await expect(unknown).rejects.toMatchObject(violationOf('restore_reports_source_kind_check'));
    const summary = await db.select().from(restoreReports).orderBy(restoreReports.id);

    await db.delete(restoreReports).where(eq(restoreReports.id, 1));

    expect(summary).toStrictEqual([
      { id: 1, restoredAt: ANY_INSTANT, ...REPORT },
      { id: 2, restoredAt: ANY_INSTANT, ...REPORT, sourceKind: 'full_export' },
    ]);
    await expect(db.select().from(restoreReportEvents)).resolves.toStrictEqual([]);
  });
});

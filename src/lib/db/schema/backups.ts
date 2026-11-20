import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';

// BackupKind (TRV-50, TRV-55, CL-TRV-04).
const BACKUP_KINDS = ['weekly', 'manual', 'before_update'] as const;
// BackupStatus (TRV-50).
const BACKUP_STATUSES = ['done', 'failed'] as const;
// The causes of a failed backup, one "backup failed" incident each (CL-TRV-04).
const BACKUP_FAILURE_CAUSES = [
  'missing_key',
  'missing_token',
  'storage_unreachable',
  'storage_not_private',
  'upload_failed',
  'verification_failed',
] as const;
// ExportKind: the full export and the spreadsheet exports (TRV-52).
const EXPORT_KINDS = ['full', 'players', 'events', 'cases', 'profiles'] as const;
// What a restore read: a backup or a full export (TRV-53).
const RESTORE_SOURCE_KINDS = ['backup', 'full_export'] as const;

/**
 * The backup register: each backup attempt, the stored object it produced, and
 * its deletion by rotation once verified, or the doubt a failed deletion leaves
 * (TRV-50, CL-TRV-04, CL-DSN-07).
 */
export const backups = pgTable(
  'backups',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind', { enum: BACKUP_KINDS }).notNull(),
    status: text('status', { enum: BACKUP_STATUSES }).notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    objectName: text('object_name'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    failureCause: text('failure_cause', { enum: BACKUP_FAILURE_CAUSES }),
    deletedAt: timestamptz('deleted_at'),
    deletionFailedAt: timestamptz('deletion_failed_at'),
  },
  (table) => [
    check('backups_kind_check', oneOf(table.kind, BACKUP_KINDS)),
    check('backups_status_check', oneOf(table.status, BACKUP_STATUSES)),
    check('backups_failure_cause_check', oneOf(table.failureCause, BACKUP_FAILURE_CAUSES)),
    check(
      'backups_done_check',
      sql`(${table.status} = 'done') = (${table.objectName} IS NOT NULL)`,
    ),
    check(
      'backups_failed_check',
      sql`(${table.status} = 'failed') = (${table.failureCause} IS NOT NULL)`,
    ),
    index('backups_stored_idx')
      .on(table.startedAt)
      .where(sql`${table.status} = 'done' AND ${table.deletedAt} IS NULL`),
  ],
);

/** The exports downloaded; only a full one resets the export reminder (TRV-52, TRV-54, CL-TRV-22). */
export const exportDownloads = pgTable(
  'export_downloads',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind', { enum: EXPORT_KINDS }).notNull(),
    downloadedAt: timestamptz('downloaded_at').notNull().defaultNow(),
  },
  (table) => [check('export_downloads_kind_check', oneOf(table.kind, EXPORT_KINDS))],
);

/**
 * What a restore did, for the status screen: the rows restored per table, what
 * it deleted or withdrew again, and its warnings (TRV-53, CA-TRV-16, CL-TRV-06).
 */
export const restoreReports = pgTable(
  'restore_reports',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    restoredAt: timestamptz('restored_at').notNull().defaultNow(),
    backupCreatedAt: timestamptz('backup_created_at').notNull(),
    sourceKind: text('source_kind', { enum: RESTORE_SOURCE_KINDS }).notNull(),
    tableCounts: jsonb('table_counts').notNull(),
    playersDeletedAgain: integer('players_deleted_again').notNull(),
    eventsWithdrawnAgain: integer('events_withdrawn_again').notNull(),
    ledgerCarriedOver: boolean('ledger_carried_over').notNull(),
    olderThanHorizon: boolean('older_than_horizon').notNull(),
    consistencyCheckPassed: boolean('consistency_check_passed').notNull(),
  },
  (table) => [
    check('restore_reports_source_kind_check', oneOf(table.sourceKind, RESTORE_SOURCE_KINDS)),
  ],
);

/**
 * The restored events a restore left for the owner to check, each with its link
 * (CL-TRV-06); a withdrawal or the owner's check removes the row.
 */
export const restoreReportEvents = pgTable(
  'restore_report_events',
  {
    restoreReportId: integer('restore_report_id')
      .notNull()
      .references(() => restoreReports.id, { onDelete: 'cascade' }),
    // The deferred foreign key to events comes with that table: ON DELETE CASCADE.
    playerEventId: integer('player_event_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.restoreReportId, table.playerEventId] })],
);

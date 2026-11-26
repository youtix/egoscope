import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { oneOf, subsetOf, timestamptz } from './builders';

// IncidentKind: the glossary's incident kinds (section 9.2).
const INCIDENT_KINDS = [
  'press_source_down',
  'collection_impossible',
  'press_source_silent',
  'feed_too_short',
  'quota_reached',
  'quota_warning',
  'database_volume_warning',
  'stats_source_unavailable',
  'stats_source_schema_changed',
  'task_not_run',
  'backup_failed',
  'logins_refused',
  'telegram_link_broken',
  'export_reminder',
] as const;
// The quota incidents, which always name their service (TRV-09).
const QUOTA_KINDS = [
  'quota_reached',
  'quota_warning',
] as const satisfies readonly (typeof INCIDENT_KINDS)[number][];
// ServiceRole: the "{service function}" of a quota incident (TRV-05, TRV-09).
const SERVICE_ROLES = [
  'hosting',
  'database',
  'stats_source',
  'language_model',
  'news_feeds',
  'notifications',
  'trigger_service',
  'backup_storage',
] as const;
// IncidentStatus (TRV-45).
const INCIDENT_STATUSES = ['open', 'closed'] as const;
// QuotaIncidentCause: the causes that a quota_reached incident names (CL-TRV-11).
export const QUOTA_INCIDENT_CAUSES = [
  'limit_reached',
  'refused_before_limit',
  'not_answering',
] as const;

/**
 * Incidents, and the warnings and reminders handled like them: opened once per
 * cause, closed automatically when the cause disappears, only hidden by the owner
 * (TRV-45, IHM-20, CL-TRV-11, CL-IHM-20).
 */
export const incidents = pgTable(
  'incidents',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind', { enum: INCIDENT_KINDS }).notNull(),
    causeKey: text('cause_key').notNull().default(''),
    serviceRole: text('service_role', { enum: SERVICE_ROLES }),
    status: text('status', { enum: INCIDENT_STATUSES }).notNull().default('open'),
    openedAt: timestamptz('opened_at').notNull().defaultNow(),
    closedAt: timestamptz('closed_at'),
    hiddenAt: timestamptz('hidden_at'),
    quotaCauses: text('quota_causes', { enum: QUOTA_INCIDENT_CAUSES })
      .array()
      .notNull()
      .default([]),
    details: jsonb('details').notNull().default({}),
  },
  (table) => [
    check('incidents_kind_check', oneOf(table.kind, INCIDENT_KINDS)),
    check('incidents_service_role_check', oneOf(table.serviceRole, SERVICE_ROLES)),
    check('incidents_status_check', oneOf(table.status, INCIDENT_STATUSES)),
    check('incidents_quota_causes_check', subsetOf(table.quotaCauses, QUOTA_INCIDENT_CAUSES)),
    check(
      'incidents_closed_check',
      sql`(${table.status} = 'closed') = (${table.closedAt} IS NOT NULL)`,
    ),
    check(
      'incidents_quota_reached_check',
      sql`(${table.kind} = 'quota_reached') = (${table.quotaCauses} <> '{}')`,
    ),
    check(
      'incidents_quota_service_role_check',
      sql`NOT (${oneOf(table.kind, QUOTA_KINDS)}) OR ${table.serviceRole} IS NOT NULL`,
    ),
    uniqueIndex('incidents_open_cause_key')
      .on(table.kind, table.causeKey)
      .where(sql`${table.status} = 'open'`),
    index('incidents_status_idx').on(table.status, table.openedAt),
  ],
);

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';

import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// The task keys of the module map's task registry (section 4); the run check is no task.
const TASK_KEYS = [
  'statistics-update',
  'statistics-fetch',
  'calendar-derivation',
  'recalculation',
  'link-check',
  'purge',
  'backup',
  'news-collection',
  'detection',
  'classification-resume',
  'game-tracking',
  'notification-dispatch',
] as const;
// TaskRunTrigger: a catch-up run after a missed occurrence is scheduled (CL-TRV-08).
const TASK_RUN_TRIGGERS = ['scheduled', 'on_demand'] as const;
// TaskRunResult: none while the run runs or waits (CL-TRV-07, CL-TRV-23).
const TASK_RUN_RESULTS = ['succeeded', 'failed', 'interrupted', 'source_late'] as const;

/**
 * One run of a scheduled task, or an on-demand run requested and not started
 * yet: waiting without a start, running without a result, then its result
 * (TRV-26, TRV-28, TRV-30, CL-TRV-07, CL-TRV-08, CL-COL-20). A postponement and
 * a missed occurrence are journal entries, never runs.
 */
export const taskRuns = pgTable(
  'task_runs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    taskKey: text('task_key', { enum: TASK_KEYS }).notNull(),
    trigger: text('trigger', { enum: TASK_RUN_TRIGGERS }).notNull(),
    dueAt: timestamptz('due_at').notNull(),
    startedAt: timestamptz('started_at'),
    progressAt: timestamptz('progress_at'),
    finishedAt: timestamptz('finished_at'),
    result: text('result', { enum: TASK_RUN_RESULTS }),
    parentRunId: integer('parent_run_id').references((): AnyPgColumn => taskRuns.id, {
      onDelete: 'set null',
    }),
    passId: uuid('pass_id'),
    // The statistics update's competition day, its probes and the last refresh they saw.
    competitionDayOn: date('competition_day_on'),
    probeCount: smallint('probe_count'),
    lastRefreshSeenAt: timestamptz('last_refresh_seen_at'),
    cursor: text('cursor'),
    summary: jsonb('summary').notNull().default({}),
  },
  (table) => [
    check('task_runs_task_key_check', oneOf(table.taskKey, TASK_KEYS)),
    check('task_runs_trigger_check', oneOf(table.trigger, TASK_RUN_TRIGGERS)),
    check('task_runs_result_check', oneOf(table.result, TASK_RUN_RESULTS)),
    check(
      'task_runs_finished_check',
      sql`(${table.finishedAt} IS NULL) = (${table.result} IS NULL)`,
    ),
    check(
      'task_runs_waiting_check',
      sql`${table.startedAt} IS NOT NULL OR (${table.trigger} = 'on_demand' AND ${table.result} IS NULL)`,
    ),
    check('task_runs_pass_check', sql`${table.startedAt} IS NULL OR ${table.passId} IS NOT NULL`),
    check(
      'task_runs_statistics_update_check',
      sql`${table.taskKey} = 'statistics-update' OR (${table.competitionDayOn}, ${table.probeCount}, ${table.lastRefreshSeenAt}) IS NULL`,
    ),
    check(
      'task_runs_source_late_check',
      sql`${table.result} <> 'source_late' OR ${table.taskKey} = 'statistics-update'`,
    ),
    uniqueIndex('task_runs_one_running_key')
      .on(table.taskKey)
      .where(sql`${table.startedAt} IS NOT NULL AND ${table.result} IS NULL`),
    uniqueIndex('task_runs_one_requested_key')
      .on(table.taskKey)
      .where(sql`${table.startedAt} IS NULL`),
    index('task_runs_task_started_idx').on(table.taskKey, table.startedAt),
    index('task_runs_task_due_idx').on(table.taskKey, table.dueAt),
    index('task_runs_day_idx')
      .on(table.competitionDayOn)
      .where(sql`${table.taskKey} = 'statistics-update'`),
    index('task_runs_pass_idx').on(table.passId),
  ],
);

/**
 * The tick lease, one row (`id = 1`): the database pass of a tick holds it, so
 * that two trigger calls never run passes side by side, and a lease past its
 * expiry is free again after a crashed invocation (TRV-28, TRV-29, TRV-30). Its
 * pass and its expiry are set together, and both are null while it is free.
 */
export const schedulerLease = pgTable(
  'scheduler_lease',
  {
    id: smallint('id').primaryKey(),
    passId: uuid('pass_id'),
    expiresAt: timestamptz('expires_at'),
  },
  (table) => [
    check('scheduler_lease_id_check', sql`${table.id} = 1`),
    check(
      'scheduler_lease_holder_check',
      sql`(${table.passId} IS NULL) = (${table.expiresAt} IS NULL)`,
    ),
  ],
);

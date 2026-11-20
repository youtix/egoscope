import { bigint, date, integer, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';

import { timestamptz } from './builders';

/**
 * The application's own count of its usage, per quota limit and period
 * instance, with the 80 % warning given once per instance, the limit reached
 * (or refused before it, TRV-06) and the reset instant the provider says
 * (TRV-03 to TRV-06, CL-TRV-12, CL-DET-04).
 */
export const quotaUsage = pgTable(
  'quota_usage',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    limitKey: text('limit_key').notNull(),
    periodStartAt: timestamptz('period_start_at').notNull(),
    used: bigint('used', { mode: 'number' }).notNull().default(0),
    warningGivenAt: timestamptz('warning_given_at'),
    reachedAt: timestamptz('reached_at'),
    resetsAt: timestamptz('resets_at'),
  },
  (table) => [unique('quota_usage_key').on(table.limitKey, table.periodStartAt)],
);

/**
 * The minutes in which the database was active, at most one row a minute per
 * server instance, from which the month's compute-hours are estimated (TRV-03,
 * TRV-04).
 */
export const databaseActivityMinutes = pgTable(
  'database_activity_minutes',
  {
    minuteAt: timestamptz('minute_at').notNull(),
    instanceId: text('instance_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.minuteAt, table.instanceId] })],
);

/**
 * The database's size, read once a day by the purge on the owner's calendar, so
 * that the application measures its real volume (TRV-07, TRV-08).
 */
export const databaseSizeSamples = pgTable('database_size_samples', {
  sampledOn: date('sampled_on').primaryKey(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
});

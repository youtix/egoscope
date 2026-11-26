// The tables of the collection module about its press sources and their reads
// (collection.md, Lot 2); the articles they bring sit in collection-articles.ts.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { notBlank, oneOf, timestamptz } from './builders';
import { incidents } from './incidents';
import { taskRuns } from './scheduler';

import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

// Language: the languages of a source and of an article (COL-05, COL-17).
export const LANGUAGES = ['en', 'fr'] as const;
// ActivationStatus (COL-09, COL-10).
const ACTIVATION_STATUSES = ['active', 'deactivated', 'withdrawn'] as const;
// HealthStatus (COL-40).
const HEALTH_STATUSES = ['never_read', 'working', 'down', 'silent'] as const;
// SourceReadOutcome and SourceReadFailureReason (COL-41, COL-48).
const SOURCE_READ_OUTCOMES = ['success', 'failure'] as const;
const SOURCE_READ_FAILURE_REASONS = [
  'unreachable',
  'error_response',
  'requires_identification',
  'unreadable',
  'not_a_feed',
] as const;

/** The condition of a CHECK that `column` holds a web address (COL-02, COL-08). */
const webAddress = (column: PgColumn): SQL => sql`${column} ~ '^https?://'`;

/**
 * A public sports-press feed the owner registered after a trial read and the
 * attestation, never deleted: a withdrawal is a status that frees its address
 * (COL-02 to COL-11, COL-40 to COL-43, CL-COL-05, CL-COL-06, CL-COL-18, CL-COL-19).
 */
export const pressSources = pgTable(
  'press_sources',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    outletName: text('outlet_name').notNull(),
    feedUrl: text('feed_url').notNull(),
    feedUrlKey: text('feed_url_key').notNull(),
    language: text('language', { enum: LANGUAGES }).notNull(),
    outletTimeZone: text('outlet_time_zone'),
    silencePeriodDays: smallint('silence_period_days'),
    publicSportsPressAttestedAt: timestamptz('public_sports_press_attested_at').notNull(),
    activationStatus: text('activation_status', { enum: ACTIVATION_STATUSES })
      .notNull()
      .default('active'),
    withdrawnAt: timestamptz('withdrawn_at'),
    healthStatus: text('health_status', { enum: HEALTH_STATUSES }).notNull().default('never_read'),
    healthStatusChangedAt: timestamptz('health_status_changed_at').notNull(),
    firstSuccessfulReadAt: timestamptz('first_successful_read_at'),
    lastSuccessfulReadAt: timestamptz('last_successful_read_at'),
    lastNewArticleAt: timestamptz('last_new_article_at'),
    consecutiveFailedRuns: smallint('consecutive_failed_runs').notNull().default(0),
    failureStreakStartedAt: timestamptz('failure_streak_started_at'),
    proposedFeedUrl: text('proposed_feed_url'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check('press_sources_outlet_name_check', notBlank(table.outletName)),
    check('press_sources_feed_url_check', webAddress(table.feedUrl)),
    check('press_sources_language_check', oneOf(table.language, LANGUAGES)),
    check(
      'press_sources_silence_period_days_check',
      sql`${table.silencePeriodDays} BETWEEN 1 AND 30`,
    ),
    check(
      'press_sources_activation_status_check',
      oneOf(table.activationStatus, ACTIVATION_STATUSES),
    ),
    check(
      'press_sources_withdrawn_check',
      sql`(${table.activationStatus} = 'withdrawn') = (${table.withdrawnAt} IS NOT NULL)`,
    ),
    check('press_sources_health_status_check', oneOf(table.healthStatus, HEALTH_STATUSES)),
    check(
      'press_sources_reads_check',
      sql`${table.lastSuccessfulReadAt} >= ${table.firstSuccessfulReadAt}`,
    ),
    check('press_sources_consecutive_failed_runs_check', sql`${table.consecutiveFailedRuns} >= 0`),
    check(
      'press_sources_failure_streak_check',
      sql`(${table.consecutiveFailedRuns} = 0) = (${table.failureStreakStartedAt} IS NULL)`,
    ),
    check('press_sources_proposed_feed_url_check', webAddress(table.proposedFeedUrl)),
    uniqueIndex('press_sources_feed_url_key_uq')
      .on(table.feedUrlKey)
      .where(sql`${table.activationStatus} <> 'withdrawn'`),
  ],
);

/**
 * A period during which the owner had a source deactivated, never caught up (COL-09,
 * CL-COL-04).
 */
export const pressSourceDeactivations = pgTable(
  'press_source_deactivations',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    pressSourceId: integer('press_source_id')
      .notNull()
      .references(() => pressSources.id, { onDelete: 'restrict' }),
    deactivatedAt: timestamptz('deactivated_at').notNull(),
    reactivatedAt: timestamptz('reactivated_at'),
  },
  (table) => [
    check(
      'press_source_deactivations_reactivated_check',
      sql`${table.reactivatedAt} > ${table.deactivatedAt}`,
    ),
    uniqueIndex('press_source_deactivations_open_uq')
      .on(table.pressSourceId)
      .where(sql`${table.reactivatedAt} IS NULL`),
    index('press_source_deactivations_source_idx').on(table.pressSourceId, table.reactivatedAt),
  ],
);

/**
 * The numbers of a source on one day of first collection, in the owner's zone,
 * that keep its indicators right after the purge (COL-11, DET-06, CL-COL-21).
 */
export const pressSourceDailyCounts = pgTable(
  'press_source_daily_counts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    pressSourceId: integer('press_source_id')
      .notNull()
      .references(() => pressSources.id, { onDelete: 'restrict' }),
    collectedOn: date('collected_on').notNull(),
    newArticles: integer('new_articles').notNull().default(0),
    prefilterKept: integer('prefilter_kept').notNull().default(0),
    exactlyDated: integer('exactly_dated').notNull().default(0),
  },
  (table) => [
    check('press_source_daily_counts_new_articles_check', sql`${table.newArticles} >= 0`),
    check(
      'press_source_daily_counts_prefilter_kept_check',
      sql`${table.prefilterKept} BETWEEN 0 AND ${table.newArticles}`,
    ),
    check(
      'press_source_daily_counts_exactly_dated_check',
      sql`${table.exactlyDated} BETWEEN 0 AND ${table.newArticles}`,
    ),
    uniqueIndex('press_source_daily_counts_uq').on(table.pressSourceId, table.collectedOn),
  ],
);

/**
 * The read of one source in one collection run, with its result, its reason and
 * its counters: the per-source part of the run's journal entry (COL-13, COL-41,
 * COL-45, COL-48, CL-COL-04, CL-COL-09, CL-COL-19).
 */
export const collectionSourceReads = pgTable(
  'collection_source_reads',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    taskRunId: integer('task_run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    pressSourceId: integer('press_source_id')
      .notNull()
      .references(() => pressSources.id, { onDelete: 'restrict' }),
    readAt: timestamptz('read_at').notNull(),
    feedUrlRead: text('feed_url_read').notNull(),
    outcome: text('outcome', { enum: SOURCE_READ_OUTCOMES }).notNull(),
    failureReason: text('failure_reason', { enum: SOURCE_READ_FAILURE_REASONS }),
    readAttempts: smallint('read_attempts').notNull(),
    itemsRead: integer('items_read').notNull().default(0),
    newArticles: integer('new_articles').notNull().default(0),
    duplicates: integer('duplicates').notNull().default(0),
    tooOld: integer('too_old').notNull().default(0),
    incomplete: integer('incomplete').notNull().default(0),
    unsupportedLanguage: integer('unsupported_language').notNull().default(0),
    dateAnomalies: integer('date_anomalies').notNull().default(0),
    catchUpReferenceAt: timestamptz('catch_up_reference_at'),
    permanentRedirectUrl: text('permanent_redirect_url'),
    uncollectedPeriodStartAt: timestamptz('uncollected_period_start_at'),
    uncollectedPeriodEndAt: timestamptz('uncollected_period_end_at'),
    interruptionStartedAt: timestamptz('interruption_started_at'),
  },
  (table) => [
    check('collection_source_reads_outcome_check', oneOf(table.outcome, SOURCE_READ_OUTCOMES)),
    check(
      'collection_source_reads_failure_reason_check',
      oneOf(table.failureReason, SOURCE_READ_FAILURE_REASONS),
    ),
    check(
      'collection_source_reads_failure_check',
      sql`(${table.outcome} = 'failure') = (${table.failureReason} IS NOT NULL)`,
    ),
    check(
      'collection_source_reads_read_attempts_check',
      sql`${table.readAttempts} BETWEEN 1 AND 5`,
    ),
    check(
      'collection_source_reads_counters_check',
      sql`${table.itemsRead} >= 0 AND ${table.newArticles} >= 0 AND ${table.duplicates} >= 0 AND ${table.tooOld} >= 0 AND ${table.incomplete} >= 0 AND ${table.unsupportedLanguage} >= 0 AND ${table.dateAnomalies} >= 0`,
    ),
    check(
      'collection_source_reads_uncollected_period_check',
      sql`(${table.uncollectedPeriodStartAt} IS NULL) = (${table.uncollectedPeriodEndAt} IS NULL)`,
    ),
    uniqueIndex('collection_source_reads_uq').on(table.taskRunId, table.pressSourceId),
    index('collection_source_reads_source_idx').on(table.pressSourceId, table.readAt),
  ],
);

/**
 * A period in which a source may have published items the app never saw, kept
 * without limit since it shows where events may be missing (COL-46, CL-COL-13, H-01).
 */
export const collectionGaps = pgTable(
  'collection_gaps',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    pressSourceId: integer('press_source_id')
      .notNull()
      .references(() => pressSources.id, { onDelete: 'restrict' }),
    gapStartAt: timestamptz('gap_start_at').notNull(),
    gapEndAt: timestamptz('gap_end_at').notNull(),
    detectedAt: timestamptz('detected_at').notNull(),
    taskRunId: integer('task_run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
  },
  (table) => [
    check('collection_gaps_period_check', sql`${table.gapEndAt} > ${table.gapStartAt}`),
    index('collection_gaps_source_idx').on(table.pressSourceId, table.detectedAt),
    index('collection_gaps_run_idx').on(table.taskRunId),
  ],
);

/**
 * Which source a source-level incident or warning concerns, so that it closes on
 * that source's recovery and names it (COL-41 to COL-43, COL-46, CL-TEL-08).
 */
export const pressSourceIncidents = pgTable(
  'press_source_incidents',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    incidentId: integer('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    pressSourceId: integer('press_source_id')
      .notNull()
      .references(() => pressSources.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('press_source_incidents_incident_uq').on(table.incidentId),
    index('press_source_incidents_source_idx').on(table.pressSourceId),
  ],
);

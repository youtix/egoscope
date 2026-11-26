// The tables of the collection module about the articles its reads store
// (collection.md, Lot 2): the articles, where each was seen, and what a purged one
// leaves behind.
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { bytea, notBlank, oneOf, subsetOf, timestamptz } from './builders';
import { LANGUAGES, pressSources } from './collection';
import { taskRuns } from './scheduler';
import { DATE_PRECISIONS } from './taxonomy-sheets';

// ArticleProcessingStatus (COL-35, CL-DET-01).
const ARTICLE_PROCESSING_STATUSES = [
  'to_analyze',
  'awaiting_classification',
  'not_relevant',
  'attached',
  'linked_to_proposal',
] as const;
// NotRelevantReason: every reason of an article's parts and facts (CL-DET-01, CL-DET-12,
// CL-DET-27), of which detection's parts and facts each take theirs.
export const NOT_RELEVANT_REASONS = [
  'no_followed_player',
  'no_fact',
  'below_threshold',
  'below_coverage_threshold',
  'old_fact',
  'already_reported_by_backtest',
  'type_rejected_or_withdrawn',
  'proposal_rejected',
  'detached_by_user',
] as const;

/**
 * A stored feed item reduced to the COL-25 minimum and dated cautiously, its
 * processing status the cache of detection's derivation; an attachment blocks its
 * deletion, and its sightings, parts, results and facts go with it (COL-17 to
 * COL-38, DSN-09, DSN-34, CL-COL-02, CL-COL-08, CL-COL-21, CL-DET-01).
 */
export const articles = pgTable(
  'articles',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    title: text('title').notNull(),
    titleKey: text('title_key').notNull(),
    outletName: text('outlet_name').notNull(),
    link: text('link').notNull(),
    retainedPublishedAt: timestamptz('retained_published_at').notNull(),
    retainedPublishedAtPrecision: text('retained_published_at_precision', {
      enum: DATE_PRECISIONS,
    }).notNull(),
    firstCollectedAt: timestamptz('first_collected_at').notNull(),
    language: text('language', { enum: LANGUAGES }).notNull(),
    excerpt: text('excerpt'),
    processingStatus: text('processing_status', { enum: ARTICLE_PROCESSING_STATUSES })
      .notNull()
      .default('to_analyze'),
    notRelevantReasons: text('not_relevant_reasons', { enum: NOT_RELEVANT_REASONS })
      .array()
      .notNull()
      .default([]),
    retentionClockStartedAt: timestamptz('retention_clock_started_at'),
    firstPressSourceId: integer('first_press_source_id')
      .notNull()
      .references(() => pressSources.id, { onDelete: 'restrict' }),
    firstTaskRunId: integer('first_task_run_id').references(() => taskRuns.id, {
      onDelete: 'set null',
    }),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check('articles_title_check', notBlank(table.title)),
    check(
      'articles_retained_published_at_check',
      sql`${table.retainedPublishedAt} <= ${table.firstCollectedAt}`,
    ),
    check(
      'articles_retained_published_at_precision_check',
      oneOf(table.retainedPublishedAtPrecision, DATE_PRECISIONS),
    ),
    check('articles_language_check', oneOf(table.language, LANGUAGES)),
    check('articles_excerpt_check', sql`char_length(${table.excerpt}) BETWEEN 1 AND 1000`),
    check(
      'articles_processing_status_check',
      oneOf(table.processingStatus, ARTICLE_PROCESSING_STATUSES),
    ),
    check(
      'articles_not_relevant_reasons_check',
      subsetOf(table.notRelevantReasons, NOT_RELEVANT_REASONS),
    ),
    check(
      'articles_not_relevant_check',
      sql`${table.processingStatus} <> 'not_relevant' OR cardinality(${table.notRelevantReasons}) > 0`,
    ),
    check(
      'articles_retention_clock_check',
      sql`(${table.processingStatus} = 'not_relevant') = (${table.retentionClockStartedAt} IS NOT NULL)`,
    ),
    uniqueIndex('articles_link_uq').on(table.link),
    index('articles_title_dedup_idx').on(
      table.outletName,
      table.titleKey,
      table.retainedPublishedAt,
    ),
    index('articles_to_analyze_idx')
      .on(table.firstCollectedAt)
      .where(sql`${table.processingStatus} = 'to_analyze'`),
    index('articles_not_relevant_idx')
      .on(table.retentionClockStartedAt)
      .where(sql`${table.processingStatus} = 'not_relevant'`),
    index('articles_reasons_gin').using('gin', table.notRelevantReasons),
    index('articles_excerpt_idx')
      .on(table.firstCollectedAt)
      .where(sql`${table.excerpt} IS NOT NULL AND ${table.processingStatus} = 'attached'`),
    index('articles_source_collected_idx').on(table.firstPressSourceId, table.firstCollectedAt),
    index('articles_run_idx').on(table.firstTaskRunId),
    index('articles_retained_idx').on(table.retainedPublishedAt),
  ],
);

/**
 * A source in which an article was seen, with the feed's item identifier when the
 * item carries one (COL-30, COL-31, CL-COL-01).
 */
export const articleSightings = pgTable(
  'article_sightings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    pressSourceId: integer('press_source_id')
      .notNull()
      .references(() => pressSources.id, { onDelete: 'restrict' }),
    feedItemId: text('feed_item_id'),
    firstSeenAt: timestamptz('first_seen_at').notNull(),
  },
  (table) => [
    check('article_sightings_feed_item_id_check', sql`${table.feedItemId} <> ''`),
    uniqueIndex('article_sightings_uq').on(table.articleId, table.pressSourceId),
    uniqueIndex('article_sightings_item_uq')
      .on(table.pressSourceId, table.feedItemId)
      .where(sql`${table.feedItemId} IS NOT NULL`),
  ],
);

/**
 * What remains of a purged article, the digest of its cleaned link, so that a feed
 * still offering it does not bring it back; never written for an erased article
 * (COL-34, DSN-34, CL-COL-16).
 */
export const dedupTraces = pgTable(
  'dedup_traces',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    linkSha256: bytea('link_sha256').notNull(),
    firstCollectedAt: timestamptz('first_collected_at').notNull(),
    articleDeletedAt: timestamptz('article_deleted_at').notNull(),
  },
  (table) => [
    check('dedup_traces_link_sha256_check', sql`octet_length(${table.linkSha256}) = 32`),
    uniqueIndex('dedup_traces_link_uq').on(table.linkSha256),
    index('dedup_traces_deleted_idx').on(table.articleDeletedAt),
  ],
);

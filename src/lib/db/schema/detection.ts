// The tables of the detection module that hold an article's parts and their
// classification results (detection.md, Lot 2); the facts of a result and the
// attachments they make sit in detection-facts.ts.
import { sql } from 'drizzle-orm';
import {
  check,
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
import { articles } from './collection-articles';
import { CLASSIFICATION_ORIGINS } from './events';
import { followedPlayers } from './players';

import type { NOT_RELEVANT_REASONS } from './collection-articles';

type NotRelevantReason = (typeof NOT_RELEVANT_REASONS)[number];

// PartRecognition (DET-49, DET-54, CL-DET-14).
const PART_RECOGNITIONS = ['prefilter', 'owner'] as const;
// ArticlePartStatus (CL-DET-01, CL-DET-23).
const ARTICLE_PART_STATUSES = ['pending', 'classified', 'closed'] as const;
// QueueEntryKind (DET-09, CL-DET-13).
const QUEUE_ENTRY_KINDS = [
  'first_classification',
  'automatic_reclassification',
  'owner_request',
] as const;
// The reasons of a part (CL-DET-01, CL-DET-23).
const PART_NOT_RELEVANT_REASONS = [
  'no_fact',
  'no_followed_player',
] as const satisfies readonly NotRelevantReason[];
// UserClassificationAction (DET-13, DET-47, DET-49, CL-DET-12).
const USER_CLASSIFICATION_ACTIONS = [
  'manual_classification',
  'rescue',
  'own_event',
  'added_player',
] as const;

/**
 * One recognized player of one article, the unit that the queue holds and that
 * classification answers, with its queue fields while it is pending (DET-06,
 * DET-09, DET-22, DET-57, CL-DET-01, CL-DET-03, CL-DET-04, CL-DET-13, CL-DET-14).
 */
export const articleParts = pgTable(
  'article_parts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'restrict' }),
    recognizedBy: text('recognized_by', { enum: PART_RECOGNITIONS }).notNull(),
    recognizedAt: timestamptz('recognized_at').notNull(),
    status: text('status', { enum: ARTICLE_PART_STATUSES }).notNull().default('pending'),
    queueEntryKind: text('queue_entry_kind', { enum: QUEUE_ENTRY_KINDS }),
    queuedAt: timestamptz('queued_at'),
    cycleAttempts: smallint('cycle_attempts').notNull().default(0),
    classificationFailedAt: timestamptz('classification_failed_at'),
    notRelevantReason: text('not_relevant_reason', { enum: PART_NOT_RELEVANT_REASONS }),
  },
  (table) => [
    check('article_parts_recognized_by_check', oneOf(table.recognizedBy, PART_RECOGNITIONS)),
    check('article_parts_status_check', oneOf(table.status, ARTICLE_PART_STATUSES)),
    check('article_parts_queue_entry_kind_check', oneOf(table.queueEntryKind, QUEUE_ENTRY_KINDS)),
    check(
      'article_parts_queue_entry_check',
      sql`(${table.status} = 'pending') = (${table.queueEntryKind} IS NOT NULL)`,
    ),
    check(
      'article_parts_queued_check',
      sql`(${table.status} = 'pending') = (${table.queuedAt} IS NOT NULL)`,
    ),
    check('article_parts_cycle_attempts_check', sql`${table.cycleAttempts} BETWEEN 0 AND 5`),
    check(
      'article_parts_failed_check',
      sql`${table.classificationFailedAt} IS NULL OR ${table.status} = 'pending'`,
    ),
    check(
      'article_parts_not_relevant_reason_check',
      oneOf(table.notRelevantReason, PART_NOT_RELEVANT_REASONS),
    ),
    // Null-safe, so that a closed part without a reason is refused too.
    check(
      'article_parts_closed_check',
      sql`${table.status} <> 'closed' OR ${table.notRelevantReason} IS NOT DISTINCT FROM 'no_followed_player'`,
    ),
    check(
      'article_parts_pending_check',
      sql`${table.status} <> 'pending' OR ${table.notRelevantReason} IS NULL`,
    ),
    uniqueIndex('article_parts_uq').on(table.articleId, table.playerId),
    index('article_parts_eligible_idx')
      .on(table.queuedAt)
      .where(sql`${table.status} = 'pending' AND ${table.classificationFailedAt} IS NULL`),
    index('article_parts_failed_idx')
      .on(table.articleId)
      .where(sql`${table.classificationFailedAt} IS NOT NULL`),
    index('article_parts_player_idx').on(table.playerId, table.status),
  ],
);

/**
 * One usable answer for one part, the model's with its provenance or the owner's
 * with its action, and the validated types it was given (DET-13, DET-22, DET-23,
 * DET-47, DET-49, DET-53, CL-DET-07).
 */
export const classificationResults = pgTable(
  'classification_results',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    articlePartId: integer('article_part_id')
      .notNull()
      .references(() => articleParts.id, { onDelete: 'cascade' }),
    origin: text('origin', { enum: CLASSIFICATION_ORIGINS }).notNull(),
    userAction: text('user_action', { enum: USER_CLASSIFICATION_ACTIONS }),
    classifiedAt: timestamptz('classified_at').notNull(),
    instructionsVersion: text('instructions_version'),
    modelId: text('model_id'),
    attemptNumber: smallint('attempt_number'),
    validatedTypes: jsonb('validated_types').notNull(),
    playerCorrectedAt: timestamptz('player_corrected_at'),
  },
  (table) => [
    check('classification_results_origin_check', oneOf(table.origin, CLASSIFICATION_ORIGINS)),
    check(
      'classification_results_user_action_check',
      oneOf(table.userAction, USER_CLASSIFICATION_ACTIONS),
    ),
    check(
      'classification_results_user_check',
      sql`(${table.origin} = 'user') = (${table.userAction} IS NOT NULL)`,
    ),
    check(
      'classification_results_instructions_check',
      sql`(${table.origin} = 'model') = (${table.instructionsVersion} IS NOT NULL)`,
    ),
    check(
      'classification_results_model_check',
      sql`(${table.origin} = 'model') = (${table.modelId} IS NOT NULL)`,
    ),
    check(
      'classification_results_attempt_number_check',
      sql`${table.attemptNumber} BETWEEN 1 AND 5`,
    ),
    check(
      'classification_results_attempt_check',
      sql`(${table.origin} = 'model') = (${table.attemptNumber} IS NOT NULL)`,
    ),
    index('classification_results_part_idx').on(table.articlePartId, table.classifiedAt),
  ],
);

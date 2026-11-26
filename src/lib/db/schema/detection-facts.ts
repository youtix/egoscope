// The tables of the detection module that hold the facts of a classification
// result and the attachments they make (detection.md, Lot 2).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { articles } from './collection-articles';
import { classificationResults } from './detection';
import { events, GAME_STAKES, INJURY_RETURNS } from './events';
import { eventTypes } from './taxonomy';

import type { NOT_RELEVANT_REASONS } from './collection-articles';
import type { AnyPgColumn, CheckBuilder } from 'drizzle-orm/pg-core';

// FactKind, FactNovelty and FactOutcome (DET-16, DET-20, DET-28, CL-DET-01, CL-DET-02).
const FACT_KINDS = ['validated_type', 'known_entry', 'new_type'] as const;
const FACT_NOVELTIES = ['new_fact', 'old_fact', 'known_event'] as const;
const FACT_OUTCOMES = ['attached', 'linked_to_proposal', 'not_relevant', 'superseded'] as const;
// The reasons of a fact (DET-20, DET-24, DET-34, DET-36, DET-58, CL-DET-12, CL-DET-27).
const FACT_NOT_RELEVANT_REASONS = [
  'below_threshold',
  'below_coverage_threshold',
  'old_fact',
  'already_reported_by_backtest',
  'type_rejected_or_withdrawn',
  'proposal_rejected',
  'detached_by_user',
] as const satisfies readonly (typeof NOT_RELEVANT_REASONS)[number][];

// The columns of classification_facts, which its row checks read.
const factColumns = {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  classificationResultId: integer('classification_result_id').notNull(),
  kind: text('kind', { enum: FACT_KINDS }).notNull(),
  eventTypeId: text('event_type_id')
    .notNull()
    .references(() => eventTypes.id, { onDelete: 'restrict' }),
  detectionConfidence: smallint('detection_confidence'),
  description: text('description'),
  novelty: text('novelty', { enum: FACT_NOVELTIES }),
  designatedEventId: integer('designated_event_id').references(() => events.id, {
    onDelete: 'set null',
  }),
  timingHintOn: date('timing_hint_on'),
  injuryReturn: text('injury_return', { enum: INJURY_RETURNS }),
  gameStakes: text('game_stakes', { enum: GAME_STAKES }),
  justification: text('justification'),
  suggestedTypeName: text('suggested_type_name'),
  suggestedTypeDefinition: text('suggested_type_definition'),
  outcome: text('outcome', { enum: FACT_OUTCOMES }).notNull(),
  notRelevantReason: text('not_relevant_reason', { enum: FACT_NOT_RELEVANT_REASONS }),
  matchedHistoricalEventId: integer('matched_historical_event_id').references(() => events.id, {
    onDelete: 'set null',
  }),
  supersededIntoEventId: integer('superseded_into_event_id').references(() => events.id, {
    onDelete: 'set null',
  }),
};
type FactColumns = Readonly<Record<keyof typeof factColumns, AnyPgColumn>>;

/** The checks that hold each column of a fact to its stored set or its range (DET-16, DET-24). */
function factValueChecks(table: FactColumns): CheckBuilder[] {
  return [
    check('classification_facts_kind_check', oneOf(table.kind, FACT_KINDS)),
    check(
      'classification_facts_detection_confidence_check',
      sql`${table.detectionConfidence} BETWEEN 0 AND 100`,
    ),
    check('classification_facts_novelty_check', oneOf(table.novelty, FACT_NOVELTIES)),
    check('classification_facts_injury_return_check', oneOf(table.injuryReturn, INJURY_RETURNS)),
    check('classification_facts_game_stakes_check', oneOf(table.gameStakes, GAME_STAKES)),
    check('classification_facts_outcome_check', oneOf(table.outcome, FACT_OUTCOMES)),
    check(
      'classification_facts_not_relevant_reason_check',
      oneOf(table.notRelevantReason, FACT_NOT_RELEVANT_REASONS),
    ),
  ];
}

/**
 * The checks that match a fact's columns to its kind and its outcome; those on a
 * nullable column are null-safe, so that a missing value does not let a row
 * through (DET-28, DET-58, CL-DET-02, CL-DET-03).
 */
function factRuleChecks(table: FactColumns): CheckBuilder[] {
  return [
    check(
      'classification_facts_designated_check',
      sql`${table.designatedEventId} IS NULL OR ${table.novelty} IS NOT DISTINCT FROM 'known_event'`,
    ),
    check(
      'classification_facts_not_relevant_check',
      sql`(${table.outcome} = 'not_relevant') = (${table.notRelevantReason} IS NOT NULL)`,
    ),
    check(
      'classification_facts_matched_check',
      sql`${table.matchedHistoricalEventId} IS NULL OR ${table.notRelevantReason} IS NOT DISTINCT FROM 'already_reported_by_backtest'`,
    ),
    check(
      'classification_facts_superseded_check',
      sql`${table.supersededIntoEventId} IS NULL OR ${table.outcome} = 'superseded'`,
    ),
    check(
      'classification_facts_validated_type_check',
      sql`${table.kind} = 'validated_type' OR num_nonnulls(${table.detectionConfidence}, ${table.description}, ${table.novelty}, ${table.designatedEventId}, ${table.timingHintOn}, ${table.injuryReturn}, ${table.gameStakes}) = 0`,
    ),
    check(
      'classification_facts_new_type_check',
      sql`${table.kind} = 'new_type' OR num_nonnulls(${table.suggestedTypeName}, ${table.suggestedTypeDefinition}) = 0`,
    ),
    check(
      'classification_facts_attached_check',
      sql`${table.outcome} <> 'attached' OR ${table.kind} = 'validated_type'`,
    ),
    check(
      'classification_facts_linked_check',
      sql`${table.outcome} <> 'linked_to_proposal' OR ${table.kind} IN ('known_entry', 'new_type')`,
    ),
  ];
}

/**
 * One fact a result reports for its player, with its single outcome and the
 * columns of its kind; its texts are kept only while it is not relevant (DET-15
 * to DET-36, DET-47, DET-49, DET-53, DET-58, CL-DET-01 to CL-DET-03, CL-DET-11,
 * CL-DET-12, CL-DET-18, CL-DET-27).
 */
export const classificationFacts = pgTable('classification_facts', factColumns, (table) => [
  foreignKey({
    name: 'classification_facts_classification_result_id_fk',
    columns: [table.classificationResultId],
    foreignColumns: [classificationResults.id],
  }).onDelete('cascade'),
  ...factValueChecks(table),
  ...factRuleChecks(table),
  index('classification_facts_result_idx').on(table.classificationResultId),
  index('classification_facts_designated_idx')
    .on(table.designatedEventId)
    .where(sql`${table.designatedEventId} IS NOT NULL`),
  index('classification_facts_matched_idx')
    .on(table.matchedHistoricalEventId)
    .where(sql`${table.matchedHistoricalEventId} IS NOT NULL`),
  index('classification_facts_superseded_idx')
    .on(table.supersededIntoEventId)
    .where(sql`${table.supersededIntoEventId} IS NOT NULL`),
  index('classification_facts_linked_idx')
    .on(table.eventTypeId)
    .where(sql`${table.outcome} = 'linked_to_proposal'`),
  index('classification_facts_coverage_idx')
    .on(table.eventTypeId)
    .where(sql`${table.notRelevantReason} = 'below_coverage_threshold'`),
]);

/**
 * An article that sources a detected event, with the fact that attached it and
 * whether it gives the event's reference date; it blocks the deletion of its
 * article and of its fact (DET-27, DET-30, DET-31, DET-53, COL-37, CL-DET-27).
 */
export const articleAttachments = pgTable(
  'article_attachments',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'restrict' }),
    playerEventId: integer('player_event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    classificationFactId: integer('classification_fact_id').notNull(),
    attachedAt: timestamptz('attached_at').notNull(),
    isReference: boolean('is_reference').notNull().default(false),
  },
  (table) => [
    foreignKey({
      name: 'article_attachments_classification_fact_id_fk',
      columns: [table.classificationFactId],
      foreignColumns: [classificationFacts.id],
    }).onDelete('restrict'),
    uniqueIndex('article_attachments_uq').on(table.articleId, table.playerEventId),
    uniqueIndex('article_attachments_fact_uq').on(table.classificationFactId),
    uniqueIndex('article_attachments_reference_uq')
      .on(table.playerEventId)
      .where(sql`${table.isReference}`),
    index('article_attachments_event_idx').on(table.playerEventId),
  ],
);

// The tables of the imports module that name the events of a saved import: the outcome
// of each result event and the owner's answers on possible duplicates
// (backtest-and-import.md sections 1.6 and 1.7). The imports table itself sits in
// backtests.ts, beside the requests it references both ways.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { imports } from './backtests';
import { oneOf } from './builders';
import { events } from './events';

// ImportOutcome without `not_recorded_sensitive_data`, which a declined event never
// leaves in a row (IMP-19, IMP-37).
const IMPORT_OUTCOMES = [
  'added',
  'added_with_warning',
  'duplicate_not_added',
  'ignored',
  'refused',
] as const;
// ImportIgnoreReason (IMP-11, IMP-12, CL-IMP-29).
const IGNORE_REASONS = [
  'type_not_validated',
  'type_not_requested',
  'outside_requested_period',
  'before_first_nba_game',
  'calendar_derived_type',
  'split_type_ignored',
] as const;
// ImportRefusalReason (IMP-11 to IMP-14).
const REFUSAL_REASONS = [
  'type_missing',
  'type_unknown',
  'public_date_missing',
  'public_date_malformed',
  'public_date_nonexistent',
  'description_missing',
  'description_too_long',
  'description_quotation_mark',
  'no_valid_source',
  'source_before_public_date',
] as const;
// The reasons of an event set aside: ignored, then refused.
const SET_ASIDE_REASONS = [...IGNORE_REASONS, ...REFUSAL_REASONS] as const;
// PossibleDuplicateAnswer (IMP-25, IMP-26).
const DUPLICATE_ANSWERS = ['same_fact', 'distinct_facts', 'keep_as_distinct'] as const;

/**
 * The outcome of one event of the result: an event set aside keeps its rank, its type
 * and its date as read and its reason, nothing else, while an event added or a
 * duplicate names the event it became or matched and keeps no rank, so that a
 * withdrawn or declined event leaves no gap in a numbered list (IMP-19, IMP-20, IMP-31,
 * IMP-37, CL-IMP-02).
 */
export const importEventOutcomes = pgTable(
  'import_event_outcomes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    importId: integer('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    position: integer('position'),
    outcome: text('outcome', { enum: IMPORT_OUTCOMES }).notNull(),
    playerEventId: integer('player_event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    eventTypeAsRead: text('event_type_as_read'),
    dateAsRead: text('date_as_read'),
    reason: text('reason', { enum: SET_ASIDE_REASONS }),
  },
  (table) => [
    check('import_event_outcomes_position_check', sql`${table.position} >= 1`),
    check('import_event_outcomes_outcome_check', oneOf(table.outcome, IMPORT_OUTCOMES)),
    check(
      'import_event_outcomes_ignore_reason_check',
      sql`${table.outcome} <> 'ignored' OR ${oneOf(table.reason, IGNORE_REASONS)}`,
    ),
    check(
      'import_event_outcomes_refusal_reason_check',
      sql`${table.outcome} <> 'refused' OR ${oneOf(table.reason, REFUSAL_REASONS)}`,
    ),
    check(
      'import_event_outcomes_set_aside_check',
      sql`(${table.outcome} IN ('ignored', 'refused')) = (${table.reason} IS NOT NULL) AND (${table.outcome} IN ('ignored', 'refused')) = (${table.position} IS NOT NULL) AND (${table.outcome} NOT IN ('ignored', 'refused') OR ${table.playerEventId} IS NULL)`,
    ),
    check(
      'import_event_outcomes_recorded_check',
      sql`${table.outcome} NOT IN ('added', 'added_with_warning', 'duplicate_not_added') OR (${table.eventTypeAsRead}, ${table.dateAsRead}, ${table.reason}) IS NULL`,
    ),
    uniqueIndex('import_event_outcomes_position_key')
      .on(table.importId, table.position)
      .where(sql`${table.position} IS NOT NULL`),
    index('import_event_outcomes_event_idx').on(table.playerEventId),
  ],
);

/**
 * For each possible duplicate the existing event concerned and the owner's answer,
 * the result event named by the event recorded from it, never by its rank, so that a
 * withdrawal finds the row whichever side its event is on (IMP-25, IMP-26, IMP-37).
 */
export const importPossibleDuplicates = pgTable(
  'import_possible_duplicates',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    importId: integer('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    resultPlayerEventId: integer('result_player_event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    existingPlayerEventId: integer('existing_player_event_id'),
    answer: text('answer', { enum: DUPLICATE_ANSWERS }).notNull(),
  },
  (table) => [
    check('import_possible_duplicates_answer_check', oneOf(table.answer, DUPLICATE_ANSWERS)),
    foreignKey({
      name: 'import_possible_duplicates_existing_player_event_id_fk',
      columns: [table.existingPlayerEventId],
      foreignColumns: [events.id],
    }).onDelete('set null'),
    index('import_possible_duplicates_event_idx').on(table.existingPlayerEventId),
    index('import_possible_duplicates_result_idx').on(table.resultPlayerEventId),
  ],
);

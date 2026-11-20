import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { incidents } from './incidents';

import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

// OutboxFactKind: the facts Telegram may announce (TEL-09 to TEL-15); the export
// reminder has no fact of its own, being the incident export_reminder.
const OUTBOX_FACT_KINDS = [
  'backtest_request_to_do',
  'backtest_request_deadline_changed',
  'alert_sheet_produced',
  'alert_sheet_updated',
  'tracked_result_ready',
  'type_proposal_new',
  'incident_opened',
  'incident_closed',
] as const;

type OutboxFactKind = (typeof OUTBOX_FACT_KINDS)[number];

/** The condition that `subject` is set exactly on the facts whose `kind` is one of `kinds`. */
function subjectOf(subject: PgColumn, kind: PgColumn, kinds: readonly OutboxFactKind[]): SQL {
  return sql`(${subject} IS NOT NULL) = (${oneOf(kind, kinds)})`;
}

/**
 * A fact Telegram may announce, recorded by its module in its own transaction
 * and consumed by the Lot 2 dispatch, grouped by pass; one fact per kind and
 * subject, so that a rerun of a step never yields a second message (TEL-02,
 * TEL-17, TEL-19, TRV-29). A Lot 2 subject is named by its identifier, without a
 * foreign key, so that no core table points at a Lot 2 table.
 */
export const outboxFacts = pgTable(
  'outbox_facts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind', { enum: OUTBOX_FACT_KINDS }).notNull(),
    // The deferred foreign keys to the domain tables come with those tables: ON
    // DELETE CASCADE for the request and the event, RESTRICT for the game and the type.
    backtestRequestId: integer('backtest_request_id'),
    deadlineGameId: integer('deadline_game_id'),
    playerEventId: integer('player_event_id'),
    eventTypeId: text('event_type_id'),
    incidentId: integer('incident_id').references(() => incidents.id, { onDelete: 'cascade' }),
    lot2SubjectId: integer('lot2_subject_id'),
    passId: uuid('pass_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    consumedAt: timestamptz('consumed_at'),
  },
  (table) => [
    check('outbox_facts_kind_check', oneOf(table.kind, OUTBOX_FACT_KINDS)),
    check(
      'outbox_facts_subject_check',
      sql.join(
        [
          subjectOf(table.backtestRequestId, table.kind, [
            'backtest_request_to_do',
            'backtest_request_deadline_changed',
          ]),
          subjectOf(table.deadlineGameId, table.kind, ['backtest_request_deadline_changed']),
          subjectOf(table.playerEventId, table.kind, ['backtest_request_deadline_changed']),
          subjectOf(table.eventTypeId, table.kind, ['type_proposal_new']),
          subjectOf(table.incidentId, table.kind, ['incident_opened', 'incident_closed']),
          subjectOf(table.lot2SubjectId, table.kind, [
            'alert_sheet_produced',
            'alert_sheet_updated',
            'tracked_result_ready',
          ]),
        ],
        sql` AND `,
      ),
    ),
    unique('outbox_facts_fact_key')
      .on(
        table.kind,
        table.backtestRequestId,
        table.deadlineGameId,
        table.playerEventId,
        table.eventTypeId,
        table.incidentId,
        table.lot2SubjectId,
      )
      .nullsNotDistinct(),
    index('outbox_facts_pending_idx')
      .on(table.passId, table.createdAt)
      .where(sql`${table.consumedAt} IS NULL`),
  ],
);

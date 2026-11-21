import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { outsideArchive } from './archive';
import { backtestRequests } from './backtests';
import { oneOf, timestamptz } from './builders';
import { eventTypes } from './taxonomy';

// DraftKind (IHM-42, DSN-32).
const DRAFT_KINDS = ['research_result', 'exploration_response'] as const;

/**
 * The server copy of a pasted text, the only one, so that another device can
 * resume it: at most one import draft per backtest request, and one exploration
 * draft for the general screen or per targeted proposal (IHM-42, DSN-32,
 * CL-DSN-17). Never in a backup or an export (CL-TRV-05).
 */
export const drafts = outsideArchive(
  pgTable(
    'drafts',
    {
      id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
      kind: text('kind', { enum: DRAFT_KINDS }).notNull(),
      // A draft goes with its request or its proposal.
      backtestRequestId: integer('backtest_request_id').references(() => backtestRequests.id, {
        onDelete: 'cascade',
      }),
      explorationEventTypeId: text('exploration_event_type_id').references(() => eventTypes.id, {
        onDelete: 'cascade',
      }),
      text: text('text').notNull(),
      updatedAt: timestamptz('updated_at').notNull().defaultNow(),
      originDevice: text('origin_device').notNull(),
    },
    (table) => [
      check('drafts_kind_check', oneOf(table.kind, DRAFT_KINDS)),
      check(
        'drafts_import_check',
        sql`(${table.kind} = 'research_result') = (${table.backtestRequestId} IS NOT NULL)`,
      ),
      check(
        'drafts_exploration_check',
        sql`${table.explorationEventTypeId} IS NULL OR ${table.kind} = 'exploration_response'`,
      ),
      uniqueIndex('drafts_import_key')
        .on(table.backtestRequestId)
        .where(sql`${table.kind} = 'research_result'`),
      // NULLS NOT DISTINCT, which Drizzle cannot write on a partial index: the
      // general screen's draft, which has no type, is keyed by the empty string,
      // which no type's slug is.
      uniqueIndex('drafts_exploration_key')
        .on(sql`coalesce(${table.explorationEventTypeId}, '')`)
        .where(sql`${table.kind} = 'exploration_response'`),
    ],
  ),
);

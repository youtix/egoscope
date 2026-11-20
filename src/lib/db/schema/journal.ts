import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { incidents } from './incidents';
import { taskRuns } from './scheduler';

// JournalEntryCategory (TRV-41, TEL-34, CL-TRV-25).
const JOURNAL_ENTRY_CATEGORIES = [
  'task_pass',
  'profile_recalculation',
  'service_failure',
  'incident',
  'user_action',
  'import_refused',
  'parameter_change',
  'login_refused',
  'login_lockout',
  'telegram_message',
  'trigger_refused',
] as const;
// JournalLevel (TRV-43).
const JOURNAL_LEVELS = ['info', 'warning', 'incident'] as const;
// The Lot 2 objects that an entry names by identifier, without a foreign key (lot boundary).
const LOT2_OBJECT_KINDS = [
  'press_source',
  'article',
  'alert_sheet',
  'notification_message',
] as const;

/**
 * The activity journal (TRV-41): a fixed message key and references by
 * identifier, the text built when the entry is displayed or exported, so that an
 * erased item's references disappear at once (CL-TRV-10). An entry about an event
 * names it alone, and one about a case names neither its player nor its type: the
 * display reads them through the event or the case.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    category: text('category', { enum: JOURNAL_ENTRY_CATEGORIES }).notNull(),
    level: text('level', { enum: JOURNAL_LEVELS }).notNull(),
    messageKey: text('message_key').notNull(),
    messageParams: jsonb('message_params').notNull().default({}),
    // The deferred foreign keys to the domain tables come with those tables:
    // ON DELETE SET NULL for each of these references, RESTRICT for the event type.
    playerId: uuid('player_id'),
    playerEventId: integer('player_event_id'),
    eventTypeId: text('event_type_id'),
    backtestRequestId: integer('backtest_request_id'),
    importId: integer('import_id'),
    caseId: integer('case_id'),
    incidentId: integer('incident_id').references(() => incidents.id, { onDelete: 'set null' }),
    taskRunId: integer('task_run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    lot2ObjectKind: text('lot2_object_kind', { enum: LOT2_OBJECT_KINDS }),
    lot2ObjectId: integer('lot2_object_id'),
  },
  (table) => [
    check('journal_entries_category_check', oneOf(table.category, JOURNAL_ENTRY_CATEGORIES)),
    check('journal_entries_level_check', oneOf(table.level, JOURNAL_LEVELS)),
    check('journal_entries_lot2_object_kind_check', oneOf(table.lot2ObjectKind, LOT2_OBJECT_KINDS)),
    check(
      'journal_entries_lot2_object_check',
      sql`(${table.lot2ObjectKind} IS NULL) = (${table.lot2ObjectId} IS NULL)`,
    ),
    check(
      'journal_entries_event_reference_check',
      sql`${table.playerEventId} IS NULL OR (${table.playerId}, ${table.eventTypeId}, ${table.caseId}, ${table.backtestRequestId}, ${table.importId}) IS NULL`,
    ),
    check(
      'journal_entries_case_reference_check',
      sql`${table.caseId} IS NULL OR (${table.playerId}, ${table.eventTypeId}) IS NULL`,
    ),
    index('journal_entries_occurred_idx').on(table.occurredAt),
    index('journal_entries_category_idx').on(table.category, table.occurredAt),
    index('journal_entries_incident_idx').on(table.incidentId),
    index('journal_entries_event_idx').on(table.playerEventId),
    index('journal_entries_player_idx').on(table.playerId),
  ],
);

/**
 * An entry's technical details, stored apart and hidden by default, limited to
 * the allowlist of CL-DSN-11 and deleted with their entry (TRV-44, DSN-11).
 */
export const journalTechnicalDetails = pgTable('journal_technical_details', {
  journalEntryId: integer('journal_entry_id')
    .primaryKey()
    .references(() => journalEntries.id, { onDelete: 'cascade' }),
  details: jsonb('details').notNull(),
});

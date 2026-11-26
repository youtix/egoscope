// The tables of the notifications module about its messages (notifications.md,
// Lot 2): each message with its status, the facts it notifies and the events it
// designates.
import { sql } from 'drizzle-orm';
import {
  bigint,
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
  uuid,
} from 'drizzle-orm/pg-core';

import { alertSheets } from './alerts';
import { alertSheetUpdates } from './alerts-history';
import { backtestRequests } from './backtests';
import { oneOf, timestamptz } from './builders';
import { events } from './events';
import { games } from './games';
import { incidents } from './incidents';
import { followedPlayers } from './players';
import { cases } from './sensitivity';
import { eventTypes } from './taxonomy';

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, CheckBuilder, IndexBuilder } from 'drizzle-orm/pg-core';

// NotificationKind (TEL-09 to TEL-16, TEL-36).
const NOTIFICATION_KINDS = [
  'backtest_request_to_do',
  'deadline_changed',
  'deadline_reminder',
  'alert',
  'alert_update',
  'tracked_game_result',
  'new_type_proposal',
  'incident_start',
  'incident_reminder',
  'incident_end',
  'export_reminder',
  'link_confirmation',
  'test_message',
  'pass_digest',
  'quiet_hours_digest',
  'catch_up',
  'daily_cap_reached',
  'chat_unlinked_notice',
] as const;
// The kinds that can be urgent (TEL-21, CL-TEL-18).
const URGENT_KINDS = [
  'backtest_request_to_do',
  'deadline_changed',
  'deadline_reminder',
  'alert',
  'alert_update',
] as const satisfies readonly (typeof NOTIFICATION_KINDS)[number][];
// NotificationMessageStatus, SendFailureKind and NotificationDiscardReason (TEL-22,
// TEL-23, TEL-26, TEL-33, TEL-35, TEL-37, CL-TEL-07, CL-TEL-20).
const MESSAGE_STATUSES = ['to_send', 'deferred', 'sent', 'grouped', 'discarded', 'failed'] as const;
const SEND_FAILURE_KINDS = ['temporary', 'permanent'] as const;
const DISCARD_REASONS = [
  'moot',
  'category_disabled',
  'notifications_suspended',
  'unlinked',
  'daily_cap',
] as const;

// The columns of notification_messages, which its row checks read.
const messageColumns = {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
  status: text('status', { enum: MESSAGE_STATUSES }).notNull().default('to_send'),
  isUrgent: boolean('is_urgent').notNull().default(false),
  passId: uuid('pass_id'),
  playerId: uuid('player_id').references(() => followedPlayers.id, { onDelete: 'restrict' }),
  gameId: integer('game_id').references(() => games.id, { onDelete: 'restrict' }),
  createdAt: timestamptz('created_at').notNull(),
  scheduledSendAt: timestamptz('scheduled_send_at'),
  sentAt: timestamptz('sent_at'),
  text: text('text'),
  chatId: bigint('chat_id', { mode: 'number' }),
  telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
  attemptCount: smallint('attempt_count').notNull().default(0),
  firstFailureAt: timestamptz('first_failure_at'),
  lastFailureAt: timestamptz('last_failure_at'),
  lastFailureKind: text('last_failure_kind', { enum: SEND_FAILURE_KINDS }),
  lastFailureReason: text('last_failure_reason'),
  discardReason: text('discard_reason', { enum: DISCARD_REASONS }),
  groupedIntoMessageId: integer('grouped_into_message_id'),
  capDay: date('cap_day'),
};
type MessageColumns = Readonly<Record<keyof typeof messageColumns, AnyPgColumn>>;

/** The checks of a message's kind, status and texts (TEL-21, TEL-22, TEL-33, CL-TEL-14). */
function messageValueChecks(table: MessageColumns): CheckBuilder[] {
  return [
    check('notification_messages_kind_check', oneOf(table.kind, NOTIFICATION_KINDS)),
    check('notification_messages_status_check', oneOf(table.status, MESSAGE_STATUSES)),
    check(
      'notification_messages_urgent_check',
      sql`NOT ${table.isUrgent} OR ${oneOf(table.kind, URGENT_KINDS)}`,
    ),
    check('notification_messages_text_check', sql`char_length(${table.text}) <= 4096`),
    check(
      'notification_messages_last_failure_kind_check',
      oneOf(table.lastFailureKind, SEND_FAILURE_KINDS),
    ),
    check(
      'notification_messages_last_failure_reason_check',
      sql`char_length(${table.lastFailureReason}) <= 300`,
    ),
    check(
      'notification_messages_discard_reason_check',
      oneOf(table.discardReason, DISCARD_REASONS),
    ),
    check('notification_messages_attempt_count_check', sql`${table.attemptCount} >= 0`),
    check(
      'notification_messages_cap_day_check',
      sql`(${table.kind} = 'daily_cap_reached') = (${table.capDay} IS NOT NULL)`,
    ),
  ];
}

/**
 * The checks that tie a message's delivery columns to its status: only a sent
 * message keeps a text and Telegram identifiers, and a failure is dated and typed
 * (TEL-19, TEL-35, TEL-36, CL-TEL-09, CL-TEL-12).
 */
function messageDeliveryChecks(table: MessageColumns): CheckBuilder[] {
  const sent = sql`(${table.status} = 'sent')`;
  const neverFailed = sql`(${table.attemptCount} = 0)`;
  return [
    check('notification_messages_sent_check', sql`${sent} = (${table.sentAt} IS NOT NULL)`),
    check('notification_messages_sent_text_check', sql`${sent} = (${table.text} IS NOT NULL)`),
    check('notification_messages_chat_check', sql`${sent} = (${table.chatId} IS NOT NULL)`),
    check(
      'notification_messages_telegram_message_check',
      sql`${sent} = (${table.telegramMessageId} IS NOT NULL)`,
    ),
    check(
      'notification_messages_first_failure_check',
      sql`${neverFailed} = (${table.firstFailureAt} IS NULL)`,
    ),
    check(
      'notification_messages_last_failure_check',
      sql`${neverFailed} = (${table.lastFailureAt} IS NULL)`,
    ),
    check(
      'notification_messages_failures_check',
      sql`${table.lastFailureAt} >= ${table.firstFailureAt}`,
    ),
    check(
      'notification_messages_failure_kind_check',
      sql`${neverFailed} = (${table.lastFailureKind} IS NULL)`,
    ),
    check(
      'notification_messages_discarded_check',
      sql`(${table.status} = 'discarded') = (${table.discardReason} IS NOT NULL)`,
    ),
    check(
      'notification_messages_grouped_check',
      sql`${table.groupedIntoMessageId} IS NULL OR ${table.status} = 'grouped'`,
    ),
  ];
}

/**
 * One Telegram message of the catalogue, a digest or a service message, with its
 * status; its text is composed at send time and kept only once sent (TEL-04 to
 * TEL-23, TEL-33 to TEL-38, CL-TEL-07, CL-TEL-09, CL-TEL-12, CL-TEL-14).
 */
export const notificationMessages = pgTable('notification_messages', messageColumns, (table) => [
  ...messageValueChecks(table),
  ...messageDeliveryChecks(table),
  foreignKey({
    name: 'notification_messages_grouped_into_message_id_fk',
    columns: [table.groupedIntoMessageId],
    foreignColumns: [table.id],
  }).onDelete('set null'),
  index('notification_messages_due_idx')
    .on(table.scheduledSendAt)
    .where(sql`${table.status} IN ('to_send', 'deferred')`),
  index('notification_messages_failed_idx')
    .on(table.createdAt)
    .where(sql`${table.status} = 'failed'`),
  index('notification_messages_created_idx').on(table.createdAt),
  uniqueIndex('notification_messages_pass_uq')
    .on(table.passId)
    .where(sql`${table.kind} = 'pass_digest'`),
  uniqueIndex('notification_messages_quiet_uq')
    .on(table.scheduledSendAt)
    .where(sql`${table.kind} = 'quiet_hours_digest'`),
  uniqueIndex('notification_messages_cap_uq')
    .on(table.capDay)
    .where(sql`${table.kind} = 'daily_cap_reached'`),
  uniqueIndex('notification_messages_catch_up_uq')
    .on(table.kind)
    .where(sql`${table.kind} = 'catch_up' AND ${table.status} IN ('to_send', 'deferred')`),
  index('notification_messages_player_idx')
    .on(table.playerId)
    .where(sql`${table.playerId} IS NOT NULL`),
]);

// The columns of notification_message_facts, which its indexes read.
const factColumns = {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  messageId: integer('message_id').notNull(),
  messageKind: text('message_kind', { enum: NOTIFICATION_KINDS }).notNull(),
  backtestRequestId: integer('backtest_request_id'),
  deadlineGameId: integer('deadline_game_id').references(() => games.id, {
    onDelete: 'restrict',
  }),
  alertSheetId: integer('alert_sheet_id').references(() => alertSheets.id, {
    onDelete: 'restrict',
  }),
  alertSheetUpdateId: integer('alert_sheet_update_id'),
  caseId: integer('case_id').references(() => cases.id, { onDelete: 'cascade' }),
  eventTypeId: text('event_type_id').references(() => eventTypes.id, { onDelete: 'restrict' }),
  incidentId: integer('incident_id').references(() => incidents.id, { onDelete: 'cascade' }),
  reminderNumber: smallint('reminder_number'),
};
type FactColumns = Readonly<Record<keyof typeof factColumns, AnyPgColumn>>;

/**
 * The partial unique indexes that let a fact give at most one message of each kind
 * of the catalogue (TEL-17, CL-TEL-05, CL-TEL-08, CL-SUI-09).
 */
function oneMessagePerFact(table: FactColumns): IndexBuilder[] {
  const of = (kind: (typeof NOTIFICATION_KINDS)[number]): SQL => oneOf(table.messageKind, [kind]);
  return [
    uniqueIndex('notification_facts_request_uq')
      .on(table.backtestRequestId)
      .where(of('backtest_request_to_do')),
    uniqueIndex('notification_facts_deadline_changed_uq')
      .on(table.backtestRequestId, table.deadlineGameId)
      .where(of('deadline_changed')),
    uniqueIndex('notification_facts_reminder_uq')
      .on(table.backtestRequestId, table.deadlineGameId)
      .where(of('deadline_reminder')),
    uniqueIndex('notification_facts_alert_uq').on(table.alertSheetId).where(of('alert')),
    uniqueIndex('notification_facts_alert_update_uq')
      .on(table.alertSheetUpdateId)
      .where(of('alert_update')),
    uniqueIndex('notification_facts_result_uq').on(table.caseId).where(of('tracked_game_result')),
    uniqueIndex('notification_facts_proposal_uq')
      .on(table.eventTypeId)
      .where(of('new_type_proposal')),
    uniqueIndex('notification_facts_incident_start_uq')
      .on(table.incidentId)
      .where(of('incident_start')),
    uniqueIndex('notification_facts_incident_reminder_uq')
      .on(table.incidentId, table.reminderNumber)
      .where(of('incident_reminder')),
    uniqueIndex('notification_facts_incident_end_uq')
      .on(table.incidentId)
      .where(of('incident_end')),
    uniqueIndex('notification_facts_export_reminder_uq')
      .on(table.incidentId)
      .where(of('export_reminder')),
  ];
}

/**
 * The fact a message notifies, one row per fact, each naming exactly one subject;
 * its partial unique indexes make "one fact, one message" a database rule (TEL-02,
 * TEL-09 to TEL-17, TEL-34, CL-TEL-05, CL-TEL-08, CL-SUI-09).
 */
export const notificationMessageFacts = pgTable(
  'notification_message_facts',
  factColumns,
  (table) => [
    check(
      'notification_message_facts_message_kind_check',
      oneOf(table.messageKind, NOTIFICATION_KINDS),
    ),
    check(
      'notification_message_facts_reminder_check',
      sql`(${table.messageKind} = 'incident_reminder') = (${table.reminderNumber} IS NOT NULL)`,
    ),
    check(
      'notification_message_facts_subject_check',
      sql`num_nonnulls(${table.backtestRequestId}, ${table.alertSheetId}, ${table.alertSheetUpdateId}, ${table.caseId}, ${table.eventTypeId}, ${table.incidentId}) = 1`,
    ),
    check(
      'notification_message_facts_deadline_check',
      sql`${table.deadlineGameId} IS NULL OR ${table.backtestRequestId} IS NOT NULL`,
    ),
    foreignKey({
      name: 'notification_message_facts_message_id_fk',
      columns: [table.messageId],
      foreignColumns: [notificationMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notification_message_facts_backtest_request_id_fk',
      columns: [table.backtestRequestId],
      foreignColumns: [backtestRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'notification_message_facts_alert_sheet_update_id_fk',
      columns: [table.alertSheetUpdateId],
      foreignColumns: [alertSheetUpdates.id],
    }).onDelete('restrict'),
    ...oneMessagePerFact(table),
    index('notification_facts_message_idx').on(table.messageId),
    index('notification_facts_case_idx')
      .on(table.caseId)
      .where(sql`${table.caseId} IS NOT NULL`),
  ],
);

/**
 * An event a message designates, complete at every instant, so that a withdrawal
 * finds every message to delete and a text never names another (TEL-06, TEL-38).
 */
export const notificationMessageEvents = pgTable(
  'notification_message_events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    messageId: integer('message_id').notNull(),
    playerEventId: integer('player_event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
  },
  (table) => [
    foreignKey({
      name: 'notification_message_events_message_id_fk',
      columns: [table.messageId],
      foreignColumns: [notificationMessages.id],
    }).onDelete('cascade'),
    uniqueIndex('notification_message_events_uq').on(table.messageId, table.playerEventId),
    index('notification_message_events_event_idx').on(table.playerEventId),
  ],
);

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { alertSheets } from './alerts';
import { alertSheetUpdates } from './alerts-history';
import { events } from './events';
import { incidents } from './incidents';
import {
  notificationMessageEvents,
  notificationMessageFacts,
  notificationMessages,
} from './notifications-messages';
import { cases } from './sensitivity';

import type { Database } from '../types';

// The tables of notifications.md about the messages and what they notify.
const TABLES = [
  'notification_message_events',
  'notification_message_facts',
  'notification_messages',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'notification_message_events.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'notification_message_events.message_id integer NOT NULL',
  'notification_message_events.player_event_id integer NOT NULL',
  'notification_message_facts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'notification_message_facts.message_id integer NOT NULL',
  'notification_message_facts.message_kind text NOT NULL',
  'notification_message_facts.backtest_request_id integer',
  'notification_message_facts.deadline_game_id integer',
  'notification_message_facts.alert_sheet_id integer',
  'notification_message_facts.alert_sheet_update_id integer',
  'notification_message_facts.case_id integer',
  'notification_message_facts.event_type_id text',
  'notification_message_facts.incident_id integer',
  'notification_message_facts.reminder_number smallint',
  'notification_messages.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'notification_messages.kind text NOT NULL',
  "notification_messages.status text NOT NULL DEFAULT 'to_send'::text",
  'notification_messages.is_urgent boolean NOT NULL DEFAULT false',
  'notification_messages.pass_id uuid',
  'notification_messages.player_id uuid',
  'notification_messages.game_id integer',
  'notification_messages.created_at timestamp with time zone NOT NULL',
  'notification_messages.scheduled_send_at timestamp with time zone',
  'notification_messages.sent_at timestamp with time zone',
  'notification_messages.text text',
  'notification_messages.chat_id bigint',
  'notification_messages.telegram_message_id bigint',
  'notification_messages.attempt_count smallint NOT NULL DEFAULT 0',
  'notification_messages.first_failure_at timestamp with time zone',
  'notification_messages.last_failure_at timestamp with time zone',
  'notification_messages.last_failure_kind text',
  'notification_messages.last_failure_reason text',
  'notification_messages.discard_reason text',
  'notification_messages.grouped_into_message_id integer',
  'notification_messages.cap_day date',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  "CREATE UNIQUE INDEX notification_facts_alert_update_uq ON public.notification_message_facts USING btree (alert_sheet_update_id) WHERE (message_kind = 'alert_update'::text)",
  "CREATE UNIQUE INDEX notification_facts_alert_uq ON public.notification_message_facts USING btree (alert_sheet_id) WHERE (message_kind = 'alert'::text)",
  'CREATE INDEX notification_facts_case_idx ON public.notification_message_facts USING btree (case_id) WHERE (case_id IS NOT NULL)',
  "CREATE UNIQUE INDEX notification_facts_deadline_changed_uq ON public.notification_message_facts USING btree (backtest_request_id, deadline_game_id) WHERE (message_kind = 'deadline_changed'::text)",
  "CREATE UNIQUE INDEX notification_facts_export_reminder_uq ON public.notification_message_facts USING btree (incident_id) WHERE (message_kind = 'export_reminder'::text)",
  "CREATE UNIQUE INDEX notification_facts_incident_end_uq ON public.notification_message_facts USING btree (incident_id) WHERE (message_kind = 'incident_end'::text)",
  "CREATE UNIQUE INDEX notification_facts_incident_reminder_uq ON public.notification_message_facts USING btree (incident_id, reminder_number) WHERE (message_kind = 'incident_reminder'::text)",
  "CREATE UNIQUE INDEX notification_facts_incident_start_uq ON public.notification_message_facts USING btree (incident_id) WHERE (message_kind = 'incident_start'::text)",
  'CREATE INDEX notification_facts_message_idx ON public.notification_message_facts USING btree (message_id)',
  "CREATE UNIQUE INDEX notification_facts_proposal_uq ON public.notification_message_facts USING btree (event_type_id) WHERE (message_kind = 'new_type_proposal'::text)",
  "CREATE UNIQUE INDEX notification_facts_reminder_uq ON public.notification_message_facts USING btree (backtest_request_id, deadline_game_id) WHERE (message_kind = 'deadline_reminder'::text)",
  "CREATE UNIQUE INDEX notification_facts_request_uq ON public.notification_message_facts USING btree (backtest_request_id) WHERE (message_kind = 'backtest_request_to_do'::text)",
  "CREATE UNIQUE INDEX notification_facts_result_uq ON public.notification_message_facts USING btree (case_id) WHERE (message_kind = 'tracked_game_result'::text)",
  'CREATE INDEX notification_message_events_event_idx ON public.notification_message_events USING btree (player_event_id)',
  'CREATE UNIQUE INDEX notification_message_events_pkey ON public.notification_message_events USING btree (id)',
  'CREATE UNIQUE INDEX notification_message_events_uq ON public.notification_message_events USING btree (message_id, player_event_id)',
  'CREATE UNIQUE INDEX notification_message_facts_pkey ON public.notification_message_facts USING btree (id)',
  "CREATE UNIQUE INDEX notification_messages_cap_uq ON public.notification_messages USING btree (cap_day) WHERE (kind = 'daily_cap_reached'::text)",
  "CREATE UNIQUE INDEX notification_messages_catch_up_uq ON public.notification_messages USING btree (kind) WHERE ((kind = 'catch_up'::text) AND (status = ANY (ARRAY['to_send'::text, 'deferred'::text])))",
  'CREATE INDEX notification_messages_created_idx ON public.notification_messages USING btree (created_at)',
  "CREATE INDEX notification_messages_due_idx ON public.notification_messages USING btree (scheduled_send_at) WHERE (status = ANY (ARRAY['to_send'::text, 'deferred'::text]))",
  "CREATE INDEX notification_messages_failed_idx ON public.notification_messages USING btree (created_at) WHERE (status = 'failed'::text)",
  "CREATE UNIQUE INDEX notification_messages_pass_uq ON public.notification_messages USING btree (pass_id) WHERE (kind = 'pass_digest'::text)",
  'CREATE UNIQUE INDEX notification_messages_pkey ON public.notification_messages USING btree (id)',
  'CREATE INDEX notification_messages_player_idx ON public.notification_messages USING btree (player_id) WHERE (player_id IS NOT NULL)',
  "CREATE UNIQUE INDEX notification_messages_quiet_uq ON public.notification_messages USING btree (scheduled_send_at) WHERE (kind = 'quiet_hours_digest'::text)",
];

// Their references: a fact and an event go with their message, which keeps what it names.
const FOREIGN_KEYS = [
  'notification_message_events FOREIGN KEY (message_id) REFERENCES notification_messages(id) ON DELETE CASCADE',
  'notification_message_events FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE RESTRICT',
  'notification_message_facts FOREIGN KEY (alert_sheet_id) REFERENCES alert_sheets(id) ON DELETE RESTRICT',
  'notification_message_facts FOREIGN KEY (alert_sheet_update_id) REFERENCES alert_sheet_updates(id) ON DELETE RESTRICT',
  'notification_message_facts FOREIGN KEY (backtest_request_id) REFERENCES backtest_requests(id) ON DELETE RESTRICT',
  'notification_message_facts FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE',
  'notification_message_facts FOREIGN KEY (deadline_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'notification_message_facts FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'notification_message_facts FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE',
  'notification_message_facts FOREIGN KEY (message_id) REFERENCES notification_messages(id) ON DELETE CASCADE',
  'notification_messages FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'notification_messages FOREIGN KEY (grouped_into_message_id) REFERENCES notification_messages(id) ON DELETE SET NULL',
  'notification_messages FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE RESTRICT',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
const MESSAGE_ID = 1;
const CHAT_ID = 2 ** 40 + 7;
const PASS_ID = '9e3c1a52-7b4d-4f80-a6e1-3d2b8c0f5a47';
// A message waiting to be sent, then the same message once sent, failed or discarded.
const MESSAGE = { kind: 'alert', createdAt: at(10) } as const;
const SENT = {
  ...MESSAGE,
  status: 'sent',
  sentAt: at(11),
  text: 'A media storm on a followed player.',
  chatId: CHAT_ID,
  telegramMessageId: 42,
} as const;
const FAILED = {
  ...MESSAGE,
  status: 'failed',
  attemptCount: 3,
  firstFailureAt: at(11),
  lastFailureAt: at(12),
  lastFailureKind: 'permanent',
  lastFailureReason: 'Forbidden: the chat refused the message.',
} as const;
const DISCARDED = { ...MESSAGE, status: 'discarded', discardReason: 'moot' } as const;
const SHEET = { playerId: PARENTS.playerId, producedAt: at(10) } as const;
const FACT = { messageId: MESSAGE_ID, messageKind: 'alert', alertSheetId: 1 } as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the messages and what they notify', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(alertSheets).values(SHEET);
    await db
      .insert(alertSheetUpdates)
      .values({ alertSheetId: 1, occurredAt: at(11), kind: 'status_changed' });
    await db.insert(incidents).values({ kind: 'export_reminder', causeKey: 'export' });
    await db.insert(notificationMessages).values([MESSAGE, MESSAGE]);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that notifications.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[TEL-09] [TEL-16] [TEL-33] stores a message to send without its text, and every kind, status and reason of its sets', async () => {
    const kinds = [
      'backtest_request_to_do',
      'deadline_changed',
      'deadline_reminder',
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
    ] as const;
    const reasons = [
      'category_disabled',
      'notifications_suspended',
      'unlinked',
      'daily_cap',
    ] as const;
    await db.insert(notificationMessages).values([
      ...kinds.map((kind) => ({ ...MESSAGE, kind })),
      { ...MESSAGE, kind: 'daily_cap_reached', capDay: '2024-12-02' },
      { ...MESSAGE, kind: 'chat_unlinked_notice', status: 'deferred', scheduledSendAt: at(12) },
      { ...SENT, isUrgent: true, playerId: PARENTS.playerId, gameId: PARENTS.gameId },
      { ...SENT, text: 'x'.repeat(4096) },
      FAILED,
      {
        ...FAILED,
        attemptCount: 1,
        lastFailureAt: at(11),
        lastFailureKind: 'temporary',
        lastFailureReason: 'x'.repeat(300),
      },
      DISCARDED,
      ...reasons.map((discardReason) => ({ ...DISCARDED, discardReason })),
      { ...MESSAGE, status: 'grouped', groupedIntoMessageId: MESSAGE_ID },
    ]);

    const [first] = await db
      .select()
      .from(notificationMessages)
      .where(eq(notificationMessages.id, MESSAGE_ID));

    expect(first).toStrictEqual({
      ...MESSAGE,
      id: MESSAGE_ID,
      status: 'to_send',
      isUrgent: false,
      passId: null,
      playerId: null,
      gameId: null,
      scheduledSendAt: null,
      sentAt: null,
      text: null,
      chatId: null,
      telegramMessageId: null,
      attemptCount: 0,
      firstFailureAt: null,
      lastFailureAt: null,
      lastFailureKind: null,
      lastFailureReason: null,
      discardReason: null,
      groupedIntoMessageId: null,
      capDay: null,
    });
    await expect(db.$count(notificationMessages)).resolves.toBe(29);
  });

  it.each([
    ['a kind outside the list', { ...MESSAGE, kind: OUTSIDE }, 'kind'],
    ['a status outside the list', { ...MESSAGE, status: OUTSIDE }, 'status'],
    [
      'an urgent message of a kind that never is',
      { ...MESSAGE, kind: 'test_message', isUrgent: true },
      'urgent',
    ],
    ['a text of 4,097 characters', { ...SENT, text: 'x'.repeat(4097) }, 'text'],
    [
      'a failure kind outside the list',
      { ...FAILED, lastFailureKind: OUTSIDE },
      'last_failure_kind',
    ],
    [
      'a failure reason of 301 characters',
      { ...FAILED, lastFailureReason: 'x'.repeat(301) },
      'last_failure_reason',
    ],
    [
      'a discard reason outside the list',
      { ...DISCARDED, discardReason: OUTSIDE },
      'discard_reason',
    ],
    ['a negative number of attempts', { ...FAILED, attemptCount: -1 }, 'attempt_count'],
    ['a cap day on another kind', { ...MESSAGE, capDay: '2024-12-02' }, 'cap_day'],
    ['a reached cap without its day', { ...MESSAGE, kind: 'daily_cap_reached' }, 'cap_day'],
    ['a sent message without its instant', { ...SENT, sentAt: null }, 'sent'],
    ['a sending instant on a message to send', { ...MESSAGE, sentAt: at(11) }, 'sent'],
    ['a sent message without its text', { ...SENT, text: null }, 'sent_text'],
    ['a text on a message to send', { ...MESSAGE, text: 'Composed too early.' }, 'sent_text'],
    ['a sent message without its chat', { ...SENT, chatId: null }, 'chat'],
    ['a chat on a message to send', { ...MESSAGE, chatId: CHAT_ID }, 'chat'],
    [
      'a sent message without its Telegram identifier',
      { ...SENT, telegramMessageId: null },
      'telegram_message',
    ],
    [
      'a Telegram identifier on a message to send',
      { ...MESSAGE, telegramMessageId: 42 },
      'telegram_message',
    ],
    ['attempts without their first failure', { ...FAILED, firstFailureAt: null }, 'first_failure'],
    ['a first failure without an attempt', { ...MESSAGE, firstFailureAt: at(11) }, 'first_failure'],
    ['attempts without their last failure', { ...FAILED, lastFailureAt: null }, 'last_failure'],
    ['a last failure without an attempt', { ...MESSAGE, lastFailureAt: at(11) }, 'last_failure'],
    ['a last failure before the first', { ...FAILED, lastFailureAt: at(10) }, 'failures'],
    ['attempts without their failure kind', { ...FAILED, lastFailureKind: null }, 'failure_kind'],
    [
      'a failure kind without an attempt',
      { ...MESSAGE, lastFailureKind: 'temporary' },
      'failure_kind',
    ],
    ['a discarded message without its reason', { ...DISCARDED, discardReason: null }, 'discarded'],
    ['a discard reason on a message to send', { ...MESSAGE, discardReason: 'moot' }, 'discarded'],
    [
      'a grouping on a message to send',
      { ...MESSAGE, groupedIntoMessageId: MESSAGE_ID },
      'grouped',
    ],
  ] as const)(
    '[TEL-19] [TEL-21] [TEL-22] [TEL-35] [CL-TEL-09] [CL-TEL-12] refuses a message with %s',
    async (_case, message, check) => {
      const insert = db.insert(notificationMessages).values(message);

      await expect(insert).rejects.toMatchObject(
        violationOf(`notification_messages_${check}_check`),
      );
    },
  );

  it.each([
    ['digest of a pass', { ...MESSAGE, kind: 'pass_digest', passId: PASS_ID }, 'pass'],
    [
      'digest of quiet hours',
      { ...MESSAGE, kind: 'quiet_hours_digest', scheduledSendAt: at(7) },
      'quiet',
    ],
    [
      'notice of a reached cap',
      { ...MESSAGE, kind: 'daily_cap_reached', capDay: '2024-12-02' },
      'cap',
    ],
    ['catch-up waiting to be sent', { ...MESSAGE, kind: 'catch_up' }, 'catch_up'],
  ] as const)(
    '[TEL-22] [TEL-23] [CL-TEL-07] [CL-TEL-14] writes one %s',
    async (_case, message, index) => {
      await db.insert(notificationMessages).values(message);

      const again = db.insert(notificationMessages).values(message);

      await expect(again).rejects.toMatchObject(duplicateOf(`notification_messages_${index}_uq`));
    },
  );

  it('[TEL-22] [CL-TEL-14] lets a new catch-up wait once the last one is sent, and frees what a deleted digest grouped', async () => {
    await db.insert(notificationMessages).values([
      { ...SENT, kind: 'catch_up' },
      { ...MESSAGE, kind: 'catch_up' },
      { ...MESSAGE, kind: 'pass_digest', passId: PASS_ID },
      { ...MESSAGE, status: 'grouped', groupedIntoMessageId: 5 },
    ]);

    await db.delete(notificationMessages).where(eq(notificationMessages.id, 5));

    await expect(
      db
        .select({ into: notificationMessages.groupedIntoMessageId })
        .from(notificationMessages)
        .where(eq(notificationMessages.id, 6)),
    ).resolves.toStrictEqual([{ into: null }]);
  });

  it.each([
    [
      'a backtest request',
      { messageKind: 'backtest_request_to_do', backtestRequestId: PARENTS.requestId },
      'request',
    ],
    [
      'a changed deadline',
      {
        messageKind: 'deadline_changed',
        backtestRequestId: PARENTS.requestId,
        deadlineGameId: PARENTS.gameId,
      },
      'deadline_changed',
    ],
    [
      'a deadline reminder',
      {
        messageKind: 'deadline_reminder',
        backtestRequestId: PARENTS.requestId,
        deadlineGameId: PARENTS.gameId,
      },
      'reminder',
    ],
    ['an alert', { messageKind: 'alert', alertSheetId: 1 }, 'alert'],
    ['an alert update', { messageKind: 'alert_update', alertSheetUpdateId: 1 }, 'alert_update'],
    [
      'a tracked game result',
      { messageKind: 'tracked_game_result', caseId: PARENTS.caseId },
      'result',
    ],
    [
      'a type proposal',
      { messageKind: 'new_type_proposal', eventTypeId: 'bereavement' },
      'proposal',
    ],
    [
      'the start of an incident',
      { messageKind: 'incident_start', incidentId: 1 },
      'incident_start',
    ],
    [
      'a reminder of an incident',
      { messageKind: 'incident_reminder', incidentId: 1, reminderNumber: 2 },
      'incident_reminder',
    ],
    ['the end of an incident', { messageKind: 'incident_end', incidentId: 1 }, 'incident_end'],
    ['an export reminder', { messageKind: 'export_reminder', incidentId: 1 }, 'export_reminder'],
  ] as const)(
    '[TEL-02] [TEL-17] [CL-TEL-05] [CL-TEL-08] [CL-SUI-09] notifies %s once',
    async (_case, fact, index) => {
      await db.insert(notificationMessageFacts).values({ ...fact, messageId: MESSAGE_ID });

      const again = db.insert(notificationMessageFacts).values({ ...fact, messageId: 2 });

      await expect(again).rejects.toMatchObject(duplicateOf(`notification_facts_${index}_uq`));
    },
  );

  it.each([
    ['a kind outside the list', { ...FACT, messageKind: OUTSIDE }, 'message_kind'],
    [
      'an incident reminder without its number',
      { messageKind: 'incident_reminder', incidentId: 1 },
      'reminder',
    ],
    [
      'a number on another kind',
      { messageKind: 'incident_start', incidentId: 1, reminderNumber: 1 },
      'reminder',
    ],
    ['no subject', { messageKind: 'alert' }, 'subject'],
    ['two subjects', { ...FACT, caseId: PARENTS.caseId }, 'subject'],
    [
      'a deadline game without its request',
      { ...FACT, deadlineGameId: PARENTS.gameId },
      'deadline',
    ],
  ] as const)(
    '[TEL-02] [TEL-17] [CL-TEL-08] refuses a fact with %s',
    async (_case, fact, check) => {
      const insert = db.insert(notificationMessageFacts).values({ ...fact, messageId: MESSAGE_ID });

      await expect(insert).rejects.toMatchObject(
        violationOf(`notification_message_facts_${check}_check`),
      );
    },
  );

  it('[TEL-06] [TEL-38] [CL-JOU-06] erases with a message its facts and events, keeps the event they name, and goes with a case or an incident', async () => {
    await db.insert(notificationMessageFacts).values([
      {
        messageId: MESSAGE_ID,
        messageKind: 'backtest_request_to_do',
        backtestRequestId: PARENTS.requestId,
      },
      { messageId: 2, messageKind: 'tracked_game_result', caseId: PARENTS.caseId },
      { messageId: 2, messageKind: 'export_reminder', incidentId: 1 },
    ]);
    await db
      .insert(notificationMessageEvents)
      .values({ messageId: MESSAGE_ID, playerEventId: PARENTS.eventId });
    const again = db
      .insert(notificationMessageEvents)
      .values({ messageId: MESSAGE_ID, playerEventId: PARENTS.eventId });
    await expect(again).rejects.toMatchObject(duplicateOf('notification_message_events_uq'));
    const withdrawal = db.delete(events).where(eq(events.id, PARENTS.eventId));
    await expect(withdrawal).rejects.toMatchObject({
      cause: {
        code: '23001',
        constraint: 'notification_message_events_player_event_id_events_id_fk',
      },
    });

    await db.delete(cases).where(eq(cases.id, PARENTS.caseId));
    await db.delete(incidents).where(eq(incidents.id, 1));
    await expect(
      db.$count(notificationMessageFacts, eq(notificationMessageFacts.messageId, 2)),
    ).resolves.toBe(0);
    await db.delete(notificationMessages).where(eq(notificationMessages.id, MESSAGE_ID));

    await expect(db.$count(notificationMessageFacts)).resolves.toBe(0);
    await expect(db.$count(notificationMessageEvents)).resolves.toBe(0);
  });
});

// The tables of the notifications module about the Telegram link and the daily cap
// (notifications.md, Lot 2); the messages sit in notifications-messages.ts.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { outsideArchive } from './archive';
import { bytea, oneOf, timestamptz } from './builders';

// TelegramLinkStatus (TEL-28, TEL-32, TEL-37).
const TELEGRAM_LINK_STATUSES = ['not_linked', 'awaiting_confirmation', 'linked', 'broken'] as const;
// How Telegram's updates reach the app (TEL-29, TEL-30).
const INBOUND_MODES = ['webhook', 'polling'] as const;

/**
 * The single link between the app and one private chat, with the last Telegram
 * update handled; one row, never deleted, which unlinking empties (TEL-01,
 * TEL-28 to TEL-32, TEL-37, CL-TRV-21).
 */
export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: smallint('id').primaryKey().default(1),
    status: text('status', { enum: TELEGRAM_LINK_STATUSES }).notNull().default('not_linked'),
    statusChangedAt: timestamptz('status_changed_at').notNull(),
    chatId: bigint('chat_id', { mode: 'number' }),
    linkedAt: timestamptz('linked_at'),
    lastSuccessfulSendAt: timestamptz('last_successful_send_at'),
    inboundMode: text('inbound_mode', { enum: INBOUND_MODES }).notNull().default('webhook'),
    lastUpdateId: bigint('last_update_id', { mode: 'number' }),
    lastUpdateAt: timestamptz('last_update_at'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check('telegram_links_id_check', sql`${table.id} = 1`),
    check('telegram_links_status_check', oneOf(table.status, TELEGRAM_LINK_STATUSES)),
    check(
      'telegram_links_chat_check',
      sql`(${table.status} IN ('linked', 'broken')) = (${table.chatId} IS NOT NULL)`,
    ),
    check(
      'telegram_links_linked_check',
      sql`(${table.chatId} IS NULL) = (${table.linkedAt} IS NULL)`,
    ),
    check('telegram_links_inbound_mode_check', oneOf(table.inboundMode, INBOUND_MODES)),
  ],
);

/**
 * The digest of a one-time code that "Open Telegram" carries, single use and
 * expiring; kept out of backups and exports, like sessions (TEL-29, TEL-31,
 * CL-TEL-23, CL-TRV-05).
 */
export const telegramLinkCodes = outsideArchive(
  pgTable(
    'telegram_link_codes',
    {
      id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
      codeSha256: bytea('code_sha256').notNull(),
      createdAt: timestamptz('created_at').notNull(),
      expiresAt: timestamptz('expires_at').notNull(),
      usedAt: timestamptz('used_at'),
    },
    (table) => [
      check('telegram_link_codes_code_sha256_check', sql`octet_length(${table.codeSha256}) = 32`),
      check('telegram_link_codes_expires_check', sql`${table.expiresAt} >= ${table.createdAt}`),
      uniqueIndex('telegram_link_codes_code_uq').on(table.codeSha256),
    ],
  ),
);

/**
 * The messages sent in one day of the owner's zone that count toward the cap,
 * stored since a withdrawal erases sent messages; never decremented (TEL-22,
 * CL-TEL-07, CL-TEL-19).
 */
export const notificationDailyCounts = pgTable(
  'notification_daily_counts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    capDay: date('cap_day').notNull(),
    sentCount: smallint('sent_count').notNull().default(0),
  },
  (table) => [
    check('notification_daily_counts_sent_count_check', sql`${table.sentCount} >= 0`),
    uniqueIndex('notification_daily_counts_day_uq').on(table.capDay),
  ],
);

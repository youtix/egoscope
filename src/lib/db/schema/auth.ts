import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, text } from 'drizzle-orm/pg-core';

import { outsideArchive } from './archive';
import { bytea, oneOf, timestamptz } from './builders';

// AccountPasswordStatus (TRV-57, TRV-63, IHM-06).
const PASSWORD_STATUSES = ['initial', 'chosen'] as const;
// SessionEndReason (IHM-08, TRV-60, TRV-62, TRV-63, CL-TRV-05).
const SESSION_END_REASONS = [
  'expired',
  'logged_out',
  'password_changed',
  'reset',
  'restored',
] as const;
// The reason of the account's last ending of every session at once: any but `expired`.
const ALL_SESSIONS_END_REASONS = [
  'logged_out',
  'password_changed',
  'reset',
  'restored',
] as const satisfies readonly (typeof SESSION_END_REASONS)[number][];

/**
 * The single account, one row (`id = 1`; H-10, TRV-57): its password, stored as
 * a slow salted hash only, the fingerprint of the configured initial password,
 * and the last ending of every session at once, which outlives the session rows
 * (TRV-60, TRV-61, TRV-63, IHM-08, CL-IHM-10). Never in a backup or an export
 * (CL-TRV-05).
 */
export const accounts = outsideArchive(
  pgTable(
    'accounts',
    {
      id: smallint('id').primaryKey().default(1),
      passwordHash: text('password_hash').notNull(),
      passwordStatus: text('password_status', { enum: PASSWORD_STATUSES }).notNull(),
      initialPasswordFingerprint: text('initial_password_fingerprint').notNull(),
      passwordChangedAt: timestamptz('password_changed_at').notNull().defaultNow(),
      loginLockedUntil: timestamptz('login_locked_until'),
      allSessionsEndedAt: timestamptz('all_sessions_ended_at'),
      allSessionsEndReason: text('all_sessions_end_reason', { enum: ALL_SESSIONS_END_REASONS }),
    },
    (table) => [
      check('accounts_id_check', sql`${table.id} = 1`),
      check('accounts_password_status_check', oneOf(table.passwordStatus, PASSWORD_STATUSES)),
      check(
        'accounts_all_sessions_end_reason_check',
        oneOf(table.allSessionsEndReason, ALL_SESSIONS_END_REASONS),
      ),
      check(
        'accounts_all_sessions_ended_check',
        sql`(${table.allSessionsEndedAt} IS NULL) = (${table.allSessionsEndReason} IS NULL)`,
      ),
    ],
  ),
);

/**
 * A session of one device: its token stored hashed, never in clear (TRV-64),
 * ended by idleness or by the owner, and kept until its idle expiry so that its
 * device is told how it ended (IHM-06, IHM-08, TRV-62, CL-IHM-10). Never in a
 * backup or an export (CL-TRV-05).
 */
export const sessions = outsideArchive(
  pgTable(
    'sessions',
    {
      id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
      tokenHash: bytea('token_hash').notNull().unique(),
      device: text('device').notNull(),
      openedAt: timestamptz('opened_at').notNull().defaultNow(),
      lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
      expiresAt: timestamptz('expires_at').notNull(),
      endedAt: timestamptz('ended_at'),
      endReason: text('end_reason', { enum: SESSION_END_REASONS }),
    },
    (table) => [
      check('sessions_end_reason_check', oneOf(table.endReason, SESSION_END_REASONS)),
      check('sessions_ended_check', sql`(${table.endedAt} IS NULL) = (${table.endReason} IS NULL)`),
    ],
  ),
);

/**
 * The refused logins, counted over the observation period to lock the login
 * (TRV-61). Never backed up.
 */
export const loginFailures = outsideArchive(
  pgTable(
    'login_failures',
    {
      id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
      occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    },
    (table) => [index('login_failures_occurred_idx').on(table.occurredAt)],
  ),
);

import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { followedPlayers } from './players';
import { eventTypes } from './taxonomy';

// DerivationRequestKind: the games started since the player's previous run and his
// next game, or every started game (CL-TAX-19).
const DERIVATION_KINDS = ['regular', 'full'] as const;
// DerivationCause, `team_change_entered` being the owner's entered team change and
// `team_history_changed` what a game or a box-score correction shows (CL-TAX-19,
// CL-SEN-17).
const DERIVATION_CAUSES = [
  'statistics_update',
  'collection_pass',
  'history_stored',
  'type_validated',
  'type_reactivated',
  'type_changed',
  'birthday_changed',
  'mapping_changed',
  'team_history_changed',
  'team_change_entered',
] as const;
type DerivationCause = (typeof DERIVATION_CAUSES)[number];
// The causes that start a regular run; every other starts a full one (CL-TAX-19).
const REGULAR_CAUSES = [
  'statistics_update',
  'collection_pass',
] as const satisfies readonly DerivationCause[];
// The causes that only an action of the owner records.
const OWNER_CAUSES = [
  'type_validated',
  'type_reactivated',
  'type_changed',
  'birthday_changed',
  'mapping_changed',
  'team_change_entered',
] as const satisfies readonly DerivationCause[];

/**
 * A pending run of the calendar derivation, for one player and type or for all of
 * them, so that the change that calls for it never waits for the run and an
 * interrupted run resumes; the run deletes it in its last transaction. A new need for
 * a scope not yet taken joins its request, one that arrives while a run holds it adds
 * a row (CL-TAX-18, CL-TAX-19, ADR 0015).
 */
export const calendarDerivationRequests = pgTable(
  'calendar_derivation_requests',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind', { enum: DERIVATION_KINDS }).notNull(),
    playerId: uuid('player_id').references(() => followedPlayers.id, { onDelete: 'cascade' }),
    eventTypeId: text('event_type_id').references(() => eventTypes.id, { onDelete: 'restrict' }),
    cause: text('cause', { enum: DERIVATION_CAUSES }).notNull(),
    followsOwnerChange: boolean('follows_owner_change').notNull(),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    progressCursor: text('progress_cursor'),
  },
  (table) => [
    check('calendar_derivation_requests_kind_check', oneOf(table.kind, DERIVATION_KINDS)),
    check('calendar_derivation_requests_cause_check', oneOf(table.cause, DERIVATION_CAUSES)),
    check(
      'calendar_derivation_requests_regular_check',
      sql`(${table.kind} = 'regular') = (${oneOf(table.cause, REGULAR_CAUSES)})`,
    ),
    check(
      'calendar_derivation_requests_follows_owner_change_check',
      sql`${table.followsOwnerChange} = (${oneOf(table.cause, OWNER_CAUSES)})`,
    ),
    // NULLS NOT DISTINCT, which Drizzle cannot write on a partial index: a request for
    // every player, or for both types, is keyed by the empty string, which neither a
    // player's identifier nor a type's slug is.
    uniqueIndex('calendar_derivation_requests_scope_key')
      .on(
        table.kind,
        sql`coalesce(${table.playerId}::text, '')`,
        sql`coalesce(${table.eventTypeId}, '')`,
      )
      .where(sql`${table.leaseExpiresAt} IS NULL`),
  ],
);

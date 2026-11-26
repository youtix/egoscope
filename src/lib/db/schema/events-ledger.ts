// The tables of the events module that outlive an event: the tally exits, which keep
// a profile's count of the events that left it, and the withdrawal ledger
// (events-and-cases.md section 1.12, sensitive-data.md section 1). They sit apart from
// events.ts only to keep each schema file and its tests within the size limits.
import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';

import { outsideArchive } from './archive';
import { imports } from './backtests';
import { bytea, oneOf, timestamptz } from './builders';
import { followedPlayers } from './players';
import { eventTypes } from './taxonomy';

/**
 * The reasons an event leaves a profile's count (TallyExitReason), without `dismissed`,
 * which is counted from the events, a dismissal leaving its event in place (SEN-33,
 * CL-SEN-25). The CHECK of `tally_exits.exit_reason` is built from this list.
 */
export const TALLY_EXIT_REASONS = [
  'merged',
  'deleted',
  'replaced_at_import',
  'erased',
  'no_longer_derived',
] as const;
/**
 * The closed list of the reasons for deleting an event (HistoricalEventDeletionReason,
 * IMP-33), in its order. The CHECK of `tally_exits.deletion_reason` is built from this list,
 * and the deletion of `events` reads it.
 */
export const DELETION_REASONS = [
  'inaccurate_fact_or_false_source',
  'outside_type_criteria',
  'duplicate',
  'other',
] as const;

/**
 * An event that left the count, by reason, so that a profile shows its exits once the
 * event is gone; a manual deletion's row is the deletion trace, the only one dated. A
 * withdrawal never leaves a row (SEN-33, IMP-29, IMP-33, DSN-29, CL-SEN-25, CL-SEN-26).
 */
export const tallyExits = pgTable(
  'tally_exits',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    exitReason: text('exit_reason', { enum: TALLY_EXIT_REASONS }).notNull(),
    exitedAt: timestamptz('exited_at'),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    deletionReason: text('deletion_reason', { enum: DELETION_REASONS }),
    deletionDetail: text('deletion_detail'),
    publicDateOn: date('public_date_on'),
    publicAt: timestamptz('public_at'),
  },
  (table) => [
    check('tally_exits_exit_reason_check', oneOf(table.exitReason, TALLY_EXIT_REASONS)),
    check('tally_exits_deletion_reason_check', oneOf(table.deletionReason, DELETION_REASONS)),
    // A deletion has its reason, its public date and its instant; any other exit has
    // neither the reason nor the date, whichever of the three it would carry.
    check(
      'tally_exits_deleted_check',
      sql`CASE WHEN ${table.exitReason} = 'deleted' THEN num_nulls(${table.deletionReason}, ${table.publicDateOn}, ${table.exitedAt}) = 0 ELSE num_nonnulls(${table.deletionReason}, ${table.publicDateOn}) = 0 END`,
    ),
    check(
      'tally_exits_dated_check',
      sql`${table.exitedAt} IS NULL OR ${table.exitReason} = 'deleted'`,
    ),
    // Null-safe, so that an exit without a deletion reason holds no detail either.
    check(
      'tally_exits_deletion_detail_check',
      sql`(${table.deletionDetail} IS NOT NULL) = (${table.deletionReason} IS NOT DISTINCT FROM 'other')`,
    ),
    check(
      'tally_exits_import_check',
      sql`${table.importId} IS NULL OR ${table.exitReason} = 'replaced_at_import'`,
    ),
    index('tally_exits_player_type_idx').on(table.playerId, table.eventTypeId),
    index('tally_exits_type_idx').on(table.eventTypeId),
  ],
);

/**
 * A keyed hash of the player, type and day of a withdrawn event, kept for the
 * fingerprint horizon so that detection and the derivation cannot recreate the event
 * and an import flags it; its only other datum is its date. Never in a backup or an
 * export (ADR 0017, CL-DSN-06, CL-DSN-08).
 */
export const withdrawalFingerprints = outsideArchive(
  pgTable(
    'withdrawal_fingerprints',
    {
      id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
      fingerprint: bytea('fingerprint').notNull().unique('withdrawal_fingerprints_fingerprint_key'),
      createdAt: timestamptz('created_at').notNull().defaultNow(),
    },
    (table) => [
      check(
        'withdrawal_fingerprints_fingerprint_check',
        sql`octet_length(${table.fingerprint}) = 32`,
      ),
    ],
  ),
);

/**
 * A keyed hash of a deleted player's identifier, kept for the same horizon, only to
 * delete him again after a restore. Never in a backup or an export (CL-JOU-24,
 * CL-DSN-08, CL-TRV-06).
 */
export const deletedPlayerEntries = outsideArchive(
  pgTable(
    'deleted_player_entries',
    {
      id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
      fingerprint: bytea('fingerprint').notNull().unique('deleted_player_entries_fingerprint_key'),
      createdAt: timestamptz('created_at').notNull().defaultNow(),
    },
    (table) => [
      check(
        'deleted_player_entries_fingerprint_check',
        sql`octet_length(${table.fingerprint}) = 32`,
      ),
    ],
  ),
);

/**
 * The global count of removal decisions since go-live, one row (`id = 1`) with no date,
 * that never decreases: in no backup or export, which write its value into their
 * manifest instead, so that no restore can lower it (DSN-29, VUE-09, CL-DSN-04,
 * CL-DSN-08, CL-TRV-06).
 */
export const withdrawnEventCounter = outsideArchive(
  pgTable(
    'withdrawn_event_counter',
    {
      id: smallint('id').primaryKey().default(1),
      value: integer('value').notNull().default(0),
    },
    (table) => [
      check('withdrawn_event_counter_id_check', sql`${table.id} = 1`),
      check('withdrawn_event_counter_value_check', sql`${table.value} >= 0`),
    ],
  ),
);

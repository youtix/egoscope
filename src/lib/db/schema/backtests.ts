// The tables of the backtests module (backtest-and-import.md sections 1.1, 1.2 and
// 1.4), and the imports table of the imports module: a request names the import an
// incomplete-import supplement stems from, and an import its request, and two schema
// files that imported each other would form a cycle, so both tables sit here. The
// tables that also reference events sit in imports.ts and backtests-events.ts.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { followedPlayers } from './players';
import { eventTypes } from './taxonomy';
import { typeSheetVersions } from './taxonomy-sheets';

import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// BacktestRequestKind (BKT-01, BKT-08, BKT-09).
const REQUEST_KINDS = ['initial', 'supplement', 'full_redo'] as const;
// BacktestRequestTrigger (BKT-01, BKT-03 to BKT-06).
const REQUEST_TRIGGERS = [
  'manual_action',
  'detection',
  'type_validated',
  'type_reactivated',
  'type_broadened',
  'incomplete_import',
] as const;
// BacktestRequestStatus (BKT-13).
const REQUEST_STATUSES = ['to_do', 'imported', 'canceled'] as const;
// RequestCancellationReason (BKT-14).
const CANCELLATION_REASON_CODES = ['player_withdrawn'] as const;
// The origin of a covered period: an import, or the merge or split of its type (CL-BKT-06).
const COVERAGE_ORIGINS = ['import', 'merge', 'split'] as const;
// ImportMode (IMP-22, IMP-28, IMP-29).
const IMPORT_MODES = ['first_import', 'addition', 'replacement'] as const;
// The versions of the research-result format the import reads (IMP-06, BKT-24).
const FORMAT_VERSIONS = ['1.0'] as const;

/**
 * A request to the owner to run a deep research for one player, under a reference
 * from the per-year counter, never changed or reused; at most one to do per player
 * (BKT-01, BKT-07, BKT-12 to BKT-14, BKT-20, CL-BKT-11).
 */
export const backtestRequests = pgTable(
  'backtest_requests',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    reference: text('reference').notNull(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: REQUEST_KINDS }).notNull(),
    trigger: text('trigger', { enum: REQUEST_TRIGGERS }).notNull(),
    triggerEventTypeId: text('trigger_event_type_id').references(() => eventTypes.id, {
      onDelete: 'restrict',
    }),
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- a request and its import name each other, a reference read only once both tables exist
    triggerImportId: integer('trigger_import_id').references((): AnyPgColumn => imports.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('to_do'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdOn: date('created_on').notNull(),
    importedAt: timestamptz('imported_at'),
    canceledAt: timestamptz('canceled_at'),
    cancellationReasonCode: text('cancellation_reason_code', { enum: CANCELLATION_REASON_CODES }),
    cancellationReasonText: text('cancellation_reason_text'),
    promptText: text('prompt_text').notNull(),
    promptProducedAt: timestamptz('prompt_produced_at').notNull(),
    lastCopiedAt: timestamptz('last_copied_at'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check(
      'backtest_requests_reference_check',
      sql`${table.reference} ~ '^REQ-[0-9]{4}-[0-9]{4,}$'`,
    ),
    check('backtest_requests_kind_check', oneOf(table.kind, REQUEST_KINDS)),
    check('backtest_requests_trigger_check', oneOf(table.trigger, REQUEST_TRIGGERS)),
    check('backtest_requests_status_check', oneOf(table.status, REQUEST_STATUSES)),
    check(
      'backtest_requests_cancellation_reason_code_check',
      oneOf(table.cancellationReasonCode, CANCELLATION_REASON_CODES),
    ),
    check(
      'backtest_requests_imported_check',
      sql`(${table.status} = 'imported') = (${table.importedAt} IS NOT NULL)`,
    ),
    check(
      'backtest_requests_canceled_check',
      sql`${table.status} <> 'canceled' OR ${table.canceledAt} IS NOT NULL`,
    ),
    check(
      'backtest_requests_cancellation_reason_check',
      sql`(${table.cancellationReasonCode} IS NULL OR ${table.canceledAt} IS NOT NULL) AND (${table.cancellationReasonText} IS NULL OR ${table.canceledAt} IS NOT NULL)`,
    ),
    check(
      'backtest_requests_trigger_type_check',
      sql`(${table.triggerEventTypeId} IS NOT NULL) = (${table.trigger} IN ('type_validated', 'type_reactivated', 'type_broadened'))`,
    ),
    check(
      'backtest_requests_trigger_import_check',
      sql`${table.triggerImportId} IS NULL OR ${table.trigger} = 'incomplete_import'`,
    ),
    unique('backtest_requests_reference_key').on(table.reference),
    uniqueIndex('backtest_requests_one_to_do_key')
      .on(table.playerId)
      .where(sql`${table.status} = 'to_do'`),
    index('backtest_requests_to_do_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'to_do'`),
    index('backtest_requests_copied_idx')
      .on(table.lastCopiedAt)
      .where(sql`${table.status} = 'to_do'`),
    index('backtest_requests_player_idx').on(table.playerId, table.createdAt),
  ],
);

/**
 * A saved import and its trace: its number from the gapless counter, its mode, and what
 * it kept of the result, never the pasted text; a result refused in full creates no row
 * (IMP-05, IMP-22, IMP-29, IMP-31, DSN-32, CL-IMP-33).
 */
export const imports = pgTable(
  'imports',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sequenceNumber: integer('sequence_number').notNull(),
    backtestRequestId: integer('backtest_request_id')
      .notNull()
      .references(() => backtestRequests.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    importedAt: timestamptz('imported_at').notNull().defaultNow(),
    mode: text('mode', { enum: IMPORT_MODES }).notNull(),
    formatVersion: text('format_version', { enum: FORMAT_VERSIONS }).notNull().default('1.0'),
    truncationRecovered: boolean('truncation_recovered').notNull().default(false),
    declaredLimitations: text('declared_limitations').array().notNull().default([]),
    unverifiedLeadCounts: jsonb('unverified_lead_counts').notNull().default({}),
    resultWarnings: jsonb('result_warnings').notNull().default([]),
    coverageGaps: jsonb('coverage_gaps').notNull().default([]),
    deletedByReplacementCount: integer('deleted_by_replacement_count').notNull().default(0),
    deletedCorrectedCount: integer('deleted_corrected_count').notNull().default(0),
  },
  (table) => [
    check('imports_mode_check', oneOf(table.mode, IMPORT_MODES)),
    check('imports_format_version_check', oneOf(table.formatVersion, FORMAT_VERSIONS)),
    unique('imports_sequence_number_key').on(table.sequenceNumber),
    index('imports_player_idx').on(table.playerId, table.importedAt),
    index('imports_request_idx').on(table.backtestRequestId, table.importedAt),
  ],
);

/**
 * Each type of a request with the sheet version its prompt was produced under and its
 * requested period; a reduction keeps the row but stops requesting it (BKT-08, BKT-09,
 * BKT-15, CL-BKT-07, CL-TAX-06).
 */
export const backtestRequestTypes = pgTable(
  'backtest_request_types',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    backtestRequestId: integer('backtest_request_id').notNull(),
    eventTypeId: text('event_type_id').notNull(),
    sheetVersionNumber: smallint('sheet_version_number').notNull(),
    periodStartOn: date('period_start_on'),
    periodEndOn: date('period_end_on').notNull(),
    isRequested: boolean('is_requested').notNull().default(true),
  },
  (table) => [
    check(
      'backtest_request_types_period_check',
      sql`${table.periodStartOn} IS NULL OR ${table.periodStartOn} <= ${table.periodEndOn}`,
    ),
    unique('backtest_request_types_key').on(table.backtestRequestId, table.eventTypeId),
    foreignKey({
      name: 'backtest_request_types_backtest_request_id_fk',
      columns: [table.backtestRequestId],
      foreignColumns: [backtestRequests.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'backtest_request_types_sheet_version_fk',
      columns: [table.eventTypeId, table.sheetVersionNumber],
      foreignColumns: [typeSheetVersions.eventTypeId, typeSheetVersions.versionNumber],
    }).onDelete('restrict'),
  ],
);

/**
 * The periods an imported result covered for a player and a research type, even an
 * empty one, each with the sheet version it was researched under; a merge or a split
 * carries them over (BKT-10, IMP-10, IMP-30, CL-BKT-06, CL-BKT-20).
 */
export const backtestCoveragePeriods = pgTable(
  'backtest_coverage_periods',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    startOn: date('start_on').notNull(),
    endOn: date('end_on').notNull(),
    sheetVersionNumber: smallint('sheet_version_number').notNull(),
    origin: text('origin', { enum: COVERAGE_ORIGINS }).notNull(),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'cascade' }),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    check('backtest_coverage_periods_period_check', sql`${table.startOn} <= ${table.endOn}`),
    check(
      'backtest_coverage_periods_sheet_version_number_check',
      sql`${table.sheetVersionNumber} >= 0`,
    ),
    check('backtest_coverage_periods_origin_check', oneOf(table.origin, COVERAGE_ORIGINS)),
    check(
      'backtest_coverage_periods_import_check',
      sql`(${table.origin} = 'import') = (${table.importId} IS NOT NULL)`,
    ),
    index('backtest_coverage_periods_player_type_idx').on(
      table.playerId,
      table.eventTypeId,
      table.startOn,
    ),
  ],
);

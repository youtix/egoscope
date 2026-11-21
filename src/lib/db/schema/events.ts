// The events table of the events module (events-and-cases.md section 1.1). The rows
// that hang off one event sit in events-children.ts, and the tally exits and the
// withdrawal ledger in events-ledger.ts, to keep each schema file and its tests within
// the size limits.
import { sql } from 'drizzle-orm';
import {
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

import { imports } from './backtests';
import { oneOf, timestamptz } from './builders';
import { games } from './games';
import { followedPlayers } from './players';
import { cases } from './sensitivity';
import { eventTypes } from './taxonomy';
import { DATE_PRECISIONS, typeSheetVersions } from './taxonomy-sheets';

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, CheckBuilder } from 'drizzle-orm/pg-core';

// EventOrigin: a calendar-derived event is stored `calendar`, never `schedule`
// (DSN-06, CL-VUE-12, ADR 0015).
const EVENT_ORIGINS = ['detected', 'historical', 'calendar'] as const;
// EventTypeLinkMark (TAX-25, TAX-29).
const TYPE_LINK_MARKS = ['to_requalify', 'to_distribute'] as const;
// InjuryReturn and GameStakes (DSN-07, SEN-13, SEN-14, H-09).
const INJURY_RETURNS = ['yes', 'no', 'unknown'] as const;
const GAME_STAKES = ['high', 'normal', 'unknown'] as const;
// ContextIndicationOrigin without `calculation`, the condition of a case's criterion
// (SEN-18, H-09).
const CONTEXT_ORIGINS = ['research', 'classification', 'user'] as const;
// ResearchConfidence (IMP-15, CL-VUE-08, ADR 0022).
const RESEARCH_CONFIDENCES = ['high', 'medium', 'low'] as const;
// Precedence (IMP-18, SEN-44, CL-IMP-17).
const PRECEDENCES = ['established', 'uncertain', 'not_established', 'to_verify'] as const;
/** DetectedEventStatus: no event is ever stored withdrawn (DET-43, DET-45, DSN-26, CL-VUE-07). */
export const DETECTED_STATUSES = ['detected', 'dismissed'] as const;
/** DismissalReason (DET-43). */
export const DISMISSAL_REASONS = [
  'not_an_event',
  'no_validated_type_fits',
  'old_fact',
  'non_public_or_unverifiable',
  'duplicate_of_historical_event',
  'other',
] as const;
// How a detected event's reference date is computed, fixed at its creation (DET-30,
// DET-31, CL-DET-27).
const REFERENCE_DATE_RULES = ['earliest_source', 'coverage_threshold'] as const;
// ClassificationOrigin (DET-13, DET-49).
const CLASSIFICATION_ORIGINS = ['model', 'user'] as const;

// The columns of events that its row checks read.
type EventColumns = Readonly<
  Record<
    | 'origin'
    | 'typeLinkMark'
    | 'referenceDateOn'
    | 'referenceAt'
    | 'referenceOffsetMinutes'
    | 'referenceDatePrecision'
    | 'injuryReturn'
    | 'injuryReturnOrigin'
    | 'gameStakes'
    | 'gameStakesOrigin'
    | 'researchConfidence'
    | 'unverifiedNote'
    | 'precedence'
    | 'originImportId'
    | 'detectedStatus'
    | 'dismissalReason'
    | 'dismissalComment'
    | 'dismissedAt'
    | 'detectionConfidence'
    | 'referenceDateRule'
    | 'classificationOrigin'
    | 'derivedGameId',
    AnyPgColumn
  >
>;

// The separator of the columns of a row value.
const COMMA = sql.raw(', ');

/** The condition that every one of `columns` is set. */
function allSet(columns: readonly AnyPgColumn[]): SQL {
  return sql`(${sql.join([...columns], COMMA)}) IS NOT NULL`;
}

/** The condition that none of `columns` is set. */
function noneSet(columns: readonly AnyPgColumn[]): SQL {
  return sql`(${sql.join([...columns], COMMA)}) IS NULL`;
}

/** The checks that hold each column of a stored set to its values (DSN-06, DSN-07). */
function valueChecks(table: EventColumns): CheckBuilder[] {
  return [
    check('events_origin_check', oneOf(table.origin, EVENT_ORIGINS)),
    check('events_type_link_mark_check', oneOf(table.typeLinkMark, TYPE_LINK_MARKS)),
    check(
      'events_reference_date_precision_check',
      oneOf(table.referenceDatePrecision, DATE_PRECISIONS),
    ),
    check('events_injury_return_check', oneOf(table.injuryReturn, INJURY_RETURNS)),
    check('events_injury_return_origin_check', oneOf(table.injuryReturnOrigin, CONTEXT_ORIGINS)),
    check('events_game_stakes_check', oneOf(table.gameStakes, GAME_STAKES)),
    check('events_game_stakes_origin_check', oneOf(table.gameStakesOrigin, CONTEXT_ORIGINS)),
    check(
      'events_research_confidence_check',
      oneOf(table.researchConfidence, RESEARCH_CONFIDENCES),
    ),
    check('events_precedence_check', oneOf(table.precedence, PRECEDENCES)),
    check('events_detected_status_check', oneOf(table.detectedStatus, DETECTED_STATUSES)),
    check('events_dismissal_reason_check', oneOf(table.dismissalReason, DISMISSAL_REASONS)),
    check('events_detection_confidence_check', sql`${table.detectionConfidence} BETWEEN 0 AND 100`),
    check('events_reference_date_rule_check', oneOf(table.referenceDateRule, REFERENCE_DATE_RULES)),
    check(
      'events_classification_origin_check',
      oneOf(table.classificationOrigin, CLASSIFICATION_ORIGINS),
    ),
  ];
}

/**
 * The row checks of events: each origin holds the DSN-06 items it has and no other,
 * a historical event dated as written with its precision, a dismissed one its reason
 * and its instant, and a known context indication its origin (DSN-06, DSN-07, DET-43,
 * IMP-12, CL-DSN-20, CL-IMP-09).
 */
function originChecks(table: EventColumns): CheckBuilder[] {
  const historicalOnly = [
    table.researchConfidence,
    table.unverifiedNote,
    table.precedence,
    table.originImportId,
  ];
  const detectedOnly = [
    table.detectedStatus,
    table.dismissalReason,
    table.dismissalComment,
    table.dismissedAt,
    table.detectionConfidence,
    table.referenceDateRule,
    table.classificationOrigin,
  ];
  return [
    check(
      'events_historical_check',
      sql`${table.origin} <> 'historical' OR (${allSet([table.referenceDateOn, table.referenceDatePrecision, table.researchConfidence, table.precedence, table.originImportId])} AND (${table.referenceAt} IS NULL) = (${table.referenceOffsetMinutes} IS NULL) AND ${table.referenceDatePrecision} = CASE WHEN ${table.referenceAt} IS NULL THEN 'approximate' ELSE 'exact' END AND ${noneSet([...detectedOnly, table.derivedGameId])})`,
    ),
    check(
      'events_detected_check',
      sql`${table.origin} <> 'detected' OR (${allSet([table.detectedStatus, table.referenceAt, table.referenceDatePrecision, table.referenceDateRule, table.classificationOrigin])} AND ${noneSet([table.referenceDateOn, table.referenceOffsetMinutes, ...historicalOnly, table.derivedGameId])})`,
    ),
    check(
      'events_calendar_check',
      sql`${table.origin} <> 'calendar' OR (${allSet([table.derivedGameId, table.referenceDateOn])} AND ${noneSet([table.referenceAt, table.referenceOffsetMinutes, table.referenceDatePrecision, table.typeLinkMark, ...historicalOnly, ...detectedOnly])})`,
    ),
    check(
      'events_dismissed_check',
      sql`(${table.detectedStatus} = 'dismissed') = (${table.dismissalReason} IS NOT NULL AND ${table.dismissedAt} IS NOT NULL)`,
    ),
    check(
      'events_dismissal_comment_check',
      sql`${table.dismissalReason} <> 'other' OR ${table.dismissalComment} IS NOT NULL`,
    ),
    check(
      'events_injury_return_with_origin_check',
      sql`${table.injuryReturn} = 'unknown' OR ${table.injuryReturnOrigin} IS NOT NULL`,
    ),
    check(
      'events_game_stakes_with_origin_check',
      sql`${table.gameStakes} = 'unknown' OR ${table.gameStakesOrigin} IS NOT NULL`,
    ),
  ];
}

/**
 * A public, dated fact about one followed player, of one type, under the sheet version
 * it was qualified under, holding the DSN-06 list and nothing else: imported
 * (`historical`), detected in the press (`detected`, Lot 2) or derived from the
 * schedule (`calendar`), whose game stands for its sources (VUE-04, DSN-06, TAX-23,
 * CL-VUE-12, CL-DSN-20). Only the erasure step deletes a row, so the player's own
 * deletion is refused while he has one. Its case is one of its own player and type: on
 * the case's deletion the recalculation service first clears `case_id`, which the
 * composite reference cannot set to null alone (events-and-cases.md section 6).
 */
export const events = pgTable(
  'events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'restrict' }),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    sheetEventTypeId: text('sheet_event_type_id').notNull(),
    sheetVersionNumber: smallint('sheet_version_number').notNull(),
    origin: text('origin', { enum: EVENT_ORIGINS }).notNull(),
    typeLinkMark: text('type_link_mark', { enum: TYPE_LINK_MARKS }),
    referenceDateOn: date('reference_date_on'),
    referenceAt: timestamptz('reference_at'),
    referenceOffsetMinutes: smallint('reference_offset_minutes'),
    referenceDatePrecision: text('reference_date_precision', { enum: DATE_PRECISIONS }),
    description: text('description').notNull(),
    injuryReturn: text('injury_return', { enum: INJURY_RETURNS }).notNull().default('unknown'),
    injuryReturnOrigin: text('injury_return_origin', { enum: CONTEXT_ORIGINS }),
    gameStakes: text('game_stakes', { enum: GAME_STAKES }).notNull().default('unknown'),
    gameStakesOrigin: text('game_stakes_origin', { enum: CONTEXT_ORIGINS }),
    caseId: integer('case_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(1),
    researchConfidence: text('research_confidence', { enum: RESEARCH_CONFIDENCES }),
    unverifiedNote: text('unverified_note'),
    precedence: text('precedence', { enum: PRECEDENCES }),
    originImportId: integer('origin_import_id').references(() => imports.id, {
      onDelete: 'restrict',
    }),
    detectedStatus: text('detected_status', { enum: DETECTED_STATUSES }),
    dismissalReason: text('dismissal_reason', { enum: DISMISSAL_REASONS }),
    dismissalComment: text('dismissal_comment'),
    dismissedAt: timestamptz('dismissed_at'),
    detectionConfidence: smallint('detection_confidence'),
    referenceDateRule: text('reference_date_rule', { enum: REFERENCE_DATE_RULES }),
    classificationOrigin: text('classification_origin', { enum: CLASSIFICATION_ORIGINS }),
    derivedGameId: integer('derived_game_id').references(() => games.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    ...valueChecks(table),
    ...originChecks(table),
    foreignKey({
      name: 'events_sheet_version_fk',
      columns: [table.sheetEventTypeId, table.sheetVersionNumber],
      foreignColumns: [typeSheetVersions.eventTypeId, typeSheetVersions.versionNumber],
    }).onDelete('restrict'),
    foreignKey({
      name: 'events_case_fk',
      columns: [table.caseId, table.playerId, table.eventTypeId],
      foreignColumns: [cases.id, cases.playerId, cases.eventTypeId],
    }).onDelete('restrict'),
    uniqueIndex('events_calendar_game_key')
      .on(table.playerId, table.eventTypeId, table.derivedGameId)
      .where(sql`${table.origin} = 'calendar'`),
    index('events_case_idx').on(table.caseId),
    index('events_player_type_idx').on(table.playerId, table.eventTypeId),
    index('events_type_idx')
      .on(table.eventTypeId)
      .where(sql`${table.typeLinkMark} IS NOT NULL`),
    index('events_player_reference_date_idx').on(table.playerId, table.referenceDateOn),
    index('events_player_reference_at_idx').on(table.playerId, table.referenceAt),
    index('events_origin_import_idx').on(table.originImportId),
  ],
);

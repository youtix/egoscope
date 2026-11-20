// The tables of the events module that hang off one event and go with it: its sources,
// the warnings its import left, its marks, its dismissals and reinstatements, and its
// corrections (events-and-cases.md sections 1.2 to 1.6). They sit apart from events.ts
// only to keep each schema file and its tests within the size limits.
import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, smallint, text, unique } from 'drizzle-orm/pg-core';

import { imports } from './backtests';
import { oneOf, timestamptz } from './builders';
import { DETECTED_STATUSES, DISMISSAL_REASONS, events } from './events';

import type { DATE_PRECISIONS } from './taxonomy-sheets';

// The DatePrecision of a source the owner adds to a detected event, never `none`
// (DET-48, CL-DET-26).
const SOURCE_PRECISIONS = [
  'exact',
  'approximate',
] as const satisfies readonly (typeof DATE_PRECISIONS)[number][];
// LinkStatus: nothing is stored while the link answers or is not checked (IMP-17, CL-IMP-25).
const LINK_STATUSES = ['not_found'] as const;
// SpotCheckVerdict (IMP-23).
const SPOT_CHECK_VERDICTS = ['consistent', 'inconsistent', 'inaccessible'] as const;
// The event-scope values of ImportWarningKind; the whole-result ones are on the import
// (IMP-11 to IMP-17, CL-IMP-03, CL-IMP-07, CL-IMP-08).
const IMPORT_WARNING_KINDS = [
  'attached_to_surviving_type',
  'type_not_declared_covered',
  'outside_declared_period',
  'possible_statistics',
  'source_dropped',
  'source_outlet_or_title_missing',
  'confidence_defaulted',
  'context_defaulted',
  'text_too_long_ignored',
  'text_quotation_mark_ignored',
  'shared_link',
  'non_standard_date',
  'time_ignored',
  'possible_citation_marker',
] as const;
// SourceDropCause (IMP-14, CL-IMP-10, CL-IMP-15).
const SOURCE_DROP_CAUSES = [
  'incomplete_address',
  'home_page',
  'disallowed_domain',
  'publication_date_missing',
  'publication_date_malformed',
  'publication_date_in_future',
] as const;
// EventMark without `detected_after_tip_off`, which is derived (DET-21, DET-32, CL-DET-16).
const EVENT_MARKS = [
  'dating_to_verify',
  'possible_historical_duplicate',
  'description_to_review',
] as const;
// EventMarkStatus (DET-32, DET-33, DET-58).
const EVENT_MARK_STATUSES = ['set', 'lifted'] as const;
// The fields a correction changes, then the detected-event actions DET-52 traces.
const CORRECTED_FIELDS = [
  'player',
  'event_type',
  'reference_date',
  'description',
  'sources',
  'injury_return',
  'game_stakes',
  'research_confidence',
  'unverified_note',
  'article_detached',
  'event_merged_in',
  'player_added',
  'rescued',
] as const;

/** The reference to the event a row hangs off, which goes with it (DSN-06, DSN-27). */
function eventOfRow() {
  return integer('player_event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' });
}

/**
 * A press article cited for an event, reduced to its link, exactly as published, its
 * outlet, its title and its publication date, and what the import's checks found of it
 * (DSN-06, DSN-08, IMP-14, IMP-17, IMP-23, IMP-25, CL-IMP-09, CL-IMP-25). A
 * calendar-derived event has none.
 */
export const eventSources = pgTable(
  'event_sources',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerEventId: eventOfRow(),
    position: smallint('position').notNull(),
    url: text('url').notNull(),
    cleanedUrl: text('cleaned_url').notNull(),
    outlet: text('outlet'),
    title: text('title'),
    publicationDateOn: date('publication_date_on').notNull(),
    publicationAt: timestamptz('publication_at'),
    publicationOffsetMinutes: smallint('publication_offset_minutes'),
    publicationPrecision: text('publication_precision', { enum: SOURCE_PRECISIONS }),
    addedByImportId: integer('added_by_import_id').references(() => imports.id, {
      onDelete: 'set null',
    }),
    addedAt: timestamptz('added_at').notNull().defaultNow(),
    linkStatus: text('link_status', { enum: LINK_STATUSES }),
    linkCheckedAt: timestamptz('link_checked_at'),
    spotCheckVerdict: text('spot_check_verdict', { enum: SPOT_CHECK_VERDICTS }),
  },
  (table) => [
    check(
      'event_sources_publication_precision_check',
      oneOf(table.publicationPrecision, SOURCE_PRECISIONS),
    ),
    check('event_sources_link_status_check', oneOf(table.linkStatus, LINK_STATUSES)),
    check(
      'event_sources_spot_check_verdict_check',
      oneOf(table.spotCheckVerdict, SPOT_CHECK_VERDICTS),
    ),
    // A dated time keeps its offset, except on a source the owner adds, always timed,
    // whose offset stays empty when he gave no zone (CL-IMP-09, CL-DET-26).
    check(
      'event_sources_publication_check',
      sql`CASE WHEN ${table.publicationPrecision} IS NULL THEN (${table.publicationAt} IS NULL) = (${table.publicationOffsetMinutes} IS NULL) ELSE ${table.publicationAt} IS NOT NULL END`,
    ),
    index('event_sources_event_idx').on(table.playerEventId, table.position),
    index('event_sources_cleaned_url_idx').on(table.cleanedUrl),
    index('event_sources_unchecked_idx')
      .on(table.id)
      .where(sql`${table.linkCheckedAt} IS NULL`),
  ],
);

/**
 * A warning an import left on a saved event, naming a source by its position and
 * another event by reference, never by its rank in the import nor by quoting a text of
 * the result (IMP-19, IMP-37, CL-IMP-02).
 */
export const eventImportWarnings = pgTable(
  'event_import_warnings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerEventId: eventOfRow(),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: IMPORT_WARNING_KINDS }).notNull(),
    field: text('field'),
    sourceDropCause: text('source_drop_cause', { enum: SOURCE_DROP_CAUSES }),
    relatedPosition: smallint('related_position'),
    // The warning goes when the other event goes: the link is then no longer shared.
    relatedPlayerEventId: integer('related_player_event_id').references(() => events.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => [
    check('event_import_warnings_kind_check', oneOf(table.kind, IMPORT_WARNING_KINDS)),
    check(
      'event_import_warnings_source_drop_cause_check',
      oneOf(table.sourceDropCause, SOURCE_DROP_CAUSES),
    ),
    check(
      'event_import_warnings_source_dropped_check',
      sql`(${table.kind} = 'source_dropped') = (${table.sourceDropCause} IS NOT NULL)`,
    ),
    check(
      'event_import_warnings_source_position_check',
      sql`(${table.kind} IN ('source_dropped', 'source_outlet_or_title_missing')) = (${table.relatedPosition} IS NOT NULL)`,
    ),
    check(
      'event_import_warnings_shared_link_check',
      sql`(${table.kind} = 'shared_link') = (${table.relatedPlayerEventId} IS NOT NULL)`,
    ),
    check(
      'event_import_warnings_text_field_check',
      sql`(${table.kind} IN ('possible_statistics', 'text_too_long_ignored', 'text_quotation_mark_ignored', 'possible_citation_marker')) = (${table.field} IS NOT NULL)`,
    ),
    index('event_import_warnings_event_idx').on(table.playerEventId),
    index('event_import_warnings_related_idx').on(table.relatedPlayerEventId),
  ],
);

/**
 * Lot 2: a mark set on a detected event and later lifted, once per mark; the mark
 * "detected after tip-off" is derived, never stored (DET-21, DET-32, DET-33, DET-58,
 * CL-DET-06, CL-DET-16).
 */
export const eventMarks = pgTable(
  'event_marks',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerEventId: eventOfRow(),
    mark: text('mark', { enum: EVENT_MARKS }).notNull(),
    status: text('status', { enum: EVENT_MARK_STATUSES }).notNull().default('set'),
    setAt: timestamptz('set_at').notNull().defaultNow(),
    resolvedAt: timestamptz('resolved_at'),
  },
  (table) => [
    check('event_marks_mark_check', oneOf(table.mark, EVENT_MARKS)),
    check('event_marks_status_check', oneOf(table.status, EVENT_MARK_STATUSES)),
    unique('event_marks_event_mark_key').on(table.playerEventId, table.mark),
  ],
);

/**
 * Lot 2: every dismissal and reinstatement of a detected event, with its reason and
 * its instant; its position against tip-off is derived at each display (DET-43 to
 * DET-46, DET-52, CL-DET-15).
 */
export const eventStatusChanges = pgTable(
  'event_status_changes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerEventId: eventOfRow(),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    toStatus: text('to_status', { enum: DETECTED_STATUSES }).notNull(),
    dismissalReason: text('dismissal_reason', { enum: DISMISSAL_REASONS }),
    dismissalComment: text('dismissal_comment'),
  },
  (table) => [
    check('event_status_changes_to_status_check', oneOf(table.toStatus, DETECTED_STATUSES)),
    check(
      'event_status_changes_dismissal_reason_check',
      oneOf(table.dismissalReason, DISMISSAL_REASONS),
    ),
    check(
      'event_status_changes_dismissed_check',
      sql`${table.toStatus} <> 'dismissed' OR ${table.dismissalReason} IS NOT NULL`,
    ),
    check(
      'event_status_changes_dismissal_comment_check',
      sql`${table.dismissalReason} <> 'other' OR ${table.dismissalComment} IS NOT NULL`,
    ),
  ],
);

/**
 * Each correction of an event with its instant and the field it changed, or the
 * detected-event action it traces; values before and after only for a structured
 * field, never for a free text, the sources or an action (IMP-32, DET-47, DET-48,
 * DET-52, CA-DET-27, CL-DSN-15, D-20).
 */
export const eventCorrections = pgTable(
  'event_corrections',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerEventId: eventOfRow(),
    correctedAt: timestamptz('corrected_at').notNull().defaultNow(),
    field: text('field', { enum: CORRECTED_FIELDS }).notNull(),
    beforeValue: text('before_value'),
    afterValue: text('after_value'),
  },
  (table) => [
    check('event_corrections_field_check', oneOf(table.field, CORRECTED_FIELDS)),
    check(
      'event_corrections_values_check',
      sql`${table.field} NOT IN ('description', 'unverified_note', 'sources', 'article_detached', 'event_merged_in', 'player_added', 'rescued') OR (${table.beforeValue} IS NULL AND ${table.afterValue} IS NULL)`,
    ),
    index('event_corrections_event_idx').on(table.playerEventId, table.correctedAt),
  ],
);

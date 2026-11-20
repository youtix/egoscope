// The tables of the taxonomy module that hang off one type: the versions and the change
// history of its sheet, the illustration sources of its proposal, and the facts that
// detection attaches to it (Lot 2, created now). They sit apart from taxonomy.ts only
// to keep each schema file and its tests within the size limits.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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

// TypeSheetVersionKind (TAX-20, TAX-22, TAX-27, CL-TAX-06).
const TYPE_SHEET_VERSION_KINDS = ['validation', 'substantive_change', 'merge'] as const;
// SubstantiveChangeScope (TAX-22, CL-TAX-07).
const SUBSTANTIVE_CHANGE_SCOPES = ['broadens', 'narrows', 'both'] as const;
// TypeSheetChangeKind (TAX-21, TAX-22, CL-TAX-06, CL-TAX-17).
const TYPE_SHEET_CHANGE_KINDS = ['formal', 'substantive', 'criterion_switch'] as const;
// DatePrecision (COL-20).
export const DATE_PRECISIONS = ['exact', 'approximate', 'none'] as const;

/**
 * The dated full content of a sheet at each version, which every event qualified
 * under it keeps, with the counts of what the version did to events (TAX-20 to TAX-26,
 * CL-TAX-06).
 */
export const typeSheetVersions = pgTable(
  'type_sheet_versions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    versionNumber: smallint('version_number').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    kind: text('kind', { enum: TYPE_SHEET_VERSION_KINDS }).notNull(),
    substantiveScope: text('substantive_scope', { enum: SUBSTANTIVE_CHANGE_SCOPES }),
    mergeCoversUnion: boolean('merge_covers_union'),
    isBroadening: boolean('is_broadening').notNull().default(false),
    reason: text('reason'),
    content: jsonb('content').notNull(),
    requalifiedConformingCount: integer('requalified_conforming_count').notNull().default(0),
    reassignedCount: integer('reassigned_count').notNull().default(0),
    erasedCount: integer('erased_count').notNull().default(0),
    supplementaryRequestsProposedCount: integer('supplementary_requests_proposed_count')
      .notNull()
      .default(0),
  },
  (table) => [
    check('type_sheet_versions_version_number_check', sql`${table.versionNumber} >= 1`),
    check('type_sheet_versions_kind_check', oneOf(table.kind, TYPE_SHEET_VERSION_KINDS)),
    check(
      'type_sheet_versions_substantive_scope_check',
      oneOf(table.substantiveScope, SUBSTANTIVE_CHANGE_SCOPES),
    ),
    check(
      'type_sheet_versions_substantive_change_check',
      sql`(${table.kind} = 'substantive_change') = (${table.substantiveScope} IS NOT NULL)`,
    ),
    check(
      'type_sheet_versions_merge_check',
      sql`(${table.kind} = 'merge') = (${table.mergeCoversUnion} IS NOT NULL)`,
    ),
    unique('type_sheet_versions_type_number_key').on(table.eventTypeId, table.versionNumber),
  ],
);

/**
 * The modification history of validated sheets: every saved change, formal or
 * substantive, and every change of the criterion switch, with the content before
 * and after (TAX-21, CL-TAX-06, CL-TAX-17).
 */
export const typeSheetChanges = pgTable(
  'type_sheet_changes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    changeKind: text('change_kind', { enum: TYPE_SHEET_CHANGE_KINDS }).notNull(),
    substantiveScope: text('substantive_scope', { enum: SUBSTANTIVE_CHANGE_SCOPES }),
    reason: text('reason'),
    contentBefore: jsonb('content_before').notNull(),
    contentAfter: jsonb('content_after').notNull(),
    resultingVersionNumber: smallint('resulting_version_number'),
  },
  (table) => [
    check('type_sheet_changes_change_kind_check', oneOf(table.changeKind, TYPE_SHEET_CHANGE_KINDS)),
    check(
      'type_sheet_changes_substantive_scope_check',
      oneOf(table.substantiveScope, SUBSTANTIVE_CHANGE_SCOPES),
    ),
    check(
      'type_sheet_changes_resulting_version_check',
      sql`(${table.changeKind} = 'substantive') = (${table.resultingVersionNumber} IS NOT NULL)`,
    ),
    check(
      'type_sheet_changes_scoped_change_check',
      sql`${table.substantiveScope} IS NULL OR ${table.changeKind} = 'substantive'`,
    ),
    index('type_sheet_changes_type_idx').on(table.eventTypeId, table.changedAt),
    index('type_sheet_changes_switch_idx')
      .on(table.changedAt)
      .where(sql`${table.changeKind} = 'criterion_switch'`),
  ],
);

/**
 * A real article an AI cites to justify a proposal, kept apart from the sheet, shown
 * on the proposal's page only and erased once the proposal is decided (TAX-03,
 * CL-TAX-16).
 */
export const typeIllustrationSources = pgTable(
  'type_illustration_sources',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    url: text('url').notNull(),
    outlet: text('outlet'),
    title: text('title'),
    publicationDateOn: date('publication_date_on').notNull(),
    publicationAt: timestamptz('publication_at'),
    publicationOffsetMinutes: smallint('publication_offset_minutes'),
  },
  // A dated time keeps the offset it was written with, as a source of an event does (CL-IMP-09).
  (table) => [
    check(
      'type_illustration_sources_publication_check',
      sql`(${table.publicationAt} IS NULL) = (${table.publicationOffsetMinutes} IS NULL)`,
    ),
  ],
);

/**
 * Lot 2: a fact detection attaches to a pending proposal, a rejected or a withdrawn
 * type, about one followed player, with a copy of its article's reference that
 * outlives the article; at most one per type is the fact that created a detection
 * proposal (VUE-04, TAX-18, DET-34, DSN-09).
 */
export const typeOccurrences = pgTable(
  'type_occurrences',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventTypeId: text('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    isOriginatingFact: boolean('is_originating_fact').notNull().default(false),
    justification: text('justification'),
    articleUrl: text('article_url').notNull(),
    articleOutlet: text('article_outlet'),
    articleTitle: text('article_title'),
    articlePublishedAt: timestamptz('article_published_at').notNull(),
    articlePublicationPrecision: text('article_publication_precision', {
      enum: DATE_PRECISIONS,
    }).notNull(),
  },
  (table) => [
    check(
      'type_occurrences_article_publication_precision_check',
      oneOf(table.articlePublicationPrecision, DATE_PRECISIONS),
    ),
    uniqueIndex('type_occurrences_originating_key')
      .on(table.eventTypeId)
      .where(sql`${table.isOriginatingFact}`),
    index('type_occurrences_type_idx').on(table.eventTypeId),
    index('type_occurrences_article_idx').on(table.articleUrl),
  ],
);

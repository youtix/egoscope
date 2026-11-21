// The histories of the profiles and trends: the verdict changes of the default view
// and the value versions of the historical-only view (sensitivity-and-profiles.md
// sections 1.3 and 1.5). They sit apart from sensitivity-profiles.ts only to keep each
// schema file and its tests within the size limits.
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { VERDICT_CHANGE_CAUSES } from './sensitivity';
import {
  directedVerdict,
  generalTrends,
  PROFILE_CONFIDENCES,
  sensitivityProfiles,
  VERDICT_DIRECTIONS,
  VERDICT_LEVELS,
} from './sensitivity-profiles';

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** The condition that a row names a profile or a trend, not both. */
function oneSubject(profile: AnyPgColumn, trend: AnyPgColumn): SQL {
  return sql`(${profile} IS NULL) <> (${trend} IS NULL)`;
}

/**
 * A change of verdict level or direction, or of profile confidence, of the default
 * view, with its cause, written with the profile's or trend's new values; a withdrawal
 * leaves only `recalculation` (SEN-37, SEN-48, CL-SEN-16, CL-SEN-18).
 */
export const verdictHistoryEntries = pgTable(
  'verdict_history_entries',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sensitivityProfileId: integer('sensitivity_profile_id'),
    generalTrendId: integer('general_trend_id').references(() => generalTrends.id, {
      onDelete: 'cascade',
    }),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    oldVerdictLevel: text('old_verdict_level', { enum: VERDICT_LEVELS }).notNull(),
    oldVerdictDirection: text('old_verdict_direction', { enum: VERDICT_DIRECTIONS }),
    oldProfileConfidence: text('old_profile_confidence', { enum: PROFILE_CONFIDENCES }).notNull(),
    newVerdictLevel: text('new_verdict_level', { enum: VERDICT_LEVELS }).notNull(),
    newVerdictDirection: text('new_verdict_direction', { enum: VERDICT_DIRECTIONS }),
    newProfileConfidence: text('new_profile_confidence', { enum: PROFILE_CONFIDENCES }).notNull(),
    cause: text('cause', { enum: VERDICT_CHANGE_CAUSES }).notNull(),
  },
  (table) => [
    check(
      'verdict_history_entries_old_verdict_level_check',
      oneOf(table.oldVerdictLevel, VERDICT_LEVELS),
    ),
    check(
      'verdict_history_entries_old_verdict_direction_check',
      oneOf(table.oldVerdictDirection, VERDICT_DIRECTIONS),
    ),
    check(
      'verdict_history_entries_old_profile_confidence_check',
      oneOf(table.oldProfileConfidence, PROFILE_CONFIDENCES),
    ),
    check(
      'verdict_history_entries_new_verdict_level_check',
      oneOf(table.newVerdictLevel, VERDICT_LEVELS),
    ),
    check(
      'verdict_history_entries_new_verdict_direction_check',
      oneOf(table.newVerdictDirection, VERDICT_DIRECTIONS),
    ),
    check(
      'verdict_history_entries_new_profile_confidence_check',
      oneOf(table.newProfileConfidence, PROFILE_CONFIDENCES),
    ),
    check('verdict_history_entries_cause_check', oneOf(table.cause, VERDICT_CHANGE_CAUSES)),
    check(
      'verdict_history_entries_subject_check',
      oneSubject(table.sensitivityProfileId, table.generalTrendId),
    ),
    check(
      'verdict_history_entries_change_check',
      sql`(${table.oldVerdictLevel}, ${table.oldVerdictDirection}, ${table.oldProfileConfidence}) IS DISTINCT FROM (${table.newVerdictLevel}, ${table.newVerdictDirection}, ${table.newProfileConfidence})`,
    ),
    foreignKey({
      name: 'verdict_history_entries_sensitivity_profile_id_fk',
      columns: [table.sensitivityProfileId],
      foreignColumns: [sensitivityProfiles.id],
    }).onDelete('cascade'),
    index('verdict_history_entries_profile_idx').on(table.sensitivityProfileId, table.changedAt),
    index('verdict_history_entries_trend_idx').on(table.generalTrendId, table.changedAt),
  ],
);

/**
 * The values of a historical-only profile or trend over time, a row per change, never
 * updated, which Lot 2 tracking reads: rows the jobs insert, that a withdrawal, a
 * player-data deletion or a restore's re-application replace by one version and that
 * the daily purge prunes, so nothing keeps them from being deleted (SUI-08, SUI-09,
 * CL-SEN-18, CL-SEN-19, CL-SUI-03).
 */
export const profileValueVersions = pgTable(
  'profile_value_versions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sensitivityProfileId: integer('sensitivity_profile_id'),
    generalTrendId: integer('general_trend_id').references(() => generalTrends.id, {
      onDelete: 'cascade',
    }),
    effectiveAt: timestamptz('effective_at').notNull(),
    validCount: integer('valid_count').notNull(),
    meanGap: doublePrecision('mean_gap'),
    verdictLevel: text('verdict_level', { enum: VERDICT_LEVELS }).notNull(),
    verdictDirection: text('verdict_direction', { enum: VERDICT_DIRECTIONS }),
    profileConfidence: text('profile_confidence', { enum: PROFILE_CONFIDENCES }).notNull(),
  },
  (table) => [
    check('profile_value_versions_verdict_level_check', oneOf(table.verdictLevel, VERDICT_LEVELS)),
    check(
      'profile_value_versions_verdict_direction_check',
      oneOf(table.verdictDirection, VERDICT_DIRECTIONS),
    ),
    check(
      'profile_value_versions_profile_confidence_check',
      oneOf(table.profileConfidence, PROFILE_CONFIDENCES),
    ),
    check(
      'profile_value_versions_subject_check',
      oneSubject(table.sensitivityProfileId, table.generalTrendId),
    ),
    check(
      'profile_value_versions_verdict_check',
      directedVerdict(table.verdictLevel, table.verdictDirection),
    ),
    foreignKey({
      name: 'profile_value_versions_sensitivity_profile_id_fk',
      columns: [table.sensitivityProfileId],
      foreignColumns: [sensitivityProfiles.id],
    }).onDelete('cascade'),
    index('profile_value_versions_profile_idx').on(table.sensitivityProfileId, table.effectiveAt),
    index('profile_value_versions_trend_idx').on(table.generalTrendId, table.effectiveAt),
  ],
);

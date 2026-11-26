// The tables of the detection module that hold numbers about its runs and its
// players rather than about one article (detection.md, Lot 2).
import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { oneOf } from './builders';
import { incidents, QUOTA_INCIDENT_CAUSES } from './incidents';
import { followedPlayers } from './players';
import { taskRuns } from './scheduler';

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** The condition that none of `columns` is negative; a null one passes. */
function allNonNegative(columns: readonly AnyPgColumn[]): SQL {
  return sql.join(
    columns.map((column) => sql`${column} >= 0`),
    sql.raw(' AND '),
  );
}

/**
 * The number of collected articles that cited a player on one day of the owner's
 * zone: numbers only, which survive the article purge and feed the exposure
 * indicator (DET-57, JOU-03, CL-DET-14, CL-JOU-06, CL-JOU-19).
 */
export const exposureCounts = pgTable(
  'exposure_counts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => followedPlayers.id, { onDelete: 'cascade' }),
    countedOn: date('counted_on').notNull(),
    articleCount: integer('article_count').notNull().default(0),
  },
  (table) => [
    check('exposure_counts_article_count_check', sql`${table.articleCount} >= 0`),
    uniqueIndex('exposure_counts_uq').on(table.playerId, table.countedOn),
  ],
);

// The counters of a detection run, each 0 or more, and the calls left, which may be
// unknown (DET-55, CL-DET-25).
const runCounters = {
  articlesReceived: integer('articles_received').notNull().default(0),
  articlesNotPrefilteredIn: integer('articles_not_prefiltered_in').notNull().default(0),
  articlesClassified: integer('articles_classified').notNull().default(0),
  articlesClassifiedWithoutFact: integer('articles_classified_without_fact').notNull().default(0),
  articlesFailed: integer('articles_failed').notNull().default(0),
  articlesStillQueued: integer('articles_still_queued').notNull().default(0),
  factsAttachedToExistingEvent: integer('facts_attached_to_existing_event').notNull().default(0),
  factsBelowThreshold: integer('facts_below_threshold').notNull().default(0),
  factsBelowCoverageThreshold: integer('facts_below_coverage_threshold').notNull().default(0),
  factsOld: integer('facts_old').notNull().default(0),
  factsAlreadyReportedByBacktest: integer('facts_already_reported_by_backtest')
    .notNull()
    .default(0),
  proposalsSubmitted: integer('proposals_submitted').notNull().default(0),
  occurrencesAdded: integer('occurrences_added').notNull().default(0),
  descriptionsReplaced: integer('descriptions_replaced').notNull().default(0),
  eventsCreated: integer('events_created').notNull().default(0),
  quotaCallsUsed: integer('quota_calls_used').notNull().default(0),
  quotaCallsLeft: integer('quota_calls_left'),
};

/**
 * The detection-journal entry of one run of `detection` or `classification-resume`,
 * with its counters per article and per fact (DET-21, DET-55, TRV-03, CL-DET-25).
 */
export const detectionRuns = pgTable(
  'detection_runs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    taskRunId: integer('task_run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    ...runCounters,
  },
  (table) => [
    check(
      'detection_runs_counters_check',
      allNonNegative([
        table.articlesReceived,
        table.articlesNotPrefilteredIn,
        table.articlesClassified,
        table.articlesClassifiedWithoutFact,
        table.articlesFailed,
        table.articlesStillQueued,
        table.factsAttachedToExistingEvent,
        table.factsBelowThreshold,
        table.factsBelowCoverageThreshold,
        table.factsOld,
        table.factsAlreadyReportedByBacktest,
        table.proposalsSubmitted,
        table.occurrencesAdded,
        table.descriptionsReplaced,
        table.eventsCreated,
        table.quotaCallsUsed,
        table.quotaCallsLeft,
      ]),
    ),
    uniqueIndex('detection_runs_task_run_uq').on(table.taskRunId),
  ],
);

/**
 * The current cause of the classification incident, which the core's incident does
 * not hold: every cause it had stays in its quota causes (DET-11, CL-DET-04, CL-DET-05).
 */
export const classificationIncidentDetails = pgTable(
  'classification_incident_details',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    incidentId: integer('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    cause: text('cause', { enum: QUOTA_INCIDENT_CAUSES }).notNull(),
  },
  (table) => [
    check('classification_incident_details_cause_check', oneOf(table.cause, QUOTA_INCIDENT_CAUSES)),
    uniqueIndex('classification_incident_details_incident_uq').on(table.incidentId),
  ],
);

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
} from 'drizzle-orm/pg-core';

import { oneOf, timestamptz } from './builders';
import { journalEntries } from './journal';

/**
 * Every key of the parameter registry, the module map's section 6 in both lots,
 * that can hold an override: all but `taxonomy.switchedOffCriterion`, whose values
 * live on the type sheets (operations.md §1.1). The CHECK of `parameter_overrides`
 * is built from this list, and the registry of `params` is typed by it, since the
 * schema cannot import the registry, which reads that table (TRV-34, TRV-38).
 */
export const OVERRIDABLE_PARAMETER_KEYS = [
  'players.maxActive',
  'players.indicativeMin',
  'players.prolongedAbsenceGames',
  'players.exposureWindowDays',
  'collection.times',
  'collection.readAttempts',
  'collection.maxArticleAgeDays',
  'collection.titleDedupWindowHours',
  'collection.excerptMaxLength',
  'collection.notRelevantRetentionDays',
  'collection.dedupTraceRetentionDays',
  'collection.failedRunsBeforeDown',
  'collection.silencePeriodDays',
  'collection.indicatorWindowDays',
  'detection.threshold',
  'detection.confidenceBandWidth',
  'detection.classificationAttempts',
  'detection.groupingWindowHours',
  'detection.priorityHorizonHours',
  'detection.queueResumeIntervalHours',
  'languageModel.primaryModel',
  'languageModel.fallbackModel',
  'backtests.maxSourcesPerEvent',
  'imports.maxPastedTextMegabytes',
  'imports.duplicateMaxDateGapDays',
  'imports.maxSourceLeadDays',
  'imports.spotCheckSources',
  'imports.linkCheckEnabled',
  'imports.linkCheckTimeoutSeconds',
  'imports.disallowedSourceDomains',
  'games.minutesFloor',
  'games.minutesAverageShare',
  'games.minBaselineGames',
  'games.postseasonBaseline',
  'games.partialBaselineShare',
  'games.dailyUpdateDelayHours',
  'games.correctionWindowDays',
  'games.boxScoreUnavailableAfterDays',
  'games.retryFirstDelayHours',
  'games.retryIntervalHours',
  'games.incidentAfterHours',
  'games.quotaReserveShare',
  'sensitivity.maxAttachmentDays',
  'sensitivity.coOccurringCasesDoubtful',
  'sensitivity.injuryReturnMinGamesMissed',
  'sensitivity.injuryReturnFirstGames',
  'sensitivity.allPlayoffGamesUnusualStakes',
  'sensitivity.opponentWinShareLow',
  'sensitivity.opponentWinShareHigh',
  'sensitivity.opponentMinGames',
  'sensitivity.minValidCases',
  'sensitivity.possibleSignalToNoise',
  'sensitivity.possibleMeanGap',
  'sensitivity.probableSignalToNoise',
  'sensitivity.probableMeanGap',
  'sensitivity.confidenceMediumFromCases',
  'sensitivity.confidenceHighFromCases',
  'sensitivity.confidenceDispersionDrop',
  'sensitivity.confidenceDoubtfulShareDrop',
  'sensitivity.trendMinPlayers',
  'sensitivity.trendMaxTopShare',
  'sensitivity.countsBelowCases',
  'alerts.confidenceVigilanceMargin',
  'tracking.categoryThreshold',
  'tracking.minTrackedCasesForAssessment',
  'notifications.enabled',
  'notifications.quietHours',
  'notifications.urgentException',
  'notifications.category.backtestRequests',
  'notifications.category.alerts',
  'notifications.category.trackedResults',
  'notifications.category.typeProposals',
  'notifications.category.incidents',
  'notifications.inconclusiveAlerts',
  'notifications.incidentEnd',
  'notifications.reminderEnabled',
  'notifications.reminderLeadHours',
  'notifications.alertGroupingThreshold',
  'notifications.maxDetailedFacts',
  'notifications.dailyCap',
  'notifications.retryIntervalsMinutes',
  'notifications.catchUpIntervalMinutes',
  'notifications.incidentReminderDays',
  'notifications.incidentRecurrenceGraceHours',
  'notifications.linkCodeValidityMinutes',
  'display.timeZone',
  'display.listPageSize',
  'display.deadlineSoonHours',
  'display.draftRetentionDays',
  'display.researchToolUrl',
  'events.maxDescriptionLength',
  'quotas.statsSource.requestsPerDay',
  'quotas.statsSource.megabytesPerDay',
  'quotas.workersAi.neuronsPerDay',
  'quotas.workersAi.requestsPerMinute',
  'quotas.groq.requestsPerMinute',
  'quotas.groq.requestsPerDay',
  'quotas.groq.tokensPerMinute',
  'quotas.groq.tokensPerDay',
  'quotas.database.capacityMegabytes',
  'quotas.database.computeHoursPerMonth',
  'quotas.database.transferMegabytesPerMonth',
  'quotas.hosting.invocationsPerMonth',
  'quotas.hosting.activeCpuHoursPerMonth',
  'quotas.hosting.memoryGbHoursPerMonth',
  'quotas.hosting.runtimeCacheReadsPerMonth',
  'quotas.hosting.runtimeCacheWritesPerMonth',
  'quotas.hosting.schedulesRunsPerMonth',
  'quotas.telegram.messagesPerSecond',
  'quotas.backupStorage.maxFileMegabytes',
  'quotas.backupStorage.requestsPerHour',
  'quotas.warningShare',
  'quotas.databaseWarningShare',
  'scheduler.statsUpdateTime',
  'scheduler.statsUpdateCutoff',
  'scheduler.statsProbeIntervalMinutes',
  'scheduler.statsLateDaysBeforeIncident',
  'scheduler.purgeTime',
  'scheduler.missedRunMarginHours',
  'scheduler.expectedTickIntervalMinutes',
  'journal.retentionDays',
  'backups.weekday',
  'backups.time',
  'backups.kept',
  'backups.exportReminderDays',
  'auth.passwordMinLength',
  'auth.loginFailureThreshold',
  'auth.loginFailureWindowMinutes',
  'auth.lockoutMinutes',
  'auth.sessionIdleDays',
] as const;

/**
 * The owner's overrides of the registry's defaults, one per key, replaced whole
 * at each change; "Restore default" deletes the override (TRV-34, TRV-35).
 */
export const parameterOverrides = pgTable(
  'parameter_overrides',
  {
    parameterKey: text('parameter_key', { enum: OVERRIDABLE_PARAMETER_KEYS }).primaryKey(),
    value: jsonb('value').notNull(),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [
    check(
      'parameter_overrides_parameter_key_check',
      oneOf(table.parameterKey, OVERRIDABLE_PARAMETER_KEYS),
    ),
  ],
);

/**
 * Every parameter change with its old and new values, kept beyond the journal's
 * retention so that the last change that affects calculations stays known
 * (TRV-35, SEN-37, IHM-51, CL-IHM-12).
 */
export const parameterChanges = pgTable(
  'parameter_changes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    parameterKey: text('parameter_key').notNull(),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    oldValue: jsonb('old_value').notNull(),
    newValue: jsonb('new_value').notNull(),
    affectsCalculations: boolean('affects_calculations').notNull(),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('parameter_changes_calculation_idx')
      .on(table.changedAt)
      .where(sql`${table.affectsCalculations}`),
  ],
);

/**
 * The values a result was computed with: every parameter that affects
 * calculations, stored once per distinct set (SEN-36, TRV-35).
 */
export const parameterSnapshots = pgTable('parameter_snapshots', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  capturedAt: timestamptz('captured_at').notNull().defaultNow(),
  values: jsonb('values').notNull(),
  valuesHash: text('values_hash').notNull().unique(),
});

/**
 * The interface settings that are not parameters, one row (`id = 1`): the
 * getting-started guide and the in-progress banner (IHM-20, IHM-40, IHM-53).
 */
export const uiState = pgTable(
  'ui_state',
  {
    id: smallint('id').primaryKey().default(1),
    onboardingGuideHidden: boolean('onboarding_guide_hidden').notNull().default(false),
    firstProfileViewedAt: timestamptz('first_profile_viewed_at'),
    inProgressBannerHiddenAt: timestamptz('in_progress_banner_hidden_at'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (table) => [check('ui_state_id_check', sql`${table.id} = 1`)],
);

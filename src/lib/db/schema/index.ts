// Every table of the database, one schema file per module that owns tables
// (src/lib/db/schema/<owning-module>.ts). drizzle-kit generates the migrations
// from this file, and src/lib/db/index.ts re-exports each table by name.
export { installation, sequenceCounters } from './db';

// The machinery tables (operations.md).
export { accounts, loginFailures, sessions } from './auth';
export { backups, exportDownloads, restoreReportEvents, restoreReports } from './backups';
export { drafts } from './drafts';
export { incidents } from './incidents';
export { journalEntries, journalTechnicalDetails } from './journal';
export { outboxFacts } from './outbox';
export {
  OVERRIDABLE_PARAMETER_KEYS,
  parameterChanges,
  parameterOverrides,
  parameterSnapshots,
  uiState,
} from './params';
export { databaseActivityMinutes, databaseSizeSamples, quotaHolds, quotaUsage } from './quotas';
export { schedulerLease, taskRuns } from './scheduler';

// The players, games and event-type tables (players.md, games-and-statistics.md,
// event-types.md).
export {
  followedPlayers,
  playerNameVariants,
  playerStatusChanges,
  playerTeamChanges,
} from './players';
export {
  games,
  playerDirectoryEntries,
  playerDirectoryTeams,
  seasons,
  series,
  teamSeasons,
  teams,
  teamSourceRefs,
} from './games';
export { fetchQueueItems, statsSourceVersions } from './games-fetch';
export {
  boxScores,
  mappingCandidates,
  playerIndicators,
  statCorrections,
  statsSourceMappings,
} from './games-followed-players';
export { eventTypes, eventTypeStatusChanges } from './taxonomy';
export {
  typeIllustrationSources,
  typeOccurrences,
  typeSheetChanges,
  typeSheetVersions,
} from './taxonomy-sheets';

// The events, backtest, import and sensitivity tables (events-and-cases.md,
// backtest-and-import.md, sensitivity-and-profiles.md, sensitive-data.md).
export { events } from './events';
export {
  eventCorrections,
  eventImportWarnings,
  eventMarks,
  eventSources,
  eventStatusChanges,
} from './events-children';
export {
  deletedPlayerEntries,
  tallyExits,
  withdrawalFingerprints,
  withdrawnEventCounter,
} from './events-ledger';
export {
  backtestCoveragePeriods,
  backtestRequests,
  backtestRequestTypes,
  imports,
} from './backtests';
export { backtestRequestEvents } from './backtests-events';
export { importEventOutcomes, importPossibleDuplicates } from './imports';
export { cases } from './sensitivity';
export {
  caseHistoryEntries,
  caseManualDecisions,
  caseReviewFlags,
  caseTriggeredCriteria,
} from './sensitivity-case-children';
export { generalTrends, recalculationJobs, sensitivityProfiles } from './sensitivity-profiles';
export { profileValueVersions, verdictHistoryEntries } from './sensitivity-history';
export { calendarDerivationRequests } from './calendar-events';

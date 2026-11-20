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
export { databaseActivityMinutes, databaseSizeSamples, quotaUsage } from './quotas';
export { schedulerLease, taskRuns } from './scheduler';

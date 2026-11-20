import { getTableName } from 'drizzle-orm';
import { integer, pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { isOutsideArchive, outsideArchive } from './archive';
import { accounts, loginFailures, sessions } from './auth';
import { backups, exportDownloads, restoreReportEvents, restoreReports } from './backups';
import { installation, sequenceCounters } from './db';
import { drafts } from './drafts';
import { incidents } from './incidents';
import { journalEntries, journalTechnicalDetails } from './journal';
import { outboxFacts } from './outbox';
import { parameterChanges, parameterOverrides, parameterSnapshots, uiState } from './params';
import { databaseActivityMinutes, databaseSizeSamples, quotaUsage } from './quotas';
import { schedulerLease, taskRuns } from './scheduler';

// The tables of the db module and of the machinery (operations.md).
const CORE_TABLES = [
  installation,
  sequenceCounters,
  parameterOverrides,
  parameterChanges,
  parameterSnapshots,
  uiState,
  journalEntries,
  journalTechnicalDetails,
  outboxFacts,
  incidents,
  quotaUsage,
  databaseActivityMinutes,
  databaseSizeSamples,
  taskRuns,
  schedulerLease,
  accounts,
  sessions,
  loginFailures,
  drafts,
  backups,
  exportDownloads,
  restoreReports,
  restoreReportEvents,
];

describe('the tables kept out of the archive', () => {
  it('[CL-TRV-05] are the account, its sessions and login failures, and the drafts', () => {
    const keptOut = CORE_TABLES.filter((table) => isOutsideArchive(table));

    expect(keptOut.map((table) => getTableName(table))).toStrictEqual([
      'accounts',
      'sessions',
      'login_failures',
      'drafts',
    ]);
  });

  it('are marked by their definition, which keeps its table', () => {
    const table = pgTable('probes', { id: integer('id').primaryKey() });

    expect(isOutsideArchive(table)).toBe(false);
    expect(outsideArchive(table)).toBe(table);
    expect(isOutsideArchive(table)).toBe(true);
  });
});

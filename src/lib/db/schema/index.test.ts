import { asc, getTableName, inArray, is } from 'drizzle-orm';
import {
  date,
  getTableConfig,
  integer,
  pgSchema,
  PgTable,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { describe, expect, it, onTestFinished } from 'vitest';

import * as schema from '.';
import { createTestDatabase } from '../test-database';

type Column = Readonly<{ table: string; name: string; type: string }>;

// Every table of the schema, whichever task or lot added it, among its other exports.
const EXPORTS: readonly unknown[] = Object.values(schema);
const TABLES = EXPORTS.filter((value): value is PgTable => is(value, PgTable));

// The type of an instant, at any precision.
const TIMESTAMPTZ = /^timestamp(?: \(\d\))? with time zone$/u;

// The view of the catalog that lists every index with its definition.
const pgIndexes = pgSchema('pg_catalog').table('pg_indexes', {
  tableName: text('tablename'),
  indexName: text('indexname'),
  definition: text('indexdef'),
});

// The machinery tables of operations.md, installation and sequence_counters aside.
const MACHINERY_TABLES = [
  'accounts',
  'backups',
  'database_activity_minutes',
  'database_size_samples',
  'drafts',
  'export_downloads',
  'incidents',
  'journal_entries',
  'journal_technical_details',
  'login_failures',
  'outbox_facts',
  'parameter_changes',
  'parameter_overrides',
  'parameter_snapshots',
  'quota_usage',
  'restore_report_events',
  'restore_reports',
  'scheduler_lease',
  'sessions',
  'task_runs',
  'ui_state',
];

// Their indexes, primary keys and unique constraints included, as operations.md lists
// them, in the words of the catalog.
const MACHINERY_INDEXES = [
  'CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (id)',
  'CREATE UNIQUE INDEX backups_pkey ON public.backups USING btree (id)',
  "CREATE INDEX backups_stored_idx ON public.backups USING btree (started_at) WHERE ((status = 'done'::text) AND (deleted_at IS NULL))",
  'CREATE UNIQUE INDEX database_activity_minutes_minute_at_instance_id_pk ON public.database_activity_minutes USING btree (minute_at, instance_id)',
  'CREATE UNIQUE INDEX database_size_samples_pkey ON public.database_size_samples USING btree (sampled_on)',
  "CREATE UNIQUE INDEX drafts_exploration_key ON public.drafts USING btree (COALESCE(exploration_event_type_id, ''::text)) WHERE (kind = 'exploration_response'::text)",
  "CREATE UNIQUE INDEX drafts_import_key ON public.drafts USING btree (backtest_request_id) WHERE (kind = 'research_result'::text)",
  'CREATE UNIQUE INDEX drafts_pkey ON public.drafts USING btree (id)',
  'CREATE UNIQUE INDEX export_downloads_pkey ON public.export_downloads USING btree (id)',
  "CREATE UNIQUE INDEX incidents_open_cause_key ON public.incidents USING btree (kind, cause_key) WHERE (status = 'open'::text)",
  'CREATE UNIQUE INDEX incidents_pkey ON public.incidents USING btree (id)',
  'CREATE INDEX incidents_status_idx ON public.incidents USING btree (status, opened_at)',
  'CREATE INDEX journal_entries_category_idx ON public.journal_entries USING btree (category, occurred_at)',
  'CREATE INDEX journal_entries_event_idx ON public.journal_entries USING btree (player_event_id)',
  'CREATE INDEX journal_entries_incident_idx ON public.journal_entries USING btree (incident_id)',
  'CREATE INDEX journal_entries_occurred_idx ON public.journal_entries USING btree (occurred_at)',
  'CREATE UNIQUE INDEX journal_entries_pkey ON public.journal_entries USING btree (id)',
  'CREATE INDEX journal_entries_player_idx ON public.journal_entries USING btree (player_id)',
  'CREATE UNIQUE INDEX journal_technical_details_pkey ON public.journal_technical_details USING btree (journal_entry_id)',
  'CREATE INDEX login_failures_occurred_idx ON public.login_failures USING btree (occurred_at)',
  'CREATE UNIQUE INDEX login_failures_pkey ON public.login_failures USING btree (id)',
  'CREATE UNIQUE INDEX outbox_facts_fact_key ON public.outbox_facts USING btree (kind, backtest_request_id, deadline_game_id, player_event_id, event_type_id, incident_id, lot2_subject_id) NULLS NOT DISTINCT',
  'CREATE INDEX outbox_facts_pending_idx ON public.outbox_facts USING btree (pass_id, created_at) WHERE (consumed_at IS NULL)',
  'CREATE UNIQUE INDEX outbox_facts_pkey ON public.outbox_facts USING btree (id)',
  'CREATE INDEX parameter_changes_calculation_idx ON public.parameter_changes USING btree (changed_at) WHERE affects_calculations',
  'CREATE UNIQUE INDEX parameter_changes_pkey ON public.parameter_changes USING btree (id)',
  'CREATE UNIQUE INDEX parameter_overrides_pkey ON public.parameter_overrides USING btree (parameter_key)',
  'CREATE UNIQUE INDEX parameter_snapshots_pkey ON public.parameter_snapshots USING btree (id)',
  'CREATE UNIQUE INDEX parameter_snapshots_values_hash_unique ON public.parameter_snapshots USING btree (values_hash)',
  'CREATE UNIQUE INDEX quota_usage_key ON public.quota_usage USING btree (limit_key, period_start_at)',
  'CREATE UNIQUE INDEX quota_usage_pkey ON public.quota_usage USING btree (id)',
  'CREATE UNIQUE INDEX restore_report_events_restore_report_id_player_event_id_pk ON public.restore_report_events USING btree (restore_report_id, player_event_id)',
  'CREATE UNIQUE INDEX restore_reports_pkey ON public.restore_reports USING btree (id)',
  'CREATE UNIQUE INDEX scheduler_lease_pkey ON public.scheduler_lease USING btree (id)',
  'CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (id)',
  'CREATE UNIQUE INDEX sessions_token_hash_unique ON public.sessions USING btree (token_hash)',
  "CREATE INDEX task_runs_day_idx ON public.task_runs USING btree (competition_day_on) WHERE (task_key = 'statistics-update'::text)",
  'CREATE UNIQUE INDEX task_runs_one_requested_key ON public.task_runs USING btree (task_key) WHERE (started_at IS NULL)',
  'CREATE UNIQUE INDEX task_runs_one_running_key ON public.task_runs USING btree (task_key) WHERE ((started_at IS NOT NULL) AND (result IS NULL))',
  'CREATE INDEX task_runs_pass_idx ON public.task_runs USING btree (pass_id)',
  'CREATE UNIQUE INDEX task_runs_pkey ON public.task_runs USING btree (id)',
  'CREATE INDEX task_runs_task_due_idx ON public.task_runs USING btree (task_key, due_at)',
  'CREATE INDEX task_runs_task_started_idx ON public.task_runs USING btree (task_key, started_at)',
  'CREATE UNIQUE INDEX ui_state_pkey ON public.ui_state USING btree (id)',
];

/** Every column of `tables`, with its table and its SQL type. */
function columnsOf(tables: readonly PgTable[]): Column[] {
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns.map((column) => ({
      table: config.name,
      name: column.name,
      type: column.getSQLType(),
    }));
  });
}

// The names that the data model gives to the column of an instant and to that of a
// calendar date (glossary, section 2, "Time").
const hasInstantName = (column: Column): boolean =>
  column.name.endsWith('_at') || column.name.endsWith('_until');
const hasDateName = (column: Column): boolean => column.name.endsWith('_on');

/** Whether `column` holds an instant or a calendar date, as its name or its type says. */
const isTimeColumn = (column: Column): boolean =>
  hasInstantName(column) ||
  hasDateName(column) ||
  column.type.startsWith('timestamp') ||
  column.type === 'date';

/** Whether `column` stores what it holds: a calendar date as date, an instant as timestamptz. */
const isStoredAsItHolds = (column: Column): boolean =>
  hasDateName(column)
    ? column.type === 'date'
    : !(hasInstantName(column) || column.type.startsWith('timestamp')) ||
      TIMESTAMPTZ.test(column.type);

/** The columns of `tables` that hold an instant or a calendar date, as `table.column type`. */
function timeColumns(tables: readonly PgTable[]): string[] {
  return columnsOf(tables)
    .filter((column) => isTimeColumn(column))
    .map((column) => `${column.table}.${column.name} ${column.type}`);
}

/** The columns of `tables` that store an instant or a calendar date in another type. */
function misTypedTimes(tables: readonly PgTable[]): string[] {
  return columnsOf(tables)
    .filter((column) => isTimeColumn(column) && !isStoredAsItHolds(column))
    .map((column) => `${column.table}.${column.name} ${column.type}`);
}

/**
 * Each foreign key of `tables`, as `table.column → table on delete rule`; a key that
 * states no rule gets Postgres's default, `no action`, which the data model never uses.
 */
function foreignKeysOf(tables: readonly PgTable[]): string[] {
  return tables.flatMap((table) => {
    const { name, foreignKeys } = getTableConfig(table);
    return foreignKeys.map((foreignKey) => {
      const { columns, foreignTable } = foreignKey.reference();
      const from = columns.map((column) => column.name).join(', ');
      return `${name}.${from} → ${getTableName(foreignTable)} on delete ${foreignKey.onDelete ?? 'no action'}`;
    });
  });
}

describe('the schema', () => {
  it('[TRV-68] stores every instant as timestamptz and every calendar date as date', () => {
    expect(misTypedTimes(TABLES)).toStrictEqual([]);
    expect(timeColumns(TABLES)).toStrictEqual(
      expect.arrayContaining([
        'task_runs.due_at timestamp with time zone',
        'accounts.login_locked_until timestamp with time zone',
        'task_runs.competition_day_on date',
        'database_size_samples.sampled_on date',
      ]),
    );
  });

  it('[TRV-68] reports a column that stores an instant without its zone, or a date otherwise', () => {
    const probes = pgTable('probes', {
      tipOffAt: timestamp('tip_off_at'),
      startedAt: date('started_at'),
      lockedUntil: text('locked_until'),
      playedOn: timestamp('played_on', { withTimezone: true }),
      noted: timestamp('noted'),
      seenAt: timestamp('seen_at', { withTimezone: true, precision: 3 }),
      bornOn: date('born_on'),
      capDay: date('cap_day'),
      count: integer('count'),
    });

    expect(misTypedTimes([probes])).toStrictEqual([
      'probes.tip_off_at timestamp',
      'probes.started_at date',
      'probes.locked_until text',
      'probes.played_on timestamp with time zone',
      'probes.noted timestamp',
    ]);
  });

  it('states the ON DELETE rule of every foreign key', () => {
    const foreignKeys = foreignKeysOf(TABLES);

    expect(foreignKeys.filter((foreignKey) => foreignKey.endsWith('no action'))).toStrictEqual([]);
    expect(foreignKeys).toStrictEqual(
      expect.arrayContaining([
        'journal_technical_details.journal_entry_id → journal_entries on delete cascade',
        'task_runs.parent_run_id → task_runs on delete set null',
      ]),
    );
  });

  it('reports a foreign key that states no ON DELETE rule', () => {
    const parents = pgTable('parents', { id: integer('id').primaryKey() });
    const children = pgTable('children', {
      parentId: integer('parent_id').references(() => parents.id),
    });

    expect(foreignKeysOf([children])).toStrictEqual([
      'children.parent_id → parents on delete no action',
    ]);
  });

  it(
    'builds the indexes that the data model gives the machinery tables',
    { timeout: 60_000 },
    async () => {
      const database = await createTestDatabase();
      onTestFinished(database.close);

      const indexes = await database.db
        .select({ definition: pgIndexes.definition })
        .from(pgIndexes)
        .where(inArray(pgIndexes.tableName, MACHINERY_TABLES))
        .orderBy(asc(pgIndexes.indexName));

      expect(indexes.map((index) => index.definition)).toStrictEqual(MACHINERY_INDEXES);
    },
  );
});

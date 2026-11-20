import { and, asc, eq, getTableName, inArray, is, sql } from 'drizzle-orm';
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
// A column as the catalog describes it; an identity column has no default but its generation.
type BuiltColumn = Readonly<{
  table: string;
  name: string;
  type: string;
  nullable: string;
  default: string | null;
  identity: string | null;
}>;

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

// The view of the catalog that describes every column: its place in its table, the
// name of its type, whether it takes a null, and its default or its identity.
const catalogColumns = pgSchema('information_schema').table('columns', {
  tableSchema: text('table_schema').notNull(),
  tableName: text('table_name').notNull(),
  columnName: text('column_name').notNull(),
  ordinalPosition: integer('ordinal_position').notNull(),
  udtName: text('udt_name').notNull(),
  isNullable: text('is_nullable').notNull(),
  columnDefault: text('column_default'),
  identityGeneration: text('identity_generation'),
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

// Their columns, table by table and each table's in the order of operations.md, with the
// type, the null and the default that the model gives each, in the words of SQL: a column
// without NOT NULL takes a null, and the model's `identity` is GENERATED ALWAYS AS IDENTITY.
const MACHINERY_COLUMNS = [
  'accounts.id smallint NOT NULL DEFAULT 1',
  'accounts.password_hash text NOT NULL',
  'accounts.password_status text NOT NULL',
  'accounts.initial_password_fingerprint text NOT NULL',
  'accounts.password_changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'accounts.login_locked_until timestamp with time zone',
  'accounts.all_sessions_ended_at timestamp with time zone',
  'accounts.all_sessions_end_reason text',
  'backups.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'backups.kind text NOT NULL',
  'backups.status text NOT NULL',
  'backups.started_at timestamp with time zone NOT NULL DEFAULT now()',
  'backups.finished_at timestamp with time zone',
  'backups.object_name text',
  'backups.size_bytes bigint',
  'backups.failure_cause text',
  'backups.deleted_at timestamp with time zone',
  'backups.deletion_failed_at timestamp with time zone',
  'database_activity_minutes.minute_at timestamp with time zone NOT NULL',
  'database_activity_minutes.instance_id text NOT NULL',
  'database_size_samples.sampled_on date NOT NULL',
  'database_size_samples.size_bytes bigint NOT NULL',
  'drafts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'drafts.kind text NOT NULL',
  'drafts.backtest_request_id integer',
  'drafts.exploration_event_type_id text',
  'drafts.text text NOT NULL',
  'drafts.updated_at timestamp with time zone NOT NULL DEFAULT now()',
  'drafts.origin_device text NOT NULL',
  'export_downloads.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'export_downloads.kind text NOT NULL',
  'export_downloads.downloaded_at timestamp with time zone NOT NULL DEFAULT now()',
  'incidents.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'incidents.kind text NOT NULL',
  "incidents.cause_key text NOT NULL DEFAULT ''::text",
  'incidents.service_role text',
  "incidents.status text NOT NULL DEFAULT 'open'::text",
  'incidents.opened_at timestamp with time zone NOT NULL DEFAULT now()',
  'incidents.closed_at timestamp with time zone',
  'incidents.hidden_at timestamp with time zone',
  "incidents.quota_causes text[] NOT NULL DEFAULT '{}'::text[]",
  "incidents.details jsonb NOT NULL DEFAULT '{}'::jsonb",
  'journal_entries.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'journal_entries.occurred_at timestamp with time zone NOT NULL DEFAULT now()',
  'journal_entries.category text NOT NULL',
  'journal_entries.level text NOT NULL',
  'journal_entries.message_key text NOT NULL',
  "journal_entries.message_params jsonb NOT NULL DEFAULT '{}'::jsonb",
  'journal_entries.player_id uuid',
  'journal_entries.player_event_id integer',
  'journal_entries.event_type_id text',
  'journal_entries.backtest_request_id integer',
  'journal_entries.import_id integer',
  'journal_entries.case_id integer',
  'journal_entries.incident_id integer',
  'journal_entries.task_run_id integer',
  'journal_entries.lot2_object_kind text',
  'journal_entries.lot2_object_id integer',
  'journal_technical_details.journal_entry_id integer NOT NULL',
  'journal_technical_details.details jsonb NOT NULL',
  'login_failures.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'login_failures.occurred_at timestamp with time zone NOT NULL DEFAULT now()',
  'outbox_facts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'outbox_facts.kind text NOT NULL',
  'outbox_facts.backtest_request_id integer',
  'outbox_facts.deadline_game_id integer',
  'outbox_facts.player_event_id integer',
  'outbox_facts.event_type_id text',
  'outbox_facts.incident_id integer',
  'outbox_facts.lot2_subject_id integer',
  'outbox_facts.pass_id uuid',
  'outbox_facts.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'outbox_facts.consumed_at timestamp with time zone',
  'parameter_changes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'parameter_changes.parameter_key text NOT NULL',
  'parameter_changes.changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'parameter_changes.old_value jsonb NOT NULL',
  'parameter_changes.new_value jsonb NOT NULL',
  'parameter_changes.affects_calculations boolean NOT NULL',
  'parameter_changes.journal_entry_id integer',
  'parameter_overrides.parameter_key text NOT NULL',
  'parameter_overrides.value jsonb NOT NULL',
  'parameter_overrides.changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'parameter_overrides.row_version integer NOT NULL DEFAULT 1',
  'parameter_snapshots.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'parameter_snapshots.captured_at timestamp with time zone NOT NULL DEFAULT now()',
  'parameter_snapshots.values jsonb NOT NULL',
  'parameter_snapshots.values_hash text NOT NULL',
  'quota_usage.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'quota_usage.limit_key text NOT NULL',
  'quota_usage.period_start_at timestamp with time zone NOT NULL',
  'quota_usage.used bigint NOT NULL DEFAULT 0',
  'quota_usage.warning_given_at timestamp with time zone',
  'quota_usage.reached_at timestamp with time zone',
  'quota_usage.resets_at timestamp with time zone',
  'restore_report_events.restore_report_id integer NOT NULL',
  'restore_report_events.player_event_id integer NOT NULL',
  'restore_reports.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'restore_reports.restored_at timestamp with time zone NOT NULL DEFAULT now()',
  'restore_reports.backup_created_at timestamp with time zone NOT NULL',
  'restore_reports.source_kind text NOT NULL',
  'restore_reports.table_counts jsonb NOT NULL',
  'restore_reports.players_deleted_again integer NOT NULL',
  'restore_reports.events_withdrawn_again integer NOT NULL',
  'restore_reports.ledger_carried_over boolean NOT NULL',
  'restore_reports.older_than_horizon boolean NOT NULL',
  'restore_reports.consistency_check_passed boolean NOT NULL',
  'scheduler_lease.id smallint NOT NULL',
  'scheduler_lease.pass_id uuid',
  'scheduler_lease.expires_at timestamp with time zone',
  'sessions.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'sessions.token_hash bytea NOT NULL',
  'sessions.device text NOT NULL',
  'sessions.opened_at timestamp with time zone NOT NULL DEFAULT now()',
  'sessions.last_used_at timestamp with time zone NOT NULL DEFAULT now()',
  'sessions.expires_at timestamp with time zone NOT NULL',
  'sessions.ended_at timestamp with time zone',
  'sessions.end_reason text',
  'task_runs.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'task_runs.task_key text NOT NULL',
  'task_runs.trigger text NOT NULL',
  'task_runs.due_at timestamp with time zone NOT NULL',
  'task_runs.started_at timestamp with time zone',
  'task_runs.progress_at timestamp with time zone',
  'task_runs.finished_at timestamp with time zone',
  'task_runs.result text',
  'task_runs.parent_run_id integer',
  'task_runs.pass_id uuid',
  'task_runs.competition_day_on date',
  'task_runs.probe_count smallint',
  'task_runs.last_refresh_seen_at timestamp with time zone',
  'task_runs.cursor text',
  "task_runs.summary jsonb NOT NULL DEFAULT '{}'::jsonb",
  'ui_state.id smallint NOT NULL DEFAULT 1',
  'ui_state.onboarding_guide_hidden boolean NOT NULL DEFAULT false',
  'ui_state.first_profile_viewed_at timestamp with time zone',
  'ui_state.in_progress_banner_hidden_at timestamp with time zone',
  'ui_state.row_version integer NOT NULL DEFAULT 1',
];

/** `column` in the words of SQL, as MACHINERY_COLUMNS writes the model's columns. */
function definitionOf(column: BuiltColumn): string {
  const nullable = column.nullable === 'NO' ? ' NOT NULL' : '';
  const value = column.default === null ? '' : ` DEFAULT ${column.default}`;
  const identity = column.identity === null ? '' : ` GENERATED ${column.identity} AS IDENTITY`;
  return `${column.table}.${column.name} ${column.type}${nullable}${value}${identity}`;
}

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

  it(
    'builds the columns that the data model gives the machinery tables, each with its type, its null and its default',
    { timeout: 60_000 },
    async () => {
      const database = await createTestDatabase();
      onTestFinished(database.close);

      const built = await database.db
        .select({
          table: catalogColumns.tableName,
          name: catalogColumns.columnName,
          // The name SQL gives the type: text[] for the array that the view calls ARRAY.
          type: sql<string>`${catalogColumns.udtName}::regtype::text`,
          nullable: catalogColumns.isNullable,
          default: catalogColumns.columnDefault,
          identity: catalogColumns.identityGeneration,
        })
        .from(catalogColumns)
        .where(
          and(
            eq(catalogColumns.tableSchema, 'public'),
            inArray(catalogColumns.tableName, MACHINERY_TABLES),
          ),
        )
        .orderBy(asc(catalogColumns.tableName), asc(catalogColumns.ordinalPosition));

      expect(built.map((column) => definitionOf(column))).toStrictEqual(MACHINERY_COLUMNS);
    },
  );
});

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import {
  backtestCoveragePeriods,
  backtestRequests,
  backtestRequestTypes,
  imports,
} from './backtests';
import { followedPlayers } from './players';

import type { Database } from '../types';

// The tables of backtest-and-import.md that hold a request, its types, its imports and
// the coverage they bring.
const TABLES = [
  'backtest_coverage_periods',
  'backtest_request_types',
  'backtest_requests',
  'imports',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'backtest_coverage_periods.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'backtest_coverage_periods.player_id uuid NOT NULL',
  'backtest_coverage_periods.event_type_id text NOT NULL',
  'backtest_coverage_periods.start_on date NOT NULL',
  'backtest_coverage_periods.end_on date NOT NULL',
  'backtest_coverage_periods.sheet_version_number smallint NOT NULL',
  'backtest_coverage_periods.origin text NOT NULL',
  'backtest_coverage_periods.import_id integer',
  'backtest_coverage_periods.recorded_at timestamp with time zone NOT NULL DEFAULT now()',
  'backtest_request_types.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'backtest_request_types.backtest_request_id integer NOT NULL',
  'backtest_request_types.event_type_id text NOT NULL',
  'backtest_request_types.sheet_version_number smallint NOT NULL',
  'backtest_request_types.period_start_on date',
  'backtest_request_types.period_end_on date NOT NULL',
  'backtest_request_types.is_requested boolean NOT NULL DEFAULT true',
  'backtest_requests.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'backtest_requests.reference text NOT NULL',
  'backtest_requests.player_id uuid NOT NULL',
  'backtest_requests.kind text NOT NULL',
  'backtest_requests.trigger text NOT NULL',
  'backtest_requests.trigger_event_type_id text',
  'backtest_requests.trigger_import_id integer',
  "backtest_requests.status text NOT NULL DEFAULT 'to_do'::text",
  'backtest_requests.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'backtest_requests.created_on date NOT NULL',
  'backtest_requests.imported_at timestamp with time zone',
  'backtest_requests.canceled_at timestamp with time zone',
  'backtest_requests.cancellation_reason_code text',
  'backtest_requests.cancellation_reason_text text',
  'backtest_requests.prompt_text text NOT NULL',
  'backtest_requests.prompt_produced_at timestamp with time zone NOT NULL',
  'backtest_requests.last_copied_at timestamp with time zone',
  'backtest_requests.row_version integer NOT NULL DEFAULT 1',
  'imports.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'imports.sequence_number integer NOT NULL',
  'imports.backtest_request_id integer NOT NULL',
  'imports.player_id uuid NOT NULL',
  'imports.imported_at timestamp with time zone NOT NULL DEFAULT now()',
  'imports.mode text NOT NULL',
  "imports.format_version text NOT NULL DEFAULT '1.0'::text",
  'imports.truncation_recovered boolean NOT NULL DEFAULT false',
  "imports.declared_limitations text[] NOT NULL DEFAULT '{}'::text[]",
  "imports.unverified_lead_counts jsonb NOT NULL DEFAULT '{}'::jsonb",
  "imports.result_warnings jsonb NOT NULL DEFAULT '[]'::jsonb",
  "imports.coverage_gaps jsonb NOT NULL DEFAULT '[]'::jsonb",
  'imports.deleted_by_replacement_count integer NOT NULL DEFAULT 0',
  'imports.deleted_corrected_count integer NOT NULL DEFAULT 0',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX backtest_coverage_periods_pkey ON public.backtest_coverage_periods USING btree (id)',
  'CREATE INDEX backtest_coverage_periods_player_type_idx ON public.backtest_coverage_periods USING btree (player_id, event_type_id, start_on)',
  'CREATE UNIQUE INDEX backtest_request_types_key ON public.backtest_request_types USING btree (backtest_request_id, event_type_id)',
  'CREATE UNIQUE INDEX backtest_request_types_pkey ON public.backtest_request_types USING btree (id)',
  "CREATE INDEX backtest_requests_copied_idx ON public.backtest_requests USING btree (last_copied_at) WHERE (status = 'to_do'::text)",
  "CREATE UNIQUE INDEX backtest_requests_one_to_do_key ON public.backtest_requests USING btree (player_id) WHERE (status = 'to_do'::text)",
  'CREATE UNIQUE INDEX backtest_requests_pkey ON public.backtest_requests USING btree (id)',
  'CREATE INDEX backtest_requests_player_idx ON public.backtest_requests USING btree (player_id, created_at)',
  'CREATE UNIQUE INDEX backtest_requests_reference_key ON public.backtest_requests USING btree (reference)',
  "CREATE INDEX backtest_requests_to_do_idx ON public.backtest_requests USING btree (created_at) WHERE (status = 'to_do'::text)",
  'CREATE UNIQUE INDEX imports_pkey ON public.imports USING btree (id)',
  'CREATE INDEX imports_player_idx ON public.imports USING btree (player_id, imported_at)',
  'CREATE INDEX imports_request_idx ON public.imports USING btree (backtest_request_id, imported_at)',
  'CREATE UNIQUE INDEX imports_sequence_number_key ON public.imports USING btree (sequence_number)',
];

// Their references, each with the ON DELETE rule of the model: all go with the player.
const FOREIGN_KEYS = [
  'backtest_coverage_periods FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'backtest_coverage_periods FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE',
  'backtest_coverage_periods FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'backtest_request_types FOREIGN KEY (backtest_request_id) REFERENCES backtest_requests(id) ON DELETE CASCADE',
  'backtest_request_types FOREIGN KEY (event_type_id, sheet_version_number) REFERENCES type_sheet_versions(event_type_id, version_number) ON DELETE RESTRICT',
  'backtest_requests FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'backtest_requests FOREIGN KEY (trigger_event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'backtest_requests FOREIGN KEY (trigger_import_id) REFERENCES imports(id) ON DELETE SET NULL',
  'imports FOREIGN KEY (backtest_request_id) REFERENCES backtest_requests(id) ON DELETE CASCADE',
  'imports FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
];

// 10:00 UTC on 2 November 2026, when the prompt was produced; a day later.
const PRODUCED_AT = new Date(toEpochMs(Date.UTC(2026, 10, 2, 10)));
const NEXT_DAY = new Date(toEpochMs(Date.UTC(2026, 10, 3, 10)));
// A manual request for the other player, whose prompt was produced.
const REQUEST = {
  reference: 'REQ-2026-0002',
  playerId: PARENTS.otherPlayerId,
  kind: 'initial',
  trigger: 'manual_action',
  createdOn: '2026-11-02',
  promptText: 'Research the public events of the player.',
  promptProducedAt: PRODUCED_AT,
} as const;
const CANCELED = { ...REQUEST, status: 'canceled', canceledAt: NEXT_DAY } as const;
// The media storm in the parent request, from his first NBA game to its creation day.
const REQUEST_TYPE = {
  backtestRequestId: PARENTS.requestId,
  eventTypeId: 'media-storm',
  sheetVersionNumber: 1,
  periodEndOn: '2026-11-02',
} as const;
// A period that the parent import covered for the media storm.
const PERIOD = {
  playerId: PARENTS.playerId,
  eventTypeId: 'media-storm',
  startOn: '2019-10-23',
  endOn: '2026-11-02',
  sheetVersionNumber: 1,
  origin: 'import',
  importId: PARENTS.importId,
} as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the backtest request and import tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that backtest-and-import.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[BKT-13] [BKT-14] stores each kind, trigger and status of a request, a canceled one imported later included', async () => {
    // A supplement comes of a detection, of a type validated, reactivated or broadened, or
    // of an incomplete import of the player's, a full redo of the owner's action (BKT-04
    // to BKT-06, BKT-09).
    const supplement = { ...CANCELED, kind: 'supplement' } as const;
    await db
      .update(backtestRequests)
      .set({ status: 'canceled', canceledAt: PRODUCED_AT })
      .where(eq(backtestRequests.id, PARENTS.requestId));
    await db.insert(backtestRequests).values([
      { ...REQUEST, kind: 'supplement', trigger: 'detection' },
      {
        ...supplement,
        reference: 'REQ-2026-0003',
        trigger: 'type_validated',
        triggerEventTypeId: 'media-storm',
      },
      {
        ...supplement,
        reference: 'REQ-2026-0004',
        trigger: 'type_reactivated',
        triggerEventTypeId: 'bereavement',
        cancellationReasonCode: 'player_withdrawn',
      },
      {
        ...supplement,
        reference: 'REQ-2026-0005',
        trigger: 'type_broadened',
        triggerEventTypeId: 'media-storm',
        cancellationReasonText: 'Done elsewhere.',
      },
      {
        ...supplement,
        reference: 'REQ-2027-12345',
        playerId: PARENTS.playerId,
        trigger: 'incomplete_import',
        triggerImportId: PARENTS.importId,
        status: 'imported',
        importedAt: NEXT_DAY,
      },
      { ...CANCELED, reference: 'REQ-2026-0006', kind: 'full_redo' },
    ]);

    const [created] = await db
      .select()
      .from(backtestRequests)
      .where(eq(backtestRequests.reference, REQUEST.reference));

    expect(created).toMatchObject({
      ...REQUEST,
      kind: 'supplement',
      trigger: 'detection',
      status: 'to_do',
      rowVersion: 1,
      lastCopiedAt: null,
    });
    await expect(db.$count(backtestRequests)).resolves.toBe(7);
  });

  it.each(['REQ-26-0001', 'REQ-2026-001', 'req-2026-0001', 'REQ-2026-0001 ', 'REQ-2026'])(
    '[BKT-12] [CL-BKT-11] refuses the reference "%s"',
    async (reference) => {
      const insert = db.insert(backtestRequests).values({ ...REQUEST, reference });

      await expect(insert).rejects.toMatchObject(violationOf('backtest_requests_reference_check'));
    },
  );

  it('[BKT-07] [BKT-12] keeps one request to do per player, and never issues a reference twice', async () => {
    await db.insert(backtestRequests).values(REQUEST);

    const secondToDo = db
      .insert(backtestRequests)
      .values({ ...REQUEST, reference: 'REQ-2026-0003' });
    const sameReference = db
      .insert(backtestRequests)
      .values({ ...CANCELED, playerId: PARENTS.playerId, reference: REQUEST.reference });
    await db.insert(backtestRequests).values({ ...CANCELED, reference: 'REQ-2026-0004' });

    await expect(secondToDo).rejects.toMatchObject(duplicateOf('backtest_requests_one_to_do_key'));
    await expect(sameReference).rejects.toMatchObject(
      duplicateOf('backtest_requests_reference_key'),
    );
    await expect(db.$count(backtestRequests)).resolves.toBe(3);
  });

  it.each([
    ['of a kind the glossary does not list', { kind: OUTSIDE }, 'kind'],
    ['of a trigger the glossary does not list', { trigger: OUTSIDE }, 'trigger'],
    ['of a status the glossary does not list', { status: OUTSIDE }, 'status'],
    [
      'canceled for a reason the glossary does not list',
      { ...CANCELED, cancellationReasonCode: OUTSIDE },
      'cancellation_reason_code',
    ],
    ['imported without its instant', { status: 'imported' }, 'imported'],
    ['to do with an import instant', { importedAt: NEXT_DAY }, 'imported'],
    ['canceled without its instant', { status: 'canceled' }, 'canceled'],
    [
      'with a reason code but not canceled',
      { cancellationReasonCode: 'player_withdrawn' },
      'cancellation_reason',
    ],
    [
      'with a reason text but not canceled',
      { cancellationReasonText: 'Done elsewhere.' },
      'cancellation_reason',
    ],
    ['born of a validation without its type', { trigger: 'type_validated' }, 'trigger_type'],
    ['asked by the owner naming a type', { triggerEventTypeId: 'media-storm' }, 'trigger_type'],
    [
      'naming an import it does not stem from',
      { triggerImportId: PARENTS.importId },
      'trigger_import',
    ],
  ] as const)('[BKT-13] [BKT-14] refuses a request %s', async (_case, change, check) => {
    const insert = db.insert(backtestRequests).values({ ...REQUEST, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`backtest_requests_${check}_check`));
  });

  it('[CL-BKT-07] plans each type once per request, under an existing sheet version and a period', async () => {
    await db.insert(backtestRequestTypes).values([
      REQUEST_TYPE,
      {
        ...REQUEST_TYPE,
        eventTypeId: 'bereavement',
        periodStartOn: '2026-11-02',
        isRequested: false,
      },
    ]);

    const twice = db.insert(backtestRequestTypes).values(REQUEST_TYPE);
    const unknownVersion = db
      .insert(backtestRequestTypes)
      .values({ ...REQUEST_TYPE, eventTypeId: 'birthday', sheetVersionNumber: 2 });
    const reversed = db
      .insert(backtestRequestTypes)
      .values({ ...REQUEST_TYPE, eventTypeId: 'birthday', periodStartOn: '2026-11-03' });

    await expect(
      db
        .select({ requested: backtestRequestTypes.isRequested })
        .from(backtestRequestTypes)
        .orderBy(backtestRequestTypes.id),
    ).resolves.toStrictEqual([{ requested: true }, { requested: false }]);
    await expect(twice).rejects.toMatchObject(duplicateOf('backtest_request_types_key'));
    await expect(unknownVersion).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'backtest_request_types_sheet_version_fk' },
    });
    await expect(reversed).rejects.toMatchObject(
      violationOf('backtest_request_types_period_check'),
    );
  });

  it('[BKT-10] [CL-BKT-06] keeps the periods an import covered, and those a merge or a split carried over', async () => {
    await db.insert(backtestCoveragePeriods).values([
      PERIOD,
      { ...PERIOD, origin: 'merge', importId: null },
      {
        ...PERIOD,
        origin: 'split',
        importId: null,
        sheetVersionNumber: 0,
        startOn: '2026-11-02',
      },
    ]);

    await expect(
      db
        .select({ origin: backtestCoveragePeriods.origin })
        .from(backtestCoveragePeriods)
        .orderBy(backtestCoveragePeriods.id),
    ).resolves.toStrictEqual([{ origin: 'import' }, { origin: 'merge' }, { origin: 'split' }]);
  });

  it.each([
    ['that ends before it starts', { endOn: '2019-10-22' }, 'period'],
    ['under a negative version', { sheetVersionNumber: -1 }, 'sheet_version_number'],
    ['of an origin the model does not list', { origin: OUTSIDE, importId: null }, 'origin'],
    ['of an import that names none', { importId: null }, 'import'],
    ['of a merge that names an import', { origin: 'merge' }, 'import'],
  ] as const)('[BKT-10] [CL-BKT-06] refuses a covered period %s', async (_case, change, check) => {
    const insert = db.insert(backtestCoveragePeriods).values({ ...PERIOD, ...change });

    await expect(insert).rejects.toMatchObject(
      violationOf(`backtest_coverage_periods_${check}_check`),
    );
  });

  it('[IMP-31] [IMP-06] numbers each import once, of a listed mode and of format 1.0, with the defaults of the model', async () => {
    await db.insert(imports).values([
      {
        sequenceNumber: 2,
        backtestRequestId: PARENTS.requestId,
        playerId: PARENTS.playerId,
        mode: 'addition',
      },
      {
        sequenceNumber: 3,
        backtestRequestId: PARENTS.requestId,
        playerId: PARENTS.playerId,
        mode: 'replacement',
      },
    ]);
    const anImport = {
      backtestRequestId: PARENTS.requestId,
      playerId: PARENTS.playerId,
      mode: 'addition',
    } as const;

    const [first] = await db.select().from(imports).where(eq(imports.id, PARENTS.importId));
    const again = db.insert(imports).values({ ...anImport, sequenceNumber: 2 });
    const mode = db.insert(imports).values({ ...anImport, sequenceNumber: 4, mode: OUTSIDE });
    const version = db
      .insert(imports)
      .values({ ...anImport, sequenceNumber: 4, formatVersion: sql`'1.1'` });

    expect(first).toMatchObject({
      formatVersion: '1.0',
      truncationRecovered: false,
      declaredLimitations: [],
      unverifiedLeadCounts: {},
      resultWarnings: [],
      coverageGaps: [],
      deletedByReplacementCount: 0,
      deletedCorrectedCount: 0,
    });
    await expect(again).rejects.toMatchObject(duplicateOf('imports_sequence_number_key'));
    await expect(mode).rejects.toMatchObject(violationOf('imports_mode_check'));
    await expect(version).rejects.toMatchObject(violationOf('imports_format_version_check'));
  });

  it('[CL-JOU-06] deletes with a player his requests, their types, imports and coverage, a supplement keeping its trigger when its import goes', async () => {
    await db.insert(backtestRequests).values({
      ...REQUEST,
      reference: 'REQ-2026-0003',
      playerId: PARENTS.playerId,
      kind: 'supplement',
      status: 'canceled',
      canceledAt: NEXT_DAY,
      trigger: 'incomplete_import',
      triggerImportId: PARENTS.importId,
    });
    await db.insert(backtestRequestTypes).values(REQUEST_TYPE);
    await db.insert(backtestCoveragePeriods).values(PERIOD);

    await db.delete(imports).where(eq(imports.id, PARENTS.importId));
    const supplement = await db
      .select({ trigger: backtestRequests.trigger, importId: backtestRequests.triggerImportId })
      .from(backtestRequests)
      .where(eq(backtestRequests.reference, 'REQ-2026-0003'));
    await db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.otherPlayerId));
    await db.insert(imports).values({
      sequenceNumber: 2,
      backtestRequestId: PARENTS.requestId,
      playerId: PARENTS.playerId,
      mode: 'first_import',
    });

    expect(supplement).toStrictEqual([{ trigger: 'incomplete_import', importId: null }]);
    await expect(db.$count(backtestCoveragePeriods)).resolves.toBe(0);
    await expect(
      Promise.all(
        [backtestRequests, backtestRequestTypes, imports].map(async (table) => db.$count(table)),
      ),
    ).resolves.toStrictEqual([2, 1, 1]);
  });
});

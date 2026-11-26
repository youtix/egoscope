import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { events } from './events';
import { cases } from './sensitivity';
import {
  caseCategoryChanges,
  forecastVersions,
  regroupingExits,
  trackedCaseDecisions,
  trackedCases,
  trackedGameResults,
} from './tracking';

import type { Database } from '../types';

// The tables of tracking-and-validation.md.
const TABLES = [
  'case_category_changes',
  'forecast_versions',
  'regrouping_exits',
  'tracked_case_decisions',
  'tracked_cases',
  'tracked_game_results',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'case_category_changes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'case_category_changes.tracked_case_id integer NOT NULL',
  'case_category_changes.changed_at timestamp with time zone NOT NULL',
  'case_category_changes.category text',
  'case_category_changes.normalized_gap double precision',
  'case_category_changes.gap_status text',
  'forecast_versions.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'forecast_versions.tracked_case_id integer NOT NULL',
  'forecast_versions.effective_at timestamp with time zone NOT NULL',
  'forecast_versions.source text NOT NULL',
  'forecast_versions.level text',
  'forecast_versions.direction text',
  'forecast_versions.announced_mean_gap double precision',
  'forecast_versions.case_count integer',
  'forecast_versions.profile_confidence text',
  'regrouping_exits.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'regrouping_exits.player_event_id integer NOT NULL',
  'regrouping_exits.player_id uuid NOT NULL',
  'regrouping_exits.event_type_id text NOT NULL',
  'regrouping_exits.overall_subrow text',
  'regrouping_exits.gap_in_forecast_direction double precision',
  'tracked_case_decisions.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'tracked_case_decisions.tracked_case_id integer NOT NULL',
  'tracked_case_decisions.kind text NOT NULL',
  'tracked_case_decisions.effect text NOT NULL',
  'tracked_case_decisions.player_event_id integer',
  'tracked_case_decisions.decided_at timestamp with time zone NOT NULL',
  'tracked_cases.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'tracked_cases.case_id integer NOT NULL',
  'tracked_cases.forecast_state text',
  'tracked_cases.forecast_source text',
  'tracked_cases.forecast_level text',
  'tracked_cases.forecast_direction text',
  'tracked_cases.announced_mean_gap double precision',
  'tracked_cases.forecast_case_count integer',
  'tracked_cases.forecast_profile_confidence text',
  'tracked_cases.forecast_frozen_at timestamp with time zone',
  'tracked_cases.awaiting_late_forecast boolean NOT NULL DEFAULT false',
  'tracked_cases.category text',
  'tracked_game_results.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'tracked_game_results.tracked_case_id integer NOT NULL',
  'tracked_game_results.kind text NOT NULL',
  'tracked_game_results.transmitted_at timestamp with time zone NOT NULL',
  'tracked_game_results.content jsonb NOT NULL',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX case_category_changes_case_idx ON public.case_category_changes USING btree (tracked_case_id, changed_at)',
  'CREATE UNIQUE INDEX case_category_changes_pkey ON public.case_category_changes USING btree (id)',
  'CREATE UNIQUE INDEX forecast_versions_pkey ON public.forecast_versions USING btree (id)',
  'CREATE UNIQUE INDEX forecast_versions_uq ON public.forecast_versions USING btree (tracked_case_id, effective_at)',
  'CREATE INDEX regrouping_exits_event_idx ON public.regrouping_exits USING btree (player_event_id)',
  'CREATE INDEX regrouping_exits_pair_idx ON public.regrouping_exits USING btree (player_id, event_type_id)',
  'CREATE UNIQUE INDEX regrouping_exits_pkey ON public.regrouping_exits USING btree (id)',
  'CREATE INDEX tracked_case_decisions_case_idx ON public.tracked_case_decisions USING btree (tracked_case_id, decided_at)',
  'CREATE UNIQUE INDEX tracked_case_decisions_pkey ON public.tracked_case_decisions USING btree (id)',
  'CREATE UNIQUE INDEX tracked_cases_case_uq ON public.tracked_cases USING btree (case_id)',
  'CREATE INDEX tracked_cases_late_idx ON public.tracked_cases USING btree (id) WHERE awaiting_late_forecast',
  'CREATE UNIQUE INDEX tracked_cases_pkey ON public.tracked_cases USING btree (id)',
  'CREATE INDEX tracked_cases_unfrozen_idx ON public.tracked_cases USING btree (id) WHERE (forecast_state IS NULL)',
  'CREATE INDEX tracked_game_results_case_idx ON public.tracked_game_results USING btree (tracked_case_id, transmitted_at)',
  'CREATE UNIQUE INDEX tracked_game_results_pkey ON public.tracked_game_results USING btree (id)',
];

// Their references: each row goes with its tracked case, which goes with its case.
const FOREIGN_KEYS = [
  'case_category_changes FOREIGN KEY (tracked_case_id) REFERENCES tracked_cases(id) ON DELETE CASCADE',
  'forecast_versions FOREIGN KEY (tracked_case_id) REFERENCES tracked_cases(id) ON DELETE CASCADE',
  'regrouping_exits FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'regrouping_exits FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE RESTRICT',
  'regrouping_exits FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE RESTRICT',
  'tracked_case_decisions FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE SET NULL',
  'tracked_case_decisions FOREIGN KEY (tracked_case_id) REFERENCES tracked_cases(id) ON DELETE CASCADE',
  'tracked_cases FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE',
  'tracked_game_results FOREIGN KEY (tracked_case_id) REFERENCES tracked_cases(id) ON DELETE CASCADE',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
const TRACKED_ID = 1;
// A tracked case before tip-off: no forecast chosen yet.
const UNFROZEN = { caseId: PARENTS.caseId } as const;
// The forecast of a player profile, frozen at tip-off.
const FROZEN = {
  caseId: PARENTS.caseId,
  forecastState: 'frozen',
  forecastSource: 'player_profile',
  forecastLevel: 'probable',
  forecastDirection: 'decrease',
  announcedMeanGap: -4.5,
  forecastCaseCount: 12,
  forecastProfileConfidence: 'high',
  forecastFrozenAt: at(23),
} as const;
// A tip-off without a forecast, waiting for a late one.
const NONE = {
  caseId: PARENTS.caseId,
  forecastState: 'none',
  forecastSource: 'none',
  forecastFrozenAt: at(23),
} as const;
const VERSION = {
  trackedCaseId: TRACKED_ID,
  effectiveAt: at(20),
  source: 'general_trend',
  level: 'possible',
  direction: 'increase',
  announcedMeanGap: 2.5,
  caseCount: 6,
  profileConfidence: 'medium',
} as const;
// A version without a forecast, none of whose fields is set.
const NO_VERSION = { trackedCaseId: TRACKED_ID, effectiveAt: at(20), source: 'none' } as const;
const DECISION = {
  trackedCaseId: TRACKED_ID,
  kind: 'event_dismissed',
  effect: 'exit',
  playerEventId: PARENTS.eventId,
  decidedAt: at(22),
} as const;
const EXIT = {
  playerEventId: PARENTS.eventId,
  playerId: PARENTS.playerId,
  eventTypeId: 'media-storm',
  overallSubrow: 'probable_profile',
  gapInForecastDirection: 1.25,
} as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the tracked cases and their history', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that tracking-and-validation.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[SUI-01] [SUI-08] [SUI-22] tracks a case once, its forecast chosen at tip-off and its category given at the end', async () => {
    await db.insert(trackedCases).values(UNFROZEN);
    const again = db.insert(trackedCases).values(UNFROZEN);
    await expect(again).rejects.toMatchObject(duplicateOf('tracked_cases_case_uq'));

    const [tracked] = await db.select().from(trackedCases);
    await db
      .update(trackedCases)
      .set({ ...FROZEN, category: 'confirmed' })
      .where(eq(trackedCases.id, TRACKED_ID));

    expect(tracked).toStrictEqual({
      id: TRACKED_ID,
      caseId: PARENTS.caseId,
      forecastState: null,
      forecastSource: null,
      forecastLevel: null,
      forecastDirection: null,
      announcedMeanGap: null,
      forecastCaseCount: null,
      forecastProfileConfidence: null,
      forecastFrozenAt: null,
      awaitingLateForecast: false,
      category: null,
    });
    await expect(
      db.select({ category: trackedCases.category }).from(trackedCases),
    ).resolves.toStrictEqual([{ category: 'confirmed' }]);
  });

  it.each([
    [
      'a late forecast of the general trend',
      {
        ...FROZEN,
        forecastState: 'late',
        forecastSource: 'general_trend',
        forecastLevel: 'possible',
        forecastDirection: 'increase',
        forecastProfileConfidence: 'low',
        category: 'refuted',
      },
    ],
    [
      'no forecast, waiting for a late one',
      { ...NONE, awaitingLateForecast: true, category: 'no_forecast' },
    ],
    ['a neutral category', { ...FROZEN, forecastProfileConfidence: 'medium', category: 'neutral' }],
  ] as const)(
    '[SUI-08] [SUI-10] [CL-SUI-05] keeps a tracked case with %s',
    async (_case, tracked) => {
      await db.insert(trackedCases).values(tracked);

      await expect(db.$count(trackedCases)).resolves.toBe(1);
    },
  );

  it.each([
    ['a forecast state outside the list', { ...FROZEN, forecastState: OUTSIDE }, 'forecast_state'],
    [
      'a forecast source outside the list',
      { ...NONE, forecastState: 'frozen', forecastSource: OUTSIDE },
      'forecast_source',
    ],
    [
      'a state without its source',
      { caseId: PARENTS.caseId, forecastState: 'late', forecastFrozenAt: at(23) },
      'forecast_chosen',
    ],
    [
      'a source without its state',
      { ...FROZEN, forecastState: null, forecastFrozenAt: null },
      'forecast_chosen',
    ],
    ['no forecast from a profile', { ...FROZEN, forecastState: 'none' }, 'no_forecast'],
    ['a frozen forecast from no source', { ...NONE, forecastState: 'frozen' }, 'no_forecast'],
    ['a level outside the list', { ...FROZEN, forecastLevel: OUTSIDE }, 'forecast_level'],
    [
      'a direction outside the list',
      { ...FROZEN, forecastDirection: OUTSIDE },
      'forecast_direction',
    ],
    ['a forecast of no case', { ...FROZEN, forecastCaseCount: 0 }, 'forecast_case_count'],
    [
      'a confidence outside the list',
      { ...FROZEN, forecastProfileConfidence: OUTSIDE },
      'forecast_profile_confidence',
    ],
    ['a profile forecast without its level', { ...FROZEN, forecastLevel: null }, 'forecast'],
    [
      'a profile forecast without its direction',
      { ...FROZEN, forecastDirection: null },
      'forecast',
    ],
    [
      'a profile forecast without its announced gap',
      { ...FROZEN, announcedMeanGap: null },
      'forecast',
    ],
    [
      'a profile forecast without its case count',
      { ...FROZEN, forecastCaseCount: null },
      'forecast',
    ],
    [
      'a profile forecast without its confidence',
      { ...FROZEN, forecastProfileConfidence: null },
      'forecast',
    ],
    ['no forecast with a level', { ...NONE, forecastLevel: 'possible' }, 'forecast'],
    ['no forecast with a direction', { ...NONE, forecastDirection: 'decrease' }, 'forecast'],
    ['no forecast with an announced gap', { ...NONE, announcedMeanGap: -4.5 }, 'forecast'],
    ['no forecast with a case count', { ...NONE, forecastCaseCount: 12 }, 'forecast'],
    ['no forecast with a confidence', { ...NONE, forecastProfileConfidence: 'high' }, 'forecast'],
    ['a level before any choice', { ...UNFROZEN, forecastLevel: 'possible' }, 'forecast'],
    ['a chosen forecast not yet frozen', { ...FROZEN, forecastFrozenAt: null }, 'forecast_frozen'],
    [
      'a freezing instant before any choice',
      { ...UNFROZEN, forecastFrozenAt: at(23) },
      'forecast_frozen',
    ],
    [
      'a wait for a late forecast after a frozen one',
      { ...FROZEN, awaitingLateForecast: true },
      'awaiting_late_forecast',
    ],
    [
      'a wait for a late forecast before tip-off',
      { ...UNFROZEN, awaitingLateForecast: true },
      'awaiting_late_forecast',
    ],
    ['a category outside the list', { ...FROZEN, category: OUTSIDE }, 'category'],
  ] as const)(
    '[SUI-08] [SUI-09] [SUI-10] [CL-SUI-03] [CL-SUI-05] refuses a tracked case with %s',
    async (_case, tracked, check) => {
      const insert = db.insert(trackedCases).values(tracked);

      await expect(insert).rejects.toMatchObject(violationOf(`tracked_cases_${check}_check`));
    },
  );

  it('[SUI-09] [CL-SUI-03] keeps one forecast version per instant, with or without a forecast', async () => {
    await db.insert(trackedCases).values(UNFROZEN);
    await db.insert(forecastVersions).values([
      VERSION,
      {
        ...VERSION,
        effectiveAt: at(21),
        source: 'player_profile',
        level: 'probable',
        direction: 'decrease',
        profileConfidence: 'high',
      },
      { trackedCaseId: TRACKED_ID, effectiveAt: at(22), source: 'none', profileConfidence: null },
      { ...VERSION, effectiveAt: at(23), profileConfidence: 'low' },
    ]);
    const again = db.insert(forecastVersions).values(VERSION);

    await expect(again).rejects.toMatchObject(duplicateOf('forecast_versions_uq'));
  });

  it.each([
    [
      'a source outside the list',
      { trackedCaseId: TRACKED_ID, effectiveAt: at(20), source: OUTSIDE },
      'source',
    ],
    ['a level outside the list', { ...VERSION, level: OUTSIDE }, 'level'],
    ['a direction outside the list', { ...VERSION, direction: OUTSIDE }, 'direction'],
    [
      'a confidence outside the list',
      { ...VERSION, profileConfidence: OUTSIDE },
      'profile_confidence',
    ],
    ['a forecast without its level', { ...VERSION, level: null }, 'forecast'],
    ['a forecast without its direction', { ...VERSION, direction: null }, 'forecast'],
    ['a forecast without its announced gap', { ...VERSION, announcedMeanGap: null }, 'forecast'],
    ['a forecast without its case count', { ...VERSION, caseCount: null }, 'forecast'],
    ['a forecast without its confidence', { ...VERSION, profileConfidence: null }, 'forecast'],
    ['no forecast with a level', { ...NO_VERSION, level: 'possible' }, 'forecast'],
    ['no forecast with a direction', { ...NO_VERSION, direction: 'increase' }, 'forecast'],
    ['no forecast with an announced gap', { ...NO_VERSION, announcedMeanGap: 2.5 }, 'forecast'],
    ['no forecast with a case count', { ...NO_VERSION, caseCount: 3 }, 'forecast'],
    ['no forecast with a confidence', { ...NO_VERSION, profileConfidence: 'medium' }, 'forecast'],
  ] as const)(
    '[SUI-08] [SUI-09] refuses a forecast version with %s',
    async (_case, version, check) => {
      await db.insert(trackedCases).values(UNFROZEN);

      const insert = db.insert(forecastVersions).values(version);

      await expect(insert).rejects.toMatchObject(violationOf(`forecast_versions_${check}_check`));
    },
  );

  it('[SUI-15] [SUI-19] [SUI-21] [CL-SUI-09] records each category change and transmitted result of a tracked case', async () => {
    await db.insert(trackedCases).values(UNFROZEN);
    await db.insert(caseCategoryChanges).values([
      {
        trackedCaseId: TRACKED_ID,
        changedAt: at(23),
        category: 'confirmed',
        normalizedGap: -1.5,
        gapStatus: 'provisional',
      },
      {
        trackedCaseId: TRACKED_ID,
        changedAt: at(23),
        category: 'refuted',
        normalizedGap: 0.5,
        gapStatus: 'final',
      },
      { trackedCaseId: TRACKED_ID, changedAt: at(23), category: 'neutral' },
      { trackedCaseId: TRACKED_ID, changedAt: at(23), category: 'no_forecast' },
      { trackedCaseId: TRACKED_ID, changedAt: at(23) },
    ]);
    await db.insert(trackedGameResults).values([
      {
        trackedCaseId: TRACKED_ID,
        kind: 'indicative',
        transmittedAt: at(23),
        content: { points: 12 },
      },
      { trackedCaseId: TRACKED_ID, kind: 'final', transmittedAt: at(23), content: { points: 14 } },
    ]);
    const category = db
      .insert(caseCategoryChanges)
      .values({ trackedCaseId: TRACKED_ID, changedAt: at(23), category: OUTSIDE });
    await expect(category).rejects.toMatchObject(
      violationOf('case_category_changes_category_check'),
    );
    const gapStatus = db
      .insert(caseCategoryChanges)
      .values({ trackedCaseId: TRACKED_ID, changedAt: at(23), gapStatus: OUTSIDE });
    await expect(gapStatus).rejects.toMatchObject(
      violationOf('case_category_changes_gap_status_check'),
    );
    const result = db
      .insert(trackedGameResults)
      .values({ trackedCaseId: TRACKED_ID, kind: OUTSIDE, transmittedAt: at(23), content: {} });

    await expect(result).rejects.toMatchObject(violationOf('tracked_game_results_kind_check'));
  });

  it('[SUI-17] [CL-SUI-10] traces each decision on a tracked case, a decision on the case naming no event', async () => {
    const kinds = [
      'event_reinstated',
      'context_corrected',
      'reference_date_corrected',
      'player_corrected',
      'type_corrected',
      'dating_mark_lifted',
    ] as const;
    await db.insert(trackedCases).values(UNFROZEN);
    await db.insert(trackedCaseDecisions).values([
      DECISION,
      ...kinds.map((kind) => ({ ...DECISION, kind, effect: 'entry' }) as const),
      { ...DECISION, kind: 'case_excluded', playerEventId: null },
      {
        ...DECISION,
        kind: 'case_reinstated',
        effect: 'measured_game_change',
        playerEventId: null,
      },
    ]);

    await db.delete(events).where(eq(events.id, PARENTS.eventId));

    await expect(
      db.$count(trackedCaseDecisions, sql`${trackedCaseDecisions.playerEventId} IS NULL`),
    ).resolves.toBe(9);
  });

  it.each([
    ['of a kind outside the list', { ...DECISION, kind: OUTSIDE }, 'kind'],
    ['of an effect outside the list', { ...DECISION, effect: OUTSIDE }, 'effect'],
    [
      'excluding the case and naming an event',
      { ...DECISION, kind: 'case_excluded' },
      'case_decision',
    ],
    [
      'reinstating the case and naming an event',
      { ...DECISION, kind: 'case_reinstated' },
      'case_decision',
    ],
  ] as const)('[SUI-17] [CL-SUI-10] refuses a decision %s', async (_case, decision, check) => {
    await db.insert(trackedCases).values(UNFROZEN);

    const insert = db.insert(trackedCaseDecisions).values(decision);

    await expect(insert).rejects.toMatchObject(
      violationOf(`tracked_case_decisions_${check}_check`),
    );
  });

  it('[SUI-17] [SUI-23] [CL-SUI-16] keeps a regrouping exit with its subrow, and the event it names', async () => {
    await db
      .insert(regroupingExits)
      .values([
        EXIT,
        { ...EXIT, overallSubrow: 'possible_profile' },
        { ...EXIT, overallSubrow: 'general_trend', gapInForecastDirection: null },
        { ...EXIT, overallSubrow: null, gapInForecastDirection: null },
      ]);
    const subrow = db.insert(regroupingExits).values({ ...EXIT, overallSubrow: OUTSIDE });
    await expect(subrow).rejects.toMatchObject(
      violationOf('regrouping_exits_overall_subrow_check'),
    );
    const gap = db.insert(regroupingExits).values({ ...EXIT, overallSubrow: null });
    await expect(gap).rejects.toMatchObject(violationOf('regrouping_exits_gap_check'));

    const withdrawal = db.delete(events).where(eq(events.id, PARENTS.eventId));

    await expect(withdrawal).rejects.toMatchObject({ cause: { code: '23001' } });
  });

  it('[SUI-01] [CL-SUI-10] erases a tracked case with its case, and everything it holds', async () => {
    await db.insert(trackedCases).values(UNFROZEN);
    await db.insert(forecastVersions).values(VERSION);
    await db.insert(caseCategoryChanges).values({ trackedCaseId: TRACKED_ID, changedAt: at(23) });
    await db
      .insert(trackedGameResults)
      .values({ trackedCaseId: TRACKED_ID, kind: 'final', transmittedAt: at(23), content: {} });
    await db.insert(trackedCaseDecisions).values(DECISION);

    await db.delete(cases).where(eq(cases.id, PARENTS.caseId));

    const held = [
      trackedCases,
      forecastVersions,
      caseCategoryChanges,
      trackedGameResults,
      trackedCaseDecisions,
    ];
    await expect(Promise.all(held.map(async (table) => db.$count(table)))).resolves.toStrictEqual([
      0, 0, 0, 0, 0,
    ]);
  });
});

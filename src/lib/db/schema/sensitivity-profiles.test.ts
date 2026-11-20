import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { EMPTY_CALCULATION, insertParents, PARENTS } from '../test-parents';
import { parameterSnapshots } from './params';
import { followedPlayers } from './players';
import { generalTrends, recalculationJobs, sensitivityProfiles } from './sensitivity-profiles';

import type { Database } from '../types';
import type { PgInsertValue } from 'drizzle-orm/pg-core';

// The tables of sensitivity-and-profiles.md that reference a parameter snapshot.
const TABLES = ['general_trends', 'recalculation_jobs', 'sensitivity_profiles'];

// The columns that a profile and a trend share, from the tally to the calculation's
// date, with the plausible range of the control mean gap after that mean (SEN-38).
const CALCULATION = [
  'event_count integer NOT NULL',
  'case_count integer NOT NULL',
  'grouped_event_count integer NOT NULL',
  'awaiting_count integer NOT NULL',
  'valid_count integer NOT NULL',
  'excluded_count integer NOT NULL',
  'manually_excluded_count integer NOT NULL',
  'not_measurable_count integer NOT NULL',
  'co_occurring_count integer NOT NULL',
  'provisional_gap_count integer NOT NULL',
  'historical_valid_count integer NOT NULL',
  'tracked_valid_count integer NOT NULL',
  'tally_reasons jsonb NOT NULL',
  'exit_counts jsonb NOT NULL',
  'low_research_confidence_count integer NOT NULL',
  'mean_gap double precision',
  'gap_dispersion double precision',
  'retained_dispersion double precision',
  'expected_noise double precision',
  'signal_to_noise double precision',
  'range_low double precision',
  'range_high double precision',
  'above_zero_count integer NOT NULL',
  'below_zero_count integer NOT NULL',
  'verdict_level text NOT NULL',
  'verdict_direction text',
  'is_fragile boolean NOT NULL',
  'profile_confidence text NOT NULL',
  "confidence_step_down_reasons text[] NOT NULL DEFAULT '{}'::text[]",
  'control_case_count integer NOT NULL',
  'control_mean_gap double precision',
  'control_range_low double precision',
  'control_range_high double precision',
  'control_verdict_level text NOT NULL',
  'control_verdict_direction text',
  'depends_on_manual_exclusions boolean NOT NULL',
  'valid_case_threshold smallint NOT NULL',
  'parameter_snapshot_id integer NOT NULL',
  'computed_at timestamp with time zone NOT NULL',
];

// Their columns, table by table and each table's in the order of the model.
const COLUMNS = [
  'general_trends.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'general_trends.event_type_id text NOT NULL',
  'general_trends.view text NOT NULL',
  ...CALCULATION.map((column) => `general_trends.${column}`),
  'general_trends.distinct_player_count integer NOT NULL',
  'general_trends.top_contributor_valid_count integer NOT NULL',
  'recalculation_jobs.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'recalculation_jobs.recorded_at timestamp with time zone NOT NULL DEFAULT now()',
  'recalculation_jobs.scope text NOT NULL',
  'recalculation_jobs.player_ids uuid[]',
  'recalculation_jobs.event_type_ids text[]',
  'recalculation_jobs.game_ids integer[]',
  'recalculation_jobs.cause text NOT NULL',
  "recalculation_jobs.status text NOT NULL DEFAULT 'pending'::text",
  'recalculation_jobs.started_at timestamp with time zone',
  'recalculation_jobs.lease_expires_at timestamp with time zone',
  'recalculation_jobs.progress_cursor text',
  'recalculation_jobs.parameter_snapshot_id integer',
  'sensitivity_profiles.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'sensitivity_profiles.player_id uuid NOT NULL',
  'sensitivity_profiles.event_type_id text NOT NULL',
  'sensitivity_profiles.view text NOT NULL',
  ...CALCULATION.map((column) => `sensitivity_profiles.${column}`),
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX general_trends_key ON public.general_trends USING btree (event_type_id, view)',
  'CREATE UNIQUE INDEX general_trends_pkey ON public.general_trends USING btree (id)',
  "CREATE UNIQUE INDEX recalculation_jobs_one_running_key ON public.recalculation_jobs USING btree ((true)) WHERE (status = 'running'::text)",
  'CREATE UNIQUE INDEX recalculation_jobs_pkey ON public.recalculation_jobs USING btree (id)',
  'CREATE UNIQUE INDEX sensitivity_profiles_key ON public.sensitivity_profiles USING btree (player_id, event_type_id, view)',
  'CREATE UNIQUE INDEX sensitivity_profiles_pkey ON public.sensitivity_profiles USING btree (id)',
  'CREATE INDEX sensitivity_profiles_type_view_idx ON public.sensitivity_profiles USING btree (event_type_id, view)',
];

// Their references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'general_trends FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'general_trends FOREIGN KEY (parameter_snapshot_id) REFERENCES parameter_snapshots(id) ON DELETE RESTRICT',
  'recalculation_jobs FOREIGN KEY (parameter_snapshot_id) REFERENCES parameter_snapshots(id) ON DELETE RESTRICT',
  'sensitivity_profiles FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'sensitivity_profiles FOREIGN KEY (parameter_snapshot_id) REFERENCES parameter_snapshots(id) ON DELETE RESTRICT',
  'sensitivity_profiles FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
];

// Nine events in eight cases, seven of them valid at a mean gap of +0.40: a possible
// increase, its control the same over eight cases.
const SEVEN_VALID = {
  ...EMPTY_CALCULATION,
  eventCount: 9,
  caseCount: 8,
  groupedEventCount: 1,
  validCount: 7,
  excludedCount: 1,
  historicalValidCount: 7,
  meanGap: 0.4,
  gapDispersion: 0.9,
  retainedDispersion: 1,
  expectedNoise: 0.378,
  signalToNoise: 1.058,
  rangeLow: -0.356,
  rangeHigh: 1.156,
  aboveZeroCount: 5,
  belowZeroCount: 2,
  verdictLevel: 'possible',
  verdictDirection: 'increase',
  profileConfidence: 'medium',
  controlCaseCount: 8,
  controlMeanGap: 0.35,
  controlRangeLow: -0.36,
  controlRangeHigh: 1.06,
  controlVerdictLevel: 'possible',
  controlVerdictDirection: 'increase',
} as const;
// The first player's profile of the media storm in the default view, and its trend.
const PROFILE = {
  ...SEVEN_VALID,
  playerId: PARENTS.playerId,
  eventTypeId: 'media-storm',
  view: 'all_cases',
} as const;
const TREND = {
  ...SEVEN_VALID,
  eventTypeId: 'media-storm',
  view: 'all_cases',
  distinctPlayerCount: 1,
  topContributorValidCount: 7,
} as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;
// Each change breaks one clause of one check that a profile and a trend share.
const BROKEN = [
  ['of a view the model does not list', { view: OUTSIDE }, 'view'],
  ['of a level the glossary does not list', { verdictLevel: OUTSIDE }, 'verdict_level'],
  ['of a direction the glossary does not list', { verdictDirection: OUTSIDE }, 'verdict_direction'],
  [
    'of a confidence the glossary does not list',
    { profileConfidence: OUTSIDE },
    'profile_confidence',
  ],
  [
    'stepped down for a reason the glossary does not list',
    { confidenceStepDownReasons: sql`ARRAY['outside']` },
    'confidence_step_down_reasons',
  ],
  [
    'of a control level the glossary does not list',
    { controlVerdictLevel: OUTSIDE },
    'control_verdict_level',
  ],
  [
    'of a control direction the glossary does not list',
    { controlVerdictDirection: OUTSIDE },
    'control_verdict_direction',
  ],
  ['counting more events than cases and grouped events', { eventCount: 10 }, 'event_count'],
  ['counting more cases than its states', { caseCount: 9, eventCount: 10 }, 'case_count'],
  ['counting more valid cases than its origins', { historicalValidCount: 6 }, 'valid_count'],
  ['inconclusive with a direction', { verdictLevel: 'inconclusive' }, 'verdict'],
  ['possible without a direction', { verdictDirection: null }, 'verdict'],
  [
    'of an inconclusive control with a direction',
    { controlVerdictLevel: 'inconclusive' },
    'control_verdict',
  ],
  [
    'of a possible control without a direction',
    { controlVerdictDirection: null },
    'control_verdict',
  ],
  ['of valid cases without a mean gap', { meanGap: null }, 'mean_gap'],
  [
    'of no valid case with a mean gap',
    { validCount: 0, historicalValidCount: 0, excludedCount: 8, gapDispersion: null },
    'mean_gap',
  ],
  ['of seven valid cases without a dispersion', { gapDispersion: null }, 'gap_dispersion'],
  [
    'of one valid case with a dispersion',
    { validCount: 1, historicalValidCount: 1, excludedCount: 7 },
    'gap_dispersion',
  ],
  ['of a control range without its low end', { controlRangeLow: null }, 'control_range'],
  ['of a control range without its high end', { controlRangeHigh: null }, 'control_range'],
  ['of a control range without its mean', { controlMeanGap: null }, 'control_range'],
] as const;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the profile, trend and recalculation tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that sensitivity-and-profiles.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[SEN-20] [SEN-21] [SEN-23] [SEN-24] [SEN-25] [CL-SEN-26] stores every view, verdict and confidence of a profile and a trend, an empty birthday profile included', async () => {
    await db.insert(sensitivityProfiles).values([
      {
        ...PROFILE,
        confidenceStepDownReasons: ['high_dispersion', 'high_doubtful_share', 'fragile_verdict'],
      },
      {
        ...PROFILE,
        view: 'historical_only',
        verdictLevel: 'probable',
        verdictDirection: 'decrease',
        profileConfidence: 'high',
        controlVerdictLevel: 'probable',
        controlVerdictDirection: 'decrease',
      },
      { ...PROFILE, view: 'tracked_only', isFragile: true },
      {
        ...EMPTY_CALCULATION,
        playerId: PARENTS.otherPlayerId,
        eventTypeId: 'birthday',
        view: 'all_cases',
      },
    ]);
    await db.insert(generalTrends).values([
      {
        ...TREND,
        confidenceStepDownReasons: [
          'high_dispersion',
          'high_doubtful_share',
          'fragile_verdict',
          'dominant_player',
        ],
      },
      {
        ...TREND,
        view: 'historical_only',
        verdictLevel: 'probable',
        verdictDirection: 'decrease',
        profileConfidence: 'high',
        controlVerdictLevel: 'probable',
        controlVerdictDirection: 'decrease',
      },
      { ...TREND, view: 'tracked_only', isFragile: true },
      {
        ...EMPTY_CALCULATION,
        eventTypeId: 'birthday',
        view: 'all_cases',
        distinctPlayerCount: 0,
        topContributorValidCount: 0,
      },
    ]);

    const views = await db
      .select({ view: sensitivityProfiles.view, level: sensitivityProfiles.verdictLevel })
      .from(sensitivityProfiles)
      .orderBy(sensitivityProfiles.id);

    expect(views).toStrictEqual([
      { view: 'all_cases', level: 'possible' },
      { view: 'historical_only', level: 'probable' },
      { view: 'tracked_only', level: 'possible' },
      { view: 'all_cases', level: 'inconclusive' },
    ]);
    await expect(db.$count(generalTrends)).resolves.toBe(4);
  });

  it.each(BROKEN)(
    '[SEN-24] [SEN-32] [SEN-38] [CL-SEN-15] refuses a profile %s',
    async (_case, change, check) => {
      const insert = db.insert(sensitivityProfiles).values({ ...PROFILE, ...change });

      await expect(insert).rejects.toMatchObject(
        violationOf(`sensitivity_profiles_${check}_check`),
      );
    },
  );

  it.each(BROKEN)(
    '[SEN-24] [SEN-32] [SEN-38] [CL-SEN-15] refuses a trend %s',
    async (_case, change, check) => {
      const insert = db.insert(generalTrends).values({ ...TREND, ...change });

      await expect(insert).rejects.toMatchObject(violationOf(`general_trends_${check}_check`));
    },
  );

  it('[SEN-25] [SEN-29] keeps the dominant player to a trend, and one profile or trend per view', async () => {
    await db.insert(sensitivityProfiles).values(PROFILE);
    await db.insert(generalTrends).values(TREND);

    const dominant = db.insert(sensitivityProfiles).values({
      ...PROFILE,
      view: 'tracked_only',
      confidenceStepDownReasons: sql`ARRAY['dominant_player']`,
    });
    const profileTwice = db.insert(sensitivityProfiles).values(PROFILE);
    const trendTwice = db.insert(generalTrends).values(TREND);

    await expect(dominant).rejects.toMatchObject(
      violationOf('sensitivity_profiles_confidence_step_down_reasons_check'),
    );
    await expect(profileTwice).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'sensitivity_profiles_key' },
    });
    await expect(trendTwice).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'general_trends_key' },
    });
  });

  it('[CL-JOU-06] [SEN-36] deletes the profiles of a player with him, and keeps the snapshot a result was computed with', async () => {
    await db.insert(sensitivityProfiles).values({
      ...EMPTY_CALCULATION,
      playerId: PARENTS.otherPlayerId,
      eventTypeId: 'birthday',
      view: 'all_cases',
    });

    const snapshotDeleted = db
      .delete(parameterSnapshots)
      .where(eq(parameterSnapshots.id, PARENTS.parameterSnapshotId));
    await expect(snapshotDeleted).rejects.toMatchObject({
      cause: { code: '23001', constraint: 'sensitivity_profiles_parameter_snapshot_id_fk' },
    });
    await db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.otherPlayerId));

    await expect(db.$count(sensitivityProfiles)).resolves.toBe(0);
  });

  it('[SEN-34] [CL-SEN-16] [CL-SEN-17] records each job with its scope and its cause, one running at a time', async () => {
    const causes = [
      'new_cases',
      'stats_correction',
      'baseline_updated',
      'manual_decision',
      'event_dismissed',
      'parameter_change',
      'recalculation',
      'event_corrected_or_removed',
      'event_reinstated',
      'taxonomy_changed',
    ] as const;
    const players = { playerIds: [PARENTS.playerId] };
    await db.insert(recalculationJobs).values([
      {
        ...players,
        scope: 'import',
        cause: 'new_cases',
        status: 'running',
        startedAt: EMPTY_CALCULATION.computedAt,
        parameterSnapshotId: 1,
      },
      {
        ...players,
        scope: 'statistics_update',
        cause: 'stats_correction',
        gameIds: [PARENTS.gameId],
      },
      {
        ...players,
        scope: 'event_or_case_change',
        cause: 'event_dismissed',
        eventTypeIds: ['media-storm'],
      },
      ...causes.map((cause) => ({ scope: 'full', cause }) as const),
    ]);

    const secondRunning = db
      .update(recalculationJobs)
      .set({ status: 'running' })
      .where(eq(recalculationJobs.id, 2));

    await expect(secondRunning).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'recalculation_jobs_one_running_key' },
    });
    await expect(
      db.$count(recalculationJobs, eq(recalculationJobs.status, 'pending')),
    ).resolves.toBe(12);
  });

  it.each<readonly [string, Partial<PgInsertValue<typeof recalculationJobs>>, string]>([
    ['of a scope the model does not list', { scope: OUTSIDE }, 'scope'],
    ['of a cause the glossary does not list', { cause: OUTSIDE }, 'cause'],
    ['of a status the model does not list', { status: sql`'done'` }, 'status'],
    [
      'of the whole base naming its players',
      { scope: 'full', playerIds: [PARENTS.playerId] },
      'full_scope',
    ],
    ['of an import naming no player', { scope: 'import', playerIds: null }, 'full_scope'],
  ])('[SEN-34] [CL-SEN-16] refuses a job %s', async (_case, change, check) => {
    const insert = db
      .insert(recalculationJobs)
      .values({ scope: 'import', cause: 'new_cases', playerIds: [PARENTS.playerId], ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`recalculation_jobs_${check}_check`));
  });
});

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

// The calculation a profile and a trend share, without what names its subject.
type Calculation = Omit<
  PgInsertValue<typeof sensitivityProfiles>,
  'playerId' | 'eventTypeId' | 'view'
>;
// The tally reasons of a calculation whose excluded cases were all excluded for their
// playing time, keyed by the stored values as the engine counts them.
const excludedForPlayingTime = (count: number): Readonly<Record<string, unknown>> => ({
  awaitingGame: {},
  notMeasurable: {},
  excluded: Object.fromEntries([['playing_time_too_low', count]]),
});

// Three calculations whose figures follow from their gaps by SEN-20 and SEN-22 to SEN-27,
// rounded to three decimals, each excluded case for its playing time. Twelve events in
// eleven cases: seven valid of gaps −0.3, −0.1, 0.6, 0.9, 1.1, 1.4 and 2.0, four excluded
// of 0.2, 0.5, 1.6 and −0.4. Mean +0.80, noise 1 ÷ √7 = 0.378, ratio 2.117: a possible
// increase, which the 2.0 alone holds up (a ratio of 1.470 without it), so fragile; low
// below eight valid cases, with 4 doubtful cases in 11 noted too. Its control over the
// eleven gaps is a possible increase as well.
const SEVEN_VALID: Calculation = {
  ...EMPTY_CALCULATION,
  eventCount: 12,
  caseCount: 11,
  groupedEventCount: 1,
  validCount: 7,
  excludedCount: 4,
  historicalValidCount: 7,
  tallyReasons: excludedForPlayingTime(4),
  meanGap: 0.8,
  gapDispersion: 0.812,
  retainedDispersion: 1,
  expectedNoise: 0.378,
  signalToNoise: 2.117,
  rangeLow: 0.044,
  rangeHigh: 1.556,
  aboveZeroCount: 5,
  belowZeroCount: 2,
  verdictLevel: 'possible',
  verdictDirection: 'increase',
  isFragile: true,
  confidenceStepDownReasons: ['high_doubtful_share', 'fragile_verdict'],
  controlCaseCount: 11,
  controlMeanGap: 0.682,
  controlRangeLow: 0.079,
  controlRangeHigh: 1.285,
  controlVerdictLevel: 'possible',
  controlVerdictDirection: 'increase',
};
// Sixteen valid cases of gaps −2.0, −1.9, −1.7, −1.5, −1.4, −1.2, −1.1, −1.0, −0.9, −0.9,
// −0.8, −0.7, −0.5, −0.4, −0.2 and 0.2, two excluded of −0.6 and 0.4. Mean −1.00, noise
// 1 ÷ √16 = 0.25, ratio −4: a probable decrease, still probable without the −2.0, and
// high from fifteen valid cases.
const SIXTEEN_DECREASING: Calculation = {
  ...EMPTY_CALCULATION,
  eventCount: 18,
  caseCount: 18,
  validCount: 16,
  excludedCount: 2,
  historicalValidCount: 16,
  tallyReasons: excludedForPlayingTime(2),
  meanGap: -1,
  gapDispersion: 0.611,
  retainedDispersion: 1,
  expectedNoise: 0.25,
  signalToNoise: -4,
  rangeLow: -1.5,
  rangeHigh: -0.5,
  aboveZeroCount: 1,
  belowZeroCount: 15,
  verdictLevel: 'probable',
  verdictDirection: 'decrease',
  profileConfidence: 'high',
  controlCaseCount: 18,
  controlMeanGap: -0.9,
  controlRangeLow: -1.371,
  controlRangeHigh: -0.429,
  controlVerdictLevel: 'probable',
  controlVerdictDirection: 'decrease',
};
// Sixteen valid cases of gaps −1.6, −1.2, −0.8, −0.4, 0.1, 0.4, 0.7, 0.9, 1.1, 1.3, 1.6,
// 1.9, 2.4, 2.8, 3.2 and 3.6, three excluded of 0.5, −0.2 and 1.2. Mean +1.00, dispersion
// 1.552, retained as it is, noise 0.388, ratio 2.577: a possible increase, still possible
// without the 3.6; a dispersion above 1.5 takes the confidence down from high to medium.
const SIXTEEN_DISPERSED: Calculation = {
  ...EMPTY_CALCULATION,
  eventCount: 19,
  caseCount: 19,
  validCount: 16,
  excludedCount: 3,
  historicalValidCount: 16,
  tallyReasons: excludedForPlayingTime(3),
  meanGap: 1,
  gapDispersion: 1.552,
  retainedDispersion: 1.552,
  expectedNoise: 0.388,
  signalToNoise: 2.577,
  rangeLow: 0.224,
  rangeHigh: 1.776,
  aboveZeroCount: 12,
  belowZeroCount: 4,
  verdictLevel: 'possible',
  verdictDirection: 'increase',
  profileConfidence: 'medium',
  confidenceStepDownReasons: ['high_dispersion'],
  controlCaseCount: 19,
  controlMeanGap: 0.921,
  controlRangeLow: 0.257,
  controlRangeHigh: 1.586,
  controlVerdictLevel: 'possible',
  controlVerdictDirection: 'increase',
};
// The other player's profile of the media storm in the default view. Its cases are all
// historical, so its historical-only view is the same and its tracked-only view empty.
const OTHER_STORM = { playerId: PARENTS.otherPlayerId, eventTypeId: 'media-storm' } as const;
const PROFILE = { ...SEVEN_VALID, ...OTHER_STORM, view: 'all_cases' } as const;
// The trend of the death of a loved one, of the same figures over the cases of three
// players, the one who brings the most giving four of the seven valid ones: more than
// half, which the confidence notes (SEN-29).
const TREND: PgInsertValue<typeof generalTrends> = {
  ...SEVEN_VALID,
  eventTypeId: 'bereavement',
  view: 'all_cases',
  confidenceStepDownReasons: ['high_doubtful_share', 'fragile_verdict', 'dominant_player'],
  distinctPlayerCount: 3,
  topContributorValidCount: 4,
};
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
  ['counting more events than cases and grouped events', { eventCount: 13 }, 'event_count'],
  ['counting more cases than its states', { caseCount: 12, eventCount: 13 }, 'case_count'],
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
    { validCount: 0, historicalValidCount: 0, excludedCount: 11, gapDispersion: null },
    'mean_gap',
  ],
  ['of seven valid cases without a dispersion', { gapDispersion: null }, 'gap_dispersion'],
  [
    'of one valid case with a dispersion',
    { validCount: 1, historicalValidCount: 1, excludedCount: 10 },
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

  it('[SEN-21] [SEN-24] [CL-SEN-26] stores every view, verdict and confidence of a profile, an empty birthday profile included', async () => {
    const bereavement = { eventTypeId: 'bereavement', view: 'all_cases' } as const;
    await db.insert(sensitivityProfiles).values([
      PROFILE,
      { ...PROFILE, view: 'historical_only' },
      { ...EMPTY_CALCULATION, ...OTHER_STORM, view: 'tracked_only' },
      { ...SIXTEEN_DECREASING, ...bereavement, playerId: PARENTS.playerId },
      { ...SIXTEEN_DISPERSED, ...bereavement, playerId: PARENTS.otherPlayerId },
      // The first player has no birthday recorded.
      {
        ...EMPTY_CALCULATION,
        playerId: PARENTS.playerId,
        eventTypeId: 'birthday',
        view: 'all_cases',
      },
    ]);

    const stored = await db
      .select({
        view: sensitivityProfiles.view,
        level: sensitivityProfiles.verdictLevel,
        confidence: sensitivityProfiles.profileConfidence,
      })
      .from(sensitivityProfiles)
      .orderBy(sensitivityProfiles.id);

    expect(stored).toStrictEqual([
      { view: 'all_cases', level: 'possible', confidence: 'low' },
      { view: 'historical_only', level: 'possible', confidence: 'low' },
      { view: 'tracked_only', level: 'inconclusive', confidence: 'low' },
      { view: 'all_cases', level: 'probable', confidence: 'high' },
      { view: 'all_cases', level: 'possible', confidence: 'medium' },
      { view: 'all_cases', level: 'inconclusive', confidence: 'low' },
    ]);
  });

  it('[SEN-21] [SEN-24] [CL-SEN-19] stores every view, verdict and confidence of a trend, a dominant player included', async () => {
    await db.insert(generalTrends).values([
      TREND,
      { ...TREND, view: 'historical_only' },
      {
        ...EMPTY_CALCULATION,
        eventTypeId: 'bereavement',
        view: 'tracked_only',
        distinctPlayerCount: 0,
        topContributorValidCount: 0,
      },
      // The historical cases of the media storm, without the tracked one that waits for
      // its game.
      {
        ...SIXTEEN_DECREASING,
        eventTypeId: 'media-storm',
        view: 'historical_only',
        distinctPlayerCount: 4,
        topContributorValidCount: 5,
      },
      // Eight of the sixteen valid cases make half, not more: no step down for them.
      {
        ...SIXTEEN_DISPERSED,
        eventTypeId: 'birthday',
        view: 'all_cases',
        distinctPlayerCount: 3,
        topContributorValidCount: 8,
      },
    ]);

    const stored = await db
      .select({
        view: generalTrends.view,
        level: generalTrends.verdictLevel,
        confidence: generalTrends.profileConfidence,
      })
      .from(generalTrends)
      .orderBy(generalTrends.id);

    expect(stored).toStrictEqual([
      { view: 'all_cases', level: 'possible', confidence: 'low' },
      { view: 'historical_only', level: 'possible', confidence: 'low' },
      { view: 'tracked_only', level: 'inconclusive', confidence: 'low' },
      { view: 'historical_only', level: 'probable', confidence: 'high' },
      { view: 'all_cases', level: 'possible', confidence: 'medium' },
    ]);
  });

  it.each(BROKEN)(
    '[SEN-20] [SEN-21] [SEN-24] [SEN-32] [SEN-38] [CL-SEN-15] refuses a profile %s',
    async (_case, change, check) => {
      const insert = db.insert(sensitivityProfiles).values({ ...PROFILE, ...change });

      await expect(insert).rejects.toMatchObject(
        violationOf(`sensitivity_profiles_${check}_check`),
      );
    },
  );

  it.each(BROKEN)(
    '[SEN-20] [SEN-21] [SEN-24] [SEN-32] [SEN-38] [CL-SEN-15] refuses a trend %s',
    async (_case, change, check) => {
      const insert = db.insert(generalTrends).values({ ...TREND, ...change });

      await expect(insert).rejects.toMatchObject(violationOf(`general_trends_${check}_check`));
    },
  );

  it('[SEN-21] [CL-SEN-19] keeps one profile or trend per view, and the dominant player to a trend', async () => {
    await db.insert(sensitivityProfiles).values(PROFILE);
    await db.insert(generalTrends).values(TREND);

    const dominant = db.insert(sensitivityProfiles).values({
      ...PROFILE,
      view: 'historical_only',
      confidenceStepDownReasons: sql`ARRAY['high_doubtful_share', 'fragile_verdict', 'dominant_player']`,
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

  it('[CL-JOU-06] deletes the profiles of a player with him, and keeps the snapshot a result was computed with', async () => {
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
    // Each cause under the item of SEN-34 whose changes give it (CL-SEN-17): a statistics
    // update, then the changes to events, cases and decisions, then the full recalculation.
    const statistics = ['stats_correction', 'baseline_updated'] as const;
    const changes = [
      'manual_decision',
      'event_dismissed',
      'event_corrected_or_removed',
      'event_reinstated',
    ] as const;
    const full = ['parameter_change', 'recalculation', 'taxonomy_changed'] as const;
    const players = { playerIds: [PARENTS.playerId] };
    type Job = PgInsertValue<typeof recalculationJobs>;
    await db.insert(recalculationJobs).values([
      {
        ...players,
        scope: 'import',
        cause: 'new_cases',
        status: 'running',
        startedAt: EMPTY_CALCULATION.computedAt,
        parameterSnapshotId: PARENTS.parameterSnapshotId,
      },
      ...statistics.map((cause): Job => ({
        ...players,
        scope: 'statistics_update',
        cause,
        gameIds: [PARENTS.gameId],
      })),
      ...changes.map((cause): Job => ({
        ...players,
        scope: 'event_or_case_change',
        cause,
        eventTypeIds: ['media-storm'],
      })),
      ...full.map((cause): Job => ({ scope: 'full', cause })),
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
    ).resolves.toBe(9);
  });

  it.each<readonly [string, Partial<PgInsertValue<typeof recalculationJobs>>, string]>([
    ['of a scope the model does not list', { scope: OUTSIDE }, 'scope'],
    ['of a cause the glossary does not list', { cause: OUTSIDE }, 'cause'],
    ['of a status the model does not list', { status: sql`'done'` }, 'status'],
    [
      'of the whole base naming its players',
      { scope: 'full', cause: 'recalculation', playerIds: [PARENTS.playerId] },
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

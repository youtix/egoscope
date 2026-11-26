import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS, SCHEDULED_GAME } from '../test-parents';
import { games } from './games';
import { followedPlayers } from './players';
import { cases } from './sensitivity';

import type { Database } from '../types';

// The columns of cases, in the order of events-and-cases.md, with the type, the null and
// the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'cases.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'cases.player_id uuid NOT NULL',
  'cases.event_type_id text NOT NULL',
  'cases.origin text NOT NULL',
  'cases.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'cases.status text NOT NULL',
  'cases.status_reason text',
  'cases.reference_instant_at timestamp with time zone',
  'cases.reference_instant_origin text NOT NULL',
  'cases.measured_game_id integer',
  'cases.team_games_missed_before smallint',
  'cases.playing_time_threshold_minutes double precision',
  'cases.measured_minutes double precision',
  'cases.has_rounded_minutes boolean',
  'cases.measured_game_score double precision',
  'cases.performance_index double precision',
  'cases.baseline_season text',
  'cases.baseline_phase text',
  'cases.baseline_game_count smallint',
  'cases.baseline_mean double precision',
  'cases.baseline_standard_deviation double precision',
  'cases.baseline_status text',
  'cases.baseline_is_partial boolean',
  'cases.normalized_gap double precision',
  'cases.gap_status text',
  'cases.opponent_strength_not_evaluable boolean NOT NULL DEFAULT false',
  'cases.stakes_not_evaluable boolean NOT NULL DEFAULT false',
  'cases.computed_at timestamp with time zone NOT NULL DEFAULT now()',
  'cases.row_version integer NOT NULL DEFAULT 1',
];

// Its indexes, the primary key and the unique ones included, in the words of the catalog.
const INDEXES = [
  "CREATE INDEX cases_awaiting_idx ON public.cases USING btree (status_reason) WHERE (status = 'awaiting_game'::text)",
  'CREATE UNIQUE INDEX cases_id_player_type_key ON public.cases USING btree (id, player_id, event_type_id)',
  'CREATE UNIQUE INDEX cases_pkey ON public.cases USING btree (id)',
  'CREATE INDEX cases_player_baseline_season_idx ON public.cases USING btree (player_id, baseline_season)',
  'CREATE INDEX cases_player_game_idx ON public.cases USING btree (player_id, measured_game_id)',
  'CREATE UNIQUE INDEX cases_player_type_game_key ON public.cases USING btree (player_id, event_type_id, measured_game_id) WHERE (measured_game_id IS NOT NULL)',
  'CREATE INDEX cases_player_type_idx ON public.cases USING btree (player_id, event_type_id)',
  'CREATE INDEX cases_type_status_idx ON public.cases USING btree (event_type_id, status)',
];

// Its references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'cases FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'cases FOREIGN KEY (measured_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'cases FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
];

// A media storm of the first player known at its instant, still waiting for its game.
const AWAITING = {
  playerId: PARENTS.playerId,
  eventTypeId: 'media-storm',
  origin: 'historical',
  status: 'awaiting_game',
  statusReason: 'statistics_pending',
  referenceInstantAt: new Date(toEpochMs(Date.UTC(2024, 11, 2, 18, 30))),
  referenceInstantOrigin: 'known_instant',
} as const;
// The same case measured at the parent game against a final baseline of 40 games.
const MEASURED = {
  ...AWAITING,
  status: 'measured',
  statusReason: null,
  measuredGameId: PARENTS.gameId,
  performanceIndex: 12.4,
  baselineSeason: '2024-25',
  baselinePhase: 'regular_season',
  baselineGameCount: 40,
  baselineMean: 10.2,
  baselineStandardDeviation: 3.1,
  baselineStatus: 'final',
  baselineIsPartial: false,
  normalizedGap: 0.7096774193548387,
  gapStatus: 'final',
} as const;
// A case that cannot be measured, its walk having reached no game.
const NOT_MEASURABLE = {
  ...AWAITING,
  status: 'not_measurable',
  statusReason: 'season_not_covered',
} as const;
// The reasons of a case that has its measured game, and those of a case that has none,
// each with a case of the status it belongs to (CL-SEN-05); a derived game is missed only
// by a calendar-derived case (CL-SEN-03).
const GAME_REASONS = [
  ['box_score_incomplete', NOT_MEASURABLE],
  ['box_score_suspect', NOT_MEASURABLE],
  ['box_score_unavailable', NOT_MEASURABLE],
  ['insufficient_baseline', NOT_MEASURABLE],
  ['derived_game_missed', { ...NOT_MEASURABLE, eventTypeId: 'birthday' }],
  ['baseline_building', AWAITING],
] as const;
const GAMELESS_REASONS = [
  ['season_not_covered', NOT_MEASURABLE],
  ['no_game_within_window', NOT_MEASURABLE],
  ['precedence_not_established', NOT_MEASURABLE],
  ['mapping_not_established', AWAITING],
  ['precedence_to_verify', AWAITING],
  ['dating_to_verify', AWAITING],
] as const;
// The measurement items that a measured or excluded case has.
const MEASUREMENT = [
  ['game', { measuredGameId: null }],
  ['index', { performanceIndex: null }],
  ['baseline season', { baselineSeason: null }],
  ['baseline phase', { baselinePhase: null }],
  ['baseline game count', { baselineGameCount: null }],
  ['baseline mean', { baselineMean: null }],
  ['baseline deviation', { baselineStandardDeviation: null }],
  ['baseline status', { baselineStatus: null }],
  ['partial baseline notice', { baselineIsPartial: null }],
  ['gap', { normalizedGap: null }],
  ['gap status', { gapStatus: null }],
] as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the cases table', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db
      .insert(games)
      .values(
        [2, 3].map((game) => ({ ...SCHEDULED_GAME, sourceGameRef: `40170000${String(game)}` })),
      );
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that events-and-cases.md gives it', async () => {
    await expect(describeColumns(db, ['cases'])).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, ['cases'])).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, ['cases'])).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[SEN-07] [CL-SEN-05] [CL-SEN-03] stores each status with its reasons, and every value of the glossary a case holds', async () => {
    const awaiting = [
      'game_not_played_yet',
      'mapping_not_established',
      'precedence_to_verify',
      'dating_to_verify',
    ] as const;
    const gameless = ['no_game_within_window', 'precedence_not_established'] as const;
    const atGame = [
      'box_score_incomplete',
      'box_score_suspect',
      'box_score_unavailable',
      'insufficient_baseline',
      'derived_game_missed',
    ] as const;
    await db.insert(cases).values([
      AWAITING,
      NOT_MEASURABLE,
      ...awaiting.map((statusReason) => ({ ...AWAITING, statusReason })),
      {
        ...AWAITING,
        eventTypeId: 'birthday',
        statusReason: 'baseline_building',
        measuredGameId: 2,
      },
      ...gameless.map((statusReason) => ({ ...NOT_MEASURABLE, statusReason })),
      ...atGame.map((statusReason, index) => ({
        ...NOT_MEASURABLE,
        statusReason,
        eventTypeId: 'bereavement',
        measuredGameId: (index % 3) + 1,
        playerId: index < 3 ? PARENTS.playerId : PARENTS.otherPlayerId,
      })),
      {
        ...MEASURED,
        origin: 'tracked',
        baselinePhase: 'postseason',
        baselineStatus: 'provisional',
        gapStatus: 'provisional',
        referenceInstantOrigin: 'date_only',
      },
      {
        ...MEASURED,
        status: 'excluded',
        measuredGameId: 2,
        baselineStatus: 'building',
        referenceInstantOrigin: 'uncertain_precedence_shift',
      },
      {
        ...MEASURED,
        measuredGameId: 3,
        baselineStatus: 'insufficient',
        baselineIsPartial: true,
        referenceInstantAt: null,
        referenceInstantOrigin: 'known_in_advance',
      },
    ]);

    await expect(db.$count(cases)).resolves.toBe(18);
  });

  it.each([
    ['of an origin the glossary does not list', { ...AWAITING, origin: OUTSIDE }, 'origin'],
    [
      'of a status the glossary does not list',
      { ...AWAITING, status: OUTSIDE, statusReason: null },
      'status',
    ],
    [
      'for a reason the glossary does not list',
      { ...NOT_MEASURABLE, statusReason: OUTSIDE },
      'status_reason',
    ],
    [
      'of a reference the glossary does not list',
      { ...AWAITING, referenceInstantOrigin: OUTSIDE },
      'reference_instant_origin',
    ],
    [
      'whose baseline season is not a season label',
      { ...MEASURED, baselineSeason: '2024-2025' },
      'baseline_season',
    ],
    [
      'whose baseline season does not end the year after it starts',
      { ...MEASURED, baselineSeason: '2024-26' },
      'baseline_season',
    ],
    [
      'of a baseline phase the glossary does not list',
      { ...MEASURED, baselinePhase: OUTSIDE },
      'baseline_phase',
    ],
    [
      'of a baseline status the glossary does not list',
      { ...MEASURED, baselineStatus: OUTSIDE },
      'baseline_status',
    ],
    [
      'of a gap status the glossary does not list',
      { ...MEASURED, gapStatus: OUTSIDE },
      'gap_status',
    ],
    ['awaiting without its reason', { ...AWAITING, statusReason: null }, 'reasoned_status'],
    [
      'not measurable without its reason',
      { ...NOT_MEASURABLE, statusReason: null },
      'reasoned_status',
    ],
    [
      'measured with a reason',
      { ...MEASURED, statusReason: 'derived_game_missed' },
      'reasoned_status',
    ],
    [
      'awaiting for a reason of a case not measurable',
      { ...AWAITING, statusReason: 'no_game_within_window' },
      'awaiting_reason',
    ],
    [
      'not measurable for a reason of a waiting case',
      { ...NOT_MEASURABLE, statusReason: 'statistics_pending' },
      'awaiting_reason',
    ],
    ...GAME_REASONS.map(
      ([statusReason, aCase]) =>
        [
          `without its game, which the reason ${statusReason} needs`,
          { ...aCase, statusReason },
          'game_reason',
        ] as const,
    ),
    ...GAMELESS_REASONS.map(
      ([statusReason, aCase]) =>
        [
          `with a game, which the reason ${statusReason} excludes`,
          { ...aCase, statusReason, measuredGameId: PARENTS.gameId },
          'gameless_reason',
        ] as const,
    ),
    [
      'known in advance with an instant',
      { ...AWAITING, referenceInstantOrigin: 'known_in_advance' },
      'reference_instant',
    ],
    [
      'known at an instant it lacks',
      { ...AWAITING, referenceInstantAt: null },
      'reference_instant',
    ],
    ...MEASUREMENT.map(
      ([item, change]) =>
        [`measured without its ${item}`, { ...MEASURED, ...change }, 'measurement'] as const,
    ),
    [
      'excluded without its gap',
      { ...MEASURED, status: 'excluded', normalizedGap: null },
      'measurement',
    ],
  ] as const)('[SEN-07] [CL-SEN-05] refuses a case %s', async (_case, aCase, check) => {
    const insert = db.insert(cases).values(aCase);

    await expect(insert).rejects.toMatchObject(violationOf(`cases_${check}_check`));
  });

  it('[SEN-05] [CL-VUE-03] [CL-SEN-06] keeps one case per player, type and measured game, an event that reaches no game being its own case', async () => {
    await db
      .insert(cases)
      .values([
        MEASURED,
        { ...MEASURED, eventTypeId: 'bereavement' },
        NOT_MEASURABLE,
        NOT_MEASURABLE,
      ]);

    const again = db.insert(cases).values({ ...MEASURED, status: 'excluded' });

    await expect(again).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'cases_player_type_game_key' },
    });
    await expect(db.$count(cases)).resolves.toBe(5);
  });

  it('[CL-JOU-06] deletes with a player his cases, and keeps the game they were measured at', async () => {
    await db.insert(cases).values({ ...MEASURED, playerId: PARENTS.otherPlayerId });

    const gameDeleted = db.delete(games).where(eq(games.id, PARENTS.gameId));
    await expect(gameDeleted).rejects.toMatchObject({
      cause: { code: '23001', constraint: 'cases_measured_game_id_games_id_fk' },
    });
    await db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.otherPlayerId));

    await expect(db.select({ playerId: cases.playerId }).from(cases)).resolves.toStrictEqual([
      { playerId: PARENTS.playerId },
    ]);
  });
});

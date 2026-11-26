import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { alertSheets, alertSheetSections } from './alerts';
import { alertSheetCaveats, alertSheetExpectedGames, alertSheetUpdates } from './alerts-history';

import type { Database } from '../types';
import type { PgInsertValue } from 'drizzle-orm/pg-core';

// The tables of alert-sheets.md that follow a sheet after its production.
const TABLES = ['alert_sheet_caveats', 'alert_sheet_expected_games', 'alert_sheet_updates'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'alert_sheet_caveats.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheet_caveats.alert_sheet_id integer NOT NULL',
  'alert_sheet_caveats.kind text NOT NULL',
  'alert_sheet_caveats.event_type_id text',
  'alert_sheet_caveats.player_event_id integer',
  'alert_sheet_caveats.known_context_reasons text[]',
  'alert_sheet_caveats.computed_at timestamp with time zone NOT NULL',
  'alert_sheet_expected_games.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheet_expected_games.alert_sheet_id integer NOT NULL',
  'alert_sheet_expected_games.state text NOT NULL',
  'alert_sheet_expected_games.game_id integer',
  'alert_sheet_expected_games.scheduled_start_at timestamp with time zone',
  'alert_sheet_expected_games.opponent_team_id integer',
  'alert_sheet_expected_games.is_home boolean',
  'alert_sheet_expected_games.passed_game_id integer',
  'alert_sheet_expected_games.unknown_reason text',
  'alert_sheet_expected_games.recorded_at timestamp with time zone NOT NULL',
  'alert_sheet_expected_games.superseded_at timestamp with time zone',
  'alert_sheet_expected_games.supersession_reason text',
  'alert_sheet_updates.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheet_updates.alert_sheet_id integer NOT NULL',
  'alert_sheet_updates.occurred_at timestamp with time zone NOT NULL',
  'alert_sheet_updates.kind text NOT NULL',
  'alert_sheet_updates.player_event_id integer',
  'alert_sheet_updates.alert_sheet_section_id integer',
  "alert_sheet_updates.detail jsonb NOT NULL DEFAULT '{}'::jsonb",
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX alert_sheet_caveats_pkey ON public.alert_sheet_caveats USING btree (id)',
  'CREATE UNIQUE INDEX alert_sheet_caveats_uq ON public.alert_sheet_caveats USING btree (alert_sheet_id, kind, event_type_id, player_event_id) NULLS NOT DISTINCT',
  "CREATE INDEX alert_sheet_expected_games_game_idx ON public.alert_sheet_expected_games USING btree (game_id) WHERE (state = 'current'::text)",
  "CREATE UNIQUE INDEX alert_sheet_expected_games_live_uq ON public.alert_sheet_expected_games USING btree (alert_sheet_id) WHERE (state = ANY (ARRAY['current'::text, 'unknown'::text]))",
  'CREATE UNIQUE INDEX alert_sheet_expected_games_pkey ON public.alert_sheet_expected_games USING btree (id)',
  'CREATE INDEX alert_sheet_updates_event_idx ON public.alert_sheet_updates USING btree (player_event_id) WHERE (player_event_id IS NOT NULL)',
  'CREATE UNIQUE INDEX alert_sheet_updates_pkey ON public.alert_sheet_updates USING btree (id)',
  'CREATE INDEX alert_sheet_updates_sheet_idx ON public.alert_sheet_updates USING btree (alert_sheet_id, occurred_at)',
];

// Their references: each row goes with its sheet, and keeps the game, team, type and event it names.
const FOREIGN_KEYS = [
  'alert_sheet_caveats FOREIGN KEY (alert_sheet_id) REFERENCES alert_sheets(id) ON DELETE CASCADE',
  'alert_sheet_caveats FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'alert_sheet_caveats FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE RESTRICT',
  'alert_sheet_expected_games FOREIGN KEY (alert_sheet_id) REFERENCES alert_sheets(id) ON DELETE CASCADE',
  'alert_sheet_expected_games FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'alert_sheet_expected_games FOREIGN KEY (opponent_team_id) REFERENCES teams(id) ON DELETE RESTRICT',
  'alert_sheet_expected_games FOREIGN KEY (passed_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'alert_sheet_updates FOREIGN KEY (alert_sheet_id) REFERENCES alert_sheets(id) ON DELETE CASCADE',
  'alert_sheet_updates FOREIGN KEY (alert_sheet_section_id) REFERENCES alert_sheet_sections(id) ON DELETE CASCADE',
  'alert_sheet_updates FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE RESTRICT',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
const SHEET_ID = 1;
const SHEET = { playerId: PARENTS.playerId, teamIdAtProduction: 1, producedAt: at(10) } as const;
const SECTION = {
  alertSheetId: SHEET_ID,
  kind: 'initial',
  eventTypeId: 'media-storm',
  addedAt: at(10),
  profileState: 'pending',
} as const;
// The expected game a sheet shows, then the entry of a season without a game.
const CURRENT = {
  alertSheetId: SHEET_ID,
  state: 'current',
  gameId: PARENTS.gameId,
  scheduledStartAt: at(23),
  opponentTeamId: 2,
  isHome: true,
  recordedAt: at(10),
} as const;
const UNKNOWN = {
  alertSheetId: SHEET_ID,
  state: 'unknown',
  unknownReason: 'offseason',
  recordedAt: at(10),
} as const;
const SUPERSEDED = {
  ...CURRENT,
  state: 'superseded',
  supersededAt: at(11),
  supersessionReason: 'postponed',
} as const;
const CAVEAT = { alertSheetId: SHEET_ID, kind: 'small_sample', computedAt: at(10) } as const;
const KNOWN_CONTEXT: PgInsertValue<typeof alertSheetCaveats> = {
  ...CAVEAT,
  kind: 'known_context',
  knownContextReasons: ['high_stakes'],
};
const UPDATE = { alertSheetId: SHEET_ID, occurredAt: at(11), kind: 'status_changed' } as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index or constraint refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the expected games, caveats and updates of a sheet', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(alertSheets).values(SHEET);
    await db.insert(alertSheetSections).values(SECTION);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that alert-sheets.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[ALE-15] [ALE-23] [STA-26] [CL-ALE-02] keeps one live expected game per sheet, and every game it replaced with the reason', async () => {
    const changes = [
      'brought_forward',
      'canceled',
      'player_did_not_play',
      'reference_date_moved',
    ] as const;
    await db
      .insert(alertSheetExpectedGames)
      .values([
        SUPERSEDED,
        ...changes.map((supersessionReason) => ({ ...SUPERSEDED, supersessionReason })),
        { ...CURRENT, passedGameId: PARENTS.gameId },
      ]);
    const secondLive = db.insert(alertSheetExpectedGames).values(UNKNOWN);
    await expect(secondLive).rejects.toMatchObject(
      duplicateOf('alert_sheet_expected_games_live_uq'),
    );
    await db.insert(alertSheets).values([SHEET, SHEET, SHEET, SHEET]);
    const reasons = [
      'schedule_not_published',
      'stats_source_unavailable',
      'player_without_team',
    ] as const;
    await db.insert(alertSheetExpectedGames).values([
      { ...UNKNOWN, alertSheetId: 2 },
      ...reasons.map((unknownReason, index) => ({
        ...UNKNOWN,
        alertSheetId: index + 3,
        unknownReason,
      })),
    ]);

    await expect(db.$count(alertSheetExpectedGames)).resolves.toBe(10);
  });

  it.each([
    [
      'a state outside the list',
      { ...SUPERSEDED, state: OUTSIDE, supersededAt: null, supersessionReason: null },
      'state',
    ],
    ['a known game without its game', { ...CURRENT, gameId: null }, 'game'],
    ['an unknown game with a game', { ...UNKNOWN, gameId: PARENTS.gameId }, 'game'],
    [
      'an unknown reason outside the list',
      { ...UNKNOWN, unknownReason: OUTSIDE },
      'unknown_reason',
    ],
    ['an unknown game without its reason', { ...UNKNOWN, unknownReason: null }, 'unknown'],
    ['a known game with an unknown reason', { ...CURRENT, unknownReason: 'offseason' }, 'unknown'],
    ['a replaced game without its instant', { ...SUPERSEDED, supersededAt: null }, 'superseded'],
    ['a live game with a replacement instant', { ...CURRENT, supersededAt: at(11) }, 'superseded'],
    [
      'a change reason outside the list',
      { ...SUPERSEDED, supersessionReason: OUTSIDE },
      'supersession_reason',
    ],
    [
      'a replaced game without its reason',
      { ...SUPERSEDED, supersessionReason: null },
      'supersession',
    ],
    [
      'a live game with a change reason',
      { ...CURRENT, supersessionReason: 'postponed' },
      'supersession',
    ],
  ] as const)(
    '[ALE-15] [ALE-23] [SUI-18] refuses an expected game with %s',
    async (_case, entry, check) => {
      const insert = db.insert(alertSheetExpectedGames).values(entry);

      await expect(insert).rejects.toMatchObject(
        violationOf(`alert_sheet_expected_games_${check}_check`),
      );
    },
  );

  it('[ALE-16] [D-19] shows each caveat of the glossary once per sheet, type and event, two empty names counting as equal', async () => {
    const kinds = [
      'small_sample',
      'effect_direction',
      'several_events',
      'confidence_near_threshold',
      'dating_to_verify',
      'incomplete_or_earlier_version',
      'late_sheet',
      'type_not_covered',
      'confounder_not_separable',
    ] as const;
    await db.insert(alertSheetCaveats).values([
      ...kinds.map((kind) => ({ ...CAVEAT, kind })),
      {
        ...KNOWN_CONTEXT,
        knownContextReasons: ['high_stakes', 'injury_return_flagged', 'opponent_strength'],
      },
      { ...CAVEAT, eventTypeId: 'media-storm' },
      { ...CAVEAT, eventTypeId: 'media-storm', playerEventId: PARENTS.eventId },
    ]);
    const again = db.insert(alertSheetCaveats).values(CAVEAT);
    await expect(again).rejects.toMatchObject(duplicateOf('alert_sheet_caveats_uq'));
    const sameType = db.insert(alertSheetCaveats).values({ ...CAVEAT, eventTypeId: 'media-storm' });
    await expect(sameType).rejects.toMatchObject(duplicateOf('alert_sheet_caveats_uq'));

    await expect(db.$count(alertSheetCaveats)).resolves.toBe(12);
  });

  it.each<readonly [string, PgInsertValue<typeof alertSheetCaveats>, string]>([
    ['a kind outside the list', { ...CAVEAT, kind: OUTSIDE }, 'kind'],
    [
      'a reason outside the list',
      { ...KNOWN_CONTEXT, knownContextReasons: sql`ARRAY['high_stakes', 'outside']` },
      'known_context_reasons',
    ],
    [
      'a known context without its reasons',
      { ...KNOWN_CONTEXT, knownContextReasons: null },
      'known_context',
    ],
    [
      'reasons on another caveat',
      { ...CAVEAT, knownContextReasons: ['opponent_strength'] },
      'known_context',
    ],
  ])('[ALE-16] [CL-ALE-07] refuses a caveat with %s', async (_case, caveat, check) => {
    const insert = db.insert(alertSheetCaveats).values(caveat);

    await expect(insert).rejects.toMatchObject(violationOf(`alert_sheet_caveats_${check}_check`));
  });

  it('[ALE-20] [ALE-31] [CL-ALE-12] journals every kind of update, an outcome naming its event, and goes with the sheet', async () => {
    const kinds = [
      'event_added',
      'source_added',
      'event_dismissed',
      'event_reinstated',
      'expected_game_changed',
      'late_mark_changed',
      'context_corrected',
      'attachment_corrected',
      'profile_values_entered',
      'profile_changed_since_issue',
      'caveats_changed',
      'status_changed',
      'event_no_longer_applies',
    ] as const;
    await db.insert(alertSheetUpdates).values([
      ...kinds.map((kind) => ({ ...UPDATE, kind, alertSheetSectionId: 1 })),
      {
        ...UPDATE,
        kind: 'outcome_recorded',
        playerEventId: PARENTS.eventId,
        detail: { category: 'confirmed' },
      },
      { ...UPDATE, kind: 'outcome_value_changed', playerEventId: PARENTS.eventId },
    ]);
    await expect(
      db
        .select({ detail: alertSheetUpdates.detail })
        .from(alertSheetUpdates)
        .where(eq(alertSheetUpdates.id, 1)),
    ).resolves.toStrictEqual([{ detail: {} }]);
    await db.delete(alertSheetSections).where(eq(alertSheetSections.id, 1));
    await expect(db.$count(alertSheetUpdates)).resolves.toBe(2);

    await db.delete(alertSheets).where(eq(alertSheets.id, SHEET_ID));

    await expect(db.$count(alertSheetUpdates)).resolves.toBe(0);
  });

  it.each([
    ['of a kind outside the list', { ...UPDATE, kind: OUTSIDE }, 'kind'],
    [
      'of a recorded outcome without its event',
      { ...UPDATE, kind: 'outcome_recorded' },
      'outcome_event',
    ],
    [
      'of a changed outcome without its event',
      { ...UPDATE, kind: 'outcome_value_changed' },
      'outcome_event',
    ],
  ] as const)('[ALE-27] [CL-ALE-12] refuses an update %s', async (_case, update, check) => {
    const insert = db.insert(alertSheetUpdates).values(update);

    await expect(insert).rejects.toMatchObject(violationOf(`alert_sheet_updates_${check}_check`));
  });
});

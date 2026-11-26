import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { events } from './events';
import { followedPlayers } from './players';
import { cases } from './sensitivity';

import type { Database } from '../types';

// The columns of events, in the order of events-and-cases.md, with the type, the null
// and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'events.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'events.player_id uuid NOT NULL',
  'events.event_type_id text NOT NULL',
  'events.sheet_event_type_id text NOT NULL',
  'events.sheet_version_number smallint NOT NULL',
  'events.origin text NOT NULL',
  'events.type_link_mark text',
  'events.reference_date_on date',
  'events.reference_at timestamp with time zone',
  'events.reference_offset_minutes smallint',
  'events.reference_date_precision text',
  'events.description text NOT NULL',
  "events.injury_return text NOT NULL DEFAULT 'unknown'::text",
  'events.injury_return_origin text',
  "events.game_stakes text NOT NULL DEFAULT 'unknown'::text",
  'events.game_stakes_origin text',
  'events.case_id integer',
  'events.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'events.updated_at timestamp with time zone NOT NULL DEFAULT now()',
  'events.row_version integer NOT NULL DEFAULT 1',
  'events.research_confidence text',
  'events.unverified_note text',
  'events.precedence text',
  'events.origin_import_id integer',
  'events.detected_status text',
  'events.dismissal_reason text',
  'events.dismissal_comment text',
  'events.dismissed_at timestamp with time zone',
  'events.detection_confidence smallint',
  'events.reference_date_rule text',
  'events.classification_origin text',
  'events.derived_game_id integer',
];

// Its indexes, the primary key and the unique index included, in the words of the catalog.
const INDEXES = [
  "CREATE UNIQUE INDEX events_calendar_game_key ON public.events USING btree (player_id, event_type_id, derived_game_id) WHERE (origin = 'calendar'::text)",
  'CREATE INDEX events_case_idx ON public.events USING btree (case_id)',
  'CREATE INDEX events_origin_import_idx ON public.events USING btree (origin_import_id)',
  'CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id)',
  'CREATE INDEX events_player_reference_at_idx ON public.events USING btree (player_id, reference_at)',
  'CREATE INDEX events_player_reference_date_idx ON public.events USING btree (player_id, reference_date_on)',
  'CREATE INDEX events_player_type_idx ON public.events USING btree (player_id, event_type_id)',
  'CREATE INDEX events_type_idx ON public.events USING btree (event_type_id) WHERE (type_link_mark IS NOT NULL)',
];

// Its references, each with the ON DELETE rule of the model; that of the case cannot
// set case_id alone to null, which the recalculation service does first.
const FOREIGN_KEYS = [
  'events FOREIGN KEY (case_id, player_id, event_type_id) REFERENCES cases(id, player_id, event_type_id) ON DELETE RESTRICT',
  'events FOREIGN KEY (derived_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'events FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'events FOREIGN KEY (origin_import_id) REFERENCES imports(id) ON DELETE RESTRICT',
  'events FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE RESTRICT',
  'events FOREIGN KEY (sheet_event_type_id, sheet_version_number) REFERENCES type_sheet_versions(event_type_id, version_number) ON DELETE RESTRICT',
];

// 18:30 UTC on 2 December 2024, written 13:30 in New York, five hours behind.
const REFERENCE_AT = new Date(toEpochMs(Date.UTC(2024, 11, 2, 18, 30)));
const OFFSET = -300;
// A media storm of the first player, under the first version of its sheet.
const MEDIA_STORM = {
  playerId: PARENTS.playerId,
  eventTypeId: 'media-storm',
  sheetEventTypeId: 'media-storm',
  sheetVersionNumber: 1,
  description: 'Every outlet covered the player on the same day.',
} as const;
// A historical event whose public date has no time, then one with its time.
const HISTORICAL = {
  ...MEDIA_STORM,
  origin: 'historical',
  referenceDateOn: '2024-12-02',
  referenceDatePrecision: 'approximate',
  researchConfidence: 'medium',
  precedence: 'established',
  originImportId: PARENTS.importId,
} as const;
const TIMED = {
  ...HISTORICAL,
  referenceAt: REFERENCE_AT,
  referenceOffsetMinutes: OFFSET,
  referenceDatePrecision: 'exact',
} as const;
// A detected event, dated by its earliest source.
const DETECTED = {
  ...MEDIA_STORM,
  origin: 'detected',
  referenceAt: REFERENCE_AT,
  referenceDatePrecision: 'exact',
  detectedStatus: 'detected',
  referenceDateRule: 'earliest_source',
  classificationOrigin: 'model',
} as const;
// A birthday derived from the schedule, whose game stands for its sources.
const CALENDAR = {
  ...MEDIA_STORM,
  eventTypeId: 'birthday',
  sheetEventTypeId: 'birthday',
  origin: 'calendar',
  referenceDateOn: '2025-01-14',
  description: 'The player plays on his birthday.',
  derivedGameId: PARENTS.gameId,
} as const;
// The columns that only a historical, a detected or a calendar-derived event fills.
const HISTORICAL_ONLY = [
  ['a research confidence', { researchConfidence: 'medium' }],
  ['an unverified note', { unverifiedNote: 'One outlet only.' }],
  ['a precedence', { precedence: 'established' }],
  ['an origin import', { originImportId: PARENTS.importId }],
] as const;
const DETECTED_ONLY = [
  ['a detection status', { detectedStatus: 'detected' }],
  ['a dismissal reason', { dismissalReason: 'old_fact' }],
  ['a dismissal comment', { dismissalComment: 'Seen before.' }],
  ['a dismissal instant', { dismissedAt: REFERENCE_AT }],
  ['a detection confidence', { detectionConfidence: 80 }],
  ['a reference date rule', { referenceDateRule: 'earliest_source' }],
  ['a classification origin', { classificationOrigin: 'model' }],
] as const;
const DERIVED_GAME = ['a derived game', { derivedGameId: PARENTS.gameId }] as const;
// A value that no stored set of the model holds, and a player nobody follows.
const OUTSIDE = sql`'outside'`;
const UNKNOWN_PLAYER_ID = '0f6b3d2a-8c47-4e19-a5d0-93b7e1c4f285';

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a foreign key refused. */
const referenceOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23503', constraint },
});

/** The error of a deletion that an ON DELETE RESTRICT foreign key refused. */
const restrictionOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23001', constraint },
});

describe('the events table', { timeout: 60_000 }, () => {
  // A case of a per-origin check: what the event lacks or holds, and the event.
  type EventCase = readonly [string, typeof events.$inferInsert];

  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that events-and-cases.md gives it', async () => {
    await expect(describeColumns(db, ['events'])).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, ['events'])).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, ['events'])).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[DSN-06] [CL-VUE-12] records an event of each origin, the context unknown until indicated', async () => {
    const rows = [HISTORICAL, TIMED, DETECTED, CALENDAR];
    await db.insert(events).values(rows);

    const stored = await db.select().from(events).orderBy(events.id);

    expect(stored.map((event) => event.origin)).toStrictEqual([
      'detected',
      'historical',
      'historical',
      'detected',
      'calendar',
    ]);
    expect(stored[1]).toMatchObject({
      injuryReturn: 'unknown',
      gameStakes: 'unknown',
      rowVersion: 1,
    });
    expect(stored[2]).toMatchObject({ referenceAt: REFERENCE_AT, referenceOffsetMinutes: OFFSET });
  });

  it('[DSN-07] [CL-IMP-09] stores every value of the glossary that an event holds', async () => {
    await db.insert(events).values([
      {
        ...TIMED,
        researchConfidence: 'high',
        precedence: 'uncertain',
        typeLinkMark: 'to_requalify',
      },
      {
        ...HISTORICAL,
        researchConfidence: 'low',
        precedence: 'not_established',
        typeLinkMark: 'to_distribute',
      },
      {
        ...HISTORICAL,
        precedence: 'to_verify',
        injuryReturn: 'yes',
        injuryReturnOrigin: 'research',
      },
      {
        ...DETECTED,
        injuryReturn: 'no',
        injuryReturnOrigin: 'classification',
        detectionConfidence: 0,
      },
      { ...CALENDAR, injuryReturn: 'yes', injuryReturnOrigin: 'user' },
      { ...DETECTED, gameStakes: 'high', gameStakesOrigin: 'user', detectionConfidence: 100 },
      {
        ...DETECTED,
        gameStakes: 'normal',
        gameStakesOrigin: 'research',
        referenceDatePrecision: 'approximate',
      },
      {
        ...DETECTED,
        gameStakes: 'high',
        gameStakesOrigin: 'classification',
        referenceDatePrecision: 'none',
      },
      { ...DETECTED, referenceDateRule: 'coverage_threshold', classificationOrigin: 'user' },
      ...(
        [
          'not_an_event',
          'no_validated_type_fits',
          'old_fact',
          'non_public_or_unverifiable',
          'duplicate_of_historical_event',
        ] as const
      ).map(
        (dismissalReason) =>
          ({
            ...DETECTED,
            detectedStatus: 'dismissed',
            dismissalReason,
            dismissedAt: REFERENCE_AT,
          }) as const,
      ),
      {
        ...DETECTED,
        detectedStatus: 'dismissed',
        dismissalReason: 'other',
        dismissalComment: 'A rumor.',
        dismissedAt: REFERENCE_AT,
      },
    ]);

    await expect(db.select({ id: events.id }).from(events)).resolves.toHaveLength(16);
  });

  // Each event holds a value outside the stored set of one column.
  it.each([
    ['an origin', { ...DETECTED, origin: OUTSIDE }, 'origin'],
    ['a type link mark', { ...DETECTED, typeLinkMark: OUTSIDE }, 'type_link_mark'],
    [
      'a date precision',
      { ...DETECTED, referenceDatePrecision: OUTSIDE },
      'reference_date_precision',
    ],
    [
      'an injury return',
      { ...DETECTED, injuryReturn: OUTSIDE, injuryReturnOrigin: 'user' },
      'injury_return',
    ],
    [
      'an injury return origin',
      { ...DETECTED, injuryReturnOrigin: OUTSIDE },
      'injury_return_origin',
    ],
    [
      'a context origin of calculation',
      { ...DETECTED, injuryReturnOrigin: sql`'calculation'` },
      'injury_return_origin',
    ],
    ['game stakes', { ...DETECTED, gameStakes: OUTSIDE, gameStakesOrigin: 'user' }, 'game_stakes'],
    ['a game stakes origin', { ...DETECTED, gameStakesOrigin: OUTSIDE }, 'game_stakes_origin'],
    [
      'a research confidence',
      { ...HISTORICAL, researchConfidence: OUTSIDE },
      'research_confidence',
    ],
    ['a precedence', { ...HISTORICAL, precedence: OUTSIDE }, 'precedence'],
    ['a withdrawn status', { ...DETECTED, detectedStatus: sql`'withdrawn'` }, 'detected_status'],
    ['a dismissal reason', { ...DETECTED, dismissalReason: OUTSIDE }, 'dismissal_reason'],
    ['a confidence of 101', { ...DETECTED, detectionConfidence: 101 }, 'detection_confidence'],
    ['a confidence of -1', { ...DETECTED, detectionConfidence: -1 }, 'detection_confidence'],
    ['a date rule', { ...DETECTED, referenceDateRule: OUTSIDE }, 'reference_date_rule'],
    [
      'a classification origin',
      { ...DETECTED, classificationOrigin: OUTSIDE },
      'classification_origin',
    ],
  ] as const)(
    '[DSN-06] refuses an event with %s that the model does not list',
    async (_value, event, column) => {
      const insert = db.insert(events).values(event);

      await expect(insert).rejects.toMatchObject(violationOf(`events_${column}_check`));
    },
  );

  it.each<EventCase>([
    ['without its public date', { ...HISTORICAL, referenceDateOn: null }],
    ['without its precision', { ...HISTORICAL, referenceDatePrecision: null }],
    ['without its research confidence', { ...HISTORICAL, researchConfidence: null }],
    ['without its precedence', { ...HISTORICAL, precedence: null }],
    ['without its import', { ...HISTORICAL, originImportId: null }],
    ['timed without its offset', { ...TIMED, referenceOffsetMinutes: null }],
    ['with an offset but no time', { ...HISTORICAL, referenceOffsetMinutes: OFFSET }],
    ['dated without a time but exact', { ...HISTORICAL, referenceDatePrecision: 'exact' }],
    ['timed but approximate', { ...TIMED, referenceDatePrecision: 'approximate' }],
    ['of no precision', { ...HISTORICAL, referenceDatePrecision: 'none' }],
    ...[...DETECTED_ONLY, DERIVED_GAME].map(
      ([item, change]) => [`with ${item}`, { ...HISTORICAL, ...change }] as const,
    ),
  ])('[DSN-06] [CL-IMP-09] refuses a historical event %s', async (_case, event) => {
    const insert = db.insert(events).values(event);

    await expect(insert).rejects.toMatchObject(violationOf('events_historical_check'));
  });

  it.each<EventCase>([
    ['without its status', { ...DETECTED, detectedStatus: null }],
    ['without its reference instant', { ...DETECTED, referenceAt: null }],
    ['without its precision', { ...DETECTED, referenceDatePrecision: null }],
    ['without its date rule', { ...DETECTED, referenceDateRule: null }],
    ['without its classification origin', { ...DETECTED, classificationOrigin: null }],
    ['with a date as written', { ...DETECTED, referenceDateOn: '2024-12-02' }],
    ['with an offset', { ...DETECTED, referenceOffsetMinutes: OFFSET }],
    ...[...HISTORICAL_ONLY, DERIVED_GAME].map(
      ([item, change]) => [`with ${item}`, { ...DETECTED, ...change }] as const,
    ),
  ])('[DSN-06] refuses a detected event %s', async (_case, event) => {
    const insert = db.insert(events).values(event);

    await expect(insert).rejects.toMatchObject(violationOf('events_detected_check'));
  });

  it.each<EventCase>([
    ['without its game', { ...CALENDAR, derivedGameId: null }],
    ['without its date', { ...CALENDAR, referenceDateOn: null }],
    ['with a reference instant', { ...CALENDAR, referenceAt: REFERENCE_AT }],
    ['with an offset', { ...CALENDAR, referenceOffsetMinutes: OFFSET }],
    ['with a precision', { ...CALENDAR, referenceDatePrecision: 'exact' }],
    ['with a type link mark', { ...CALENDAR, typeLinkMark: 'to_requalify' }],
    ...[...HISTORICAL_ONLY, ...DETECTED_ONLY].map(
      ([item, change]) => [`with ${item}`, { ...CALENDAR, ...change }] as const,
    ),
  ])('[CL-DSN-20] [CL-VUE-12] refuses a calendar-derived event %s', async (_case, event) => {
    const insert = db.insert(events).values(event);

    await expect(insert).rejects.toMatchObject(violationOf('events_calendar_check'));
  });

  it.each([
    [
      'dismissed without its reason',
      { ...DETECTED, detectedStatus: 'dismissed', dismissedAt: REFERENCE_AT },
      'dismissed',
    ],
    [
      'dismissed without its instant',
      { ...DETECTED, detectedStatus: 'dismissed', dismissalReason: 'old_fact' },
      'dismissed',
    ],
    [
      'reinstated with its dismissal',
      { ...DETECTED, dismissalReason: 'old_fact', dismissedAt: REFERENCE_AT },
      'dismissed',
    ],
    [
      'not dismissed with a dismissal reason but no instant',
      { ...DETECTED, dismissalReason: 'old_fact' },
      'dismissed',
    ],
    [
      'dismissed for another reason without a comment',
      {
        ...DETECTED,
        detectedStatus: 'dismissed',
        dismissalReason: 'other',
        dismissedAt: REFERENCE_AT,
      },
      'dismissal_comment',
    ],
    [
      'returning from injury by no origin',
      { ...DETECTED, injuryReturn: 'yes' },
      'injury_return_with_origin',
    ],
    ['of high stakes by no origin', { ...DETECTED, gameStakes: 'high' }, 'game_stakes_with_origin'],
  ] as const)('[DET-43] [SEN-18] refuses a detected event %s', async (_case, event, check) => {
    const insert = db.insert(events).values(event);

    await expect(insert).rejects.toMatchObject(violationOf(`events_${check}_check`));
  });

  it('[VUE-04] [TAX-23] [CL-TAX-08] refuses an event of no followed player, or under no version of its sheet', async () => {
    const noPlayer = db.insert(events).values({ ...DETECTED, playerId: sql`NULL` });
    const unknownPlayer = db.insert(events).values({ ...DETECTED, playerId: UNKNOWN_PLAYER_ID });
    const unknownVersion = db.insert(events).values({ ...DETECTED, sheetVersionNumber: 2 });

    await expect(noPlayer).rejects.toMatchObject({ cause: { code: '23502', column: 'player_id' } });
    await expect(unknownPlayer).rejects.toMatchObject(
      referenceOf('events_player_id_followed_players_id_fk'),
    );
    await expect(unknownVersion).rejects.toMatchObject(referenceOf('events_sheet_version_fk'));
  });

  it('[CL-TAX-18] derives one event per player, type and game', async () => {
    await db.insert(events).values([CALENDAR, { ...CALENDAR, playerId: PARENTS.otherPlayerId }]);

    const again = db.insert(events).values(CALENDAR);

    await expect(again).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'events_calendar_game_key' },
    });
  });

  it('[CL-VUE-03] [SEN-05] joins an event to a case of its own player and type only, which keeps it', async () => {
    await db.update(events).set({ caseId: PARENTS.caseId }).where(eq(events.id, PARENTS.eventId));
    const otherType = db.insert(events).values({
      ...DETECTED,
      eventTypeId: 'bereavement',
      sheetEventTypeId: 'bereavement',
      caseId: PARENTS.caseId,
    });
    const otherPlayer = db
      .insert(events)
      .values({ ...DETECTED, playerId: PARENTS.otherPlayerId, caseId: PARENTS.caseId });
    const caseDeleted = db.delete(cases).where(eq(cases.id, PARENTS.caseId));

    await expect(otherType).rejects.toMatchObject(referenceOf('events_case_fk'));
    await expect(otherPlayer).rejects.toMatchObject(referenceOf('events_case_fk'));
    await expect(caseDeleted).rejects.toMatchObject(restrictionOf('events_case_fk'));
    await db.update(events).set({ caseId: null }).where(eq(events.id, PARENTS.eventId));
    await expect(
      db.delete(cases).where(eq(cases.id, PARENTS.caseId)).returning({ id: cases.id }),
    ).resolves.toStrictEqual([{ id: PARENTS.caseId }]);
  });

  it('[JOU-24] refuses to delete a player while an event of his remains, the erasure step coming first', async () => {
    const deleted = db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.playerId));

    await expect(deleted).rejects.toMatchObject(
      restrictionOf('events_player_id_followed_players_id_fk'),
    );
  });
});

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { DETECTED_EVENT, HISTORICAL_EVENT, insertParents, PARENTS } from '../test-parents';
import { imports } from './backtests';
import { events } from './events';
import { importEventOutcomes, importPossibleDuplicates } from './imports';

import type { Database } from '../types';

// The tables of backtest-and-import.md that name the events of a saved import.
const TABLES = ['import_event_outcomes', 'import_possible_duplicates'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'import_event_outcomes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'import_event_outcomes.import_id integer NOT NULL',
  'import_event_outcomes.position integer',
  'import_event_outcomes.outcome text NOT NULL',
  'import_event_outcomes.player_event_id integer',
  'import_event_outcomes.event_type_as_read text',
  'import_event_outcomes.date_as_read text',
  'import_event_outcomes.reason text',
  'import_possible_duplicates.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'import_possible_duplicates.import_id integer NOT NULL',
  'import_possible_duplicates.result_player_event_id integer',
  'import_possible_duplicates.existing_player_event_id integer',
  'import_possible_duplicates.answer text NOT NULL',
];

// Their indexes, primary keys and the unique index included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX import_event_outcomes_event_idx ON public.import_event_outcomes USING btree (player_event_id)',
  'CREATE UNIQUE INDEX import_event_outcomes_pkey ON public.import_event_outcomes USING btree (id)',
  'CREATE UNIQUE INDEX import_event_outcomes_position_key ON public.import_event_outcomes USING btree (import_id, "position") WHERE ("position" IS NOT NULL)',
  'CREATE INDEX import_possible_duplicates_event_idx ON public.import_possible_duplicates USING btree (existing_player_event_id)',
  'CREATE UNIQUE INDEX import_possible_duplicates_pkey ON public.import_possible_duplicates USING btree (id)',
  'CREATE INDEX import_possible_duplicates_result_idx ON public.import_possible_duplicates USING btree (result_player_event_id)',
];

// Their references: each row goes with its import, and lets go of an erased event.
const FOREIGN_KEYS = [
  'import_event_outcomes FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE',
  'import_event_outcomes FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE SET NULL',
  'import_possible_duplicates FOREIGN KEY (existing_player_event_id) REFERENCES events(id) ON DELETE SET NULL',
  'import_possible_duplicates FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE',
  'import_possible_duplicates FOREIGN KEY (result_player_event_id) REFERENCES events(id) ON DELETE SET NULL',
];

// The second detected event of the first player, of 2 December 2024 at 07:15 UTC, which
// events of the parent import's result matched.
const EXISTING_EVENT_ID = 2;
const DETECTED_AT = new Date(toEpochMs(Date.UTC(2024, 11, 2, 7, 15)));
// The historical events that the parent import recorded from its result, the third and
// the fourth: a media storm of 20 November 2024, and a bereavement of 3 December, the day
// after the detected media storm.
const RECORDED_EVENT_ID = 3;
const RECORDED_WITH_WARNING_ID = 4;
const BEREAVEMENT = {
  ...HISTORICAL_EVENT,
  eventTypeId: 'bereavement',
  sheetEventTypeId: 'bereavement',
  referenceDateOn: '2024-12-03',
  description: 'The player lost his grandfather.',
} as const;
// The outcome of an event the parent import added, and of one it set aside, keeping
// its rank, its type and its date as read.
const ADDED = {
  importId: PARENTS.importId,
  outcome: 'added',
  playerEventId: RECORDED_EVENT_ID,
} as const;
const SET_ASIDE = {
  importId: PARENTS.importId,
  position: 1,
  eventTypeAsRead: 'media-storm',
  dateAsRead: '2024-12-02',
} as const;
// Each reason to ignore or refuse an event, with the type and the date it was read
// with: a proposed type, one the request leaves out, a date after the request, one
// before the player's first NBA game, a calendar-derived type, a type a split replaced;
// no type, an unknown one, no date, a malformed one, one that does not exist (IMP-20).
const IGNORED = [
  ['type_not_validated', 'public-feud', '2024-12-02'],
  ['type_not_requested', 'bereavement', '2024-12-03'],
  ['outside_requested_period', 'media-storm', '2026-11-15'],
  ['before_first_nba_game', 'media-storm', '2009-06-01'],
  ['calendar_derived_type', 'birthday', '2024-12-02'],
  ['split_type_ignored', 'press-pressure', '2024-12-02'],
] as const;
const REFUSED = [
  ['type_missing', null, '2024-12-02'],
  ['type_unknown', 'locker-room-feud', '2024-12-02'],
  ['public_date_missing', 'media-storm', null],
  ['public_date_malformed', 'media-storm', '02/12/2024'],
  ['public_date_nonexistent', 'media-storm', '2021-02-30'],
  ['description_missing', 'media-storm', '2024-12-02'],
  ['description_too_long', 'media-storm', '2024-12-02'],
  ['description_quotation_mark', 'media-storm', '2024-12-02'],
  ['no_valid_source', 'media-storm', '2024-12-02'],
  ['source_before_public_date', 'media-storm', '2024-12-02'],
] as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the outcomes and possible duplicates of an import', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db
      .insert(events)
      .values([{ ...DETECTED_EVENT, referenceAt: DETECTED_AT }, HISTORICAL_EVENT, BEREAVEMENT]);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that backtest-and-import.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[IMP-19] [IMP-20] [CL-IMP-02] keeps the outcome of each event, a rank and a reason for those set aside only', async () => {
    await db.insert(importEventOutcomes).values([
      ADDED,
      { ...ADDED, outcome: 'added_with_warning', playerEventId: RECORDED_WITH_WARNING_ID },
      { ...ADDED, outcome: 'duplicate_not_added', playerEventId: EXISTING_EVENT_ID },
      ...IGNORED.map(
        ([reason, eventTypeAsRead, dateAsRead], index) =>
          ({
            ...SET_ASIDE,
            outcome: 'ignored',
            reason,
            eventTypeAsRead,
            dateAsRead,
            position: index + 1,
          }) as const,
      ),
      ...REFUSED.map(
        ([reason, eventTypeAsRead, dateAsRead], index) =>
          ({
            ...SET_ASIDE,
            outcome: 'refused',
            reason,
            eventTypeAsRead,
            dateAsRead,
            position: index + 7,
          }) as const,
      ),
      // An event of which neither a type nor a date could be read.
      { importId: PARENTS.importId, outcome: 'refused', reason: 'type_missing', position: 17 },
    ]);

    const ranks = await db
      .select({ position: importEventOutcomes.position })
      .from(importEventOutcomes)
      .orderBy(importEventOutcomes.id);

    expect(ranks.slice(0, 4)).toStrictEqual([
      { position: null },
      { position: null },
      { position: null },
      { position: 1 },
    ]);
    await expect(db.$count(importEventOutcomes)).resolves.toBe(20);
  });

  it.each([
    ['of an outcome the glossary does not list', { ...ADDED, outcome: OUTSIDE }, 'outcome'],
    [
      'of a decline for sensitive data, which leaves no row',
      { ...ADDED, outcome: sql`'not_recorded_sensitive_data'` },
      'outcome',
    ],
    [
      'ranked 0',
      { ...SET_ASIDE, outcome: 'ignored', reason: 'type_not_validated', position: 0 },
      'position',
    ],
    [
      'ignored for a reason of refusal',
      { ...SET_ASIDE, outcome: 'ignored', reason: 'type_missing' },
      'ignore_reason',
    ],
    [
      'refused for a reason to ignore',
      { ...SET_ASIDE, outcome: 'refused', reason: 'type_not_validated' },
      'refusal_reason',
    ],
    ['ignored without its reason', { ...SET_ASIDE, outcome: 'ignored' }, 'set_aside'],
    [
      'refused without its rank',
      { ...SET_ASIDE, outcome: 'refused', reason: 'type_missing', position: null },
      'set_aside',
    ],
    [
      'refused naming an event',
      { ...SET_ASIDE, outcome: 'refused', reason: 'type_missing', playerEventId: PARENTS.eventId },
      'set_aside',
    ],
    ['added with a rank', { ...ADDED, position: 1 }, 'set_aside'],
    ['added with a reason', { ...ADDED, reason: 'type_missing' }, 'recorded'],
    ['added with its type as read', { ...ADDED, eventTypeAsRead: 'media-storm' }, 'recorded'],
    [
      'found a duplicate with its date as read',
      { ...ADDED, outcome: 'duplicate_not_added', dateAsRead: '2024-12-02' },
      'recorded',
    ],
  ] as const)(
    '[IMP-19] [IMP-37] [CL-IMP-02] refuses an outcome %s',
    async (_case, outcome, check) => {
      const insert = db.insert(importEventOutcomes).values(outcome);

      await expect(insert).rejects.toMatchObject(
        violationOf(`import_event_outcomes_${check}_check`),
      );
    },
  );

  it('[IMP-20] ranks an event set aside once in its import', async () => {
    await db.insert(imports).values({
      sequenceNumber: 2,
      backtestRequestId: PARENTS.requestId,
      playerId: PARENTS.playerId,
      mode: 'addition',
    });
    await db
      .insert(importEventOutcomes)
      .values([
        { ...SET_ASIDE, outcome: 'refused', reason: 'description_missing' },
        { ...SET_ASIDE, importId: 2, outcome: 'refused', reason: 'description_missing' },
        ADDED,
        { ...ADDED, outcome: 'duplicate_not_added', playerEventId: EXISTING_EVENT_ID },
      ]);

    const again = db
      .insert(importEventOutcomes)
      .values({ ...SET_ASIDE, outcome: 'refused', reason: 'no_valid_source' });

    await expect(again).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'import_event_outcomes_position_key' },
    });
  });

  it('[IMP-25] [IMP-26] [IMP-37] keeps the answers on possible duplicates by event, letting go of an erased one', async () => {
    // A media storm of 19 November 2024, listed before the third event in the same result.
    const earlierEventId = 5;
    await db.insert(events).values({ ...HISTORICAL_EVENT, referenceDateOn: '2024-11-19' });
    const answer = { importId: PARENTS.importId } as const;
    await db.insert(importPossibleDuplicates).values([
      // A result event of another type than the detected media storm, close in date: the
      // same fact, which the import did not add (IMP-27); or another fact, added.
      { ...answer, existingPlayerEventId: EXISTING_EVENT_ID, answer: 'same_fact' },
      {
        ...answer,
        resultPlayerEventId: RECORDED_WITH_WARNING_ID,
        existingPlayerEventId: EXISTING_EVENT_ID,
        answer: 'distinct_facts',
      },
      // Two media storms a day apart, kept as distinct events (IMP-26).
      {
        ...answer,
        resultPlayerEventId: RECORDED_EVENT_ID,
        existingPlayerEventId: earlierEventId,
        answer: 'keep_as_distinct',
      },
    ]);
    const unknown = db.insert(importPossibleDuplicates).values({ ...answer, answer: OUTSIDE });

    await db.delete(events).where(eq(events.id, EXISTING_EVENT_ID));

    await expect(unknown).rejects.toMatchObject(
      violationOf('import_possible_duplicates_answer_check'),
    );
    await expect(
      db
        .select({
          result: importPossibleDuplicates.resultPlayerEventId,
          existing: importPossibleDuplicates.existingPlayerEventId,
        })
        .from(importPossibleDuplicates)
        .orderBy(importPossibleDuplicates.id),
    ).resolves.toStrictEqual([
      { result: null, existing: null },
      { result: RECORDED_WITH_WARNING_ID, existing: null },
      { result: RECORDED_EVENT_ID, existing: earlierEventId },
    ]);
  });

  it('[IMP-31] deletes the outcomes and the answers with their import', async () => {
    await db.insert(importEventOutcomes).values(ADDED);
    await db
      .insert(importPossibleDuplicates)
      .values({ importId: PARENTS.importId, answer: 'same_fact' });

    // A player-data deletion withdraws the events an import recorded before it goes.
    await db.delete(events).where(eq(events.originImportId, PARENTS.importId));
    await db.delete(imports).where(eq(imports.id, PARENTS.importId));

    await expect(
      Promise.all(
        [importEventOutcomes, importPossibleDuplicates].map(async (table) => db.$count(table)),
      ),
    ).resolves.toStrictEqual([0, 0]);
  });
});

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { DETECTED_EVENT, insertParents, PARENTS } from '../test-parents';
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

// The outcome of an event the parent import added, and of one it set aside, keeping
// its rank, its type and its date as read.
const ADDED = {
  importId: PARENTS.importId,
  outcome: 'added',
  playerEventId: PARENTS.eventId,
} as const;
const SET_ASIDE = {
  importId: PARENTS.importId,
  position: 1,
  eventTypeAsRead: 'media-storm',
  dateAsRead: '2024-12-02',
} as const;
const IGNORE_REASONS = [
  'type_not_validated',
  'type_not_requested',
  'outside_requested_period',
  'before_first_nba_game',
  'calendar_derived_type',
  'split_type_ignored',
] as const;
const REFUSAL_REASONS = [
  'type_missing',
  'type_unknown',
  'public_date_missing',
  'public_date_malformed',
  'public_date_nonexistent',
  'description_missing',
  'description_too_long',
  'description_quotation_mark',
  'no_valid_source',
  'source_before_public_date',
] as const;
// The second detected event of the player, which a result event duplicated.
const EXISTING_EVENT_ID = 2;
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
    await db.insert(events).values(DETECTED_EVENT);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that backtest-and-import.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[IMP-19] [IMP-20] [CL-IMP-02] keeps the outcome of each event, a rank and a reason for those set aside only', async () => {
    await db
      .insert(importEventOutcomes)
      .values([
        ADDED,
        { ...ADDED, outcome: 'added_with_warning' },
        { ...ADDED, outcome: 'duplicate_not_added', playerEventId: EXISTING_EVENT_ID },
        ...IGNORE_REASONS.map(
          (reason, index) =>
            ({ ...SET_ASIDE, outcome: 'ignored', reason, position: index + 1 }) as const,
        ),
        ...REFUSAL_REASONS.map(
          (reason, index) =>
            ({ ...SET_ASIDE, outcome: 'refused', reason, position: index + 7 }) as const,
        ),
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
        { ...SET_ASIDE, outcome: 'refused', reason: 'type_missing' },
        { ...SET_ASIDE, importId: 2, outcome: 'refused', reason: 'type_missing' },
        ADDED,
        ADDED,
      ]);

    const again = db
      .insert(importEventOutcomes)
      .values({ ...SET_ASIDE, outcome: 'ignored', reason: 'type_not_requested' });

    await expect(again).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'import_event_outcomes_position_key' },
    });
  });

  it('[IMP-25] [IMP-26] [IMP-37] keeps the answers on possible duplicates by event, letting go of an erased one', async () => {
    await db.insert(importPossibleDuplicates).values([
      { importId: PARENTS.importId, existingPlayerEventId: EXISTING_EVENT_ID, answer: 'same_fact' },
      {
        importId: PARENTS.importId,
        resultPlayerEventId: PARENTS.eventId,
        existingPlayerEventId: EXISTING_EVENT_ID,
        answer: 'distinct_facts',
      },
      {
        importId: PARENTS.importId,
        resultPlayerEventId: PARENTS.eventId,
        existingPlayerEventId: EXISTING_EVENT_ID,
        answer: 'keep_as_distinct',
      },
    ]);
    const unknown = db
      .insert(importPossibleDuplicates)
      .values({ importId: PARENTS.importId, answer: OUTSIDE });

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
      { result: PARENTS.eventId, existing: null },
      { result: PARENTS.eventId, existing: null },
    ]);
  });

  it('[IMP-31] deletes the outcomes and the answers with their import', async () => {
    await db.insert(importEventOutcomes).values(ADDED);
    await db
      .insert(importPossibleDuplicates)
      .values({ importId: PARENTS.importId, answer: 'same_fact' });

    await db.delete(imports).where(eq(imports.id, PARENTS.importId));

    await expect(
      Promise.all(
        [importEventOutcomes, importPossibleDuplicates].map(async (table) => db.$count(table)),
      ),
    ).resolves.toStrictEqual([0, 0]);
  });
});

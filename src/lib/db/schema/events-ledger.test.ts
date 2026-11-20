import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { isOutsideArchive } from './archive';
import { imports } from './backtests';
import {
  deletedPlayerEntries,
  tallyExits,
  withdrawalFingerprints,
  withdrawnEventCounter,
} from './events-ledger';
import { followedPlayers } from './players';

import type { Database } from '../types';

// The tally exits of events-and-cases.md and the withdrawal ledger of sensitive-data.md.
const TABLES = [
  'deleted_player_entries',
  'tally_exits',
  'withdrawal_fingerprints',
  'withdrawn_event_counter',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'deleted_player_entries.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'deleted_player_entries.fingerprint bytea NOT NULL',
  'deleted_player_entries.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'tally_exits.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'tally_exits.player_id uuid NOT NULL',
  'tally_exits.event_type_id text NOT NULL',
  'tally_exits.exit_reason text NOT NULL',
  'tally_exits.exited_at timestamp with time zone',
  'tally_exits.import_id integer',
  'tally_exits.deletion_reason text',
  'tally_exits.deletion_detail text',
  'tally_exits.public_date_on date',
  'tally_exits.public_at timestamp with time zone',
  'withdrawal_fingerprints.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'withdrawal_fingerprints.fingerprint bytea NOT NULL',
  'withdrawal_fingerprints.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'withdrawn_event_counter.id smallint NOT NULL DEFAULT 1',
  'withdrawn_event_counter.value integer NOT NULL DEFAULT 0',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX deleted_player_entries_fingerprint_key ON public.deleted_player_entries USING btree (fingerprint)',
  'CREATE UNIQUE INDEX deleted_player_entries_pkey ON public.deleted_player_entries USING btree (id)',
  'CREATE UNIQUE INDEX tally_exits_pkey ON public.tally_exits USING btree (id)',
  'CREATE INDEX tally_exits_player_type_idx ON public.tally_exits USING btree (player_id, event_type_id)',
  'CREATE INDEX tally_exits_type_idx ON public.tally_exits USING btree (event_type_id)',
  'CREATE UNIQUE INDEX withdrawal_fingerprints_fingerprint_key ON public.withdrawal_fingerprints USING btree (fingerprint)',
  'CREATE UNIQUE INDEX withdrawal_fingerprints_pkey ON public.withdrawal_fingerprints USING btree (id)',
  'CREATE UNIQUE INDEX withdrawn_event_counter_pkey ON public.withdrawn_event_counter USING btree (id)',
];

// Their references, each with the ON DELETE rule of the model: the ledger has none.
const FOREIGN_KEYS = [
  'tally_exits FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'tally_exits FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE SET NULL',
  'tally_exits FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
];

// The exit of an event of the first player's media storm.
const EXIT = { playerId: PARENTS.playerId, eventTypeId: 'media-storm' } as const;
// The manual deletion of a historical event dated 2 December 2024, on 18 November 2026.
const DELETED = {
  ...EXIT,
  exitReason: 'deleted',
  exitedAt: new Date(toEpochMs(Date.UTC(2026, 10, 18, 9))),
  deletionReason: 'duplicate',
  publicDateOn: '2024-12-02',
} as const;
// The time of that event's public date, 18:30 UTC.
const PUBLIC_AT = new Date(toEpochMs(Date.UTC(2024, 11, 2, 18, 30)));
// A keyed hash, 32 bytes long, and another one.
const HASH = new Uint8Array(32).fill(7);
const OTHER_HASH = new Uint8Array(32).fill(9);
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

describe('the tally exits and the withdrawal ledger', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that the model gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[SEN-33] [IMP-33] [CL-SEN-25] counts each exit by its reason, the manual deletion alone dated', async () => {
    await db.insert(tallyExits).values([
      { ...EXIT, exitReason: 'merged' },
      { ...EXIT, exitReason: 'replaced_at_import', importId: PARENTS.importId },
      { ...EXIT, exitReason: 'erased' },
      { ...EXIT, exitReason: 'no_longer_derived' },
      { ...DELETED, publicAt: PUBLIC_AT },
      { ...DELETED, deletionReason: 'inaccurate_fact_or_false_source' },
      { ...DELETED, deletionReason: 'outside_type_criteria' },
      { ...DELETED, deletionReason: 'other', deletionDetail: 'Two outlets, one fact.' },
    ]);

    const reasons = await db
      .select({
        reason: tallyExits.exitReason,
        dated: sql<boolean>`${tallyExits.exitedAt} IS NOT NULL`,
      })
      .from(tallyExits)
      .orderBy(tallyExits.id);

    expect(reasons.slice(0, 5)).toStrictEqual([
      { reason: 'merged', dated: false },
      { reason: 'replaced_at_import', dated: false },
      { reason: 'erased', dated: false },
      { reason: 'no_longer_derived', dated: false },
      { reason: 'deleted', dated: true },
    ]);
  });

  it.each([
    [
      'for a dismissal, counted from the events',
      { ...EXIT, exitReason: sql`'dismissed'` },
      'exit_reason',
    ],
    [
      'for a deletion reason the glossary does not list',
      { ...DELETED, deletionReason: OUTSIDE },
      'deletion_reason',
    ],
    ['deleted without its reason', { ...DELETED, deletionReason: null }, 'deleted'],
    ['deleted without its public date', { ...DELETED, publicDateOn: null }, 'deleted'],
    ['deleted without its date', { ...DELETED, exitedAt: null }, 'deleted'],
    ['merged with a date', { ...EXIT, exitReason: 'merged', exitedAt: DELETED.exitedAt }, 'dated'],
    [
      'deleted for another reason without its detail',
      { ...DELETED, deletionReason: 'other' },
      'deletion_detail',
    ],
    [
      'deleted as a duplicate with a detail',
      { ...DELETED, deletionDetail: 'Two outlets.' },
      'deletion_detail',
    ],
    [
      'merged with a detail',
      { ...EXIT, exitReason: 'merged', deletionDetail: 'Two outlets.' },
      'deletion_detail',
    ],
    [
      'merged naming an import',
      { ...EXIT, exitReason: 'merged', importId: PARENTS.importId },
      'import',
    ],
  ] as const)('[SEN-33] [IMP-33] refuses an exit %s', async (_case, exit, check) => {
    const insert = db.insert(tallyExits).values(exit);

    await expect(insert).rejects.toMatchObject(violationOf(`tally_exits_${check}_check`));
  });

  it('[SEN-33] [CL-SEN-26] keeps a replacement exit when its import goes, and drops the exits of a deleted player', async () => {
    await db.insert(tallyExits).values([
      { ...EXIT, exitReason: 'replaced_at_import', importId: PARENTS.importId },
      { ...EXIT, playerId: PARENTS.otherPlayerId, exitReason: 'erased' },
    ]);

    await db.delete(imports).where(eq(imports.id, PARENTS.importId));
    await db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.otherPlayerId));

    await expect(
      db.select({ playerId: tallyExits.playerId, importId: tallyExits.importId }).from(tallyExits),
    ).resolves.toStrictEqual([{ playerId: PARENTS.playerId, importId: null }]);
  });

  it.each([
    ['a withdrawal fingerprint', withdrawalFingerprints, 'withdrawal_fingerprints'],
    ['a deleted-player entry', deletedPlayerEntries, 'deleted_player_entries'],
  ] as const)(
    '[CL-DSN-06] [CL-JOU-24] keeps %s as a keyed hash of 32 bytes (ADR 0017), once',
    async (_entry, table, name) => {
      await db.insert(table).values([{ fingerprint: HASH }, { fingerprint: OTHER_HASH }]);

      const again = db.insert(table).values({ fingerprint: HASH });
      const short = db.insert(table).values({ fingerprint: new Uint8Array(31) });
      const long = db.insert(table).values({ fingerprint: new Uint8Array(33) });

      await expect(
        db.select({ fingerprint: table.fingerprint }).from(table),
      ).resolves.toStrictEqual([{ fingerprint: HASH }, { fingerprint: OTHER_HASH }]);
      await expect(again).rejects.toMatchObject(duplicateOf(`${name}_fingerprint_key`));
      await expect(short).rejects.toMatchObject(violationOf(`${name}_fingerprint_check`));
      await expect(long).rejects.toMatchObject(violationOf(`${name}_fingerprint_check`));
    },
  );

  it('[DSN-29] [CL-DSN-04] counts the removals in one row that starts at zero and never goes below it', async () => {
    await db.insert(withdrawnEventCounter).values({});

    const second = db.insert(withdrawnEventCounter).values({ id: 2 });
    const negative = db
      .update(withdrawnEventCounter)
      .set({ value: -1 })
      .where(eq(withdrawnEventCounter.id, 1));

    await expect(db.select().from(withdrawnEventCounter)).resolves.toStrictEqual([
      { id: 1, value: 0 },
    ]);
    await expect(second).rejects.toMatchObject(violationOf('withdrawn_event_counter_id_check'));
    await expect(negative).rejects.toMatchObject(
      violationOf('withdrawn_event_counter_value_check'),
    );
  });

  it('[CL-DSN-08] keeps the withdrawal ledger out of backups and exports, and the tally exits in', () => {
    const tables = [
      withdrawalFingerprints,
      deletedPlayerEntries,
      withdrawnEventCounter,
      tallyExits,
    ];

    expect(tables.map((table) => isOutsideArchive(table))).toStrictEqual([true, true, true, false]);
  });
});

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { calendarDerivationRequests } from './calendar-events';
import { followedPlayers } from './players';

import type { Database } from '../types';

// The columns of calendar_derivation_requests, in the order of events-and-cases.md, with
// the flag of the owner's changes after the cause.
const COLUMNS = [
  'calendar_derivation_requests.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'calendar_derivation_requests.kind text NOT NULL',
  'calendar_derivation_requests.player_id uuid',
  'calendar_derivation_requests.event_type_id text',
  'calendar_derivation_requests.cause text NOT NULL',
  'calendar_derivation_requests.follows_owner_change boolean NOT NULL',
  'calendar_derivation_requests.requested_at timestamp with time zone NOT NULL DEFAULT now()',
  'calendar_derivation_requests.lease_expires_at timestamp with time zone',
  'calendar_derivation_requests.progress_cursor text',
];

// Its key, and the one pending request per scope, a null scope standing for all.
const INDEXES = [
  'CREATE UNIQUE INDEX calendar_derivation_requests_pkey ON public.calendar_derivation_requests USING btree (id)',
  "CREATE UNIQUE INDEX calendar_derivation_requests_scope_key ON public.calendar_derivation_requests USING btree (kind, COALESCE((player_id)::text, ''::text), COALESCE(event_type_id, ''::text)) WHERE (lease_expires_at IS NULL)",
];

// Its references: a player's requests go with him, a type is never deleted.
const FOREIGN_KEYS = [
  'calendar_derivation_requests FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'calendar_derivation_requests FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
];

// A regular run for every player after a statistics update, and a full one for the
// first player's birthday after the owner entered it.
const REGULAR = { kind: 'regular', cause: 'statistics_update', followsOwnerChange: false } as const;
const BIRTHDAY = {
  kind: 'full',
  playerId: PARENTS.playerId,
  eventTypeId: 'birthday',
  cause: 'birthday_changed',
  followsOwnerChange: true,
} as const;
// The end of the lease a running invocation holds, 06:00 UTC on 20 November 2026.
const LEASE_EXPIRES_AT = new Date(toEpochMs(Date.UTC(2026, 10, 20, 6)));
// The causes of a full run, with whether only an action of the owner records them.
const FULL_CAUSES = [
  ['history_stored', false],
  ['type_validated', true],
  ['type_reactivated', true],
  ['type_changed', true],
  ['birthday_changed', true],
  ['mapping_changed', true],
  ['team_history_changed', false],
  ['team_change_entered', true],
] as const;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of an insert that the one pending request per scope refused. */
const PENDING_TWICE = {
  cause: { code: '23505', constraint: 'calendar_derivation_requests_scope_key' },
} as const;

describe('the calendar derivation requests', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that events-and-cases.md gives the table', async () => {
    const table = ['calendar_derivation_requests'];

    await expect(describeColumns(db, table)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, table)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, table)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[CL-TAX-19] [CL-SEN-17] records each cause with its run, regular after the statistics and the collection only, and marks those of the owner', async () => {
    await db.insert(calendarDerivationRequests).values([
      REGULAR,
      { ...REGULAR, cause: 'collection_pass', playerId: PARENTS.playerId },
      ...FULL_CAUSES.map(
        ([cause, followsOwnerChange]) =>
          ({
            kind: 'full',
            cause,
            followsOwnerChange,
            leaseExpiresAt: LEASE_EXPIRES_AT,
          }) as const,
      ),
    ]);

    const owners = await db
      .select({ cause: calendarDerivationRequests.cause })
      .from(calendarDerivationRequests)
      .where(eq(calendarDerivationRequests.followsOwnerChange, true))
      .orderBy(calendarDerivationRequests.id);

    expect(owners.map((row) => row.cause)).toStrictEqual([
      'type_validated',
      'type_reactivated',
      'type_changed',
      'birthday_changed',
      'mapping_changed',
      'team_change_entered',
    ]);
  });

  it.each([
    ['of a kind the model does not list', { ...REGULAR, kind: sql`'partial'` }, 'kind'],
    ['of a cause the model does not list', { ...BIRTHDAY, cause: sql`'season_started'` }, 'cause'],
    ['regular after a change of birthday', { ...BIRTHDAY, kind: 'regular' }, 'regular'],
    ['full after a statistics update', { ...REGULAR, kind: 'full' }, 'regular'],
    [
      'after a stored history, marked as following the owner',
      { ...BIRTHDAY, cause: 'history_stored' },
      'follows_owner_change',
    ],
    [
      'after a team history a game showed, marked as following the owner',
      { ...BIRTHDAY, cause: 'team_history_changed' },
      'follows_owner_change',
    ],
  ] as const)('[CL-TAX-19] refuses a request %s', async (_case, request, check) => {
    const insert = db.insert(calendarDerivationRequests).values(request);

    await expect(insert).rejects.toMatchObject(
      violationOf(`calendar_derivation_requests_${check}_check`),
    );
  });

  it('[CL-TEL-21] keeps the cause of a request of the owner whose flag a need of the program turned off', async () => {
    await db.insert(calendarDerivationRequests).values({ ...BIRTHDAY, followsOwnerChange: false });

    const rows = await db
      .select({
        cause: calendarDerivationRequests.cause,
        followsOwnerChange: calendarDerivationRequests.followsOwnerChange,
      })
      .from(calendarDerivationRequests);

    expect(rows).toStrictEqual([{ cause: BIRTHDAY.cause, followsOwnerChange: false }]);
  });

  it('[CL-TAX-19] joins a need to the pending request of its scope, all players or both types included, and queues one behind a running request', async () => {
    await db
      .insert(calendarDerivationRequests)
      .values([REGULAR, BIRTHDAY, { ...BIRTHDAY, eventTypeId: null }]);

    const forAll = db
      .insert(calendarDerivationRequests)
      .values({ ...REGULAR, cause: 'collection_pass' });
    const forBirthday = db
      .insert(calendarDerivationRequests)
      .values({ ...BIRTHDAY, cause: 'mapping_changed' });
    const forBothTypes = db
      .insert(calendarDerivationRequests)
      .values({ ...BIRTHDAY, eventTypeId: null });
    await expect(forAll).rejects.toMatchObject(PENDING_TWICE);
    await expect(forBirthday).rejects.toMatchObject(PENDING_TWICE);
    await expect(forBothTypes).rejects.toMatchObject(PENDING_TWICE);
    await db
      .update(calendarDerivationRequests)
      .set({ leaseExpiresAt: LEASE_EXPIRES_AT })
      .where(eq(calendarDerivationRequests.id, 1));

    await db.insert(calendarDerivationRequests).values(REGULAR);

    await expect(db.$count(calendarDerivationRequests)).resolves.toBe(4);
  });

  it('[CL-JOU-06] deletes with a player his requests', async () => {
    await db
      .insert(calendarDerivationRequests)
      .values([REGULAR, { ...BIRTHDAY, playerId: PARENTS.otherPlayerId }]);

    await db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.otherPlayerId));

    await expect(
      db.select({ playerId: calendarDerivationRequests.playerId }).from(calendarDerivationRequests),
    ).resolves.toStrictEqual([{ playerId: null }]);
  });
});

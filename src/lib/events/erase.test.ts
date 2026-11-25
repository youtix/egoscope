import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  cases,
  createTestDatabase,
  eventCorrections,
  events,
  eventSources,
  imports,
  tallyExits,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { eraseEvent, scrubPlayerFromCorrections } from './erase';

import type { ErasureVariant } from './erase';
import type { EventRow } from './types';
import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30));
const OTHER_PLAYER = '00000000-0000-4000-8000-000000000001';
const THIRD_PLAYER = '00000000-0000-4000-8000-000000000002';

describe('eraseEvent', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let importId: number;
  let caseId: number;

  /** A historical media storm of the player in the case, with one source and one correction. */
  async function eventWithChildren(): Promise<EventRow> {
    const event = await insertHistoricalEvent(db, {
      playerId,
      originImportId: importId,
      overrides: { caseId },
    });
    await db.insert(eventSources).values({
      playerEventId: event.id,
      position: 1,
      url: 'https://news.example.com/storm',
      cleanedUrl: 'https://news.example.com/storm',
      publicationDateOn: '2024-11-20',
    });
    await db
      .insert(eventCorrections)
      .values({ playerEventId: event.id, correctedAt: new Date(AT), field: 'description' });
    return event;
  }

  async function erase(eventId: number, variant: ErasureVariant) {
    return db.transaction(async (tx) => eraseEvent(tx, eventId, variant));
  }

  async function exits() {
    return db
      .select({
        playerId: tallyExits.playerId,
        eventTypeId: tallyExits.eventTypeId,
        exitReason: tallyExits.exitReason,
        exitedAt: tallyExits.exitedAt,
        importId: tallyExits.importId,
        publicDateOn: tallyExits.publicDateOn,
        publicAt: tallyExits.publicAt,
      })
      .from(tallyExits)
      .orderBy(asc(tallyExits.id));
  }

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    await insertEventType(db);
    ({ id: playerId } = await insertPlayer(db));
    ({ id: importId } = await insertImport(db, {
      request: await insertRequest(db, { playerId }),
    }));
    const [written] = await db
      .insert(cases)
      .values({
        playerId,
        eventTypeId: MEDIA_STORM,
        origin: 'historical',
        status: 'not_measurable',
        statusReason: 'no_game_within_window',
        referenceInstantAt: new Date(AT),
        referenceInstantOrigin: 'date_only',
      })
      .returning({ id: cases.id });
    if (written === undefined) {
      throw new Error('The case was not written.');
    }
    caseId = written.id;
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[SEN-33] [DSN-27] [CL-TAX-09] removes the event with its sources and corrections and gives its player, type and case', async () => {
    const event = await eventWithChildren();

    await expect(erase(event.id, { kind: 'requalification_erasure' })).resolves.toStrictEqual({
      ok: true,
      value: { playerId, eventTypeId: MEDIA_STORM, caseId },
    });
    await expect(
      Promise.all([
        db.select().from(events),
        db.select().from(eventSources),
        db.select().from(eventCorrections),
        db.select({ id: imports.id }).from(imports),
        db.select({ id: cases.id }).from(cases),
      ]),
    ).resolves.toStrictEqual([[], [], [], [{ id: importId }], [{ id: caseId }]]);
  });

  it('[SEN-33] [CL-SEN-25] [CL-TAX-09] writes the tally exit of each variant that leaves one, as a count with no date', async () => {
    const variants: readonly ErasureVariant[] = [
      { kind: 'requalification_erasure' },
      { kind: 'split_erasure' },
      { kind: 'no_longer_derived' },
      { kind: 'merged' },
      { kind: 'replaced_at_import', importId },
    ];
    for (const variant of variants) {
      const event = await eventWithChildren();
      const outcome = await erase(event.id, variant);
      expect(outcome.ok).toBe(true);
    }

    const dateless = { playerId, eventTypeId: MEDIA_STORM, exitedAt: null, publicDateOn: null };
    expect(await exits()).toStrictEqual(
      [
        ['erased', null],
        ['erased', null],
        ['no_longer_derived', null],
        ['merged', null],
        ['replaced_at_import', importId],
      ].map(([exitReason, exitImportId]) => ({
        ...dateless,
        exitReason,
        importId: exitImportId,
        publicAt: null,
      })),
    );
  });

  it('[SEN-33] [CL-SEN-25] [DSN-29] writes no tally exit for a withdrawal, a player-data deletion, an upcoming derivation drop or a restore re-application', async () => {
    const variants: readonly ErasureVariant[] = [
      { kind: 'withdrawal' },
      { kind: 'player_deletion' },
      { kind: 'upcoming_derivation_drop' },
      { kind: 'restore_reapplication' },
    ];
    for (const variant of variants) {
      const event = await eventWithChildren();
      expect(await erase(event.id, variant)).toStrictEqual({
        ok: true,
        value: { playerId, eventTypeId: MEDIA_STORM, caseId },
      });
    }

    expect(await db.select().from(events)).toStrictEqual([]);
    expect(await exits()).toStrictEqual([]);
  });

  it('[DSN-27] answers that an event already gone no longer exists, writing no exit', async () => {
    const event = await eventWithChildren();
    await erase(event.id, { kind: 'withdrawal' });

    await expect(erase(event.id, { kind: 'merged' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no_longer_exists' },
    });
    expect(await exits()).toStrictEqual([]);
  });

  it('[JOU-24] [CL-JOU-06] sets to null every player correction value that holds the deleted player, keeping the others', async () => {
    const event = await eventWithChildren();
    const correction = { playerEventId: event.id, correctedAt: new Date(AT) } as const;
    await db.insert(eventCorrections).values([
      { ...correction, field: 'player', beforeValue: OTHER_PLAYER, afterValue: playerId },
      { ...correction, field: 'player', beforeValue: playerId, afterValue: OTHER_PLAYER },
      { ...correction, field: 'player', beforeValue: OTHER_PLAYER, afterValue: THIRD_PLAYER },
      { ...correction, field: 'injury_return', beforeValue: playerId, afterValue: 'yes' },
    ]);

    await expect(
      db.transaction(async (tx) => scrubPlayerFromCorrections(tx, playerId)),
    ).resolves.toBe(2);
    const corrections = await db.select().from(eventCorrections).orderBy(asc(eventCorrections.id));
    expect(
      corrections.map((row) => [row.field, row.beforeValue, row.afterValue, row.correctedAt]),
    ).toStrictEqual([
      ['description', null, null, new Date(AT)],
      ['player', OTHER_PLAYER, null, new Date(AT)],
      ['player', null, OTHER_PLAYER, new Date(AT)],
      ['player', OTHER_PLAYER, THIRD_PLAYER, new Date(AT)],
      ['injury_return', playerId, 'yes', new Date(AT)],
    ]);
    expect(
      await db.select({ id: events.id }).from(events).where(eq(events.id, event.id)),
    ).toHaveLength(1);
  });
});

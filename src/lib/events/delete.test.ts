import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  eventCorrections,
  eventImportWarnings,
  events,
  eventSources,
  tallyExits,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { deleteHistorical } from './delete';

import type { HistoricalDeletion } from './delete';
import type { EventRow } from './types';
import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30));
const PUBLIC_AT = toEpochMs(Date.UTC(2024, 10, 20, 17, 0));
const MAX_LENGTH = 200;

describe('deleteHistorical', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let importId: number;
  let historical: EventRow;

  async function remove(
    event: EventRow,
    deletion: Omit<HistoricalDeletion, 'expectedVersion'>,
    expectedVersion = event.rowVersion,
  ) {
    return db.transaction(async (tx) =>
      deleteHistorical(tx, event.id, { ...deletion, expectedVersion }),
    );
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
    historical = await insertHistoricalEvent(db, {
      playerId,
      originImportId: importId,
      overrides: {
        referenceAt: new Date(PUBLIC_AT),
        referenceOffsetMinutes: 0,
        referenceDatePrecision: 'exact',
      },
    });
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[IMP-33] keeps the deletion trace and removes the event with its sources, warnings and corrections', async () => {
    await db.insert(eventSources).values({
      playerEventId: historical.id,
      position: 1,
      url: 'https://news.example.com/storm',
      cleanedUrl: 'https://news.example.com/storm',
      publicationDateOn: '2024-11-20',
    });
    await db
      .insert(eventImportWarnings)
      .values({ playerEventId: historical.id, importId, kind: 'confidence_defaulted' });
    await db
      .insert(eventCorrections)
      .values({ playerEventId: historical.id, correctedAt: new Date(AT), field: 'description' });

    await expect(
      remove(historical, { reason: 'duplicate', detail: 'Kept only for other.' }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { playerId, eventTypeId: MEDIA_STORM, caseId: null },
    });
    expect(
      await db
        .select({
          playerId: tallyExits.playerId,
          eventTypeId: tallyExits.eventTypeId,
          exitReason: tallyExits.exitReason,
          exitedAt: tallyExits.exitedAt,
          deletionReason: tallyExits.deletionReason,
          deletionDetail: tallyExits.deletionDetail,
          publicDateOn: tallyExits.publicDateOn,
          publicAt: tallyExits.publicAt,
          importId: tallyExits.importId,
        })
        .from(tallyExits),
    ).toStrictEqual([
      {
        playerId,
        eventTypeId: MEDIA_STORM,
        exitReason: 'deleted',
        exitedAt: new Date(AT),
        deletionReason: 'duplicate',
        deletionDetail: null,
        publicDateOn: '2024-11-20',
        publicAt: new Date(PUBLIC_AT),
        importId: null,
      },
    ]);
    await expect(
      Promise.all([
        db.select().from(events),
        db.select().from(eventSources),
        db.select().from(eventImportWarnings),
        db.select().from(eventCorrections),
      ]),
    ).resolves.toStrictEqual([[], [], [], []]);
  });

  it('[IMP-33] keeps the short precision of the reason other, trimmed', async () => {
    await expect(
      remove(historical, { reason: 'other', detail: '  The outlet retracted its story.  ' }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      await db
        .select({ reason: tallyExits.deletionReason, detail: tallyExits.deletionDetail })
        .from(tallyExits),
    ).toStrictEqual([{ reason: 'other', detail: 'The outlet retracted its story.' }]);
  });

  it('[IMP-33] [CA-IMP-20] refuses a reason outside the list, and other without its precision or with a precision the wording rules refuse', async () => {
    await expect(
      remove(historical, { reason: 'lost_after_the_game', detail: null }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'invalid_reason' } });
    await expect(remove(historical, { reason: 'other', detail: null })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'detail_required' },
    });
    await expect(
      remove(historical, { reason: 'other', detail: ' '.repeat(3) }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'detail_required' },
    });
    await expect(
      remove(historical, { reason: 'other', detail: 'a'.repeat(MAX_LENGTH + 1) }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_detail',
        breaches: [{ kind: 'too_long', length: MAX_LENGTH + 1, maxLength: MAX_LENGTH }],
      },
    });
    await expect(
      Promise.all([db.select().from(tallyExits), db.select({ id: events.id }).from(events)]),
    ).resolves.toStrictEqual([[], [{ id: historical.id }]]);
  });

  it('[CL-IHM-18] [CL-IHM-19] refuses an older version, an event that no longer exists and an event of another origin', async () => {
    const detected = await insertDetectedEvent(db, { playerId });
    const reason = { reason: 'outside_type_criteria', detail: null } as const;

    await expect(remove(historical, reason, historical.rowVersion + 1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: historical },
    });
    await expect(remove(detected, reason)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not_historical' },
    });
    await expect(remove(historical, reason)).resolves.toMatchObject({ ok: true });
    await expect(remove(historical, reason)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no_longer_exists' },
    });
    expect(await db.select({ id: events.id }).from(events)).toStrictEqual([{ id: detected.id }]);
  });
});

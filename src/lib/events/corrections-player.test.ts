import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, eventCorrections, events } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { applyCorrection } from './corrections';

import type { EventCorrection } from './corrections';
import type { EventRow } from './types';
import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30));
const MAX_LENGTH = 200;
const UNKNOWN_PLAYER = '6f1d2c3b-4a59-4e8f-9b7a-0c1d2e3f4a5b';

// The place of the followed-player check among the checks of `applyCorrection` (DET-47): after
// the fields that an origin cannot change, before the checks of the values of the fields.
describe(
  'applyCorrection, a correction to an unknown player',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;
    let playerId: string;

    async function correct(event: EventRow, changes: Omit<EventCorrection, 'expectedVersion'>) {
      return db.transaction(async (tx) =>
        applyCorrection(tx, event.id, { ...changes, expectedVersion: event.rowVersion }),
      );
    }

    async function storedEvent(eventId: number): Promise<EventRow> {
      const [row] = await db.select().from(events).where(eq(events.id, eventId));
      if (row === undefined) {
        throw new Error(`The event ${String(eventId)} is missing.`);
      }
      return row;
    }

    async function writtenCorrections(eventId: number) {
      return db.select().from(eventCorrections).where(eq(eventCorrections.playerEventId, eventId));
    }

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(AT));
      await insertEventType(db);
      ({ id: playerId } = await insertPlayer(db));
      return async () => {
        restoreClock();
        await database.close();
      };
    }, DATABASE_TEST_TIMEOUT_MS);

    it('[DET-47] [IMP-32] answers that a historical event cannot change its player, not that the player is unknown', async () => {
      const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });
      const historical = await insertHistoricalEvent(db, { playerId, originImportId: imported.id });

      await expect(correct(historical, { playerId: UNKNOWN_PLAYER })).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'not_correctable', fields: ['player'] },
      });
      await expect(storedEvent(historical.id)).resolves.toStrictEqual(historical);
    });

    it('[DET-47] [CL-IHM-21] answers that a calendar-derived event cannot change its player, not that the player is unknown', async () => {
      await insertCalendarType(db);
      const games = await insertLeagueSeason(db, '2024-25');
      const [gameId] = games.values();
      const [written] = await db
        .insert(events)
        .values({
          playerId,
          eventTypeId: 'birthday',
          sheetEventTypeId: 'birthday',
          sheetVersionNumber: 1,
          origin: 'calendar',
          referenceDateOn: '2024-11-20',
          description: 'The player plays on his birthday.',
          derivedGameId: gameId,
        })
        .returning({ id: events.id });
      const calendar = await storedEvent(written?.id ?? 0);

      await expect(correct(calendar, { playerId: UNKNOWN_PLAYER })).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'not_correctable', fields: ['player'] },
      });
      await expect(storedEvent(calendar.id)).resolves.toStrictEqual(calendar);
    });

    it('[DET-47] [CA-DET-27] answers that the player is not followed before it checks the values of the fields, writing nothing', async () => {
      const detected = await insertDetectedEvent(db, { playerId });

      await expect(
        correct(detected, { playerId: UNKNOWN_PLAYER, description: 'a'.repeat(MAX_LENGTH + 1) }),
      ).resolves.toStrictEqual({ ok: false, error: { kind: 'player_not_followed' } });
      await expect(storedEvent(detected.id)).resolves.toStrictEqual(detected);
      expect(await writtenCorrections(detected.id)).toStrictEqual([]);
    });
  },
);

import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { cases, createTestDatabase, events, eventTypes, typeSheetVersions } from '@/lib/db';
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

import {
  clearTypeLink,
  markTypeLink,
  reassignType,
  recordCaseLinks,
  restampSheetVersion,
} from './links';

import type { EventRow } from './types';
import type { Database, Transaction } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30));
const OTHER_TYPE = 'trade-rumor';
const SECOND_VERSION = 2;

describe(
  'the links of events to their type and case',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;
    let playerId: string;
    let first: EventRow;
    let second: EventRow;
    let untouched: EventRow;

    async function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      return db.transaction(work);
    }

    async function stored() {
      return db
        .select({
          id: events.id,
          eventTypeId: events.eventTypeId,
          sheetEventTypeId: events.sheetEventTypeId,
          sheetVersionNumber: events.sheetVersionNumber,
          typeLinkMark: events.typeLinkMark,
          caseId: events.caseId,
          precedence: events.precedence,
          rowVersion: events.rowVersion,
          updatedAt: events.updatedAt,
        })
        .from(events)
        .orderBy(asc(events.id));
    }

    /** A case of the player's media storms, measured at no game. */
    async function insertCase(): Promise<number> {
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
      return written.id;
    }

    /** What `pick` takes of each stored event, in the order of their identifiers. */
    async function storedMap<T>(
      pick: (event: Awaited<ReturnType<typeof stored>>[number]) => T,
    ): Promise<T[]> {
      const rows = await stored();
      return rows.map((row) => pick(row));
    }

    /** Validates a second version of the media storm's sheet, the one then in force. */
    async function validateSecondVersion(): Promise<void> {
      await db.insert(typeSheetVersions).values({
        eventTypeId: MEDIA_STORM,
        versionNumber: SECOND_VERSION,
        kind: 'substantive_change',
        substantiveScope: 'broadens',
        content: { name: 'Media storm' },
      });
      await db
        .update(eventTypes)
        .set({ currentVersionNumber: SECOND_VERSION })
        .where(eq(eventTypes.id, MEDIA_STORM));
    }

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(AT));
      await insertEventType(db);
      await insertEventType(db, { id: OTHER_TYPE, name: 'Trade rumor' });
      ({ id: playerId } = await insertPlayer(db));
      const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });
      const caseId = await insertCase();
      const options = { playerId, originImportId: imported.id, overrides: { caseId } };
      first = await insertHistoricalEvent(db, options);
      second = await insertHistoricalEvent(db, options);
      untouched = await insertHistoricalEvent(db, options);
      return async () => {
        restoreClock();
        await database.close();
      };
    }, DATABASE_TEST_TIMEOUT_MS);

    it('[TAX-23] [TAX-25] [CL-TAX-08] [CL-TAX-22] reassigns events to a validated type under its sheet version in force, leaving their case to the recalculation', async () => {
      await expect(
        inTransaction(async (tx) => reassignType(tx, [first.id, second.id], OTHER_TYPE)),
      ).resolves.toStrictEqual({ ok: true, value: 2 });

      const moved = {
        eventTypeId: OTHER_TYPE,
        sheetEventTypeId: OTHER_TYPE,
        sheetVersionNumber: 1,
        caseId: null,
        rowVersion: first.rowVersion + 1,
        updatedAt: new Date(AT),
      };
      expect(await stored()).toMatchObject([
        { id: first.id, ...moved },
        { id: second.id, ...moved },
        { id: untouched.id, eventTypeId: MEDIA_STORM, caseId: untouched.caseId, rowVersion: 1 },
      ]);
    });

    it('[TAX-23] refuses to reassign events to a type without a validated sheet version', async () => {
      await db.insert(eventTypes).values({
        id: 'proposed-type',
        name: 'Proposed type',
        status: 'proposed',
        origin: 'scoping',
      });

      await expect(
        inTransaction(async (tx) => reassignType(tx, [first.id], 'proposed-type')),
      ).resolves.toStrictEqual({ ok: false, error: { kind: 'type_not_validated' } });
      await expect(
        inTransaction(async (tx) => reassignType(tx, [first.id], 'unknown-type')),
      ).resolves.toStrictEqual({ ok: false, error: { kind: 'type_not_validated' } });
      expect(await storedMap((event) => event.eventTypeId)).toStrictEqual([
        MEDIA_STORM,
        MEDIA_STORM,
        MEDIA_STORM,
      ]);
    });

    it('[TAX-25] [TAX-29] [CL-TAX-08] marks a set of events to requalify or to distribute, and clears the mark', async () => {
      await expect(
        inTransaction(async (tx) => markTypeLink(tx, [first.id, second.id], 'to_requalify')),
      ).resolves.toBe(2);
      await expect(
        inTransaction(async (tx) => markTypeLink(tx, [untouched.id], 'to_distribute')),
      ).resolves.toBe(1);
      expect(await storedMap((event) => [event.typeLinkMark, event.rowVersion])).toStrictEqual([
        ['to_requalify', 2],
        ['to_requalify', 2],
        ['to_distribute', 2],
      ]);

      await expect(inTransaction(async (tx) => clearTypeLink(tx, [second.id]))).resolves.toBe(1);
      expect(await storedMap((event) => event.typeLinkMark)).toStrictEqual([
        'to_requalify',
        null,
        'to_distribute',
      ]);
    });

    it('[TAX-25] [CL-TAX-22] moves events to the sheet version in force of their own type', async () => {
      await validateSecondVersion();

      await expect(
        inTransaction(async (tx) => restampSheetVersion(tx, [first.id, untouched.id])),
      ).resolves.toBe(2);
      expect(
        await storedMap((event) => [
          event.sheetEventTypeId,
          event.sheetVersionNumber,
          event.caseId === null,
        ]),
      ).toStrictEqual([
        [MEDIA_STORM, SECOND_VERSION, false],
        [MEDIA_STORM, 1, false],
        [MEDIA_STORM, SECOND_VERSION, false],
      ]);
    });

    it('[SEN-05] [IMP-18] [CL-IMP-17] writes the case and the precedence that a recalculation gives, changing only the events whose links differ', async () => {
      const newCase = await insertCase();

      await expect(
        inTransaction(async (tx) =>
          recordCaseLinks(tx, [
            { eventId: first.id, caseId: newCase, precedence: 'uncertain' },
            { eventId: second.id, caseId: newCase, precedence: 'uncertain' },
            { eventId: untouched.id, caseId: untouched.caseId, precedence: 'established' },
          ]),
        ),
      ).resolves.toBe(2);
      await expect(
        inTransaction(async (tx) =>
          recordCaseLinks(tx, [
            { eventId: first.id, caseId: null },
            { eventId: second.id, caseId: newCase },
          ]),
        ),
      ).resolves.toBe(1);

      expect(
        await storedMap(({ caseId, precedence, rowVersion }) => [caseId, precedence, rowVersion]),
      ).toStrictEqual([
        [null, 'uncertain', 3],
        [newCase, 'uncertain', 2],
        [untouched.caseId, 'established', 1],
      ]);
    });
  },
);

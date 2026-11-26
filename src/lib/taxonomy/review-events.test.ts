import { asc, eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  cases,
  createTestDatabase,
  events,
  eventTypes,
  journalEntries,
  recalculationJobs,
  typeSheetVersions,
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

import { distributeEvent, requalifyEvent } from './review-events';

import type { DistributionChoice, RequalificationChoice } from './review-events';
import type { Database } from '@/lib/db';
import type { EventRow } from '@/lib/events';

const AT = toEpochMs(Date.UTC(2026, 10, 26, 10, 0));
const TRADE_RUMOR = 'trade-rumor';
const TATTOO_REVEAL = 'tattoo-reveal';
const COACHING_CHANGE = 'coaching-change';
const COACH_HIRED = 'coach-hired';
const COACH_FIRED = 'coach-fired';
const NEW_VERSION = 2;
const MISSING_EVENT_ID = 999_999;
const REVIEW_MESSAGES = ['event_requalified', 'event_distributed'] as const;

describe(
  'the review of the events of a changed type',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;
    let playerId: string;
    let originImportId: number;

    /** Validates a second version of `typeId`'s sheet, the one then in force. */
    async function addSecondVersion(typeId: string): Promise<void> {
      await db.insert(typeSheetVersions).values({
        eventTypeId: typeId,
        versionNumber: NEW_VERSION,
        kind: 'substantive_change',
        substantiveScope: 'narrows',
        content: { name: typeId },
      });
      await db
        .update(eventTypes)
        .set({ currentVersionNumber: NEW_VERSION })
        .where(eq(eventTypes.id, typeId));
    }

    /** A historical event of the player under version 1 of `typeId`, with `mark`. */
    async function markedEvent(
      mark: EventRow['typeLinkMark'],
      typeId = MEDIA_STORM,
      caseId: number | null = null,
    ): Promise<EventRow> {
      return insertHistoricalEvent(db, {
        playerId,
        originImportId,
        overrides: { eventTypeId: typeId, sheetEventTypeId: typeId, typeLinkMark: mark, caseId },
      });
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

    async function storedEvent(id: number) {
      const [row] = await db
        .select({
          eventTypeId: events.eventTypeId,
          sheetEventTypeId: events.sheetEventTypeId,
          sheetVersionNumber: events.sheetVersionNumber,
          typeLinkMark: events.typeLinkMark,
          caseId: events.caseId,
          rowVersion: events.rowVersion,
        })
        .from(events)
        .where(eq(events.id, id));
      return row;
    }

    /** The three review counts of every version that holds one, as `type@version: [c, r, e]`. */
    async function counts(): Promise<Record<string, readonly number[]>> {
      const rows = await db
        .select()
        .from(typeSheetVersions)
        .orderBy(asc(typeSheetVersions.eventTypeId), asc(typeSheetVersions.versionNumber));
      return Object.fromEntries(
        rows
          .map(
            (row) =>
              [
                `${row.eventTypeId}@${String(row.versionNumber)}`,
                [row.requalifiedConformingCount, row.reassignedCount, row.erasedCount],
              ] as const,
          )
          .filter(([, values]) => values.some((value) => value > 0)),
      );
    }

    async function jobs() {
      return db
        .select({
          scope: recalculationJobs.scope,
          cause: recalculationJobs.cause,
          playerIds: recalculationJobs.playerIds,
          eventTypeIds: recalculationJobs.eventTypeIds,
        })
        .from(recalculationJobs)
        .orderBy(asc(recalculationJobs.id));
    }

    async function reviewEntries() {
      return db
        .select({
          messageKey: journalEntries.messageKey,
          playerEventId: journalEntries.playerEventId,
          playerId: journalEntries.playerId,
          eventTypeId: journalEntries.eventTypeId,
        })
        .from(journalEntries)
        .where(inArray(journalEntries.messageKey, [...REVIEW_MESSAGES]))
        .orderBy(asc(journalEntries.id));
    }

    async function requalify(event: EventRow, choice: RequalificationChoice, version?: number) {
      const expectedVersion = version ?? event.rowVersion;
      return db.transaction(async (tx) =>
        requalifyEvent(tx, event.id, { expectedVersion, choice }),
      );
    }

    async function distribute(event: EventRow, choice: DistributionChoice, version?: number) {
      const expectedVersion = version ?? event.rowVersion;
      return db.transaction(async (tx) =>
        distributeEvent(tx, event.id, { expectedVersion, choice }),
      );
    }

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(AT));
      await insertEventType(db);
      await addSecondVersion(MEDIA_STORM);
      await insertEventType(db, { id: TRADE_RUMOR, name: 'Trade rumor' });
      await insertEventType(db, { id: TATTOO_REVEAL, name: 'Tattoo reveal', status: 'proposed' });
      await insertEventType(db, {
        id: COACHING_CHANGE,
        name: 'Coaching change',
        status: 'withdrawn',
        withdrawalReasonKind: 'split_into',
      });
      await addSecondVersion(COACHING_CHANGE);
      for (const [id, name] of [
        [COACH_HIRED, 'Coach hired'],
        [COACH_FIRED, 'Coach fired'],
      ] as const) {
        await insertEventType(db, { id, name, splitFromTypeId: COACHING_CHANGE });
      }
      await addSecondVersion(COACH_HIRED);
      const player = await insertPlayer(db);
      playerId = player.id;
      const request = await insertRequest(db, { playerId });
      const imported = await insertImport(db, { request });
      originImportId = imported.id;
      return async () => {
        restoreClock();
        await database.close();
      };
    });

    describe('requalifyEvent', () => {
      it('[TAX-25] [TAX-26] [CL-TAX-07] conforms: the current version, the mark cleared, one conforming on the new version, a recalculation', async () => {
        const caseId = await insertCase();
        const event = await markedEvent('to_requalify', MEDIA_STORM, caseId);

        expect(await requalify(event, { kind: 'conforms' })).toStrictEqual({
          ok: true,
          value: { kind: 'settled', eventId: event.id },
        });
        expect(await storedEvent(event.id)).toStrictEqual({
          eventTypeId: MEDIA_STORM,
          sheetEventTypeId: MEDIA_STORM,
          sheetVersionNumber: NEW_VERSION,
          typeLinkMark: null,
          caseId,
          rowVersion: event.rowVersion + 2,
        });
        expect(await counts()).toStrictEqual({ 'media-storm@2': [1, 0, 0] });
        expect(await jobs()).toStrictEqual([
          {
            scope: 'event_or_case_change',
            cause: 'event_corrected_or_removed',
            playerIds: [playerId],
            eventTypeIds: [MEDIA_STORM],
          },
        ]);
        expect(await reviewEntries()).toStrictEqual([]);
      });

      it('[TAX-25] [TAX-26] [CL-TAX-22] [CL-TRV-10] reassigned: the target and its version, one reassigned on the new version, both types recalculated, journaled by reference', async () => {
        const event = await markedEvent('to_requalify');

        expect(
          await requalify(event, { kind: 'reassigned', eventTypeId: TRADE_RUMOR }),
        ).toStrictEqual({ ok: true, value: { kind: 'settled', eventId: event.id } });
        expect(await storedEvent(event.id)).toStrictEqual({
          eventTypeId: TRADE_RUMOR,
          sheetEventTypeId: TRADE_RUMOR,
          sheetVersionNumber: 1,
          typeLinkMark: null,
          caseId: null,
          rowVersion: event.rowVersion + 2,
        });
        expect(await counts()).toStrictEqual({ 'media-storm@2': [0, 1, 0] });
        expect(await jobs()).toStrictEqual([
          {
            scope: 'event_or_case_change',
            cause: 'event_corrected_or_removed',
            playerIds: [playerId],
            eventTypeIds: [MEDIA_STORM, TRADE_RUMOR],
          },
        ]);
        expect(await reviewEntries()).toStrictEqual([
          {
            messageKey: 'event_requalified',
            playerEventId: event.id,
            playerId: null,
            eventTypeId: null,
          },
        ]);
      });

      it('[TAX-25] [TAX-26] [CL-TAX-09] does not conform: one erased on the new version, the erasure handed back, the event as it was', async () => {
        const event = await markedEvent('to_requalify');

        expect(await requalify(event, { kind: 'non_conforming' })).toStrictEqual({
          ok: true,
          value: { kind: 'erasure', eventId: event.id, cause: 'requalification_erasure' },
        });
        expect(await counts()).toStrictEqual({ 'media-storm@2': [0, 0, 1] });
        expect(await storedEvent(event.id)).toMatchObject({
          typeLinkMark: 'to_requalify',
          rowVersion: event.rowVersion,
        });
        expect(await jobs()).toStrictEqual([]);
        expect(await reviewEntries()).toStrictEqual([]);
      });

      it('[TAX-26] adds every outcome to its own count, which never decreases', async () => {
        const first = await markedEvent('to_requalify');
        const second = await markedEvent('to_requalify');
        const third = await markedEvent('to_requalify');
        const fourth = await markedEvent('to_requalify');

        await requalify(first, { kind: 'conforms' });
        await requalify(second, { kind: 'conforms' });
        await requalify(third, { kind: 'non_conforming' });
        await requalify(fourth, { kind: 'reassigned', eventTypeId: TRADE_RUMOR });

        expect(await counts()).toStrictEqual({ 'media-storm@2': [2, 1, 1] });
      });

      it('[TAX-25] refuses a reassignment to a type that is not validated, changing nothing', async () => {
        const event = await markedEvent('to_requalify');

        expect(
          await requalify(event, { kind: 'reassigned', eventTypeId: TATTOO_REVEAL }),
        ).toStrictEqual({ ok: false, error: { kind: 'type_not_validated' } });
        expect(await storedEvent(event.id)).toMatchObject({
          eventTypeId: MEDIA_STORM,
          typeLinkMark: 'to_requalify',
          rowVersion: event.rowVersion,
        });
        expect(await counts()).toStrictEqual({});
        expect(await jobs()).toStrictEqual([]);
        expect(await reviewEntries()).toStrictEqual([]);
      });

      it('[TAX-25] refuses a reassignment to the event own type, which only "conforms" gives', async () => {
        const event = await markedEvent('to_requalify');

        expect(
          await requalify(event, { kind: 'reassigned', eventTypeId: MEDIA_STORM }),
        ).toStrictEqual({ ok: false, error: { kind: 'own_type' } });
        expect(await counts()).toStrictEqual({});
      });

      it('[TAX-25] refuses an event without the mark "to requalify"', async () => {
        const unmarked = await markedEvent(null);
        const toDistribute = await markedEvent('to_distribute', COACHING_CHANGE);

        expect(await requalify(unmarked, { kind: 'conforms' })).toStrictEqual({
          ok: false,
          error: { kind: 'not_marked' },
        });
        expect(await requalify(toDistribute, { kind: 'non_conforming' })).toStrictEqual({
          ok: false,
          error: { kind: 'not_marked' },
        });
        expect(await counts()).toStrictEqual({});
        expect(await storedEvent(unmarked.id)).toMatchObject({ sheetVersionNumber: 1 });
      });

      it('[TAX-25] [CL-IHM-18] refuses a stale row version with the event as it stands, and a missing event', async () => {
        const event = await markedEvent('to_requalify');
        const [current] = await db.select().from(events).where(eq(events.id, event.id));

        expect(await requalify(event, { kind: 'conforms' }, event.rowVersion - 1)).toStrictEqual({
          ok: false,
          error: { kind: 'changed_elsewhere', current },
        });
        expect(
          await db.transaction(async (tx) =>
            requalifyEvent(tx, MISSING_EVENT_ID, {
              expectedVersion: 1,
              choice: { kind: 'conforms' },
            }),
          ),
        ).toStrictEqual({ ok: false, error: { kind: 'no_longer_exists' } });
        expect(await counts()).toStrictEqual({});
        expect(await jobs()).toStrictEqual([]);
      });

      it('[TAX-25] keeps the event, its version and its case until its choice, so that it keeps counting', async () => {
        const caseId = await insertCase();
        const event = await markedEvent('to_requalify', MEDIA_STORM, caseId);
        const before = await storedEvent(event.id);

        await requalify(event, { kind: 'conforms' }, event.rowVersion + 1);
        await requalify(event, { kind: 'reassigned', eventTypeId: MEDIA_STORM });

        expect(await storedEvent(event.id)).toStrictEqual(before);
        expect(before).toMatchObject({ sheetVersionNumber: 1, caseId });
      });
    });

    describe('distributeEvent', () => {
      it('[TAX-29] [CL-TAX-22] [CL-TRV-10] gives the event a split type at its version in force, clears the mark, recalculates both types, journals by reference', async () => {
        const event = await markedEvent('to_distribute', COACHING_CHANGE);

        expect(
          await distribute(event, { kind: 'distributed', eventTypeId: COACH_HIRED }),
        ).toStrictEqual({ ok: true, value: { kind: 'settled', eventId: event.id } });
        expect(await storedEvent(event.id)).toStrictEqual({
          eventTypeId: COACH_HIRED,
          sheetEventTypeId: COACH_HIRED,
          sheetVersionNumber: NEW_VERSION,
          typeLinkMark: null,
          caseId: null,
          rowVersion: event.rowVersion + 2,
        });
        expect(await counts()).toStrictEqual({});
        expect(await jobs()).toStrictEqual([
          {
            scope: 'event_or_case_change',
            cause: 'event_corrected_or_removed',
            playerIds: [playerId],
            eventTypeIds: [COACHING_CHANGE, COACH_HIRED],
          },
        ]);
        expect(await reviewEntries()).toStrictEqual([
          {
            messageKey: 'event_distributed',
            playerEventId: event.id,
            playerId: null,
            eventTypeId: null,
          },
        ]);
      });

      it('[TAX-26] [TAX-29] [CL-TAX-09] fits none: one erased on the split type last version, the erasure handed back', async () => {
        const event = await markedEvent('to_distribute', COACHING_CHANGE);

        expect(await distribute(event, { kind: 'fits_none' })).toStrictEqual({
          ok: true,
          value: { kind: 'erasure', eventId: event.id, cause: 'split_erasure' },
        });
        expect(await counts()).toStrictEqual({ 'coaching-change@2': [0, 0, 1] });
        expect(await storedEvent(event.id)).toMatchObject({ typeLinkMark: 'to_distribute' });
        expect(await jobs()).toStrictEqual([]);
      });

      it('[TAX-29] refuses a type that is not among the split types', async () => {
        const event = await markedEvent('to_distribute', COACHING_CHANGE);

        expect(
          await distribute(event, { kind: 'distributed', eventTypeId: TRADE_RUMOR }),
        ).toStrictEqual({ ok: false, error: { kind: 'not_among_split_types' } });
        expect(await storedEvent(event.id)).toMatchObject({
          eventTypeId: COACHING_CHANGE,
          typeLinkMark: 'to_distribute',
        });
        expect(await jobs()).toStrictEqual([]);
      });

      it('[TAX-29] refuses an event without the mark "to distribute", and a stale row version', async () => {
        const toRequalify = await markedEvent('to_requalify');
        const event = await markedEvent('to_distribute', COACHING_CHANGE);

        expect(await distribute(toRequalify, { kind: 'fits_none' })).toStrictEqual({
          ok: false,
          error: { kind: 'not_marked' },
        });
        const refused = await distribute(
          event,
          { kind: 'distributed', eventTypeId: COACH_FIRED },
          event.rowVersion + 1,
        );
        expect(refused).toMatchObject({ ok: false, error: { kind: 'changed_elsewhere' } });
        expect(await counts()).toStrictEqual({});
        expect(await storedEvent(event.id)).toMatchObject({ eventTypeId: COACHING_CHANGE });
      });
    });
  },
);

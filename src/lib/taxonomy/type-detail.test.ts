import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  eventTypeStatusChanges,
  typeSheetChanges,
  typeSheetVersions,
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

import { sheetContent } from './queries';
import { eventsToReview, getType, sheetHistory, versionCounters } from './type-detail';

import type { Database } from '@/lib/db';
import type { EventTypeRow } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
const HOUR = 3_600_000;
const hourOf = (n: number) => new Date(START + n * HOUR);
const NARROWED = 'Three outlets or more write about the player within one day.';

describe('the reads of one type', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let mediaStorm: EventTypeRow;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    mediaStorm = await insertEventType(db, { createdAt: hourOf(0) });
    return async () => {
      restoreClock();
      await database.close();
    };
  });

  describe('getType', () => {
    it('[TAX-10] [TAX-13] gives the sheet, the state, the reasons, the marks and the dated transitions', async () => {
      await insertEventType(db, {
        id: 'tattoo-reveal',
        name: 'Tattoo reveal',
        status: 'rejected',
        origin: 'exploration',
        rejectionReason: 'not_datable',
        rejectionComment: 'No outlet dates it.',
        createdAt: hourOf(1),
      });
      await db.insert(eventTypeStatusChanges).values([
        {
          eventTypeId: 'tattoo-reveal',
          changedAt: hourOf(3),
          fromStatus: 'proposed',
          toStatus: 'rejected',
        },
        {
          eventTypeId: 'tattoo-reveal',
          changedAt: hourOf(2),
          fromStatus: 'rejected',
          toStatus: 'proposed',
        },
      ]);

      expect(await getType(db, 'tattoo-reveal')).toStrictEqual({
        id: 'tattoo-reveal',
        status: 'rejected',
        origin: 'exploration',
        createdAt: toEpochMs(hourOf(1).getTime()),
        sheet: { ...sheetContent(mediaStorm), name: 'Tattoo reveal' },
        currentVersionNumber: null,
        calendarDerivation: null,
        switchedOffCriterion: null,
        rejectionReason: 'not_datable',
        rejectionComment: 'No outlet dates it.',
        withdrawalReasonKind: null,
        withdrawalReason: null,
        noFitReason: null,
        rowVersion: 1,
        mergedInto: null,
        mergedFrom: [],
        splitFrom: null,
        splitInto: [],
        transitions: [
          { at: toEpochMs(hourOf(2).getTime()), from: 'rejected', to: 'proposed' },
          { at: toEpochMs(hourOf(3).getTime()), from: 'proposed', to: 'rejected' },
        ],
      });
    });

    it('[TAX-27] [TAX-29] gives the links of merges and splits both ways', async () => {
      const withdrawn = { status: 'withdrawn', name: 'Linked', createdAt: hourOf(1) } as const;
      await insertEventType(db, {
        ...withdrawn,
        id: 'public-feud',
        withdrawalReasonKind: 'merged_into',
        mergedIntoTypeId: MEDIA_STORM,
      });
      await insertEventType(db, {
        ...withdrawn,
        id: 'coaching-change',
        name: 'Coaching change',
        withdrawalReasonKind: 'split_into',
      });
      await insertEventType(db, {
        id: 'coach-fired',
        name: 'Coach fired',
        splitFromTypeId: 'coaching-change',
        createdAt: hourOf(2),
      });

      expect(await getType(db, MEDIA_STORM)).toMatchObject({
        mergedInto: null,
        mergedFrom: [{ id: 'public-feud', name: 'Linked' }],
      });
      expect(await getType(db, 'public-feud')).toMatchObject({
        withdrawalReasonKind: 'merged_into',
        mergedInto: { id: MEDIA_STORM, name: 'Media storm' },
      });
      expect(await getType(db, 'coaching-change')).toMatchObject({
        splitInto: [{ id: 'coach-fired', name: 'Coach fired' }],
      });
      expect(await getType(db, 'coach-fired')).toMatchObject({
        splitFrom: { id: 'coaching-change', name: 'Coaching change' },
      });
    });

    it('gives no type for an identifier that names none', async () => {
      expect(await getType(db, 'courtside-proposal')).toBeNull();
    });
  });

  describe('versionCounters and sheetHistory', () => {
    it('[TAX-26] gives each version its date, kind, scope, reason and the four counts that stay visible', async () => {
      await db.insert(typeSheetVersions).values({
        eventTypeId: MEDIA_STORM,
        versionNumber: 2,
        createdAt: hourOf(5),
        kind: 'substantive_change',
        substantiveScope: 'narrows',
        reason: 'One day is enough.',
        content: sheetContent(mediaStorm),
        requalifiedConformingCount: 7,
        reassignedCount: 1,
        erasedCount: 2,
        supplementaryRequestsProposedCount: 3,
      });

      const [first, second] = await versionCounters(db, MEDIA_STORM);

      expect(first).toMatchObject({ versionNumber: 1, kind: 'validation', erasedCount: 0 });
      expect(second).toStrictEqual({
        versionNumber: 2,
        createdAt: toEpochMs(hourOf(5).getTime()),
        kind: 'substantive_change',
        substantiveScope: 'narrows',
        mergeCoversUnion: null,
        isBroadening: false,
        reason: 'One day is enough.',
        requalifiedConformingCount: 7,
        reassignedCount: 1,
        erasedCount: 2,
        supplementaryRequestsProposedCount: 3,
      });
    });

    it('[TAX-21] gives every history entry, oldest first, with its date, qualification, reason and contents before and after', async () => {
      const before = { ...sheetContent(mediaStorm), switchedOffCriterion: null };
      const after = { ...before, inclusionCriteria: NARROWED };
      const switched = { ...after, switchedOffCriterion: 'co_occurring' };
      await db.insert(typeSheetChanges).values([
        {
          eventTypeId: MEDIA_STORM,
          changedAt: hourOf(6),
          changeKind: 'criterion_switch',
          contentBefore: after,
          contentAfter: switched,
        },
        {
          eventTypeId: MEDIA_STORM,
          changedAt: hourOf(5),
          changeKind: 'substantive',
          substantiveScope: 'narrows',
          reason: 'One day is enough.',
          contentBefore: before,
          contentAfter: after,
          resultingVersionNumber: 2,
        },
      ]);

      expect(await sheetHistory(db, MEDIA_STORM)).toStrictEqual([
        {
          changedAt: toEpochMs(hourOf(5).getTime()),
          changeKind: 'substantive',
          substantiveScope: 'narrows',
          reason: 'One day is enough.',
          before,
          after,
          resultingVersionNumber: 2,
        },
        {
          changedAt: toEpochMs(hourOf(6).getTime()),
          changeKind: 'criterion_switch',
          substantiveScope: null,
          reason: null,
          before: after,
          after: switched,
          resultingVersionNumber: null,
        },
      ]);
    });

    it('refuses a stored history content that is not a sheet, a bug', async () => {
      await db.insert(typeSheetChanges).values({
        eventTypeId: MEDIA_STORM,
        changeKind: 'formal',
        contentBefore: { name: 'Media storm' },
        contentAfter: { name: 'Media storm' },
      });

      await expect(sheetHistory(db, MEDIA_STORM)).rejects.toThrow(/expected boolean/u);
    });
  });

  describe('eventsToReview', () => {
    it('[TAX-25] [TAX-29] lists the events to requalify or distribute with their player, reference date and version', async () => {
      const player = await insertPlayer(db);
      await insertEventType(db, {
        id: 'coaching-change',
        name: 'Coaching change',
        status: 'withdrawn',
        withdrawalReasonKind: 'split_into',
      });
      const request = await insertRequest(db, { playerId: player.id });
      const imported = await insertImport(db, { request });
      const historical = await insertHistoricalEvent(db, {
        playerId: player.id,
        originImportId: imported.id,
        overrides: { typeLinkMark: 'to_requalify' },
      });
      const toDistribute = await insertDetectedEvent(db, {
        playerId: player.id,
        overrides: {
          eventTypeId: 'coaching-change',
          sheetEventTypeId: 'coaching-change',
          typeLinkMark: 'to_distribute',
        },
      });
      await insertDetectedEvent(db, { playerId: player.id });
      const playerRef = { id: player.id, displayName: player.displayName };
      const distributed = {
        eventId: toDistribute.id,
        mark: 'to_distribute',
        typeId: 'coaching-change',
        player: playerRef,
        referenceDateOn: null,
        referenceAt: START,
        version: { typeId: 'coaching-change', versionNumber: 1 },
      };

      expect(await eventsToReview(db)).toStrictEqual([
        distributed,
        {
          eventId: historical.id,
          mark: 'to_requalify',
          typeId: MEDIA_STORM,
          player: playerRef,
          referenceDateOn: '2024-11-20',
          referenceAt: null,
          version: { typeId: MEDIA_STORM, versionNumber: 1 },
        },
      ]);
      expect(await eventsToReview(db, 'coaching-change')).toStrictEqual([distributed]);
      expect(await eventsToReview(db, 'birthday')).toStrictEqual([]);
    });
  });
});

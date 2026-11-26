import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  backtestCoveragePeriods,
  backtestRequests,
  backtestRequestTypes,
  createTestDatabase,
  eventTypes,
  imports,
  playerIndicators,
  typeSheetVersions,
} from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertEventType,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { coverage, inheritCoverage, isProfiled, recordImport } from './coverage';

import type { CoverageInheritance, TypeCoverageEntry } from './coverage';
import type { Database } from '@/lib/db';
import type { RetainedPeriod } from '@/lib/stats-engine';
import type { RequestRow } from '@/lib/testing';

const IMPORTED_AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const LATER_AT = toEpochMs(Date.UTC(2026, 10, 24, 9, 30));
const MERGED_AT = toEpochMs(Date.UTC(2026, 10, 25, 10, 0));
const CANCELED_AT = new Date(Date.UTC(2026, 10, 10, 12, 0));
const CANCELLATION = {
  status: 'canceled',
  canceledAt: CANCELED_AT,
  cancellationReasonCode: 'player_withdrawn',
  cancellationReasonText: 'Left the league for a season.',
} as const;
const FEUD = 'public-feud';
const SLUMP = 'scoring-slump';
const PRESS_FEUD = 'press-feud';
const FIRST_GAME_ON = '2019-10-23';
const SEASONS = ['2023-10-24', '2025-06-30'] as const;
const REQUESTED = { startOn: '2023-10-24', endOn: '2026-11-02' } as const;
// The merge of the public feud into the media storm, at its first version (TAX-27).
const MERGE = {
  kind: 'merge',
  survivorTypeId: MEDIA_STORM,
  absorbedTypeIds: [FEUD],
  survivorVersionBeforeMerge: 1,
} as const;
// The split of the media storm into the public feud and the press feud (TAX-29).
const SPLIT = {
  kind: 'split',
  originalTypeId: MEDIA_STORM,
  resultingTypeIds: [FEUD, PRESS_FEUD],
} as const;

/** A period that an import retained for a type (IMP-10). */
const retained = (eventTypeId: string, startOn: string, endOn: string): RetainedPeriod => ({
  eventTypeId,
  startOn,
  endOn,
});

/** An entry of the coverage with its periods written as tuples, to compare whole. */
function summary(entry: TypeCoverageEntry) {
  const periods = entry.periods.map((period) => [
    period.startOn,
    period.endOn,
    period.sheetVersionNumber,
    period.origin,
    period.importId,
    period.recordedAt,
  ]);
  return { ...entry, periods };
}

describe('the backtest coverage of a player', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let player = '';
  let other = '';
  let sequence = 0;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(IMPORTED_AT));
    await insertEventType(db);
    await insertEventType(db, { id: FEUD, name: 'Public feud' });
    const [first, second] = [
      await insertPlayer(db, { source: 'p01' }),
      await insertPlayer(db, { source: 'p02' }),
    ];
    player = first.id;
    other = second.id;
    sequence = 0;
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Writes the import row that a save writes for `request`, at `at`. */
  async function saveImport(request: RequestRow, at = IMPORTED_AT): Promise<number> {
    sequence += 1;
    const [row] = await db
      .insert(imports)
      .values({
        sequenceNumber: sequence,
        backtestRequestId: request.id,
        playerId: request.playerId,
        importedAt: new Date(at),
        mode: 'first_import',
      })
      .returning({ id: imports.id });
    return row?.id ?? 0;
  }

  /** Records an import as its save does, in a transaction of its own. */
  async function record(importId: number, periods: readonly RetainedPeriod[], isConfirmed = false) {
    return db.transaction(async (tx) =>
      recordImport(tx, {
        importId,
        retainedPeriods: periods,
        isCanceledRequestConfirmed: isConfirmed,
      }),
    );
  }

  async function requestState(id: number) {
    const [row] = await db.select().from(backtestRequests).where(eq(backtestRequests.id, id));
    return row;
  }

  /** The stored periods of `typeId`, as tuples in the order they were written. */
  async function storedPeriods(typeId: string) {
    const rows = await db
      .select()
      .from(backtestCoveragePeriods)
      .where(eq(backtestCoveragePeriods.eventTypeId, typeId))
      .orderBy(asc(backtestCoveragePeriods.id));
    return rows.map((row) => [
      row.playerId,
      row.startOn,
      row.endOn,
      row.sheetVersionNumber,
      row.origin,
      row.importId,
      row.recordedAt.getTime(),
    ]);
  }

  /** Writes a period of `typeId`, from an import of `request`, under version 1 unless given. */
  async function covered(
    request: RequestRow,
    typeId: string,
    [startOn, endOn, version = 1]: readonly [string, string, number?],
  ): Promise<number> {
    const importId = await saveImport(request);
    await db.insert(backtestCoveragePeriods).values({
      playerId: request.playerId,
      eventTypeId: typeId,
      startOn,
      endOn,
      sheetVersionNumber: version,
      origin: 'import',
      importId,
      recordedAt: new Date(IMPORTED_AT),
    });
    return importId;
  }

  /** Per listed type: whether it is included, only under an earlier version, its first uncovered day. */
  async function situations(playerId: string) {
    const entries = await coverage(db, playerId);
    return Object.fromEntries(
      entries.map((entry) => [
        entry.eventTypeId,
        [entry.isIncluded, entry.isCoveredUnderEarlierVersion, entry.firstUncoveredOn],
      ]),
    );
  }

  /** Records a merge or a split as its screen does, in a transaction of its own. */
  async function inherit(inheritance: CoverageInheritance) {
    await db.transaction(async (tx) => inheritCoverage(tx, inheritance));
  }

  /** Marks the first version of `typeId`, born of a split, as broadening (CL-BKT-06). */
  async function broadenAtBirth(typeId: string) {
    await db
      .update(typeSheetVersions)
      .set({ isBroadening: true })
      .where(eq(typeSheetVersions.eventTypeId, typeId));
  }

  /** Gives `typeId` a later version of its sheet, broadening or not (TAX-20, TAX-24). */
  async function addVersion(typeId: string, versionNumber: number, isBroadening: boolean) {
    await db.insert(typeSheetVersions).values({
      eventTypeId: typeId,
      versionNumber,
      kind: 'substantive_change',
      substantiveScope: isBroadening ? 'broadens' : 'narrows',
      isBroadening,
      content: { name: typeId },
    });
    await db
      .update(eventTypes)
      .set({ currentVersionNumber: versionNumber })
      .where(eq(eventTypes.id, typeId));
  }

  /** Stores the player's first NBA game, on `FIRST_GAME_ON` (STA-47). */
  async function knowFirstGame(playerId: string) {
    const games = await insertLeagueSeason(db, '2024-25');
    const [gameId = 0] = games.values();
    await db.insert(playerIndicators).values({
      playerId,
      indicatorSeason: '2024-25',
      gamesPlayedThisSeason: 0,
      firstNbaGameId: gameId,
      firstNbaGameOn: FIRST_GAME_ON,
      computedAt: new Date(IMPORTED_AT),
    });
  }

  describe('recordImport', () => {
    it('[BKT-10] [BKT-13] records each retained period under its request version and imports a to-do request', async () => {
      await addVersion(MEDIA_STORM, 2, false);
      const request = await insertRequest(db, {
        playerId: player,
        types: [
          { eventTypeId: MEDIA_STORM, startOn: '2023-10-24', endOn: '2026-11-02' },
          { eventTypeId: FEUD, startOn: '2023-10-24', endOn: '2026-11-02' },
        ],
      });
      await db
        .update(backtestRequestTypes)
        .set({ sheetVersionNumber: 2 })
        .where(eq(backtestRequestTypes.eventTypeId, MEDIA_STORM));
      const id = await saveImport(request, LATER_AT);

      const result = await record(id, [
        retained(MEDIA_STORM, '2023-10-24', '2025-06-30'),
        retained(FEUD, '2024-01-01', '2025-06-30'),
      ]);

      expect(result).toStrictEqual({ ok: true });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([
        [player, '2023-10-24', '2025-06-30', 2, 'import', id, LATER_AT],
      ]);
      await expect(storedPeriods(FEUD)).resolves.toStrictEqual([
        [player, '2024-01-01', '2025-06-30', 1, 'import', id, LATER_AT],
      ]);
      await expect(requestState(request.id)).resolves.toMatchObject({
        status: 'imported',
        importedAt: new Date(LATER_AT),
        canceledAt: null,
        cancellationReasonCode: null,
        cancellationReasonText: null,
        rowVersion: 2,
      });
    });

    it('[BKT-13] imports a canceled request once confirmed, keeping its cancellation', async () => {
      const request = await insertRequest(db, { playerId: player, overrides: CANCELLATION });
      const id = await saveImport(request);
      const periods = [retained(MEDIA_STORM, '2024-01-01', '2024-12-31')];

      await expect(record(id, periods, true)).resolves.toStrictEqual({ ok: true });

      await expect(requestState(request.id)).resolves.toMatchObject({
        ...CANCELLATION,
        status: 'imported',
        importedAt: new Date(IMPORTED_AT),
        rowVersion: 2,
      });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toHaveLength(1);
    });

    it('[BKT-13] refuses a canceled request the owner did not confirm, and writes nothing', async () => {
      const request = await insertRequest(db, { playerId: player, overrides: CANCELLATION });
      const id = await saveImport(request);

      await expect(
        record(id, [retained(MEDIA_STORM, '2024-01-01', '2024-12-31')]),
      ).resolves.toStrictEqual({ ok: false, error: 'canceled_request_not_confirmed' });

      await expect(requestState(request.id)).resolves.toMatchObject({
        ...CANCELLATION,
        importedAt: null,
        rowVersion: 1,
      });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([]);
    });

    it('[BKT-13] [CL-BKT-20] leaves an imported request unchanged while a later import adds its coverage', async () => {
      const request = await insertRequest(db, { playerId: player });
      const first = await saveImport(request);
      await record(first, [retained(MEDIA_STORM, '2023-10-24', '2024-06-30')]);
      const second = await saveImport(request, LATER_AT);

      await expect(
        record(second, [retained(MEDIA_STORM, '2024-07-01', '2025-06-30')], true),
      ).resolves.toStrictEqual({ ok: true });

      await expect(requestState(request.id)).resolves.toMatchObject({
        status: 'imported',
        importedAt: new Date(IMPORTED_AT),
        rowVersion: 2,
      });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([
        [player, '2023-10-24', '2024-06-30', 1, 'import', first, IMPORTED_AT],
        [player, '2024-07-01', '2025-06-30', 1, 'import', second, LATER_AT],
      ]);
    });

    it('[CL-BKT-20] adds the import of a canceled request to the union, the request to do staying open', async () => {
      const canceled = await insertRequest(db, { playerId: player, overrides: CANCELLATION });
      const toDo = await insertRequest(db, { playerId: player });
      const earlier = await covered(toDo, MEDIA_STORM, ['2025-07-01', '2026-06-30']);
      const id = await saveImport(canceled);

      await record(id, [retained(MEDIA_STORM, ...SEASONS)], true);

      await expect(requestState(toDo.id)).resolves.toMatchObject({
        status: 'to_do',
        rowVersion: 1,
      });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([
        [player, '2025-07-01', '2026-06-30', 1, 'import', earlier, IMPORTED_AT],
        [player, ...SEASONS, 1, 'import', id, IMPORTED_AT],
      ]);
    });

    it('[BKT-10] [BKT-23] imports a request whose result retained nothing, and its player is profiled', async () => {
      const request = await insertRequest(db, { playerId: player });

      await expect(record(await saveImport(request), [])).resolves.toStrictEqual({ ok: true });

      await expect(requestState(request.id)).resolves.toMatchObject({ status: 'imported' });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([]);
      await expect(isProfiled(db, player)).resolves.toBe(true);
    });

    it('[CL-BKT-03] refuses a calendar-derived type, and writes nothing', async () => {
      await insertCalendarType(db);
      const request = await insertRequest(db, { playerId: player });
      const id = await saveImport(request);
      const year = ['2024-01-01', '2024-12-31'] as const;

      await expect(
        record(id, [retained(MEDIA_STORM, ...year), retained(BIRTHDAY, ...year)]),
      ).resolves.toStrictEqual({ ok: false, error: 'calendar_derived_type' });

      await expect(requestState(request.id)).resolves.toMatchObject({ status: 'to_do' });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([]);
    });

    it('[CL-BKT-20] writes inside the caller transaction, which takes them back when it fails', async () => {
      const request = await insertRequest(db, { playerId: player });
      const importId = await saveImport(request);
      const failure = new Error('the save failed after the coverage');
      const retainedPeriods = [retained(MEDIA_STORM, '2024-01-01', '2024-12-31')];

      await expect(
        db.transaction(async (tx) => {
          await recordImport(tx, { importId, retainedPeriods, isCanceledRequestConfirmed: false });
          throw failure;
        }),
      ).rejects.toBe(failure);

      await expect(requestState(request.id)).resolves.toMatchObject({
        status: 'to_do',
        importedAt: null,
      });
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([]);
    });

    it('[BKT-10] throws for an unknown import and for a type its request does not plan', async () => {
      await insertRequest(db, { playerId: other, types: [{ eventTypeId: FEUD, ...REQUESTED }] });
      const id = await saveImport(await insertRequest(db, { playerId: player }));

      await expect(record(id + 1, [])).rejects.toThrow(`recordImport: no import ${String(id + 1)}`);
      await expect(record(id, [retained(FEUD, '2024-01-01', '2024-12-31')])).rejects.toThrow(
        `recordImport: the request does not plan ${FEUD}`,
      );
    });

    it('[BKT-13] keeps an imported request from going back to to do (constraint)', async () => {
      const request = await insertRequest(db, { playerId: player });
      await record(await saveImport(request), []);

      await expect(
        db
          .update(backtestRequests)
          .set({ status: 'to_do' })
          .where(eq(backtestRequests.id, request.id)),
      ).rejects.toMatchObject({
        cause: { code: '23514', constraint: 'backtest_requests_imported_check' },
      });
    });
  });

  it('[BKT-10] [H-VUE-02] profiles a player from his first saved import, another player not', async () => {
    await expect(isProfiled(db, player)).resolves.toBe(false);

    await saveImport(await insertRequest(db, { playerId: player }));

    await expect(isProfiled(db, player)).resolves.toBe(true);
    await expect(isProfiled(db, other)).resolves.toBe(false);
  });

  describe('coverage', () => {
    it('[BKT-10] [CL-BKT-03] lists each research type with its periods, included whatever their version', async () => {
      await insertCalendarType(db);
      await insertEventType(db, { id: SLUMP, name: 'Scoring slump', status: 'proposed' });
      await addVersion(MEDIA_STORM, 2, false);
      await addVersion(MEDIA_STORM, 3, false);
      const request = await insertRequest(db, { playerId: player });
      const latest = await covered(request, MEDIA_STORM, ['2024-07-01', '2025-06-30']);
      const longest = await covered(request, MEDIA_STORM, ['2023-10-24', '2024-06-30', 2]);
      const shortest = await covered(request, MEDIA_STORM, ['2023-10-24', '2024-01-31']);
      await covered(await insertRequest(db, { playerId: other }), FEUD, [
        '2023-10-24',
        '2025-06-30',
      ]);

      const entries = await coverage(db, player);

      expect(entries.map((entry) => summary(entry))).toStrictEqual([
        {
          eventTypeId: MEDIA_STORM,
          name: 'Media storm',
          periods: [
            ['2023-10-24', '2024-06-30', 2, 'import', longest, IMPORTED_AT],
            ['2023-10-24', '2024-01-31', 1, 'import', shortest, IMPORTED_AT],
            ['2024-07-01', '2025-06-30', 1, 'import', latest, IMPORTED_AT],
          ],
          isIncluded: true,
          isCoveredUnderEarlierVersion: false,
          firstUncoveredOn: '2025-07-01',
        },
        {
          eventTypeId: FEUD,
          name: 'Public feud',
          periods: [],
          isIncluded: false,
          isCoveredUnderEarlierVersion: false,
          firstUncoveredOn: null,
        },
      ]);
    });

    it('[CL-BKT-05] shows a type covered only before its latest broadening as covered under an earlier version', async () => {
      await knowFirstGame(player);
      await addVersion(MEDIA_STORM, 2, true);
      await addVersion(MEDIA_STORM, 3, true);
      await addVersion(FEUD, 2, true);
      await addVersion(FEUD, 3, false);
      const request = await insertRequest(db, { playerId: player });
      await covered(request, MEDIA_STORM, [FIRST_GAME_ON, '2025-06-30', 2]);
      await covered(request, FEUD, [FIRST_GAME_ON, '2025-06-30', 2]);

      await expect(situations(player)).resolves.toStrictEqual({
        [MEDIA_STORM]: [true, true, FIRST_GAME_ON],
        [FEUD]: [true, false, '2025-07-01'],
      });
    });

    it('[BKT-10] reads the sheet versions of the covered types only', async () => {
      await covered(await insertRequest(db, { playerId: player }), MEDIA_STORM, SEASONS);
      const statements: string[] = [];
      const logQuery = (query: string) => {
        statements.push(query);
      };
      Object.assign(db._.session, { logger: { logQuery } });

      await coverage(db, player);

      expect(statements.filter((query) => query.includes('"type_sheet_versions"'))).toHaveLength(1);
    });
  });

  describe('inheritCoverage', () => {
    it('[CL-BKT-06] gives the survivor of a merge the days covered for every merged type, under its version before the merge', async () => {
      await insertEventType(db, { id: SLUMP, name: 'Scoring slump' });
      const request = await insertRequest(db, { playerId: player });
      await covered(request, MEDIA_STORM, ['2023-10-24', '2024-10-31']);
      await covered(request, FEUD, ['2025-03-01', '2025-04-30']);
      await covered(request, FEUD, ['2024-07-01', '2024-12-31']);
      await covered(request, FEUD, ['2023-01-01', '2024-03-31']);
      await covered(request, FEUD, ['2023-02-01', '2023-03-01']);
      await covered(request, FEUD, ['2024-03-31', '2024-05-31']);
      await covered(request, SLUMP, ['2020-01-01', '2026-06-30']);
      await covered(await insertRequest(db, { playerId: other }), MEDIA_STORM, SEASONS);
      const restore = installFakeClock(fixedClock(MERGED_AT));

      await inherit(MERGE);

      restore();
      await expect(storedPeriods(MEDIA_STORM)).resolves.toStrictEqual([
        [player, '2023-10-24', '2024-05-31', 1, 'merge', null, MERGED_AT],
        [player, '2024-07-01', '2024-10-31', 1, 'merge', null, MERGED_AT],
      ]);
      await expect(storedPeriods(FEUD)).resolves.toHaveLength(5);
      await expect(storedPeriods(SLUMP)).resolves.toHaveLength(1);
    });

    it('[CL-BKT-06] [CL-BKT-05] stops the inherited days counting when the merge broadened the survivor', async () => {
      await knowFirstGame(player);
      const request = await insertRequest(db, { playerId: player });
      await covered(request, MEDIA_STORM, [FIRST_GAME_ON, '2025-06-30']);
      await covered(request, FEUD, [FIRST_GAME_ON, '2025-06-30']);
      await inherit(MERGE);
      await db.insert(typeSheetVersions).values({
        eventTypeId: MEDIA_STORM,
        versionNumber: 2,
        kind: 'merge',
        mergeCoversUnion: true,
        isBroadening: true,
        content: { name: MEDIA_STORM },
      });
      await db
        .update(eventTypes)
        .set({
          status: 'withdrawn',
          withdrawalReasonKind: 'merged_into',
          mergedIntoTypeId: MEDIA_STORM,
        })
        .where(eq(eventTypes.id, FEUD));

      await expect(situations(player)).resolves.toStrictEqual({
        [MEDIA_STORM]: [true, true, FIRST_GAME_ON],
      });
    });

    it('[CL-BKT-06] gives each type born of a split the periods of the split type under version 0', async () => {
      await insertEventType(db, { id: SLUMP, name: 'Scoring slump' });
      await insertEventType(db, { id: PRESS_FEUD, name: 'Press feud' });
      await addVersion(MEDIA_STORM, 2, false);
      const request = await insertRequest(db, { playerId: player });
      await covered(request, MEDIA_STORM, ['2023-10-24', '2024-06-30']);
      await covered(request, MEDIA_STORM, ['2024-07-01', '2025-06-30', 2]);
      await covered(request, SLUMP, ['2020-01-01', '2026-06-30']);

      await inherit(SPLIT);

      const inherited = [
        [player, '2023-10-24', '2024-06-30', 0, 'split', null, IMPORTED_AT],
        [player, '2024-07-01', '2025-06-30', 0, 'split', null, IMPORTED_AT],
      ];
      await expect(storedPeriods(FEUD)).resolves.toStrictEqual(inherited);
      await expect(storedPeriods(PRESS_FEUD)).resolves.toStrictEqual(inherited);
      await expect(storedPeriods(MEDIA_STORM)).resolves.toHaveLength(2);
      await expect(storedPeriods(SLUMP)).resolves.toHaveLength(1);
    });

    it('[CL-BKT-06] counts the periods a split type inherited before its broadening version 1 only', async () => {
      await insertEventType(db, { id: PRESS_FEUD, name: 'Press feud' });
      await broadenAtBirth(PRESS_FEUD);
      await covered(await insertRequest(db, { playerId: player }), MEDIA_STORM, SEASONS);
      await inherit(SPLIT);

      await db
        .update(eventTypes)
        .set({ status: 'withdrawn', withdrawalReasonKind: 'split_into' })
        .where(eq(eventTypes.id, MEDIA_STORM));

      await expect(situations(player)).resolves.toStrictEqual({
        [FEUD]: [true, false, '2025-07-01'],
        [PRESS_FEUD]: [true, true, null],
      });
    });
  });
});

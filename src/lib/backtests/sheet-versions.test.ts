import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { backtestRequestTypes, createTestDatabase, eventTypes, typeSheetVersions } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertPlayer,
  insertRequest,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { get } from './request-detail';
import { outdatedPrompts } from './sheet-versions';

import type { Database } from '@/lib/db';
import type { LeaguePlayer, RequestRow, TypePeriod } from '@/lib/testing';

// Sunday 8 November 2026, noon in New York.
const NOW = toEpochMs(Date.UTC(2026, 10, 8, 17, 0));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FEUD = 'player-feud';
const RUMOR = 'trade-rumor';
const PERIOD = { startOn: '2023-10-24', endOn: '2026-11-08' } as const;

const ago = (ms: number) => new Date(NOW - ms);

describe('the sheet versions of the prompts', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    const restoreClock = installFakeClock(fixedClock(NOW));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Writes a request of the invented player for the types, to do and created `ageMs` ago. */
  async function request(
    source: LeaguePlayer,
    ageMs: number,
    types: readonly TypePeriod[] = [{ eventTypeId: MEDIA_STORM, ...PERIOD }],
  ): Promise<RequestRow> {
    await insertPlayer(db, { source });
    return insertRequest(db, {
      playerId: leaguePlayerId(source),
      types,
      overrides: { createdAt: ago(ageMs) },
    });
  }

  /** Gives the type a second version of its sheet, the one in force from now on. */
  async function bumpSheet(typeId: string) {
    await db.insert(typeSheetVersions).values({
      eventTypeId: typeId,
      versionNumber: 2,
      kind: 'substantive_change',
      substantiveScope: 'broadens',
      content: { name: typeId, definition: 'A broader definition.' },
    });
    await db.update(eventTypes).set({ currentVersionNumber: 2 }).where(eq(eventTypes.id, typeId));
  }

  it('[TAX-23] [BKT-15] flags each requested type whose sheet is newer than the one the prompt used', async () => {
    await insertEventType(db, { id: FEUD, name: 'Player feud' });
    await insertEventType(db, { id: RUMOR, name: 'Trade rumor' });
    // Written out of alphabetical order, to be read in it.
    const created = await request('p01', DAY, [
      { eventTypeId: RUMOR, ...PERIOD },
      { eventTypeId: MEDIA_STORM, ...PERIOD },
      { eventTypeId: FEUD, ...PERIOD },
    ]);
    await db
      .update(backtestRequestTypes)
      .set({ isRequested: false })
      .where(eq(backtestRequestTypes.eventTypeId, RUMOR));
    await bumpSheet(MEDIA_STORM);
    await bumpSheet(RUMOR);

    const detail = await get(db, created.id, NOW);

    expect(
      detail?.types.map((type) => [
        type.eventTypeId,
        type.name,
        type.isRequested,
        type.sheetVersionNumber,
        type.currentVersionNumber,
        type.isSheetOutdated,
      ]),
    ).toStrictEqual([
      [MEDIA_STORM, 'Media storm', true, 1, 2, true],
      [FEUD, 'Player feud', true, 1, 1, false],
      [RUMOR, 'Trade rumor', false, 1, 2, false],
    ]);
  });

  it('[TAX-23] flags nothing for an imported request or for a type that is no longer validated', async () => {
    await insertEventType(db, {
      id: FEUD,
      name: 'Player feud',
      status: 'withdrawn',
      withdrawalReasonKind: 'entered',
      withdrawalReason: 'No longer researched.',
    });
    const open = await request('p01', DAY, [{ eventTypeId: FEUD, ...PERIOD }]);
    await insertPlayer(db, { source: 'p02' });
    const done = await insertRequest(db, {
      playerId: leaguePlayerId('p02'),
      overrides: { status: 'imported', importedAt: ago(HOUR) },
    });
    await bumpSheet(MEDIA_STORM);
    await bumpSheet(FEUD);

    const ofDone = await get(db, done.id, NOW);
    const ofOpen = await get(db, open.id, NOW);

    expect(ofDone?.types).toMatchObject([
      { eventTypeId: MEDIA_STORM, currentVersionNumber: 2, isSheetOutdated: false },
    ]);
    expect(ofOpen?.types).toMatchObject([
      { eventTypeId: FEUD, currentVersionNumber: null, isSheetOutdated: false },
    ]);
    expect(await outdatedPrompts(db)).toStrictEqual([]);
  });

  it('[TAX-23] [BKT-15] lists the requests to do whose prompt rests on an earlier sheet, oldest first, with the types and versions', async () => {
    await insertEventType(db, { id: FEUD, name: 'Player feud' });
    await insertEventType(db, { id: RUMOR, name: 'Trade rumor' });
    const newer = await request('p01', 2 * DAY);
    // Written out of alphabetical order, to be read in it.
    const older = await request('p02', 6 * DAY, [
      { eventTypeId: RUMOR, ...PERIOD },
      { eventTypeId: MEDIA_STORM, ...PERIOD },
    ]);
    await request('p03', 4 * DAY, [{ eventTypeId: FEUD, ...PERIOD }]);
    const reduced = await request('p04', 9 * DAY);
    await db
      .update(backtestRequestTypes)
      .set({ isRequested: false })
      .where(eq(backtestRequestTypes.backtestRequestId, reduced.id));
    await bumpSheet(MEDIA_STORM);
    await bumpSheet(RUMOR);

    const outdated = await outdatedPrompts(db);

    const mediaStorm = {
      eventTypeId: MEDIA_STORM,
      name: 'Media storm',
      usedVersionNumber: 1,
      currentVersionNumber: 2,
    };
    const tradeRumor = { ...mediaStorm, eventTypeId: RUMOR, name: 'Trade rumor' };
    expect(outdated.map(({ id, reference, types }) => [id, reference, types])).toStrictEqual([
      [older.id, older.reference, [mediaStorm, tradeRumor]],
      [newer.id, newer.reference, [mediaStorm]],
    ]);
    expect(outdated.map(({ player }) => player.id)).toStrictEqual([
      leaguePlayerId('p02'),
      leaguePlayerId('p01'),
    ]);
  });

  it('[TAX-23] leaves out the requests that are not to do', async () => {
    await insertPlayer(db);
    await insertRequest(db, {
      playerId: leaguePlayerId('p01'),
      overrides: { status: 'imported', importedAt: ago(HOUR) },
    });
    await insertRequest(db, {
      playerId: leaguePlayerId('p01'),
      overrides: { status: 'canceled', canceledAt: ago(HOUR) },
    });
    await bumpSheet(MEDIA_STORM);

    expect(await outdatedPrompts(db)).toStrictEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import {
  backtestCoveragePeriods,
  backtestRequests,
  backtestRequestTypes,
  createTestDatabase,
} from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertImport, insertRequest } from './backtests';
import { insertPlayer } from './players';
import { insertEventType } from './taxonomy';

import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 2, 9));
// An instant of the import other than now.
const EARLIER = toEpochMs(Date.UTC(2026, 9, 30, 21, 45));
const BEREAVEMENT_PERIOD = {
  eventTypeId: 'bereavement',
  startOn: '2024-10-22',
  endOn: '2025-06-30',
};

describe('the backtest factories', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    await insertEventType(db);
    await insertEventType(db, { id: 'bereavement', name: 'Death of a loved one' });
    ({ id: playerId } = await insertPlayer(db));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('writes an initial request to do, its prompt produced, asking the media storm over three seasons', async () => {
    const request = await insertRequest(db, { playerId });

    expect(request).toMatchObject({
      reference: 'REQ-2026-0001',
      playerId,
      kind: 'initial',
      trigger: 'manual_action',
      status: 'to_do',
      createdOn: '2026-11-02',
      promptProducedAt: new Date(AT),
      lastCopiedAt: null,
    });
    await expect(db.select().from(backtestRequestTypes)).resolves.toMatchObject([
      {
        backtestRequestId: request.id,
        eventTypeId: 'media-storm',
        sheetVersionNumber: 1,
        periodStartOn: '2023-10-24',
        periodEndOn: '2026-11-08',
        isRequested: true,
      },
    ]);
  });

  it('numbers the references of each year in turn, as the application does', async () => {
    const first = await insertRequest(db, {
      playerId,
      overrides: { status: 'canceled', canceledAt: new Date(AT) },
    });
    const second = await insertRequest(db, { playerId });
    const earlier = await insertRequest(db, {
      playerId,
      overrides: { createdOn: '2025-03-14', status: 'canceled', canceledAt: new Date(AT) },
    });

    expect([first.reference, second.reference, earlier.reference]).toStrictEqual([
      'REQ-2026-0001',
      'REQ-2026-0002',
      'REQ-2025-0001',
    ]);
  });

  it('imports a result: the request imported, its first import numbered in turn, the periods it covers recorded', async () => {
    const request = await insertRequest(db, { playerId, types: [BEREAVEMENT_PERIOD] });
    const imported = await insertImport(db, { request, covered: [BEREAVEMENT_PERIOD] });

    expect(imported).toMatchObject({
      sequenceNumber: 1,
      backtestRequestId: request.id,
      playerId,
      importedAt: new Date(AT),
      mode: 'first_import',
      formatVersion: '1.0',
    });
    await expect(
      db
        .select({ status: backtestRequests.status, importedAt: backtestRequests.importedAt })
        .from(backtestRequests),
    ).resolves.toStrictEqual([{ status: 'imported', importedAt: new Date(AT) }]);
    await expect(db.select().from(backtestCoveragePeriods)).resolves.toMatchObject([
      {
        playerId,
        ...BEREAVEMENT_PERIOD,
        sheetVersionNumber: 1,
        origin: 'import',
        importId: imported.id,
      },
    ]);
  });

  it('covers the media storm over three seasons by default, and numbers the next import after the last', async () => {
    await insertImport(db, { request: await insertRequest(db, { playerId }) });
    const second = await insertImport(db, { request: await insertRequest(db, { playerId }) });

    expect(second.sequenceNumber).toBe(2);
    await expect(
      db.select({ type: backtestCoveragePeriods.eventTypeId }).from(backtestCoveragePeriods),
    ).resolves.toStrictEqual([{ type: 'media-storm' }, { type: 'media-storm' }]);
  });

  it('writes the mode, the truncation-recovered flag and the instant of the import that it is given, the request and the coverage at that instant', async () => {
    const request = await insertRequest(db, { playerId });

    const imported = await insertImport(db, {
      request,
      mode: 'addition',
      truncationRecovered: true,
      importedAt: new Date(EARLIER),
    });

    expect(imported).toMatchObject({
      mode: 'addition',
      truncationRecovered: true,
      importedAt: new Date(EARLIER),
    });
    await expect(
      db.select({ importedAt: backtestRequests.importedAt }).from(backtestRequests),
    ).resolves.toStrictEqual([{ importedAt: new Date(EARLIER) }]);
    await expect(
      db.select({ recordedAt: backtestCoveragePeriods.recordedAt }).from(backtestCoveragePeriods),
    ).resolves.toStrictEqual([{ recordedAt: new Date(EARLIER) }]);
  });

  it('writes a first import, which recovered no truncation, made now, unless told otherwise', async () => {
    const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });

    expect(imported).toMatchObject({
      mode: 'first_import',
      truncationRecovered: false,
      importedAt: new Date(AT),
    });
  });
});

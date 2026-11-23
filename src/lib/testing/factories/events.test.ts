import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertImport, insertRequest } from './backtests';
import { insertDetectedEvent, insertHistoricalEvent } from './events';
import { insertPlayer } from './players';
import { insertEventType } from './taxonomy';

import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));

describe('the event factories', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;

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

  it('writes a historical media storm that an import recorded, dated to the day', async () => {
    const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });

    await expect(
      insertHistoricalEvent(db, { playerId, originImportId: imported.id }),
    ).resolves.toMatchObject({
      playerId,
      eventTypeId: 'media-storm',
      sheetEventTypeId: 'media-storm',
      sheetVersionNumber: 1,
      origin: 'historical',
      referenceDateOn: '2024-11-20',
      referenceAt: null,
      referenceDatePrecision: 'approximate',
      researchConfidence: 'high',
      precedence: 'established',
      originImportId: imported.id,
      detectedStatus: null,
    });
  });

  it('writes a detected media storm dated now by its earliest source, and the columns it is given', async () => {
    const detected = await insertDetectedEvent(db, { playerId });
    const dismissed = await insertDetectedEvent(db, {
      playerId,
      overrides: {
        detectedStatus: 'dismissed',
        dismissalReason: 'old_fact',
        dismissedAt: new Date(AT),
      },
    });

    expect([detected, dismissed]).toMatchObject([
      {
        origin: 'detected',
        referenceAt: new Date(AT),
        referenceDatePrecision: 'exact',
        detectedStatus: 'detected',
        referenceDateRule: 'earliest_source',
        classificationOrigin: 'model',
        originImportId: null,
      },
      { origin: 'detected', detectedStatus: 'dismissed', dismissalReason: 'old_fact' },
    ]);
  });
});

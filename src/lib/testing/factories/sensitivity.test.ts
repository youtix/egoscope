import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertLeagueSeason } from './games';
import { insertPlayer } from './players';
import { insertValidCase } from './sensitivity';
import { insertEventType } from './taxonomy';

import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2024, 10, 19, 12));

describe('insertValidCase', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let gameIds: readonly number[];

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    await insertEventType(db);
    const season = await insertLeagueSeason(db, '2024-25');
    gameIds = Array.from(season, ([, id]) => id);
    ({ id: playerId } = await insertPlayer(db));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[SEN-07] writes a valid case: measured at its game, its normalized gap final against a final baseline', async () => {
    const [gameId = 0] = gameIds;

    await expect(insertValidCase(db, { playerId, measuredGameId: gameId })).resolves.toMatchObject({
      playerId,
      eventTypeId: 'media-storm',
      origin: 'historical',
      status: 'measured',
      statusReason: null,
      referenceInstantAt: new Date(AT),
      referenceInstantOrigin: 'date_only',
      measuredGameId: gameId,
      performanceIndex: 12.4,
      baselineGameCount: 40,
      baselineStatus: 'final',
      normalizedGap: 0.7096774193548387,
      gapStatus: 'final',
    });
  });

  it('writes the columns that it is given in place of its own', async () => {
    const [, gameId = 0] = gameIds;

    await expect(
      insertValidCase(db, {
        playerId,
        measuredGameId: gameId,
        overrides: { status: 'excluded', normalizedGap: -0.5 },
      }),
    ).resolves.toMatchObject({ status: 'excluded', normalizedGap: -0.5, measuredGameId: gameId });
  });
});

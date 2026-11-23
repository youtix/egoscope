import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, followedPlayers, statsSourceMappings } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import league from '@data/fixtures/stats-source/world/scenario.json';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertPlayer, leaguePlayerId } from './players';

import type { LeaguePlayer } from './players';
import type { Database } from '@/lib/db';

const ADDED_AT = toEpochMs(Date.UTC(2026, 10, 20, 8));
// Every player of the invented league, by his source identifier.
const SOURCES = [
  'p01',
  'p02',
  'p03',
  'p04',
  'p05',
  'p06',
  'p07',
  'p08',
  'p09',
  'p10',
] as const satisfies readonly LeaguePlayer[];

describe('insertPlayer', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(ADDED_AT));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('follows the first invented player by default, with his birthday and his mapping to the source established', async () => {
    const player = await insertPlayer(db);

    expect(player).toMatchObject({
      id: leaguePlayerId('p01'),
      displayName: 'Ansel Varga',
      displayNameNormalized: 'ansel varga',
      currentTeamId: null,
      status: 'active',
      birthdayMonth: 10,
      birthdayDay: 26,
      birthdayOrigin: 'stats_source',
      addedAt: new Date(ADDED_AT),
    });
    await expect(db.select().from(statsSourceMappings)).resolves.toMatchObject([
      {
        playerId: player.id,
        statsSource: 'sportsdataverse_espn',
        status: 'established',
        sourcePlayerRef: 'p01',
        establishedAt: new Date(ADDED_AT),
      },
    ]);
  });

  it('follows every invented player of the league under a distinct identifier, by his name as the source gives it', async () => {
    for (const source of SOURCES) {
      await insertPlayer(db, { source });
    }

    const players = await db
      .select({ id: followedPlayers.id, name: followedPlayers.displayName })
      .from(followedPlayers)
      .orderBy(followedPlayers.id);
    expect(SOURCES).toStrictEqual(league.players.map(({ id }) => id));
    expect(players).toStrictEqual(
      SOURCES.map((source, index) => ({
        id: leaguePlayerId(source),
        name: league.players[index]?.name,
      })),
    );
    expect(new Set(players.map(({ id }) => id)).size).toBe(SOURCES.length);
  });

  it('writes no birthday for the rookie whom the source gives none', async () => {
    await expect(insertPlayer(db, { source: 'p07' })).resolves.toMatchObject({
      displayName: 'Rafe Lindqvist',
      birthdayMonth: null,
      birthdayDay: null,
      birthdayOrigin: null,
    });
  });

  it('writes the columns that it is given in place of its own', async () => {
    await expect(
      insertPlayer(db, { source: 'p05', overrides: { status: 'paused', birthdayOrigin: 'owner' } }),
    ).resolves.toMatchObject({
      displayName: 'Ilias Brenner',
      status: 'paused',
      birthdayOrigin: 'owner',
    });
  });

  it('refuses a player that the invented league does not hold', async () => {
    // @ts-expect-error -- the league holds ten players, p01 to p10.
    await expect(insertPlayer(db, { source: 'p11' })).rejects.toThrow(
      'Expected the invented player p11, found none.',
    );
  });
});

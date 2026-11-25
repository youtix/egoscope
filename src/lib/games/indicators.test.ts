import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  boxScores,
  createTestDatabase,
  games,
  playerDirectoryEntries,
  playerIndicators,
  statsSourceVersions,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertLeagueSeason,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { markUnavailable } from './completeness';
import { refreshIndicators } from './indicators';

import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const STATS_SOURCE = 'sportsdataverse_espn';
const HOUR_MS = 3_600_000;
// The instant of the fake clock: the invented league's 2025-26 season is over.
const START = toEpochMs(Date.UTC(2026, 10, 10, 12));
// A day whose season no stored span tells: neither 2026-27 nor 2027-28 is stored.
const UNREAD_DAY = toEpochMs(Date.UTC(2027, 11, 1, 12));
// The first season the invented league covers, and the chosen source's (CL-STA-12).
const FIRST_COVERED = '2024-25';
const OLDEST_SEASON = '1993-94';
const P03 = leaguePlayerId('p03');

describe('the stored indicators of the player page', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    await insertLeagueSeason(db, '2025-26');
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Follows p03 with his lines of `season`. */
  async function followIn(season: string): Promise<void> {
    await insertPlayer(db, { source: 'p03' });
    await insertBoxScores(db, { playerId: P03, source: 'p03', season });
  }

  async function refresh(now: EpochMs, firstCoveredSeason: string) {
    return db.transaction(async (tx) => refreshIndicators(tx, { now, firstCoveredSeason }));
  }

  async function stored() {
    const [row] = await db
      .select()
      .from(playerIndicators)
      .where(eq(playerIndicators.playerId, P03));
    return row;
  }

  /** Lists p03 in the directory of `season`, whose box scores were read at `readAt`. */
  async function listIn(season: string, readAt: number): Promise<void> {
    await db.insert(playerDirectoryEntries).values({
      statsSource: STATS_SOURCE,
      season,
      sourcePlayerRef: 'p03',
      displayName: 'Dario Castell',
      searchNames: ['dario castell'],
      fetchedAt: new Date(readAt),
    });
    await db.insert(statsSourceVersions).values({
      statsSource: STATS_SOURCE,
      resource: 'season_box_scores',
      season,
      fetchedAt: new Date(readAt),
    });
  }

  it('[STA-46] [STA-43] [CL-STA-21] stores the games played, average minutes and last game of the season covered, from stored lines', async () => {
    await followIn('2025-26');
    expect(await refresh(START, OLDEST_SEASON)).toStrictEqual({
      refreshed: [P03],
      seasonNotRead: [],
    });
    expect(await stored()).toMatchObject({
      indicatorSeason: '2025-26',
      gamesPlayedThisSeason: 9,
      averageMinutesThisSeason: -1,
      lastGamePlayedOn: '2025-11-17',
      consecutiveTeamGamesMissed: 0,
      computedAt: new Date(START),
    });
  });

  it('[STA-46] [CL-STA-04] counts the team games missed since his last game played, an unknown one included', async () => {
    await followIn('2025-26');
    await db.transaction(async (tx) => markUnavailable(tx, { now: START, timeZone: 'UTC' }));
    const lines = await db
      .select({ id: boxScores.id, at: games.scheduledStartAt })
      .from(boxScores)
      .innerJoin(games, eq(games.id, boxScores.gameId))
      .where(eq(boxScores.status, 'complete'));
    const [first] = lines.toSorted((left, right) => left.at.getTime() - right.at.getTime());
    const later = lines.filter(({ id }) => id !== first?.id).map(({ id }) => id);
    await db.delete(boxScores).where(inArray(boxScores.id, later));
    await refresh(START, OLDEST_SEASON);
    expect(await stored()).toMatchObject({
      gamesPlayedThisSeason: 1,
      lastGamePlayedOn: '2025-10-21',
      consecutiveTeamGamesMissed: 9,
    });
  });

  it('[STA-47] [CL-STA-12] knows his first NBA game only once the box scores of every season listing him were read since his mapping', async () => {
    await insertLeagueSeason(db, FIRST_COVERED);
    await followIn('2025-26');
    await followIn(FIRST_COVERED);
    await listIn(FIRST_COVERED, START - HOUR_MS);
    await listIn('2025-26', START + HOUR_MS);
    await refresh(START, OLDEST_SEASON);
    expect(await stored()).toMatchObject({ firstNbaGameId: null, firstNbaGameOn: null });
    await db
      .update(statsSourceVersions)
      .set({ fetchedAt: new Date(START + HOUR_MS) })
      .where(eq(statsSourceVersions.season, FIRST_COVERED));
    await refresh(START, OLDEST_SEASON);
    expect(await stored()).toMatchObject({
      indicatorSeason: '2025-26',
      firstNbaGameOn: '2024-10-22',
    });
  });

  it('[STA-47] [CL-STA-12] says "date unknown" when his earliest listed season is the first one the source covers', async () => {
    await insertLeagueSeason(db, FIRST_COVERED);
    await followIn(FIRST_COVERED);
    await listIn(FIRST_COVERED, START + HOUR_MS);
    await refresh(START, FIRST_COVERED);
    expect(await stored()).toMatchObject({ firstNbaGameId: null, firstNbaGameOn: null });
  });

  it('[STA-46] [CL-STA-28] keeps the row of a player whose season the stored spans cannot tell', async () => {
    await followIn('2025-26');
    await insertPlayer(db, { source: 'p07' });
    expect(await refresh(UNREAD_DAY, OLDEST_SEASON)).toStrictEqual({
      refreshed: [],
      seasonNotRead: [P03, leaguePlayerId('p07')],
    });
    expect(await stored()).toBeUndefined();
  });

  it('[STA-46] stores nothing while no player has an established mapping', async () => {
    expect(await refresh(START, OLDEST_SEASON)).toStrictEqual({ refreshed: [], seasonNotRead: [] });
  });
});

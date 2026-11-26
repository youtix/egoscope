import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { boxScores, createTestDatabase, statsSourceMappings, teamSourceRefs } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertLeagueSeason,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { lineKey, seasonPlayers } from './line-reads';

import type { Database } from '@/lib/db';
import type { SourcePlayerId } from '@/lib/stats-source';

const SEASON = '2024-25';
const OTHER_SEASON = '2025-26';
const DAY_MS = 86_400_000;
const AT = toEpochMs(Date.UTC(2026, 10, 25, 9));
const FIRST_GAME = '2024-25:r01:h1';
const OTHER_SEASON_GAME = '2025-26:r01:h1';
const P01 = leaguePlayerId('p01');
const P06 = leaguePlayerId('p06');

describe(
  'what the box-score ingestion reads of a season',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;
    let gameIds: ReadonlyMap<string, number>;
    let otherGameIds: ReadonlyMap<string, number>;
    // Team 1, at home in the first game of each season.
    let teamId: number;

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(AT));
      gameIds = await insertLeagueSeason(db, SEASON);
      otherGameIds = await insertLeagueSeason(db, OTHER_SEASON);
      await insertPlayer(db, { source: 'p01' });
      await insertPlayer(db, { source: 'p06' });
      const [team] = await db
        .select({ teamId: teamSourceRefs.teamId })
        .from(teamSourceRefs)
        .where(eq(teamSourceRefs.sourceTeamRef, '1'));
      teamId = team?.teamId ?? 0;
      return async () => {
        restoreClock();
        await database.close();
      };
    }, DATABASE_TEST_TIMEOUT_MS);

    const idOf = (map: ReadonlyMap<string, number>, key: string): number => map.get(key) ?? 0;

    /** A stored line of the player, played unless `status` says otherwise, fetched at `fetchedAt`. */
    async function insertLine(
      playerId: string,
      {
        gameId = idOf(gameIds, FIRST_GAME),
        status = 'complete',
        fetchedAt = AT,
      }: { gameId?: number; status?: 'complete' | 'unavailable'; fetchedAt?: number } = {},
    ) {
      await db.insert(boxScores).values({
        playerId,
        gameId,
        statsSource: 'sportsdataverse_espn',
        sourcePlayerRef: playerId === P01 ? 'p01' : 'p06',
        status,
        teamId: status === 'unavailable' ? null : teamId,
        hasRoundedMinutes: false,
        fetchedAt: new Date(fetchedAt),
      });
    }

    async function players(refs: readonly SourcePlayerId[] = ['p01', 'p06']) {
      const request = { season: SEASON, knownVersion: null, players: refs };
      return db.transaction(async (tx) => seasonPlayers(tx, request));
    }

    it('[STA-03] [JOU-10] gives the requested players with an established mapping only, by their source identity', async () => {
      await insertPlayer(db, { source: 'p04' });
      await db
        .update(statsSourceMappings)
        .set({ status: 'to_establish', sourcePlayerRef: null, establishedAt: null })
        .where(eq(statsSourceMappings.playerId, P06));

      const { bySource } = await players(['p01', 'p06']);

      expect(bySource).toStrictEqual(new Map([['p01', P01]]));
    });

    it('[STA-33] [CL-STA-04] counts as read a player with a line of the season fetched since his mapping was established, never for a placeholder alone', async () => {
      await insertLine(P01);
      await insertLine(P06, { status: 'unavailable' });

      const { stored, read } = await players();

      const gameId = idOf(gameIds, FIRST_GAME);
      const keys = [lineKey(gameId, P01), lineKey(gameId, P06)];
      expect(new Set(stored.keys())).toStrictEqual(new Set(keys));
      expect(stored.get(lineKey(gameId, P06))).toMatchObject({ status: 'unavailable' });
      expect(read).toStrictEqual(new Set([P01]));
    });

    it('[STA-33] [JOU-12] counts no line fetched before his mapping was established again, which it keeps', async () => {
      await insertLine(P01);
      await insertLine(P06, { fetchedAt: AT + DAY_MS });
      await db
        .update(statsSourceMappings)
        .set({ establishedAt: new Date(AT + DAY_MS) })
        .where(eq(statsSourceMappings.statsSource, 'sportsdataverse_espn'));

      const { stored, read } = await players();

      expect(stored.size).toBe(2);
      expect(read).toStrictEqual(new Set([P06]));
    });

    it('[STA-33] [CL-STA-28] holds neither the lines of another season nor those of a player not requested', async () => {
      await insertLine(P01, { gameId: idOf(otherGameIds, OTHER_SEASON_GAME) });
      await insertLine(P06);

      const { stored, read } = await players(['p01']);

      expect(stored).toStrictEqual(new Map());
      expect(read).toStrictEqual(new Set());
    });
  },
);

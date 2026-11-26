import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { boxScores, createTestDatabase, games, incidents, series, teamSourceRefs } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertLeagueSeason,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { completeness, completeThrough, consolidate, markUnavailable } from './completeness';

import type { Database } from '@/lib/db';
import type { LeaguePlayer } from '@/lib/testing';
import type { EpochMs } from '@/lib/time';

const STATS_SOURCE = 'sportsdataverse_espn';
const PARIS = 'Europe/Paris';
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;
// The instant of the fake clock: the invented league's 2025-26 season is over.
const START = toEpochMs(Date.UTC(2026, 10, 10, 12));
// The game of the invented league listed without box scores, team 4 against team 1 (its scenario).
const WITHOUT_LINES = '2025-26:r04:h4';
const FIRST_GAME = '2025-26:r01:h1';
const P01 = leaguePlayerId('p01');
const P03 = leaguePlayerId('p03');
const P04 = leaguePlayerId('p04');
const byNumber = (left: number, right: number): number => left - right;
// The checks that a line of each status failed: a suspect line keeps at least one (STA-09).
const FAILED_CHECKS_OF = { incomplete: [], suspect: ['points_mismatch'] } as const;

/** Noon UTC, the same day in Paris, on a day counted from 1 November 2025: day 35 is 5 December. */
const noonOf = (day: number): EpochMs => toEpochMs(Date.UTC(2025, 10, day, 12));
/** An instant of November 2025, in UTC. */
const novemberAt = (day: number, hour: number, minute: number): Date =>
  new Date(Date.UTC(2025, 10, day, hour, minute));
const inParis = (now: EpochMs) => ({ now, timeZone: PARIS });
// An update less than 30 days after the game listed without box scores.
const MID_NOVEMBER = inParis(noonOf(15));

describe('the derivations after each ingestion', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let gameIds: ReadonlyMap<string, number>;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    gameIds = await insertLeagueSeason(db, '2025-26');
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  const idOf = (ref: string): number => gameIds.get(ref) ?? NaN;

  async function follow(source: LeaguePlayer): Promise<void> {
    await insertPlayer(db, { source });
    await insertBoxScores(db, { playerId: leaguePlayerId(source), source, season: '2025-26' });
  }

  async function unavailableSheets(playerId: string) {
    return db
      .select({ gameId: boxScores.gameId, status: boxScores.status })
      .from(boxScores)
      .where(and(eq(boxScores.playerId, playerId), eq(boxScores.status, 'unavailable')));
  }

  async function markAt(now: EpochMs) {
    return db.transaction(async (tx) => markUnavailable(tx, inParis(now)));
  }

  async function consolidateAt(now: number) {
    return db.transaction(async (tx) => consolidate(tx, inParis(toEpochMs(now))));
  }

  async function teamIdOf(sourceTeamRef: string): Promise<number> {
    const [team] = await db
      .select({ id: teamSourceRefs.teamId })
      .from(teamSourceRefs)
      .where(eq(teamSourceRefs.sourceTeamRef, sourceTeamRef));
    return team?.id ?? NaN;
  }

  /** The lines of the followed players, earliest game first. */
  async function linesInOrder() {
    return db
      .select({ id: boxScores.id, playerId: boxScores.playerId, gameId: boxScores.gameId })
      .from(boxScores)
      .innerJoin(games, eq(games.id, boxScores.gameId))
      .orderBy(asc(games.scheduledStartAt), asc(boxScores.id));
  }

  /** Makes a line incomplete, or suspect of a points mismatch (STA-09). */
  async function setStatus(lineId: number | undefined, status: 'incomplete' | 'suspect') {
    await db
      .update(boxScores)
      .set({ status, failedChecks: [...FAILED_CHECKS_OF[status]] })
      .where(eq(boxScores.id, lineId ?? NaN));
  }

  async function firstGameStart(): Promise<number> {
    const [game] = await db
      .select({ start: games.scheduledStartAt })
      .from(games)
      .where(eq(games.id, idOf(FIRST_GAME)));
    return game?.start.getTime() ?? NaN;
  }

  async function firstGameConsolidatedAt(): Promise<Date | null> {
    const [game] = await db
      .select({ at: games.consolidatedAt })
      .from(games)
      .where(eq(games.id, idOf(FIRST_GAME)));
    return game?.at ?? null;
  }

  describe('the completeness of a competition day', () => {
    it('[STA-35] lists the final games of a day still without box scores', async () => {
      const [incomplete, complete] = [toIsoDate('2025-10-30'), toIsoDate('2025-10-27')];
      expect(await completeness(db, incomplete)).toStrictEqual({
        day: '2025-10-30',
        gamesWithoutLines: [idOf(WITHOUT_LINES)],
      });
      expect(await completeness(db, complete)).toStrictEqual({
        day: '2025-10-27',
        gamesWithoutLines: [],
      });
    });

    it('[STA-35] gives the last complete day before the first game whose box scores are awaited', async () => {
      expect(await completeThrough(db, MID_NOVEMBER)).toBe('2025-10-27');
    });

    it('[STA-35] [CL-STA-11] counts a game past the delay as settled, and is null while no day is complete', async () => {
      expect(await completeThrough(db, inParis(START))).toBe('2025-11-17');
      await db
        .update(games)
        .set({ homeLinesPublished: false })
        .where(eq(games.gameDayOn, '2025-10-21'));
      expect(await completeThrough(db, MID_NOVEMBER)).toBeNull();
    });

    it('[STA-35] counts no day complete while one of its games is scheduled or in progress', async () => {
      const gameOn = async (day: string) => {
        const [game] = await db
          .select({ id: games.id })
          .from(games)
          .where(eq(games.gameDayOn, day));
        return game?.id ?? NaN;
      };
      const unfinished = await gameOn('2025-11-17');
      await db.update(games).set({ status: 'in_progress' }).where(eq(games.id, unfinished));
      expect(await completeThrough(db, inParis(START))).toBe('2025-11-14');
      const notStarted = await gameOn('2025-11-14');
      await db
        .update(games)
        .set({ status: 'scheduled', homeScore: null, awayScore: null })
        .where(eq(games.id, notStarted));
      expect(await completeThrough(db, inParis(START))).toBe('2025-11-11');
    });
  });

  describe('the box scores that become unavailable', () => {
    it('[STA-35] [CL-STA-11] [CL-STA-04] makes a past-season game listed without lines unavailable at once for the players of its teams', async () => {
      await follow('p01');
      await follow('p03');
      await follow('p04');
      expect(await markAt(START)).toStrictEqual({
        cause: 'new_cases',
        scope: {
          kind: 'statistics_update',
          playerIds: [P01, P03],
          gameIds: [idOf(WITHOUT_LINES)],
        },
      });
      const placeholder = [{ gameId: idOf(WITHOUT_LINES), status: 'unavailable' }];
      expect(await unavailableSheets(P03)).toStrictEqual(placeholder);
      expect(await unavailableSheets(P04)).toStrictEqual([]);
      expect(await markAt(START)).toBeNull();
    });

    it('[CL-STA-04] makes unavailable only the box scores of the team whose lines are missing', async () => {
      await follow('p03');
      await follow('p04');
      const [home, away] = [await teamIdOf('5'), await teamIdOf('4')];
      const [game] = await db
        .select({ id: games.id })
        .from(games)
        .where(and(eq(games.homeTeamId, home), eq(games.awayTeamId, away)));
      const gameId = game?.id ?? NaN;
      await db.delete(boxScores).where(eq(boxScores.gameId, gameId));
      await db.update(games).set({ awayLinesPublished: false }).where(eq(games.id, gameId));
      expect(await markAt(START)).toStrictEqual({
        cause: 'new_cases',
        scope: {
          kind: 'statistics_update',
          playerIds: [P03],
          gameIds: [idOf(WITHOUT_LINES), gameId].toSorted(byNumber),
        },
      });
      expect(await unavailableSheets(P04)).toStrictEqual([]);
    });

    it('[STA-35] [CL-STA-11] waits until more than 30 days have passed since the game’s US date', async () => {
      await follow('p03');
      expect(await markAt(noonOf(29))).toBeNull();
      expect(await unavailableSheets(P03)).toStrictEqual([]);
      expect(await markAt(noonOf(30))).not.toBeNull();
      expect(await unavailableSheets(P03)).toHaveLength(1);
    });

    it('[CL-STA-11] counts no owner’s day during which an incident stopped ingestion from the stats source', async () => {
      await follow('p03');
      await db.insert(incidents).values([
        {
          kind: 'stats_source_unavailable',
          causeKey: 'not_answering',
          status: 'closed',
          openedAt: novemberAt(5, 10, 0),
          closedAt: novemberAt(6, 10, 0),
        },
        {
          kind: 'quota_reached',
          causeKey: 'stats_source',
          serviceRole: 'stats_source',
          quotaCauses: ['limit_reached'],
          status: 'closed',
          openedAt: novemberAt(15, 10, 0),
          closedAt: novemberAt(15, 11, 0),
        },
        // Another service's quota does not stop the stats source: its day counts.
        {
          kind: 'quota_reached',
          causeKey: 'language_model',
          serviceRole: 'language_model',
          quotaCauses: ['limit_reached'],
          status: 'closed',
          openedAt: novemberAt(20, 10, 0),
          closedAt: novemberAt(20, 11, 0),
        },
        // Open across midnight in Paris: both days are lost.
        {
          kind: 'stats_source_schema_changed',
          status: 'closed',
          openedAt: novemberAt(25, 22, 30),
          closedAt: novemberAt(25, 23, 30),
        },
      ]);
      expect(await markAt(noonOf(34))).toBeNull();
      expect(await markAt(noonOf(35))).not.toBeNull();
    });

    it('[CL-STA-11] counts no day since an incident still open began', async () => {
      await follow('p03');
      await db.insert(incidents).values({
        kind: 'stats_source_unavailable',
        causeKey: 'not_answering',
        openedAt: novemberAt(29, 12, 0),
      });
      expect(await markAt(noonOf(35))).toBeNull();
    });

    it('[CL-STA-11] does not count today when an incident stopped ingestion during it', async () => {
      await follow('p03');
      await db.insert(incidents).values({
        kind: 'stats_source_unavailable',
        causeKey: 'not_answering',
        status: 'closed',
        openedAt: novemberAt(30, 9, 0),
        closedAt: novemberAt(30, 10, 0),
      });
      expect(await markAt(noonOf(30))).toBeNull();
      expect(await markAt(noonOf(31))).not.toBeNull();
    });

    it('[STA-35] keeps the line that a manual refetch brought in place of the placeholder', async () => {
      await follow('p03');
      await markAt(START);
      const teamId = await teamIdOf('4');
      await db
        .update(boxScores)
        .set({ status: 'complete', teamId, minutes: 30, seconds: 0, points: 12 })
        .where(eq(boxScores.status, 'unavailable'));
      expect(await markAt(START)).toBeNull();
      expect(await unavailableSheets(P03)).toStrictEqual([]);
    });
  });

  describe('the consolidation of games', () => {
    beforeEach(async () => {
      await db.update(games).set({ consolidatedAt: null }).where(eq(games.season, '2025-26'));
    });

    it('[STA-33] [STA-42] consolidates a final game at the first update after its correction window, never before', async () => {
      const start = await firstGameStart();
      await consolidateAt(start + WEEK_MS - 1);
      expect(await firstGameConsolidatedAt()).toBeNull();
      await consolidateAt(start + WEEK_MS);
      expect(await firstGameConsolidatedAt()).toStrictEqual(new Date(start + WEEK_MS));
    });

    it('[STA-33] [STA-42] never unconsolidates a game, and reports no change while no phase ends', async () => {
      const start = await firstGameStart();
      expect(await consolidateAt(start + WEEK_MS)).toBeNull();
      expect(await consolidateAt(start + WEEK_MS + HOUR_MS)).toBeNull();
      expect(await consolidateAt(start)).toBeNull();
      expect(await firstGameConsolidatedAt()).toStrictEqual(new Date(start + WEEK_MS));
    });

    it('[STA-33] [CL-SEN-17] gives as new cases those whose incomplete or suspect line it settles', async () => {
      await follow('p01');
      await follow('p03');
      const lines = await linesInOrder();
      const p01First = lines.find(({ playerId }) => playerId === P01);
      const p03First = lines.find(({ playerId }) => playerId === P03);
      await setStatus(p01First?.id, 'suspect');
      await setStatus(p03First?.id, 'incomplete');
      // A line of a game still inside its correction window stays pending.
      await setStatus(lines.findLast(({ playerId }) => playerId === P03)?.id, 'incomplete');
      const settled = new Set([p01First?.gameId ?? NaN, p03First?.gameId ?? NaN]);
      const start = await firstGameStart();
      expect(await consolidateAt(start + WEEK_MS)).toStrictEqual([
        {
          cause: 'new_cases',
          scope: {
            kind: 'statistics_update',
            playerIds: [P01, P03],
            gameIds: [...settled].toSorted(byNumber),
          },
        },
      ]);
    });

    it('[STA-33] [STA-20] reports no change when it consolidates a game of a phase already final', async () => {
      await follow('p03');
      const others = ne(games.id, idOf(FIRST_GAME));
      await db
        .update(games)
        .set({ consolidatedAt: new Date(START) })
        .where(and(eq(games.season, '2025-26'), others));
      expect(await consolidateAt(START)).toBeNull();
      expect(await firstGameConsolidatedAt()).toStrictEqual(new Date(START));
    });

    it('[STA-33] [CL-SEN-16] [CL-SEN-17] gives the new cases, then the cases of the season whose regular season its last consolidation makes final', async () => {
      await follow('p03');
      const lines = await linesInOrder();
      const last = lines.at(-1);
      await setStatus(last?.id, 'suspect');
      const season = await db
        .select({ id: games.id, at: games.scheduledStartAt })
        .from(games)
        .where(eq(games.season, '2025-26'));
      const end = Math.max(...season.map((game) => game.at.getTime()));
      const lastIds = season.filter((game) => game.at.getTime() === end).map(({ id }) => id);
      expect(await consolidateAt(end + WEEK_MS - 1)).toBeNull();
      expect(await consolidateAt(end + WEEK_MS)).toStrictEqual([
        {
          cause: 'new_cases',
          scope: { kind: 'statistics_update', playerIds: [P03], gameIds: [last?.gameId] },
        },
        {
          cause: 'baseline_updated',
          scope: {
            kind: 'statistics_update',
            playerIds: [P03],
            gameIds: lastIds.toSorted(byNumber),
          },
        },
      ]);
    });

    it('[STA-33] [CL-SEN-16] gives the cases when it consolidates the game that ends a postseason', async () => {
      await follow('p01');
      await db
        .update(games)
        .set({ consolidatedAt: new Date(START) })
        .where(eq(games.season, '2025-26'));
      const teams = await db
        .select({ id: teamSourceRefs.teamId })
        .from(teamSourceRefs)
        .where(inArray(teamSourceRefs.sourceTeamRef, ['1', '2']));
      const [teamA = 0, teamB = 0] = teams.map(({ id }) => id).toSorted(byNumber);
      const [finals] = await db
        .insert(series)
        .values({
          season: '2025-26',
          phase: 'playoffs',
          round: 'finals',
          teamAId: teamA,
          teamBId: teamB,
          winsNeeded: 1,
          isRebuilt: true,
        })
        .returning();
      const tipOff = Date.UTC(2026, 5, 4, 0, 30);
      const [game] = await db
        .insert(games)
        .values({
          statsSource: STATS_SOURCE,
          sourceGameRef: '2025-26:s1g1',
          season: '2025-26',
          phase: 'playoffs',
          status: 'final',
          scheduledStartAt: new Date(tipOff),
          gameDayOn: '2026-06-03',
          homeTeamId: teamA,
          awayTeamId: teamB,
          homeScore: 101,
          awayScore: 99,
          seriesId: finals?.id,
          gameNumber: 1,
          homeSeriesWinsBefore: 0,
          awaySeriesWinsBefore: 0,
          isEliminationGame: true,
          homeLinesPublished: true,
          awayLinesPublished: true,
          lastFetchedAt: new Date(START),
          scheduleChangedAt: new Date(START),
        })
        .returning({ id: games.id });
      expect(await consolidateAt(tipOff + WEEK_MS)).toStrictEqual([
        {
          cause: 'baseline_updated',
          scope: { kind: 'statistics_update', playerIds: [P01], gameIds: [game?.id] },
        },
      ]);
    });
  });
});

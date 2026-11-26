import { beforeEach, describe, expect, it } from 'vitest';

import { boxScores, createTestDatabase, games, seasons, series, teams } from '@/lib/db';
import { seasonSpans } from '@/lib/games';
import { verifyBoxScore } from '@/lib/stats-engine';
import { DATABASE_TEST_TIMEOUT_MS, insertPlayer, leaguePlayerId } from '@/lib/testing';
import { fixedClock, gameDay, installFakeClock, toEpochMs } from '@/lib/time';

import { caseSeasonsOf, playerGamesOf } from './input-games';

import type { Database } from '@/lib/db';

const P01 = leaguePlayerId('p01');
const P07 = leaguePlayerId('p07');
const SOURCE = 'sportsdataverse_espn';
const FIRST_COVERED = '2023-24';
// Tuesday 20 January 2026, noon in New York.
const NOW = toEpochMs(Date.UTC(2026, 0, 20, 17, 0));
// 1 July 2026, after the 2025-26 Finals, and 10 January 2028, which no stored span tells.
const JULY = toEpochMs(Date.UTC(2026, 6, 1, 16, 0));
const JANUARY_2028 = toEpochMs(Date.UTC(2028, 0, 10, 17, 0));
// 19:30 in New York, the start of each game of his team.
const EVENING = {
  jan15: Date.UTC(2026, 0, 16, 0, 30),
  jan17: Date.UTC(2026, 0, 18, 0, 30),
  jan19: Date.UTC(2026, 0, 20, 0, 30),
  jan21: Date.UTC(2026, 0, 22, 0, 30),
  jan23: Date.UTC(2026, 0, 24, 0, 30),
} as const;
// 00:00 in Los Angeles the next day: the end of each US day in Pacific time (CL-SEN-07).
const END_OF_JAN_15 = Date.UTC(2026, 0, 16, 8, 0);
const END_OF_JAN_17 = Date.UTC(2026, 0, 18, 8, 0);
const END_OF_JAN_19 = Date.UTC(2026, 0, 20, 8, 0);
// The night after the 15 January game, when its sheet was consolidated.
const JAN_16_NIGHT = Date.UTC(2026, 0, 16, 5, 0);
// 20:30 in New York on 9 June 2026, the one game of the 2025-26 Finals.
const FINALS_TIP_OFF = Date.UTC(2026, 5, 10, 0, 30);
// His totals in each line he played: 2 × 8 field goals, 2 threes and 4 free throws are 22 points.
const COUNTS = {
  points: 22,
  fieldGoalsMade: 8,
  fieldGoalsAttempted: 15,
  threePointersMade: 2,
  freeThrowsMade: 4,
  freeThrowsAttempted: 5,
  offensiveRebounds: 1,
  defensiveRebounds: 6,
  assists: 5,
  steals: 2,
  blocks: 1,
  turnovers: 3,
  personalFouls: 2,
} as const;
// A game whose opponent, or whose host, is still to be determined (CL-STA-14).
const TO_BE_DETERMINED = {
  status: 'scheduled',
  homeScore: null,
  awayScore: null,
  overtimeCount: null,
  homeLinesPublished: false,
  awayLinesPublished: false,
} as const;

type Teams = Readonly<{ harbor: number; ridge: number; cape: number }>;
type World = Readonly<{
  db: Database;
  teams: Teams;
  games: Readonly<Record<'older' | 'previous' | keyof typeof EVENING, number>>;
}>;

function firstOf<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error('the row looked for is missing');
  }
  return row;
}

/** 19:30 in New York on 1 November of `year`. */
const autumnOf = (year: number) => Date.UTC(year, 10, 1, 23, 30);

/** A final regular-season game of the source, `home` against `away`, starting at `at`. */
function gameRow(
  season: string,
  at: number,
  [homeTeamId, awayTeamId]: readonly [number | null, number | null],
) {
  const startAt = new Date(at);
  return {
    statsSource: SOURCE,
    sourceGameRef: `${season}-${String(at)}`,
    season,
    phase: 'regular_season',
    status: 'final',
    scheduledStartAt: startAt,
    gameDayOn: gameDay(toEpochMs(at)),
    homeTeamId,
    awayTeamId,
    homeScore: 101,
    awayScore: 99,
    overtimeCount: 0,
    homeLinesPublished: true,
    awayLinesPublished: true,
    lastFetchedAt: startAt,
    scheduleChangedAt: startAt,
  } as const;
}

async function insertGame(db: Database, row: typeof games.$inferInsert): Promise<number> {
  return firstOf(await db.insert(games).values(row).returning({ id: games.id })).id;
}

/** His line of a game of `teamId`, read from the source now. */
function lineRow(gameId: number, teamId: number | null) {
  const fetchedAt = new Date(NOW);
  return { playerId: P01, gameId, statsSource: SOURCE, sourcePlayerRef: 'p01', fetchedAt, teamId };
}

/**
 * The 2025-26 games of his team, the Harbor Herons, on 15, 17 and 19 January 2026 in the
 * evening, his line complete in seconds, then rounded with an ejection, then unavailable;
 * and two later games that still lack a team.
 */
async function insertSeasonOfHis(db: Database, { harbor, ridge, cape }: Teams) {
  const jan15 = await insertGame(db, {
    ...gameRow('2025-26', EVENING.jan15, [harbor, ridge]),
    consolidatedAt: new Date(JAN_16_NIGHT),
  });
  const jan17 = await insertGame(db, gameRow('2025-26', EVENING.jan17, [ridge, harbor]));
  const jan19 = await insertGame(db, gameRow('2025-26', EVENING.jan19, [harbor, cape]));
  const jan21 = await insertGame(db, {
    ...gameRow('2025-26', EVENING.jan21, [harbor, null]),
    ...TO_BE_DETERMINED,
  });
  const jan23 = await insertGame(db, {
    ...gameRow('2025-26', EVENING.jan23, [null, harbor]),
    ...TO_BE_DETERMINED,
  });
  const played = { ...COUNTS, status: 'complete' } as const;
  await db.insert(boxScores).values([
    {
      ...lineRow(jan15, harbor),
      ...played,
      minutes: 34,
      seconds: 30,
      hasRoundedMinutes: false,
      ejected: false,
    },
    {
      ...lineRow(jan17, harbor),
      ...played,
      minutes: 30,
      seconds: null,
      hasRoundedMinutes: true,
      ejected: true,
    },
    { ...lineRow(jan19, null), status: 'unavailable', hasRoundedMinutes: false },
  ]);
  return { jan15, jan17, jan19, jan21, jan23 };
}

/**
 * Three seasons of an invented league: 2023-24, never read, and 2024-25 hold a game of two
 * other teams; in 2025-26 his team plays in January 2026. p07 has no line.
 */
async function buildWorld(db: Database): Promise<World> {
  const teamOf = async (abbreviation: string, name: string) =>
    firstOf(await db.insert(teams).values({ abbreviation, name }).returning({ id: teams.id })).id;
  const harbor = await teamOf('HRB', 'Harbor Herons');
  const ridge = await teamOf('RDG', 'Ridge Rams');
  const cape = await teamOf('CPS', 'Cape Sparrows');
  const coverageFetchedAt = new Date(NOW);
  await db.insert(seasons).values([
    { season: '2023-24', statsSource: SOURCE },
    { season: '2024-25', statsSource: SOURCE, coverageFetchedAt },
    {
      season: '2025-26',
      statsSource: SOURCE,
      coverageFetchedAt,
      phasesWithLines: ['regular_season'],
    },
  ]);
  const older = await insertGame(db, gameRow('2023-24', autumnOf(2023), [cape, ridge]));
  const previous = await insertGame(db, gameRow('2024-25', autumnOf(2024), [cape, ridge]));
  await insertPlayer(db);
  await insertPlayer(db, { source: 'p07' });
  const ofHis = await insertSeasonOfHis(db, { harbor, ridge, cape });
  return { db, teams: { harbor, ridge, cape }, games: { older, previous, ...ofHis } };
}

/** Plays the 2025-26 Finals, one game that his team wins on 9 June 2026. */
async function playFinals(world: World) {
  const { harbor, ridge } = world.teams;
  const rows = await world.db
    .insert(series)
    .values({
      season: '2025-26',
      phase: 'playoffs',
      round: 'finals',
      teamAId: harbor,
      teamBId: ridge,
      winsNeeded: 1,
      isRebuilt: false,
    })
    .returning({ id: series.id });
  const seriesId = firstOf(rows).id;
  const gameId = await insertGame(world.db, {
    ...gameRow('2025-26', FINALS_TIP_OFF, [harbor, ridge]),
    phase: 'playoffs',
    seriesId,
    gameNumber: 1,
    isEliminationGame: true,
  });
  return { seriesId, gameId };
}

describe(
  'the games and seasons of a player’s evaluation',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;
    let world: World;

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(NOW));
      world = await buildWorld(db);
      return async () => {
        restoreClock();
        await database.close();
      };
    }, DATABASE_TEST_TIMEOUT_MS);

    it('[STA-27] [STA-09] [TRV-73] [CL-SEN-07] [CL-STA-14] gathers his team games with his participation, minutes and checked line, each with the end of its US day in Pacific time, and no game whose team is still to be determined', async () => {
      const { teamGames } = await playerGamesOf(db, P01, await seasonSpans(db));
      const { harbor, ridge, cape } = world.teams;
      const { jan15, jan17, jan19 } = world.games;
      const days = teamGames.map(({ game, gameDayOn, endOfDayPacificAt }) => {
        return [game.id, gameDayOn, endOfDayPacificAt];
      });
      expect(days).toStrictEqual([
        [jan15, '2026-01-15', END_OF_JAN_15],
        [jan17, '2026-01-17', END_OF_JAN_17],
        [jan19, '2026-01-19', END_OF_JAN_19],
      ]);
      const [inSeconds, rounded, unavailable] = teamGames;
      expect(inSeconds).toMatchObject({
        teamId: harbor,
        participation: 'played',
        minutes: 34.5,
        isBoxScoreUnavailable: false,
        boxScore: verifyBoxScore(
          { ...COUNTS, minutesPrecision: 'seconds', minutes: 34, seconds: 30 },
          0,
        ),
        ejected: false,
        game: { homeTeamId: harbor, awayTeamId: ridge, isEliminationGame: null },
      });
      expect(rounded).toMatchObject({
        participation: 'played',
        minutes: 30,
        isBoxScoreUnavailable: false,
        boxScore: verifyBoxScore(
          { ...COUNTS, minutesPrecision: 'whole_minutes', minutes: 30, seconds: null },
          0,
        ),
        ejected: true,
      });
      expect(unavailable).toMatchObject({
        game: { homeTeamId: harbor, awayTeamId: cape },
        isBoxScoreUnavailable: true,
        boxScore: null,
        ejected: null,
      });
    });

    it('[SEN-15] [CL-SEN-10] gathers the stored schedule of each of his seasons and of the stored season before, whose records the opponent criterion reads, and none for a player without a team game', async () => {
      const spans = await seasonSpans(db);
      const { schedules } = await playerGamesOf(db, P01, spans);
      const { previous, jan15, jan17, jan19, jan21, jan23 } = world.games;
      const shapes = schedules.map(({ season, schedule }) => ({
        season,
        gameIds: schedule.games.map(({ id }) => id).toSorted((a, b) => a - b),
        series: schedule.series,
        hasLaterSeasonGame: schedule.hasLaterSeasonGame,
      }));
      expect(shapes).toStrictEqual([
        { season: '2024-25', gameIds: [previous], series: [], hasLaterSeasonGame: true },
        {
          season: '2025-26',
          gameIds: [jan15, jan17, jan19, jan21, jan23],
          series: [],
          hasLaterSeasonGame: false,
        },
      ]);
      const ofSeason = schedules.at(-1)?.schedule.games;
      expect(ofSeason?.find(({ id }) => id === jan15)).toMatchObject({
        finalScore: { home: 101, away: 99 },
        scheduledStartAt: EVENING.jan15,
        consolidatedAt: JAN_16_NIGHT,
      });
      expect(ofSeason?.find(({ id }) => id === jan21)).toMatchObject({
        finalScore: null,
        homeTeamId: world.teams.harbor,
        awayTeamId: null,
        consolidatedAt: null,
      });
      await expect(playerGamesOf(db, P07, spans)).resolves.toStrictEqual({
        teamGames: [],
        schedules: [],
      });
    });

    it('[STA-45] [STA-48] [CL-STA-22] [CL-STA-30] gives the seasons as a case state reads them: the first covered season, the spans and the seasons read, each with whether it has player lines', async () => {
      const spans = await seasonSpans(db);
      const frame = { spans, at: NOW, firstCoveredSeason: FIRST_COVERED };
      await expect(caseSeasonsOf(db, frame)).resolves.toStrictEqual({
        firstCoveredSeason: FIRST_COVERED,
        spans: [
          { season: '2023-24', firstGameOn: '2023-11-01', lastGameOn: '2023-11-01' },
          { season: '2024-25', firstGameOn: '2024-11-01', lastGameOn: '2024-11-01' },
          { season: '2025-26', firstGameOn: '2026-01-15', lastGameOn: null },
        ],
        readSeasons: [
          { season: '2024-25', hasPlayerLines: false },
          { season: '2025-26', hasPlayerLines: true },
        ],
        unpublishedSeason: null,
      });
    });

    it('[STA-45] [CL-STA-22] [CL-SEN-05] gives the coming season as unpublished between seasons, and none while no stored span tells the season of the day', async () => {
      // Once the Finals are over, 2025-26 closes on 9 June 2026; on 1 July, 2026-27 has no span.
      const finals = await playFinals(world);
      const spans = await seasonSpans(db);
      const inSummer = { spans, at: JULY, firstCoveredSeason: FIRST_COVERED };
      const later = { spans, at: JANUARY_2028, firstCoveredSeason: FIRST_COVERED };
      const { unpublishedSeason: coming } = await caseSeasonsOf(db, inSummer);
      const { unpublishedSeason: unread } = await caseSeasonsOf(db, later);
      expect([coming, unread]).toStrictEqual(['2026-27', null]);
      const { teamGames, schedules } = await playerGamesOf(db, P01, spans);
      expect(schedules.at(-1)?.schedule.series).toMatchObject([
        { id: finals.seriesId, round: 'finals', winsNeeded: 1 },
      ]);
      expect(teamGames.find(({ game }) => game.id === finals.gameId)).toMatchObject({
        game: { phase: 'playoffs', isEliminationGame: true },
        isBoxScoreUnavailable: false,
        boxScore: null,
        ejected: null,
      });
    });
  },
);

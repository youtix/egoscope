import { and, eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  boxScores,
  createTestDatabase,
  followedPlayers,
  games,
  playerDirectoryEntries,
  playerIndicators,
  playerTeamChanges,
  seasons,
  series,
  teamSourceRefs,
} from '@/lib/db';
import { fakeStatsSource } from '@/lib/stats-source';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertLeagueSeason,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, gameDay, installFakeClock, toEpochMs } from '@/lib/time';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import {
  baselineInputs,
  changedSince,
  coveredSeasons,
  expectedGame,
  firstNbaGame,
  gameLog,
  indicators,
  nextGame,
  seasonBaseline,
  seasonsOf,
  seasonSpans,
  teamRecords,
} from './queries';

import type { CoveredSeason, TeamRecords } from './queries';
import type { Database, TestDatabase } from '@/lib/db';
import type { BaselineGame, EngineParams } from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

// Sunday 8 November 2026, noon in New York: 2026-27 is played up to the 7th (the league's README).
const NOW = toEpochMs(Date.UTC(2026, 10, 8, 17, 0));
const SUMMER = toEpochMs(Date.UTC(2026, 6, 1, 16, 0));
// 10 January 2028, noon in New York: no stored span tells its season.
const UNREAD_SEASON_DAY = toEpochMs(Date.UTC(2028, 0, 10, 17, 0));
// The night after the 2025-26 Finals game of 9 June 2026, still 9 June in New York.
const FINALS_NIGHT = toEpochMs(Date.UTC(2026, 5, 10, 3, 0));
const FINALS_TIP_OFF = toEpochMs(Date.UTC(2026, 5, 10, 0, 30));
const CANCELED_TIP_OFF = toEpochMs(Date.UTC(2022, 9, 20, 23, 30));
const DECEMBER = toEpochMs(Date.UTC(2026, 11, 1, 0, 0));
const HOUR = 3_600_000;
const P01 = leaguePlayerId('p01');
const UNKNOWN_PLAYER = '00000000-0000-4000-8000-000000000000';
const PARAMS: EngineParams = {
  ...engineParams,
  games: { ...engineParams.games, postseasonBaseline: 'postseason', minBaselineGames: 9 },
};
const COVERAGE = { at: NOW, firstCoveredSeason: '2024-25' };
const UNFINISHED = { finished: false, lastGameConsolidated: false };

function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error('the row looked for is missing');
  }
  return row;
}

/** The performance indices of the usable games, in order. */
const usableIndices = (classified: readonly BaselineGame[]) =>
  classified.flatMap((game) => (game.classification === 'usable' ? game.performanceIndex : []));

function sumOf(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum;
}

/** The wins and the losses of every team, added up. */
function totalOf(records: TeamRecords['season']): Readonly<{ wins: number; losses: number }> {
  const total = { wins: 0, losses: 0 };
  for (const { wins, losses } of records.values()) {
    total.wins += wins;
    total.losses += losses;
  }
  return total;
}

/** A game of the league's source between two teams, on the US Eastern day of `at`. */
function gameRow(sourceGameRef: string, at: EpochMs, [home, away]: readonly [number, number]) {
  const startAt = new Date(at);
  return {
    statsSource: 'sportsdataverse_espn' as const,
    sourceGameRef,
    scheduledStartAt: startAt,
    gameDayOn: gameDay(at),
    homeTeamId: home,
    awayTeamId: away,
    lastFetchedAt: startAt,
    scheduleChangedAt: startAt,
  };
}

const coverageLines = (rows: readonly CoveredSeason[]) =>
  rows.map(({ season, coverage }) => `${season} ${coverage}`).join(', ');

async function teamOf(db: Database, ref: string): Promise<number> {
  const rows = await db
    .select({ id: teamSourceRefs.teamId })
    .from(teamSourceRefs)
    .where(eq(teamSourceRefs.sourceTeamRef, ref));
  return only(rows).id;
}

/** The game that the league's team `ref` plays on the US date `day`. */
async function gameOn(db: Database, day: string, ref: string) {
  const teamId = await teamOf(db, ref);
  const ofTeam = or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId));
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.gameDayOn, day), ofTeam));
  return only(rows);
}

/** The league's 2025-26 and 2026-27 regular seasons, and the first invented player of team 1 with his lines. */
async function league(): Promise<TestDatabase> {
  const database = await createTestDatabase();
  const { db } = database;
  await insertLeagueSeason(db, '2025-26');
  await insertLeagueSeason(db, '2026-27');
  await insertPlayer(db, { overrides: { currentTeamId: await teamOf(db, '1') } });
  for (const season of ['2025-26', '2026-27']) {
    await insertBoxScores(db, { playerId: P01, source: 'p01', season });
  }
  return database;
}

describe('the games read API', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let database: TestDatabase;
  let db: Database;
  let restoreClock: () => void;

  beforeAll(async () => {
    restoreClock = installFakeClock(fixedClock(NOW));
    database = await league();
    ({ db } = database);
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    restoreClock();
    await database.close();
  });

  it('[STA-26] gives his team’s next scheduled game, with its opponent, venue and phase', async () => {
    const game = await gameOn(db, '2026-11-10', '1');
    const result = await nextGame(db, P01, NOW);
    const isHome = game.homeTeamId === (await teamOf(db, '1'));
    expect(result).toStrictEqual({
      ok: true,
      value: {
        kind: 'game',
        gameId: game.id,
        scheduledStartAt: game.scheduledStartAt.getTime(),
        isStartTimeTbd: false,
        gameDayOn: '2026-11-10',
        phase: 'regular_season',
        opponentTeamId: isHome ? game.awayTeamId : game.homeTeamId,
        venue: isHome ? 'home' : 'away',
        lastGamePlayedOn: null,
      },
    });
  });

  it('[STA-26] [CL-STA-20] between seasons, reads the next season’s stored games', async () => {
    const result = await nextGame(db, P01, SUMMER);
    // The league's 2026-27 games before 8 November are final: his first one still scheduled.
    const first = await gameOn(db, '2026-11-10', '1');
    expect(result).toMatchObject({ ok: true, value: { kind: 'game', gameId: first.id } });
  });

  it('[CL-STA-28] refuses with both candidate seasons when today’s season is not read', async () => {
    const result = await nextGame(db, P01, UNREAD_SEASON_DAY);
    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'schedule_not_read', candidates: ['2027-28', '2028-29'] },
    });
  });

  it('[STA-26] refuses an unknown player', async () => {
    const result = await nextGame(db, UNKNOWN_PLAYER, NOW);
    expect(result).toStrictEqual({ ok: false, error: { kind: 'player_not_found' } });
  });

  it('[STA-27] lists his team games after an instant, with his participation and minutes', async () => {
    const log = await gameLog(db, P01, toEpochMs(Date.UTC(2026, 9, 31, 12, 0)));
    expect(
      log.map(({ game, participation, minutes }) => [game.gameDayOn, participation, minutes]),
    ).toStrictEqual([
      ['2026-11-01', 'played', 28.75],
      ['2026-11-04', 'played', 15.85],
      ['2026-11-07', 'played', 22.05],
      ['2026-11-10', null, null],
      ['2026-11-13', null, null],
      ['2026-11-16', null, null],
    ]);
  });

  it('[STA-27] [CL-IMP-17] gives the first game of his teams strictly after an instant, or none', async () => {
    const game = await gameOn(db, '2026-11-07', '1');
    const start = game.scheduledStartAt.getTime();
    const before = await expectedGame(db, P01, toEpochMs(start - 1));
    const atStart = await expectedGame(db, P01, toEpochMs(start));
    expect(before?.game.id).toBe(game.id);
    expect(atStart?.game.gameDayOn).toBe('2026-11-10');
    await expect(expectedGame(db, P01, DECEMBER)).resolves.toBeNull();
  });

  it('[STA-13] [STA-14] classifies his final games of a season with their indices', async () => {
    const query = { playerId: P01, season: '2025-26', phase: { regularSeasonAt: NOW } };
    const inputs = await baselineInputs(db, query, PARAMS);
    // The league's game of 30 October 2025 is final without player lines: participation unknown.
    const withoutLines = await gameOn(db, '2025-10-30', '1');
    const usable = inputs.games.filter(({ classification }) => classification === 'usable');
    expect(inputs.games).toHaveLength(10);
    expect(usable.map(({ gameId }) => gameId)).not.toContain(withoutLines.id);
    expect(usable).toHaveLength(9);
    expect(inputs.games.find(({ gameId }) => gameId === withoutLines.id)).toMatchObject({
      classification: null,
      performanceIndex: null,
    });
  });

  it('[STA-13] gives the state of the phase asked, a postseason his team has not entered unfinished', async () => {
    const regular = { playerId: P01, season: '2025-26', phase: { regularSeasonAt: NOW } };
    const postseasonTeamId = await teamOf(db, '1');
    const postseason = { playerId: P01, season: '2026-27', phase: { postseasonTeamId } };
    const ofRegular = await baselineInputs(db, regular, PARAMS);
    const ofPostseason = await baselineInputs(db, postseason, PARAMS);
    expect(ofRegular.phaseState).toStrictEqual({ finished: true, lastGameConsolidated: true });
    expect(ofPostseason.phaseState).toStrictEqual(UNFINISHED);
  });

  it('[STA-16] [STA-19] gives the display baseline of a season, no game left out', async () => {
    const query = { playerId: P01, season: '2025-26', phase: { regularSeasonAt: NOW } };
    const { games: classified } = await baselineInputs(db, query, PARAMS);
    const indices = usableIndices(classified);
    const baseline = await seasonBaseline(db, query, PARAMS);
    expect(indices).toHaveLength(9);
    expect(baseline).toMatchObject({ status: 'final', gameCount: 9, isPartial: false });
    expect(baseline.mean).toBeCloseTo(sumOf(indices) / indices.length, 12);
  });

  it('[STA-06] [SEN-15] gives each team’s record of the season and of the previous season', async () => {
    const team1 = await teamOf(db, '1');
    const records = await teamRecords(db, '2026-27');
    // Team 1 wins every game of the league, whose 2025-26 regular season has thirty games.
    expect(records.previousSeason.size).toBe(6);
    expect(records.previousSeason.get(team1)).toStrictEqual({ wins: 10, losses: 0 });
    expect(totalOf(records.previousSeason)).toStrictEqual({ wins: 30, losses: 30 });
    expect(records.season.get(team1)).toStrictEqual({ wins: 7, losses: 0 });
  });

  it('[STA-06] [SEN-15] leaves the measured game out of the season’s records', async () => {
    const team1 = await teamOf(db, '1');
    const game = await gameOn(db, '2026-11-07', '1');
    const records = await teamRecords(db, '2026-27');
    const excluded = await teamRecords(db, '2026-27', game.id);
    const all = totalOf(records.season);
    expect(excluded.season.get(team1)).toStrictEqual({ wins: 6, losses: 0 });
    expect(totalOf(excluded.season)).toStrictEqual({ wins: all.wins - 1, losses: all.losses - 1 });
  });

  it('[STA-46] [STA-47] reads the stored indicators, a first game unknown being null', async () => {
    await expect(indicators(db, P01)).resolves.toBeNull();
    await expect(firstNbaGame(db, P01)).resolves.toBeNull();
    const game = await gameOn(db, '2025-10-21', '1');
    const stored = {
      indicatorSeason: '2026-27',
      gamesPlayedThisSeason: 7,
      averageMinutesThisSeason: 27.5,
      lastGamePlayedId: game.id,
      lastGamePlayedOn: '2026-11-07',
      consecutiveTeamGamesMissed: 0,
    };
    await db
      .insert(playerIndicators)
      .values({ playerId: P01, ...stored, computedAt: new Date(NOW) });
    await expect(indicators(db, P01)).resolves.toStrictEqual(stored);
    await expect(firstNbaGame(db, P01)).resolves.toBeNull();
    await expect(nextGame(db, P01, NOW)).resolves.toMatchObject({
      value: { lastGamePlayedOn: '2026-11-07' },
    });
  });

  it('[STA-47] reads the stored first NBA game once it is known', async () => {
    const game = await gameOn(db, '2025-10-21', '1');
    await db
      .update(playerIndicators)
      .set({ firstNbaGameId: game.id, firstNbaGameOn: '2025-10-21' })
      .where(eq(playerIndicators.playerId, P01));
    await expect(firstNbaGame(db, P01)).resolves.toStrictEqual({
      firstNbaGameId: game.id,
      firstNbaGameOn: '2025-10-21',
    });
  });

  it('[STA-43] reads stored data only: the statistics source gets no call', async () => {
    const source = fakeStatsSource();
    const operations = [
      'checkHealth',
      'getPublication',
      'getSeasonGames',
      'getSeasonBoxScores',
      'getSeasonPlayers',
      'getPlayerRecords',
    ] as const;
    const spies = operations.map((operation) => vi.spyOn(source, operation));
    const query = { playerId: P01, season: '2026-27', phase: { regularSeasonAt: NOW } };
    await Promise.all([
      nextGame(db, P01, NOW),
      gameLog(db, P01, NOW),
      expectedGame(db, P01, NOW),
      seasonBaseline(db, query, PARAMS),
      teamRecords(db, '2026-27'),
      indicators(db, P01),
      firstNbaGame(db, P01),
      coveredSeasons(db, COVERAGE),
      seasonsOf(db, P01, COVERAGE),
      changedSince(db, NOW),
    ]);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  // These change the stored schedule and his team, so they run last.
  describe('as the schedule changes', () => {
    it('[STA-28] [CL-STA-20] gives the new next game at the next read after a postponement, a new time or a trade', async () => {
      const first = await gameOn(db, '2026-11-10', '1');
      const second = await gameOn(db, '2026-11-13', '1');
      const changedAt = new Date(NOW + HOUR);
      await db
        .update(games)
        .set({ status: 'postponed', scheduleChangedAt: changedAt })
        .where(eq(games.id, first.id));
      await expect(nextGame(db, P01, NOW)).resolves.toMatchObject({ value: { gameId: second.id } });
      const changed = await changedSince(db, NOW);
      expect(changed.map(({ id }) => id)).toStrictEqual([first.id]);
      const third = await gameOn(db, '2026-11-16', '1');
      await db
        .update(games)
        .set({ scheduledStartAt: new Date(NOW + 2 * HOUR), scheduleChangedAt: changedAt })
        .where(eq(games.id, third.id));
      await expect(nextGame(db, P01, NOW)).resolves.toMatchObject({ value: { gameId: third.id } });
      await db
        .update(followedPlayers)
        .set({ currentTeamId: await teamOf(db, '2') })
        .where(eq(followedPlayers.id, P01));
      const ofTeam2 = await gameOn(db, '2026-11-10', '2');
      await expect(nextGame(db, P01, NOW)).resolves.toMatchObject({
        value: { gameId: ofTeam2.id },
      });
    });

    it('[STA-28] [CL-STA-20] answers no game scheduled once he has no team', async () => {
      await db
        .update(followedPlayers)
        .set({ currentTeamId: null })
        .where(eq(followedPlayers.id, P01));
      await expect(nextGame(db, P01, NOW)).resolves.toStrictEqual({
        ok: true,
        value: { kind: 'no_game_scheduled', reason: 'player_without_team' },
      });
    });

    it('[STA-27] [CL-STA-05] follows an entered team change', async () => {
      const team3 = await teamOf(db, '3');
      await db.insert(playerTeamChanges).values({
        playerId: P01,
        changedAt: new Date(NOW),
        previousTeamId: await teamOf(db, '1'),
        newTeamId: team3,
        origin: 'entered',
      });
      const expected = await expectedGame(db, P01, NOW);
      expect(expected?.teamId).toBe(team3);
    });

    it('[STA-12] [STA-14] [CL-STA-04] leaves unknown participation unclassified, a missing sheet not played', async () => {
      const unknown = await gameOn(db, '2026-11-07', '1');
      await db.delete(boxScores).where(eq(boxScores.gameId, unknown.id));
      await db
        .update(games)
        .set({ homeLinesPublished: false, awayLinesPublished: false })
        .where(eq(games.id, unknown.id));
      const missed = await gameOn(db, '2026-11-04', '1');
      await db.delete(boxScores).where(eq(boxScores.gameId, missed.id));
      await db.insert(boxScores).values({
        playerId: P01,
        gameId: missed.id,
        statsSource: 'sportsdataverse_espn',
        sourcePlayerRef: 'p01',
        status: 'unavailable',
        hasRoundedMinutes: false,
        fetchedAt: new Date(NOW),
      });
      const incomplete = await gameOn(db, '2026-11-01', '1');
      await db.update(boxScores).set({ points: null }).where(eq(boxScores.gameId, incomplete.id));
      const query = { playerId: P01, season: '2026-27', phase: { regularSeasonAt: NOW } };
      const { games: classified, phaseState } = await baselineInputs(db, query, PARAMS);
      const byGame = new Map(classified.map((game) => [game.gameId, game]));
      expect(byGame.get(unknown.id)).toMatchObject({
        classification: null,
        performanceIndex: null,
      });
      expect(byGame.get(missed.id)).toMatchObject({ classification: 'not_played' });
      expect(byGame.get(incomplete.id)).toMatchObject({
        classification: 'played_not_usable',
        performanceIndex: null,
      });
      expect(phaseState).toStrictEqual(UNFINISHED);
    });

    it('[STA-19] gives a building display baseline while the season goes on', async () => {
      const query = { playerId: P01, season: '2026-27', phase: { regularSeasonAt: NOW } };
      const baseline = await seasonBaseline(db, query, PARAMS);
      expect(baseline).toMatchObject({ status: 'building', isPartial: true });
    });

    it('[STA-18] [STA-19] gives the postseason display baseline, which holds no regular-season game', async () => {
      const postseasonTeamId = await teamOf(db, '1');
      const query = { playerId: P01, season: '2026-27', phase: { postseasonTeamId } };
      const baseline = await seasonBaseline(db, query, PARAMS);
      expect(baseline).toMatchObject({ status: 'building', gameCount: 0 });
    });
  });
});

describe('the season spans and coverage', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let database: TestDatabase;
  let db: Database;
  let restoreClock: () => void;
  let finalsGame: number;

  beforeAll(async () => {
    restoreClock = installFakeClock(fixedClock(NOW));
    database = await createTestDatabase();
    ({ db } = database);
    await insertLeagueSeason(db, '2024-25');
    await insertLeagueSeason(db, '2025-26');
    const [teamA, teamB] = [await teamOf(db, '1'), await teamOf(db, '3')];
    const finals = await db
      .insert(series)
      .values({
        season: '2025-26',
        phase: 'playoffs',
        round: 'finals',
        teamAId: teamA,
        teamBId: teamB,
        winsNeeded: 1,
        isRebuilt: false,
      })
      .returning({ id: series.id });
    const game = await db
      .insert(games)
      .values({
        ...gameRow('finals-2026', FINALS_TIP_OFF, [teamA, teamB]),
        season: '2025-26',
        phase: 'playoffs',
        status: 'scheduled',
        seriesId: only(finals).id,
        gameNumber: 1,
      })
      .returning({ id: games.id });
    finalsGame = only(game).id;
    await db.insert(seasons).values([
      { season: '2023-24', statsSource: 'sportsdataverse_espn', coverageFetchedAt: new Date(NOW) },
      { season: '2026-27', statsSource: 'sportsdataverse_espn' },
      { season: '2027-28', statsSource: 'sportsdataverse_espn' },
    ]);
    await db.update(seasons).set({ phasesWithLines: [] }).where(eq(seasons.season, '2024-25'));
    await insertPlayer(db);
    await db.insert(playerDirectoryEntries).values(
      ['2024-25', '2025-26'].map((season) => ({
        statsSource: 'sportsdataverse_espn' as const,
        season,
        sourcePlayerRef: 'p01',
        displayName: 'Ansel Varga',
        searchNames: ['ansel varga'],
        fetchedAt: new Date(NOW),
      })),
    );
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    restoreClock();
    await database.close();
  });

  it('[STA-48] [CL-STA-30] frames each stored season, closed once a later season is stored or its Finals are over', async () => {
    // A season whose only stored game is canceled has no regular-season game that counts: no span.
    const teams = [await teamOf(db, '1'), await teamOf(db, '3')] as const;
    await db.insert(seasons).values({ season: '2022-23', statsSource: 'sportsdataverse_espn' });
    await db.insert(games).values({
      ...gameRow('canceled-2022', CANCELED_TIP_OFF, teams),
      season: '2022-23',
      phase: 'regular_season',
      status: 'canceled',
    });
    await expect(seasonSpans(db)).resolves.toStrictEqual([
      { season: '2024-25', firstGameOn: '2024-10-22', lastGameOn: '2024-11-18' },
      { season: '2025-26', firstGameOn: '2025-10-21', lastGameOn: null },
    ]);
    await db
      .update(games)
      .set({ status: 'final', homeScore: 101, awayScore: 99 })
      .where(eq(games.id, finalsGame));
    const spans = await seasonSpans(db);
    expect(spans.at(-1)).toStrictEqual({
      season: '2025-26',
      firstGameOn: '2025-10-21',
      lastGameOn: '2026-06-09',
    });
  });

  it('[STA-45] [CL-STA-22] [CL-SEN-05] gives each season’s coverage, the coming season between seasons excepted from pending', async () => {
    // The test before has played the 2025-26 Finals game.
    const onFinalsDay = await coveredSeasons(db, { ...COVERAGE, at: FINALS_NIGHT });
    const inSummer = await coveredSeasons(db, { ...COVERAGE, at: SUMMER });
    // No stored span tells the season of that day: no season is the coming one.
    const unread = await coveredSeasons(db, { ...COVERAGE, at: UNREAD_SEASON_DAY });
    const ended = '2022-23 not_covered, 2023-24 not_covered, 2024-25 not_covered, 2025-26 covered';
    expect(coverageLines(onFinalsDay)).toBe(`${ended}, 2026-27 pending, 2027-28 pending`);
    expect(coverageLines(inSummer)).toBe(`${ended}, 2026-27 covered, 2027-28 pending`);
    expect(coverageLines(unread)).toBe(`${ended}, 2026-27 pending, 2027-28 pending`);
  });

  it('[STA-45] [CL-STA-22] gives the coverage of the seasons that list him, an ended season without lines not covered', async () => {
    await db.update(seasons).set({ phasesWithLines: [] }).where(eq(seasons.season, '2025-26'));
    const onFinalsDay = await seasonsOf(db, P01, { ...COVERAGE, at: FINALS_NIGHT });
    const inSummer = await seasonsOf(db, P01, { ...COVERAGE, at: SUMMER });
    expect(coverageLines(onFinalsDay)).toBe('2024-25 not_covered, 2025-26 covered');
    expect(coverageLines(inSummer)).toBe('2024-25 not_covered, 2025-26 not_covered');
  });
});

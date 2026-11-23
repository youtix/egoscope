import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  boxScores,
  createTestDatabase,
  games,
  seasons,
  teams,
  teamSeasons,
  teamSourceRefs,
} from '@/lib/db';
import { createFakeStatsSource } from '@/lib/stats-source';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { firstRow, readData } from '../rows';
import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertBoxScores, insertLeagueSeason } from './games';
import { insertPlayer } from './players';

import type { Database } from '@/lib/db';
import type { SeasonGames, SourceBoxScore, SourceGame } from '@/lib/stats-source';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8));
const CONTEXT = {
  deadline: toEpochMs(Date.UTC(2026, 10, 20, 9)),
  signal: new AbortController().signal,
};

/** The season's games as the fake serves them. */
async function served(season: string): Promise<SeasonGames> {
  const answer = await createFakeStatsSource().getSeasonGames(CONTEXT, {
    season,
    knownVersion: null,
  });
  return readData(answer, `the games of ${season}`);
}

/** The player's lines of the season as the fake serves them. */
async function servedLines(season: string, player: string): Promise<readonly SourceBoxScore[]> {
  const answer = await createFakeStatsSource().getSeasonBoxScores(CONTEXT, {
    season,
    knownVersion: null,
    players: [player],
  });
  return readData(answer, `the lines of ${player} in ${season}`);
}

/** Says whether `game` is one of the regular season that counts, which the factory writes. */
const isRegular = (game: SourceGame): boolean =>
  game.phase === 'regular_season' && game.exclusion === null;

/** The first of `lines` that the source times to the second, with its minutes and seconds. */
function firstTimedLine(lines: readonly SourceBoxScore[]) {
  for (const { game, playingTime } of lines) {
    if (playingTime?.precision === 'seconds') {
      return { game, minutes: playingTime.minutes, seconds: playingTime.seconds };
    }
  }
  throw new Error('Expected a line timed to the second, found none.');
}

describe('the league factories', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it("writes the season's regular-season games, teams and coverage as the statistics-source fake serves them", async () => {
    const data = await served('2024-25');
    const ids = await insertLeagueSeason(db, '2024-25');
    const regular = data.games.filter((game) => isRegular(game));
    const first = firstRow(regular, 'a game of the regular season');

    expect(new Set(ids.keys())).toStrictEqual(new Set(regular.map(({ game }) => game)));
    await expect(
      db.select().from(games).where(eq(games.sourceGameRef, first.game)),
    ).resolves.toMatchObject([
      {
        id: ids.get(first.game),
        season: '2024-25',
        phase: 'regular_season',
        status: first.status,
        scheduledStartAt: new Date(first.tipOff),
        gameDayOn: first.gameDay,
        homeScore: first.score?.home,
        awayScore: first.score?.away,
        homeLinesPublished: true,
        awayLinesPublished: true,
      },
    ]);
    await expect(db.select().from(seasons)).resolves.toMatchObject([
      {
        season: '2024-25',
        phasesWithLines: data.coverage.phasesWithBoxScores,
        gamesWithoutLines: data.coverage.gamesWithoutBoxScores.length,
      },
    ]);
    await expect(
      db
        .select({ ref: teamSourceRefs.sourceTeamRef, name: teams.name })
        .from(teamSourceRefs)
        .innerJoin(teams, eq(teams.id, teamSourceRefs.teamId))
        .orderBy(asc(teamSourceRefs.sourceTeamRef)),
    ).resolves.toStrictEqual(
      data.teams.map((team) => ({ ref: team.team, name: `${team.location} ${team.name}` })),
    );
  });

  it('writes nothing twice, and keeps a team that moved under its first name with the names of each season', async () => {
    await insertLeagueSeason(db, '2024-25');
    const again = await insertLeagueSeason(db, '2024-25');
    await insertLeagueSeason(db, '2025-26');

    await expect(db.select().from(games).where(eq(games.season, '2024-25'))).resolves.toHaveLength(
      again.size,
    );
    await expect(db.select().from(teams)).resolves.toHaveLength(6);
    await expect(
      db
        .select({ season: teamSeasons.season, abbreviation: teamSeasons.abbreviation })
        .from(teamSeasons)
        .innerJoin(teamSourceRefs, eq(teamSourceRefs.teamId, teamSeasons.teamId))
        .where(eq(teamSourceRefs.sourceTeamRef, '6'))
        .orderBy(asc(teamSeasons.season)),
    ).resolves.toStrictEqual([
      { season: '2024-25', abbreviation: 'SPG' },
      { season: '2025-26', abbreviation: 'RVG' },
    ]);
  });

  it('leaves the lines of a game that is not played yet unpublished', async () => {
    const data = await served('2026-27');
    await insertLeagueSeason(db, '2026-27');
    const upcoming = firstRow(
      data.games.filter((game) => isRegular(game) && game.status === 'scheduled'),
      'a game not played yet',
    );

    await expect(
      db
        .select({
          status: games.status,
          homeScore: games.homeScore,
          homeLinesPublished: games.homeLinesPublished,
        })
        .from(games)
        .where(eq(games.sourceGameRef, upcoming.game)),
    ).resolves.toStrictEqual([{ status: 'scheduled', homeScore: null, homeLinesPublished: false }]);
  });

  it("writes a player's lines of the regular-season games held as the fake serves them, in whole minutes", async () => {
    const ids = await insertLeagueSeason(db, '2024-25');
    const player = await insertPlayer(db);
    const lines = await servedLines('2024-25', 'p01');
    const written = await insertBoxScores(db, {
      playerId: player.id,
      source: 'p01',
      season: '2024-25',
    });
    const held = lines.filter(({ game }) => ids.has(game));
    const line = firstRow(held, 'a line of a game held');
    const [stored] = await db
      .select()
      .from(boxScores)
      .innerJoin(games, eq(games.id, boxScores.gameId))
      .where(eq(games.sourceGameRef, line.game));

    // A double round robin of six teams: ten games each, the playoffs left out.
    expect(written).toBe(10);
    expect(held).toHaveLength(written);
    expect(stored?.box_scores).toMatchObject({
      playerId: player.id,
      sourcePlayerRef: 'p01',
      status: 'complete',
      minutes: line.playingTime?.minutes,
      seconds: null,
      hasRoundedMinutes: true,
      points: line.counts.points,
      assists: line.counts.assists,
      fetchedAt: new Date(AT),
    });
  });

  it('writes the minutes and seconds of a season that gives them, and the lines of games he did not play', async () => {
    await insertLeagueSeason(db, '2025-26');
    const player = await insertPlayer(db, { source: 'p08' });
    await insertBoxScores(db, { playerId: player.id, source: 'p08', season: '2025-26' });
    const timed = firstTimedLine(await servedLines('2025-26', 'p08'));
    const lineOf = async (where: ReturnType<typeof eq>) =>
      db
        .select({
          minutes: boxScores.minutes,
          seconds: boxScores.seconds,
          hasRoundedMinutes: boxScores.hasRoundedMinutes,
        })
        .from(boxScores)
        .innerJoin(games, eq(games.id, boxScores.gameId))
        .where(where);

    await expect(lineOf(eq(games.gameDayOn, '2025-11-08'))).resolves.toStrictEqual([
      { minutes: null, seconds: null, hasRoundedMinutes: false },
    ]);
    await expect(lineOf(eq(games.sourceGameRef, timed.game))).resolves.toStrictEqual([
      { minutes: timed.minutes, seconds: timed.seconds, hasRoundedMinutes: false },
    ]);
  });

  it('writes no line twice, and none of a season whose games the database does not hold', async () => {
    await insertLeagueSeason(db, '2024-25');
    const { id: playerId } = await insertPlayer(db);
    const first = await insertBoxScores(db, { playerId, source: 'p01', season: '2024-25' });

    await expect(insertBoxScores(db, { playerId, source: 'p01', season: '2024-25' })).resolves.toBe(
      0,
    );
    await expect(insertBoxScores(db, { playerId, source: 'p01', season: '2025-26' })).resolves.toBe(
      0,
    );
    await expect(db.select().from(boxScores)).resolves.toHaveLength(first);
  });
});

// A few days after the last games of 2026-27 that the league has played, before 8 November 2026.
const LATER = toEpochMs(Date.UTC(2026, 10, 10, 8));
const WINDOW_MS = 7 * 86_400_000;

/** How each stored game of `season` stands against its correction window at LATER (STA-33). */
async function consolidation(db: Database, season: string): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ status: games.status, tipOff: games.scheduledStartAt, at: games.consolidatedAt })
    .from(games)
    .where(eq(games.season, season));
  return new Set(
    rows.map(({ status, tipOff, at }) => {
      const window = tipOff.getTime() + WINDOW_MS <= LATER ? 'window over' : 'in its window';
      return `${status}, ${window}, ${at === null ? 'not consolidated' : at.toISOString()}`;
    }),
  );
}

describe('the consolidation of the games', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(LATER));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[STA-33] consolidates a final game once its correction window of 7 days is over, and no other', async () => {
    await insertLeagueSeason(db, '2026-27');

    await expect(consolidation(db, '2026-27')).resolves.toStrictEqual(
      new Set([
        `final, window over, ${new Date(LATER).toISOString()}`,
        'final, in its window, not consolidated',
        'postponed, window over, not consolidated',
        'scheduled, in its window, not consolidated',
      ]),
    );
  });
});

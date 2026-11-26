import { and, eq, sql } from 'drizzle-orm';

import {
  boxScores,
  games,
  parameterOverrides,
  seasons,
  teams,
  teamSeasons,
  teamSourceRefs,
} from '@/lib/db';
import { createFakeStatsSource } from '@/lib/stats-source';
import { now, toEpochMs } from '@/lib/time';

import { firstRow, readData } from '../rows';
import { engineParamsOf, setOwnerParam } from './params';

import type { LeaguePlayer } from './players';
import type { Database } from '@/lib/db';
import type {
  CallContext,
  FakeStatsSource,
  PlayingTime,
  SeasonGames,
  SourceGame,
  SourceGameId,
  SourceTeamId,
} from '@/lib/stats-source';

const STATS_SOURCE = 'sportsdataverse_espn';
// Time enough for the fake, which answers at once, to answer.
const CALL_WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;
// The most games a baseline of the invented league holds: a team's ten games of a
// season, the measured game excluded (STA-17, STA-19).
const LEAGUE_BASELINE_GAMES = 9;
const MIN_BASELINE_KEY = 'games.minBaselineGames';

/** A fresh fake of the statistics source, which serves the invented league without fault, and the context of a call to it. */
function league(): Readonly<{ source: FakeStatsSource; ctx: CallContext }> {
  return {
    source: createFakeStatsSource(),
    ctx: { deadline: toEpochMs(now() + CALL_WINDOW_MS), signal: new AbortController().signal },
  };
}

/** The team that the source names `ref`, as a subquery of its identifier in the database. */
const teamOf = (ref: SourceTeamId | null) =>
  sql<number>`(SELECT ${teamSourceRefs.teamId} FROM ${teamSourceRefs} WHERE ${teamSourceRefs.statsSource} = ${STATS_SOURCE} AND ${teamSourceRefs.sourceTeamRef} = ${ref})`;

/** The game that the source names `ref`, as a subquery of its identifier in the database. */
const gameOf = (ref: SourceGameId) =>
  sql<number>`(SELECT ${games.id} FROM ${games} WHERE ${games.statsSource} = ${STATS_SOURCE} AND ${games.sourceGameRef} = ${ref})`;

/** Writes each team of the season that the database does not know yet, under its source identifier, and its names of the season. */
async function writeTeams(db: Database, data: SeasonGames, season: string): Promise<void> {
  const refs = await db.select({ ref: teamSourceRefs.sourceTeamRef }).from(teamSourceRefs);
  const known = new Set(refs.map(({ ref }) => ref));
  const unknown = data.teams.filter(({ team: ref }) => !known.has(ref));
  for (const team of unknown) {
    const inserted = await db
      .insert(teams)
      .values({ abbreviation: team.abbreviation, name: `${team.location} ${team.name}` })
      .returning({ id: teams.id });
    const { id } = firstRow(inserted, `the team ${team.team}`);
    await db
      .insert(teamSourceRefs)
      .values({ teamId: id, statsSource: STATS_SOURCE, sourceTeamRef: team.team });
  }
  await db
    .insert(teamSeasons)
    .values(
      data.teams.map((team) => ({
        teamId: teamOf(team.team),
        season,
        name: team.name,
        location: team.location,
        abbreviation: team.abbreviation,
      })),
    )
    .onConflictDoNothing();
}

/**
 * The row of a regular-season game as the fake serves it, its lines published when the
 * season's box scores hold them, and consolidated when it is final and its correction
 * window, `correctionWindowMs` long, was over before now (STA-33).
 */
function gameRow(game: SourceGame, data: SeasonGames, correctionWindowMs: number) {
  const at = now();
  const fetchedAt = new Date(at);
  const hasLines =
    game.status === 'final' && !data.coverage.gamesWithoutBoxScores.includes(game.game);
  const isConsolidated = game.status === 'final' && game.tipOff + correctionWindowMs <= at;
  return {
    statsSource: STATS_SOURCE,
    sourceGameRef: game.game,
    season: game.season,
    phase: game.phase,
    status: game.status,
    scheduledStartAt: new Date(game.tipOff),
    isStartTimeTbd: !game.isTimeKnown,
    gameDayOn: game.gameDay,
    homeTeamId: teamOf(game.homeTeam),
    awayTeamId: teamOf(game.awayTeam),
    homeScore: game.score?.home,
    awayScore: game.score?.away,
    overtimeCount: game.overtimes,
    homeLinesPublished: hasLines,
    awayLinesPublished: hasLines,
    consolidatedAt: isConsolidated ? fetchedAt : null,
    lastFetchedAt: fetchedAt,
    scheduleChangedAt: fetchedAt,
  } as const;
}

/**
 * Sets the minimum baseline size, `games.minBaselineGames`, to the league's nine games
 * through the registry, as the owner would (STA-19, TRV-35), unless the database already
 * overrides it.
 */
async function setLeagueBaseline(db: Database): Promise<void> {
  const owned = await db
    .select({ key: parameterOverrides.parameterKey })
    .from(parameterOverrides)
    .where(eq(parameterOverrides.parameterKey, MIN_BASELINE_KEY));
  if (owned.length === 0) {
    await setOwnerParam(db, MIN_BASELINE_KEY, LEAGUE_BASELINE_GAMES);
  }
}

/**
 * Writes `season` of the invented league as the statistics-source fake serves it
 * (TRV-15): the season and its coverage, its teams under their source identifiers, and
 * every game of its regular season, unless they are written already, so that the fake
 * and the database agree and scenarios combine. A team of the league plays ten games a
 * season, so a baseline holds nine at most, under the default minimum of ten: unless the
 * database already overrides it, the minimum baseline size, `games.minBaselineGames`, is
 * set to 9, a value of its range (STA-19), so that a case of the league can be measured:
 * saved through the registry, so that its history and the journal record the change
 * (TRV-35). A game is consolidated by the correction window in force (STA-33). Gives
 * the identifier of each game of the season by the source's game identifier.
 */
export async function insertLeagueSeason(
  db: Database,
  season: string,
): Promise<ReadonlyMap<SourceGameId, number>> {
  await setLeagueBaseline(db);
  const params = await engineParamsOf(db);
  const correctionWindowMs = params.games.correctionWindowDays * DAY_MS;
  const { source, ctx } = league();
  const data = readData(
    await source.getSeasonGames(ctx, { season, knownVersion: null }),
    `the games of ${season}`,
  );
  await db
    .insert(seasons)
    .values({
      season,
      statsSource: STATS_SOURCE,
      phasesWithLines: [...data.coverage.phasesWithBoxScores],
      gamesWithoutLines: data.coverage.gamesWithoutBoxScores.length,
      coverageFetchedAt: new Date(now()),
    })
    .onConflictDoNothing();
  await writeTeams(db, data, season);
  const regularSeason = data.games.filter(
    (game) => game.phase === 'regular_season' && game.exclusion === null,
  );
  await db
    .insert(games)
    .values(regularSeason.map((game) => gameRow(game, data, correctionWindowMs)))
    .onConflictDoNothing();
  const written = await db
    .select({ id: games.id, ref: games.sourceGameRef })
    .from(games)
    .where(and(eq(games.statsSource, STATS_SOURCE), eq(games.season, season)));
  return new Map(written.map(({ id, ref }) => [ref, id]));
}

/** The minutes and seconds of a line, and whether the source rounded them to the minute. */
function playingTimeColumns(time: PlayingTime | null) {
  if (time === null) {
    return { minutes: null, seconds: null, hasRoundedMinutes: false };
  }
  return time.precision === 'seconds'
    ? { minutes: time.minutes, seconds: time.seconds, hasRoundedMinutes: false }
    : { minutes: time.minutes, seconds: null, hasRoundedMinutes: true };
}

/** What `insertBoxScores` takes: the followed player, the invented player he is, and the season. */
export type BoxScoreFactoryOptions = Readonly<{
  playerId: string;
  source: LeaguePlayer;
  season: string;
}>;

/**
 * Writes the player's box scores of the season's games that the database holds, as
 * the statistics-source fake serves them (TRV-15), did-not-play lines included, each
 * one complete, unless they are written already, so that scenarios combine. Gives the
 * number of lines written.
 */
export async function insertBoxScores(
  db: Database,
  { playerId, source: player, season }: BoxScoreFactoryOptions,
): Promise<number> {
  const { source, ctx } = league();
  const lines = readData(
    await source.getSeasonBoxScores(ctx, { season, knownVersion: null, players: [player] }),
    `the box scores of ${player} in ${season}`,
  );
  const seasonGames = await db
    .select({ ref: games.sourceGameRef })
    .from(games)
    .where(eq(games.season, season));
  const held = new Set(seasonGames.map(({ ref }) => ref));
  const fetchedAt = new Date(now());
  const rows = lines
    .filter((line) => held.has(line.game))
    .map(
      (line) =>
        ({
          playerId,
          gameId: gameOf(line.game),
          statsSource: STATS_SOURCE,
          sourcePlayerRef: player,
          status: 'complete',
          teamId: teamOf(line.team),
          ...playingTimeColumns(line.playingTime),
          ...line.counts,
          ejected: line.ejected,
          fetchedAt,
        }) as const,
    );
  if (rows.length === 0) {
    return 0;
  }
  const written = await db
    .insert(boxScores)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: boxScores.id });
  return written.length;
}

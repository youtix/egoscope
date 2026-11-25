// What the reads of queries.ts share: the stored games and box-score lines as the
// statistics core reads them, the season frames read from a few aggregates, and the pure
// steps that turn stored rows into the core's inputs (STA-43: stored data only, the
// statistics source is never asked).
import 'server-only';

import { asc, eq, gt, inArray, sql } from 'drizzle-orm';

import { boxScores, games, playerTeamChanges, series } from '@/lib/db';
import {
  classifyGame,
  performanceIndex,
  teamMembership,
  teamRecord,
  verifyBoxScore,
} from '@/lib/stats-engine';
import { toEpochMs } from '@/lib/time';

import type { GameRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type {
  BaselineGame,
  BoxScoreLine,
  GameId,
  LinesGame,
  NextGameCandidate,
  PhaseSeries,
  PlayerGame,
  PlayerId,
  PlayerLine,
  SeasonSpan,
  SeasonSpanInput,
  TeamGame,
  TeamId,
  TeamStint,
  TeamWinLossRecord,
} from '@/lib/stats-engine';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A connection or the caller's transaction, to read through. */
export type Reader = Database | Transaction;

/**
 * A stored game as the statistics core reads it (STA-05, STA-31, CL-STA-14): its season,
 * its overtimes, null when unknown, and the last instant its schedule changed (STA-28).
 */
export type StoredGame = NextGameCandidate &
  LinesGame &
  Readonly<{ season: string; overtimeCount: number | null; scheduleChangedAt: EpochMs }>;

/** One season's stored schedule as phaseState reads it, its games as stored games (CL-STA-18). */
export type StoredSchedule = Readonly<{
  games: readonly StoredGame[];
  series: readonly PhaseSeries[];
  hasLaterSeasonGame: boolean;
}>;

/** His box-score lines and his stints with teams (CL-STA-05). */
export type Membership = Readonly<{ stints: readonly TeamStint[]; lines: readonly PlayerLine[] }>;

/** A season's coverage by the source (STA-45, CL-STA-22): pending while its games are not read. */
export type SeasonCoverage = 'covered' | 'not_covered' | 'pending';

/** What a coverage read needs: the instant asked about and the first season the source covers. */
export type CoverageQuery = Readonly<{ at: EpochMs; firstCoveredSeason: string }>;

/** What the coverage of one stored season is read from (CL-STA-22). */
export type SeasonRead = Readonly<{
  season: string;
  phasesWithLines: readonly string[];
  coverageFetchedAt: Date | null;
}>;

/** The frame of a coverage read: the spans, the day asked about and the coming season, if any. */
export type CoverageContext = CoverageQuery &
  Readonly<{ spans: readonly SeasonSpan[]; todayOn: IsoDate; coming: string | null }>;

// Neither postponed games without a make-up nor canceled games count (CL-STA-17).
const COUNTED = sql`${games.status} NOT IN ('postponed', 'canceled')`;
// A season is named by its first year, then the last two digits of the next: 2024-25.
const YEAR_LENGTH = 4;
const CENTURY = 100;
const SHORT_YEAR_DIGITS = 2;

/** The instant of a `timestamptz` read back, in epoch milliseconds (TRV-68). */
export const instant = (at: Date): EpochMs => toEpochMs(at.getTime());

/** The season `offset` seasons after `season` (STA-48): 2025-26 for 2024-25 and 1, 2023-24 for -1. */
export function seasonFrom(season: string, offset: number): string {
  const year = Number(season.slice(0, YEAR_LENGTH)) + offset;
  return `${String(year)}-${String((year + 1) % CENTURY).padStart(SHORT_YEAR_DIGITS, '0')}`;
}

/** A stored game row as the core reads it, its instants in epoch milliseconds (STA-05, STA-31). */
export function storedGame(row: GameRow): StoredGame {
  const { homeScore: home, awayScore: away, consolidatedAt } = row;
  return {
    ...row,
    finalScore: home === null || away === null ? null : { home, away },
    scheduledStartAt: instant(row.scheduledStartAt),
    consolidatedAt: consolidatedAt === null ? null : instant(consolidatedAt),
    scheduleChangedAt: instant(row.scheduleChangedAt),
  };
}

/** Every stored game of `ofSeasons`, of every phase and status (STA-05, STA-43). */
export async function gamesOf(
  db: Reader,
  ofSeasons: readonly string[],
): Promise<readonly StoredGame[]> {
  const rows = await db.select().from(games).where(inArray(games.season, ofSeasons));
  return rows.map((row) => storedGame(row));
}

/** One season's stored schedule, with whether a game of a later season is stored (CL-STA-18). */
export async function scheduleOf(db: Reader, season: string): Promise<StoredSchedule> {
  const later = await db
    .select({ id: games.id })
    .from(games)
    .where(gt(games.season, season))
    .limit(1);
  return {
    games: await gamesOf(db, [season]),
    series: await db.select().from(series).where(eq(series.season, season)),
    hasLaterSeasonGame: later.length > 0,
  };
}

/**
 * The days that frame each stored season, in season order, from one grouped read (STA-48,
 * CL-STA-17): its first regular-season game and its last game over the games that count,
 * and its last final playoff game.
 */
export async function seasonDays(
  db: Reader,
): Promise<readonly Omit<SeasonSpanInput, 'isFinalsOver'>[]> {
  const day = games.gameDayOn;
  const firstRegular = sql`min(${day}) FILTER (WHERE ${games.phase} = 'regular_season' AND ${COUNTED})`;
  const lastPlayoff = sql`max(${day}) FILTER (WHERE ${games.phase} = 'playoffs' AND ${games.status} = 'final')`;
  return db
    .select({
      season: games.season,
      firstRegularSeasonGameOn: sql<string | null>`(${firstRegular})::text`,
      lastPlayoffGameOn: sql<string | null>`(${lastPlayoff})::text`,
      // Every stored season has a game: one that counts unless all are canceled or postponed.
      lastGameOn: sql<string>`coalesce(max(${day}) FILTER (WHERE ${COUNTED}), max(${day}))::text`,
    })
    .from(games)
    .groupBy(games.season)
    .orderBy(asc(games.season));
}

/** The Finals of each season whose Finals games are stored, with those games (CL-STA-18). */
export async function finalsOf(
  db: Reader,
): Promise<ReadonlyMap<string, Readonly<{ finals: PhaseSeries; games: StoredGame[] }>>> {
  const rows = await db
    .select({ finals: series, game: games })
    .from(series)
    .innerJoin(games, eq(games.seriesId, series.id))
    .where(eq(series.round, 'finals'));
  const bySeason = new Map<string, { finals: PhaseSeries; games: StoredGame[] }>();
  for (const { finals, game } of rows) {
    const entry = bySeason.get(finals.season) ?? { finals, games: [] };
    entry.games.push(storedGame(game));
    bySeason.set(finals.season, entry);
  }
  return bySeason;
}

function boxScoreLine(row: typeof boxScores.$inferSelect): BoxScoreLine {
  const { minutes, seconds, hasRoundedMinutes, ...counts } = row;
  return hasRoundedMinutes
    ? { ...counts, minutesPrecision: 'whole_minutes', minutes, seconds: null }
    : { ...counts, minutesPrecision: 'seconds', minutes, seconds };
}

/**
 * His box-score lines, the placeholder of an unavailable sheet being none, and his stints
 * from them and from his team history (STA-08, CL-STA-05, CL-JOU-03).
 */
export async function membershipOf(db: Reader, playerId: PlayerId): Promise<Membership> {
  const rows = await db
    .select({ row: boxScores, startAt: games.scheduledStartAt })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(eq(boxScores.playerId, playerId));
  const lines = rows.flatMap(({ row, startAt }) =>
    row.teamId === null
      ? []
      : {
          gameId: row.gameId,
          scheduledStartAt: instant(startAt),
          teamId: row.teamId,
          line: boxScoreLine(row),
        },
  );
  const history = await db
    .select()
    .from(playerTeamChanges)
    .where(eq(playerTeamChanges.playerId, playerId));
  const changes = history.map((change) => ({ ...change, changedAt: instant(change.changedAt) }));
  return { stints: teamMembership(lines, changes), lines };
}

/** A final team game as the threshold reads it: the check of his line when he played (STA-14). */
export function playerGameOf(
  { game, participation }: TeamGame<StoredGame>,
  line: BoxScoreLine | undefined,
): PlayerGame {
  const boxScore =
    participation === 'played' && line !== undefined
      ? verifyBoxScore(line, game.overtimeCount)
      : null;
  return { gameId: game.id, scheduledStartAt: game.scheduledStartAt, phase: game.phase, boxScore };
}

/**
 * A final team game as a baseline reads it (STA-12 to STA-14, CL-STA-04): no class while his
 * participation is unknown; not played; played, usable with its index once complete and at
 * the threshold, not usable otherwise, with its index only when complete.
 */
export function baselineGameOf(
  participation: TeamGame['participation'],
  played: PlayerGame,
  threshold: number,
): BaselineGame {
  const { gameId, scheduledStartAt, phase, boxScore } = played;
  const of = { gameId, scheduledStartAt, phase };
  if (participation === 'unknown') {
    return { ...of, classification: null, performanceIndex: null };
  }
  if (boxScore === null) {
    return { ...of, classification: 'not_played', performanceIndex: null };
  }
  if (boxScore.status !== 'complete') {
    return { ...of, classification: 'played_not_usable', performanceIndex: null };
  }
  const index = performanceIndex(boxScore);
  return classifyGame(played, threshold) === 'usable'
    ? { ...of, classification: 'usable', performanceIndex: index }
    : { ...of, classification: 'played_not_usable', performanceIndex: index };
}

/** Each team's regular-season record over `ofSeason`, `excludedGameId` left out (STA-06). */
export function recordsOf(
  ofSeason: readonly StoredGame[],
  excludedGameId: GameId | undefined,
): ReadonlyMap<TeamId, TeamWinLossRecord> {
  const teamIds = new Set(ofSeason.flatMap((game) => [game.homeTeamId, game.awayTeamId]));
  const records = [...teamIds]
    .filter((teamId) => teamId !== null)
    .map((teamId) => [teamId, teamRecord(ofSeason, teamId, excludedGameId)] as const);
  return new Map(records);
}

/**
 * A season's coverage (STA-45, CL-STA-22, CL-STA-30): not covered before the first covered
 * season, or once it has ended, from the day after its last game, its games read and none
 * with player lines; pending while its games are not read, but for the coming season
 * between seasons, which is covered; covered otherwise.
 */
export function coverageOf(row: SeasonRead, context: CoverageContext): SeasonCoverage {
  if (row.season < context.firstCoveredSeason) {
    return 'not_covered';
  }
  if (row.coverageFetchedAt === null) {
    return row.season === context.coming ? 'covered' : 'pending';
  }
  const lastOn = context.spans.find(({ season }) => season === row.season)?.lastGameOn ?? null;
  const hasEnded = lastOn !== null && context.todayOn > lastOn;
  return hasEnded && row.phasesWithLines.length === 0 ? 'not_covered' : 'covered';
}

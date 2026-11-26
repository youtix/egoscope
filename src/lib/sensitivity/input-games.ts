// The games and seasons of a player's evaluation input (STA-27, STA-45, SEN-15), read from
// stored data alone for inputs.ts. Each team game carries the end of its US day in Pacific
// time, where an uncertain precedence shifts an event (TRV-73, CL-SEN-07).
import 'server-only';

import { asc, eq, inArray, isNotNull } from 'drizzle-orm';

import { boxScores, games, seasons, series } from '@/lib/db';
import { gameLog } from '@/lib/games';
import { seasonOfDate, verifyBoxScore } from '@/lib/stats-engine';
import { endOfDayPacific, gameDay, toEpochMs, toIsoDate } from '@/lib/time';

import type { Database, Transaction } from '@/lib/db';
import type { BoxScoreRow, GameRow, StoredGame } from '@/lib/games';
import type {
  BoxScoreLine,
  CaseSeasons,
  EvaluationTeamGame,
  PhaseGame,
  PlayerEvaluationInput,
  SeasonSpan,
  TeamGame,
} from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

// Every team game starts after the first instant of the epoch: the source's seasons are later.
const BEFORE_EVERY_GAME = toEpochMs(0);

const instant = (at: Date): EpochMs => toEpochMs(at.getTime());

/** His line as the checks read it, the source's rounded minutes kept as such (STA-08, STA-09). */
function lineOf(row: BoxScoreRow): BoxScoreLine {
  const { minutes, seconds, hasRoundedMinutes, ...counts } = row;
  return hasRoundedMinutes
    ? { ...counts, minutesPrecision: 'whole_minutes', minutes, seconds: null }
    : { ...counts, minutesPrecision: 'seconds', minutes, seconds };
}

/** A stored game as the phase of its season reads it (STA-20, CL-STA-18). */
function phaseGameOf(row: GameRow): PhaseGame {
  const { homeScore: home, awayScore: away, consolidatedAt } = row;
  return {
    ...row,
    finalScore: home === null || away === null ? null : { home, away },
    scheduledStartAt: instant(row.scheduledStartAt),
    consolidatedAt: consolidatedAt === null ? null : instant(consolidatedAt),
  };
}

/**
 * One of his team games as the engine reads it (STA-27, CL-SEN-07, CL-SEN-11): his
 * participation and minutes, the end of its US day in Pacific time, his checked line, the
 * placeholder of an unavailable sheet and his ejection; none while a team is still to be
 * determined, since such a placeholder is no team's game (CL-STA-14).
 */
function teamGameOf(
  teamGame: TeamGame<StoredGame>,
  facts: Readonly<{ line: BoxScoreRow | undefined; isEliminationGame: boolean | null }>,
): EvaluationTeamGame | null {
  const { game } = teamGame;
  const { homeTeamId, awayTeamId } = game;
  if (homeTeamId === null || awayTeamId === null) {
    return null;
  }
  const { line, isEliminationGame } = facts;
  const isUnavailable = line?.status === 'unavailable';
  return {
    ...teamGame,
    game: { ...game, homeTeamId, awayTeamId, isEliminationGame },
    gameDayOn: game.gameDayOn,
    endOfDayPacificAt: endOfDayPacific(toIsoDate(game.gameDayOn)),
    isBoxScoreUnavailable: isUnavailable,
    boxScore:
      line === undefined || isUnavailable ? null : verifyBoxScore(lineOf(line), game.overtimeCount),
    ejected: line?.ejected ?? null,
  };
}

/**
 * His team games of every season (STA-27, TRV-73, CL-SEN-07), each with the end of its US
 * day in Pacific time, and the stored schedule of each of their seasons and of the stored
 * season right before, whose records the opponent criterion reads (SEN-15, CL-SEN-10): a
 * season's games, its series, and whether a later season is stored. The spans, in season
 * order, name every stored season.
 */
export async function playerGamesOf(
  db: Reader,
  playerId: string,
  spans: readonly SeasonSpan[],
): Promise<Pick<PlayerEvaluationInput, 'teamGames' | 'schedules'>> {
  const log = await gameLog(db, playerId, BEFORE_EVERY_GAME);
  const ofHis = new Set(log.map(({ game }) => game.season));
  const names = spans
    .filter(({ season }, index) => ofHis.has(season) || ofHis.has(spans[index + 1]?.season ?? ''))
    .map(({ season }) => season);
  const rows = await db.select().from(games).where(inArray(games.season, names));
  const seriesRows = await db.select().from(series).where(inArray(series.season, names));
  const lines = await db.select().from(boxScores).where(eq(boxScores.playerId, playerId));
  const lineOfGame = new Map(lines.map((line) => [line.gameId, line]));
  const eliminationOf = new Map(rows.map((row) => [row.id, row.isEliminationGame]));
  const teamGames = log.flatMap((teamGame) => {
    const { id } = teamGame.game;
    const facts = { line: lineOfGame.get(id), isEliminationGame: eliminationOf.get(id) ?? null };
    return teamGameOf(teamGame, facts) ?? [];
  });
  const schedules = names.map((season) => ({
    season,
    schedule: {
      games: rows.filter((row) => row.season === season).map((row) => phaseGameOf(row)),
      series: seriesRows.filter((row) => row.season === season),
      hasLaterSeasonGame: spans.some((span) => span.season > season),
    },
  }));
  return { teamGames, schedules };
}

/**
 * The seasons as a case state reads them (STA-45, STA-48, CL-STA-22, CL-STA-30): the
 * source's first season, the spans, the seasons whose games are read, each with whether
 * one has player lines, and, between seasons, the coming season while no span of it is
 * stored, its schedule unpublished (CL-SEN-05).
 */
export async function caseSeasonsOf(
  db: Reader,
  frame: Readonly<{ spans: readonly SeasonSpan[]; at: EpochMs; firstCoveredSeason: string }>,
): Promise<CaseSeasons> {
  const { spans, at, firstCoveredSeason } = frame;
  const read = await db
    .select({ season: seasons.season, phasesWithLines: seasons.phasesWithLines })
    .from(seasons)
    .where(isNotNull(seasons.coverageFetchedAt))
    .orderBy(asc(seasons.season));
  const today = seasonOfDate(gameDay(at), spans);
  return {
    firstCoveredSeason,
    spans,
    readSeasons: read.map(({ season, phasesWithLines }) => ({
      season,
      hasPlayerLines: phasesWithLines.length > 0,
    })),
    unpublishedSeason:
      today.ok && spans.every(({ season }) => season !== today.season) ? today.season : null,
  };
}

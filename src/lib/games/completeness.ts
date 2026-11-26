// What is derived after each ingestion of the stats source (module map §2.4, games), from
// stored data only, without a request to the source (STA-43): the completeness of a
// competition day (STA-35), the box scores that become unavailable (STA-35, CL-STA-11) and
// the consolidation of games past their correction window (STA-33, STA-42); the indicators
// of the player page are in indicators.ts. A step that changes cases gives them back, for its
// caller to record their recalculation job in the same transaction (CL-SEN-16, CL-SEN-17).
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, not, or, sql } from 'drizzle-orm';

import { boxScores, games, incidents, series } from '@/lib/db';
import { getParams } from '@/lib/params';
import { phaseState, teamGames } from '@/lib/stats-engine';
import { endOfLocalDay, startOfLocalDay, toEpochMs, userDay } from '@/lib/time';

import { STATS_SOURCE } from './directory';
import { instant, linesGameOf, mappedPlayers } from './indicators';

import type { CasesChange, CasesChanges, GameRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { IncidentKind } from '@/lib/incidents';
import type {
  GameId,
  PhaseGame,
  PlayerId,
  SeasonSchedule,
  StatisticsUpdateCause,
} from '@/lib/stats-engine';
import type { EpochMs, IsoDate } from '@/lib/time';

type Executor = Database | Transaction;

const DAY_MS = 86_400_000;
// The incidents that stop ingestion from the stats source, whose days never count toward the
// delay of an unavailable box score; the quota one counts only for the stats source (CL-STA-11).
const STOPPING_KINDS = [
  'stats_source_unavailable',
  'stats_source_schema_changed',
] as const satisfies readonly IncidentKind[];
const STOPPING_INCIDENT = or(
  inArray(incidents.kind, STOPPING_KINDS),
  and(eq(incidents.kind, 'quota_reached'), eq(incidents.serviceRole, 'stats_source')),
);
// A final game for which the source has not published the lines of one of its teams (CL-STA-04).
const WITHOUT_LINES = and(
  eq(games.status, 'final'),
  or(not(games.homeLinesPublished), not(games.awayLinesPublished)),
);
// A game not over yet, or not updated since its tip-off: its day is not complete (STA-35).
const NOT_OVER = inArray(games.status, ['scheduled', 'in_progress']);
// The lines whose case waits for the game's consolidation, and is not measurable after it (SEN-07).
const AWAITING_CONSOLIDATION = ['incomplete', 'suspect'] as const;

/** What the derivations take beyond the database: the update's instant and the owner's zone, the `display.timeZone` setting. */
export type DerivationContext = Readonly<{ now: EpochMs; timeZone: string }>;

/** The final games of one competition day, a US date, whose box scores are still missing (STA-35). */
export type DayCompleteness = Readonly<{ day: IsoDate; gamesWithoutLines: readonly GameId[] }>;

/** What a step changed in cases: the recalculation of `cause` its caller records, or null (CL-SEN-17). */
export type DerivedChange<C extends StatisticsUpdateCause> = CasesChange<C> | null;

/** The change of `cause` of the cases of `playerIds`, in the order given, that `gameIds` concern; null when no player is concerned. */
function changeOf<C extends StatisticsUpdateCause>(
  cause: C,
  playerIds: readonly PlayerId[],
  gameIds: readonly GameId[],
): DerivedChange<C> {
  if (playerIds.length === 0) {
    return null;
  }
  const sortedGames = [...new Set(gameIds)].toSorted((left, right) => left - right);
  return {
    cause,
    scope: { kind: 'statistics_update', playerIds: [...new Set(playerIds)], gameIds: sortedGames },
  };
}

/**
 * The completeness of `day`, a competition day (US date): its final games for which the
 * source has not published the lines of both teams yet, in id order (STA-35, CL-STA-04).
 */
export async function completeness(db: Executor, day: IsoDate): Promise<DayCompleteness> {
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.gameDayOn, day), WITHOUT_LINES))
    .orderBy(asc(games.id));
  return { day, gamesWithoutLines: rows.map(({ id }) => id) };
}

/**
 * The first US date from which a missing box score is still awaited: a game of an earlier
 * day has more than `games.boxScoreUnavailableAfterDays` counted days since its US date. The
 * days are the owner's, walked back from today; a day does not count when an incident that
 * stops ingestion from the stats source was open at some moment of it, as the stored
 * incident periods say (CL-STA-11).
 */
async function awaitedFrom(db: Executor, { now, timeZone }: DerivationContext): Promise<IsoDate> {
  const params = await getParams(db);
  const afterDays = params.get('games.boxScoreUnavailableAfterDays');
  const periods = await db
    .select({ from: incidents.openedAt, until: incidents.closedAt })
    .from(incidents)
    .where(STOPPING_INCIDENT);
  const isStopped = (day: IsoDate): boolean =>
    periods.some(
      ({ from, until }) =>
        instant(from) < endOfLocalDay(day, timeZone) &&
        (until === null || instant(until) > startOfLocalDay(day, timeZone)),
    );
  let day = userDay(now, timeZone);
  let counted = isStopped(day) ? 0 : 1;
  while (counted <= afterDays) {
    day = userDay(toEpochMs(startOfLocalDay(day, timeZone) - 1), timeZone);
    counted += isStopped(day) ? 0 : 1;
  }
  return day;
}

/**
 * The last complete competition day: the latest US date of a final game such that no game
 * of that day or before is still scheduled or in progress, and no final one still awaits its
 * box scores, a game whose box scores are missing past the delay of STA-35 being settled as
 * unavailable; null when no day is complete (STA-35, CL-STA-11).
 */
export async function completeThrough(
  db: Executor,
  ctx: DerivationContext,
): Promise<IsoDate | null> {
  const from = await awaitedFrom(db, ctx);
  const awaitedLines = and(WITHOUT_LINES, gte(games.gameDayOn, from));
  const [awaited] = await db
    .select({ day: sql<IsoDate | null>`min(${games.gameDayOn})::text` })
    .from(games)
    .where(or(NOT_OVER, awaitedLines));
  const before = awaited?.day ?? null;
  const [complete] = await db
    .select({ day: sql<IsoDate | null>`max(${games.gameDayOn})::text` })
    .from(games)
    .where(
      and(eq(games.status, 'final'), before === null ? undefined : lt(games.gameDayOn, before)),
    );
  return complete?.day ?? null;
}

/**
 * Marks unavailable, with the placeholder row, each box score still missing whose game is
 * past the delay: a final team game of a followed player (CL-STA-05) whose participation
 * is unknown, his team's lines unpublished, more than `games.boxScoreUnavailableAfterDays`
 * counted days after its US date (CL-STA-11), so that a past-season game listed without
 * lines is unavailable at once. A placeholder stays until a refetch brings his line.
 * Gives the cases it concerns, which leave the pending state: « nouveaux cas » (STA-35,
 * CL-STA-04, CL-SEN-16, CL-SEN-17).
 */
export async function markUnavailable(
  tx: Transaction,
  ctx: DerivationContext,
): Promise<DerivedChange<'new_cases'>> {
  const from = await awaitedFrom(tx, ctx);
  const candidates = await tx
    .select()
    .from(games)
    .where(and(WITHOUT_LINES, lt(games.gameDayOn, from)));
  if (candidates.length === 0) {
    return null;
  }
  const schedule = candidates.map((row) => linesGameOf(row));
  const fetchedAt = new Date(ctx.now);
  const players = await mappedPlayers(tx);
  const placeholders = players.flatMap((player) =>
    teamGames(player, schedule, -Infinity)
      .filter(({ participation }) => participation === 'unknown')
      .map(({ game }) => ({
        playerId: player.playerId,
        gameId: game.id,
        statsSource: STATS_SOURCE,
        sourcePlayerRef: player.sourcePlayerRef,
        status: 'unavailable' as const,
        hasRoundedMinutes: false,
        fetchedAt,
      })),
  );
  if (placeholders.length === 0) {
    return null;
  }
  const written = await tx
    .insert(boxScores)
    .values(placeholders)
    .onConflictDoNothing()
    .returning({ playerId: boxScores.playerId, gameId: boxScores.gameId });
  const playerIds = written.map(({ playerId }) => playerId);
  return changeOf(
    'new_cases',
    playerIds,
    written.map(({ gameId }) => gameId),
  );
}

const phaseGameOf = (row: GameRow): PhaseGame => ({
  ...linesGameOf(row),
  consolidatedAt: row.consolidatedAt === null ? null : instant(row.consolidatedAt),
});

/**
 * Whether each phase of `game` is final in `schedule`, finished with its last game
 * consolidated: the regular season league-wide, or the postseason of each of its teams
 * (STA-20, CL-STA-02).
 */
function finalPhases(schedule: SeasonSchedule, game: GameRow): readonly boolean[] {
  if (game.phase === 'regular_season') {
    const at = instant(game.scheduledStartAt);
    return [phaseState(schedule, { regularSeasonAt: at }).lastGameConsolidated];
  }
  const teamIds = [game.homeTeamId, game.awayTeamId].filter((teamId) => teamId !== null);
  return teamIds.map(
    (teamId) => phaseState(schedule, { postseasonTeamId: teamId })?.lastGameConsolidated === true,
  );
}

/**
 * Whether consolidating `consolidated` makes a phase of `season` final: its last game
 * consolidated now and not before, which turns its baselines final (STA-20, STA-33).
 */
async function doesEndAPhase(
  tx: Transaction,
  season: string,
  consolidated: readonly GameRow[],
): Promise<boolean> {
  const rows = await tx.select().from(games).where(eq(games.season, season));
  const [later] = await tx
    .select({ id: games.id })
    .from(games)
    .where(gt(games.season, season))
    .limit(1);
  const ids = new Set(consolidated.map(({ id }) => id));
  const seasonSeries = await tx.select().from(series).where(eq(series.season, season));
  const common = { series: seasonSeries, hasLaterSeasonGame: later !== undefined };
  const after = { ...common, games: rows.map((row) => phaseGameOf(row)) };
  const before = {
    ...common,
    games: after.games.map((game) => (ids.has(game.id) ? { ...game, consolidatedAt: null } : game)),
  };
  return consolidated.some((game) => {
    const finalBefore = finalPhases(before, game);
    return finalPhases(after, game).some(
      (isFinal, index) => isFinal && finalBefore[index] !== true,
    );
  });
}

/**
 * The cases that consolidating `consolidated` takes out of the pending state: those of the
 * players whose line of one of these games is incomplete or suspect, not measurable from now
 * on (SEN-07, CL-SEN-17).
 */
async function settledCases(
  tx: Transaction,
  consolidated: readonly GameRow[],
): Promise<DerivedChange<'new_cases'>> {
  if (consolidated.length === 0) {
    return null;
  }
  const ofGames = inArray(
    boxScores.gameId,
    consolidated.map(({ id }) => id),
  );
  const lines = await tx
    .select({ playerId: boxScores.playerId, gameId: boxScores.gameId })
    .from(boxScores)
    .where(and(ofGames, inArray(boxScores.status, AWAITING_CONSOLIDATION)))
    .orderBy(asc(boxScores.playerId), asc(boxScores.gameId));
  return changeOf(
    'new_cases',
    lines.map(({ playerId }) => playerId),
    lines.map(({ gameId }) => gameId),
  );
}

/**
 * The cases of the seasons whose phase consolidating `consolidated` made final, the players
 * with a line in them, since their baselines turn final: « référence mise à jour » (STA-20,
 * CL-SEN-17).
 */
async function finalBaselineCases(
  tx: Transaction,
  consolidated: readonly GameRow[],
): Promise<DerivedChange<'baseline_updated'>> {
  const seasons = new Set(consolidated.map((game) => game.season));
  const ended: string[] = [];
  for (const season of seasons) {
    const ofSeason = consolidated.filter((game) => game.season === season);
    if (await doesEndAPhase(tx, season, ofSeason)) {
      ended.push(season);
    }
  }
  if (ended.length === 0) {
    return null;
  }
  const players = await tx
    .selectDistinct({ playerId: boxScores.playerId })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(inArray(games.season, ended))
    .orderBy(asc(boxScores.playerId));
  const endingGames = consolidated.filter((game) => ended.includes(game.season));
  return changeOf(
    'baseline_updated',
    players.map(({ playerId }) => playerId),
    endingGames.map(({ id }) => id),
  );
}

/**
 * Consolidates each final game whose correction window, `games.correctionWindowDays` from
 * its scheduled start, is over: `consolidated_at` set once and never cleared, so it is never
 * requested again (STA-33, STA-42). Gives the changes of cases, in the order of CL-SEN-17:
 * the new cases of the incomplete or suspect lines it settles (SEN-07), then the baselines
 * of the phases it made final (STA-20); null when it changes no case (CL-SEN-16).
 */
export async function consolidate(
  tx: Transaction,
  ctx: DerivationContext,
): Promise<CasesChanges | null> {
  const params = await getParams(tx);
  const windowStart = new Date(ctx.now - params.get('games.correctionWindowDays') * DAY_MS);
  const consolidated = await tx
    .update(games)
    .set({ consolidatedAt: new Date(ctx.now) })
    .where(
      and(
        eq(games.status, 'final'),
        isNull(games.consolidatedAt),
        lte(games.scheduledStartAt, windowStart),
      ),
    )
    .returning();
  const newCases = await settledCases(tx, consolidated);
  const baselineUpdated = await finalBaselineCases(tx, consolidated);
  if (newCases === null) {
    return baselineUpdated === null ? null : [baselineUpdated];
  }
  return baselineUpdated === null ? [newCases] : [newCases, baselineUpdated];
}

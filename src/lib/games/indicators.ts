// The stored indicators of the player page and the first NBA game (module map §2.4, games;
// STA-46, STA-47, CL-STA-12), refreshed after each ingestion from stored data only, without
// a request to the source (STA-43), and the read of the followed players' stored lines and
// team membership that the derivations of completeness.ts share. Split from completeness.ts,
// which the plan gives these derivations, to keep each file within the size limit.
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';

import {
  boxScores,
  games,
  playerDirectoryEntries,
  playerIndicators,
  playerTeamChanges,
  statsSourceMappings,
  statsSourceVersions,
} from '@/lib/db';
import { firstNbaGameOf, indicatorsOf, seasonSpan, teamMembership } from '@/lib/stats-engine';
import { gameDay, toEpochMs } from '@/lib/time';

import { establishedMappings } from './mapping';

import type { GameRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type {
  CareerSeasons,
  IndicatorLine,
  LinesGame,
  PlayerId,
  SeasonSpan,
  TeamStint,
} from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

type Executor = Database | Transaction;

// The games that some rule counts: neither canceled nor postponed (CL-STA-17).
const COUNTED = sql`${games.status} NOT IN ('postponed', 'canceled')`;

/** What refreshIndicators did: the players whose row it wrote, and those whose season the stored spans cannot tell (CL-STA-28). */
export type RefreshedIndicators = Readonly<{
  refreshed: readonly PlayerId[];
  seasonNotRead: readonly PlayerId[];
}>;

/** A followed player with an established mapping, his source identity, stored lines and team membership (CL-STA-05). */
type MappedPlayer = Readonly<{
  playerId: PlayerId;
  sourcePlayerRef: string;
  lines: readonly IndicatorLine[];
  stints: readonly TeamStint[];
}>;

/** The instant of a `timestamptz` read back, in epoch milliseconds. */
export const instant = (date: Date): EpochMs => toEpochMs(date.getTime());

/** A stored game as the schedule rules of the engine read it (CL-STA-04). */
export const linesGameOf = (row: GameRow): LinesGame => ({
  ...row,
  finalScore:
    row.homeScore === null || row.awayScore === null
      ? null
      : { home: row.homeScore, away: row.awayScore },
  scheduledStartAt: instant(row.scheduledStartAt),
});

type LineRow = Readonly<{ line: typeof boxScores.$inferSelect; game: GameRow }>;

/** His line of a game, or none for the placeholder of an unavailable sheet (STA-08, STA-35). */
function lineOf({ line, game }: LineRow): readonly IndicatorLine[] {
  const { teamId, minutes, seconds, hasRoundedMinutes, ...counts } = line;
  if (teamId === null) {
    return [];
  }
  return [
    {
      gameId: game.id,
      scheduledStartAt: instant(game.scheduledStartAt),
      teamId,
      gameDayOn: game.gameDayOn,
      overtimeCount: game.overtimeCount,
      line: hasRoundedMinutes
        ? { ...counts, minutesPrecision: 'whole_minutes', minutes, seconds: null }
        : { ...counts, minutesPrecision: 'seconds', minutes, seconds },
    },
  ];
}

/**
 * Every followed player with an established mapping, in id order, with his stored lines and
 * his team membership from them and from his team history (CL-STA-05). Three queries.
 */
export async function mappedPlayers(db: Executor): Promise<readonly MappedPlayer[]> {
  const mappings = await establishedMappings(db);
  const playerIds = Array.from(mappings, ([playerId]) => playerId);
  if (playerIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ line: boxScores, game: games })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(inArray(boxScores.playerId, playerIds));
  const changes = await db
    .select()
    .from(playerTeamChanges)
    .where(inArray(playerTeamChanges.playerId, playerIds));
  return Array.from(mappings, ([playerId, sourcePlayerRef]) => {
    const ofPlayer = rows.filter((row) => row.line.playerId === playerId);
    const lines = ofPlayer.flatMap((row) => lineOf(row));
    const history = changes
      .filter((change) => change.playerId === playerId)
      .map((change) => ({ ...change, changedAt: instant(change.changedAt) }));
    return { playerId, sourcePlayerRef, lines, stints: teamMembership(lines, history) };
  });
}

/**
 * The span of every stored season as the indicators read it (STA-48, CL-STA-28): a season
 * closes once a game of a later season is stored. The latest one stays open: the indicators
 * file only today's date and days of stored games by these spans, which an open last
 * season files as a closed one would, so its Finals need no read.
 */
async function seasonSpans(db: Executor): Promise<readonly SeasonSpan[]> {
  const day = games.gameDayOn;
  const days = await db
    .select({
      season: games.season,
      firstRegularSeasonGameOn: sql<
        string | null
      >`(min(${day}) FILTER (WHERE ${games.phase} = 'regular_season' AND ${COUNTED}))::text`,
      lastPlayoffGameOn: sql<
        string | null
      >`(max(${day}) FILTER (WHERE ${games.phase} = 'playoffs' AND ${games.status} = 'final'))::text`,
      lastGameOn: sql<string>`coalesce(max(${day}) FILTER (WHERE ${COUNTED}), max(${day}))::text`,
    })
    .from(games)
    .groupBy(games.season)
    .orderBy(asc(games.season));
  return days.flatMap(
    (row, index) => seasonSpan({ ...row, isFinalsOver: index < days.length - 1 }) ?? [],
  );
}

/**
 * The seasons whose directory lists each player, with whether their box scores are stored
 * for him: read since his mapping was established (CL-STA-12).
 */
async function listedSeasons(
  db: Executor,
): Promise<ReadonlyMap<PlayerId, CareerSeasons['listedSeasons']>> {
  const rows = await db
    .select({
      playerId: statsSourceMappings.playerId,
      season: playerDirectoryEntries.season,
      areBoxScoresStored: sql<boolean>`coalesce(${statsSourceVersions.fetchedAt} >= ${statsSourceMappings.establishedAt}, false)`,
    })
    .from(playerDirectoryEntries)
    .innerJoin(
      statsSourceMappings,
      and(
        eq(statsSourceMappings.statsSource, playerDirectoryEntries.statsSource),
        eq(statsSourceMappings.sourcePlayerRef, playerDirectoryEntries.sourcePlayerRef),
      ),
    )
    .leftJoin(
      statsSourceVersions,
      and(
        eq(statsSourceVersions.statsSource, playerDirectoryEntries.statsSource),
        eq(statsSourceVersions.resource, 'season_box_scores'),
        eq(statsSourceVersions.season, playerDirectoryEntries.season),
      ),
    );
  const bySeason = new Map<PlayerId, CareerSeasons['listedSeasons'][number][]>();
  for (const { playerId, ...season } of rows) {
    bySeason.set(playerId, [...(bySeason.get(playerId) ?? []), season]);
  }
  return bySeason;
}

/** The instant from which his team games may be games missed: his last game played, or the start of his first stint when he has played none. */
function missedFrom({ lines, stints }: MappedPlayer): number {
  return lines.length > 0
    ? Math.max(...lines.map(({ scheduledStartAt }) => scheduledStartAt))
    : Math.min(Infinity, ...stints.map(({ from }) => from));
}

/** The games after which some player's team games may be games missed, as the engine reads them. */
async function scheduleSince(
  tx: Transaction,
  players: readonly MappedPlayer[],
  now: EpochMs,
): Promise<readonly LinesGame[]> {
  const since = Math.min(now, ...players.map((player) => missedFrom(player)));
  const rows = await tx
    .select()
    .from(games)
    .where(gte(games.scheduledStartAt, new Date(since)));
  return rows.map((row) => linesGameOf(row));
}

const EXCLUDED = {
  indicatorSeason: sql`excluded.indicator_season`,
  gamesPlayedThisSeason: sql`excluded.games_played_this_season`,
  averageMinutesThisSeason: sql`excluded.average_minutes_this_season`,
  lastGamePlayedId: sql`excluded.last_game_played_id`,
  lastGamePlayedOn: sql`excluded.last_game_played_on`,
  consecutiveTeamGamesMissed: sql`excluded.consecutive_team_games_missed`,
  firstNbaGameId: sql`excluded.first_nba_game_id`,
  firstNbaGameOn: sql`excluded.first_nba_game_on`,
  computedAt: sql`excluded.computed_at`,
};

/**
 * Stores, for every followed player with an established mapping, the indicators of the
 * player page: games played and average minutes of the season covered, last game played and
 * consecutive team games missed since (STA-46, CL-STA-21); and his first NBA game, null for
 * "date unknown" while the box scores of a season listing him are not stored or when his
 * earliest listed season is `firstCoveredSeason`, the stats-source port's constant (STA-47,
 * CL-STA-12); from stored data only (STA-43). A player whose season the stored spans cannot
 * tell keeps his row as it is (CL-STA-28).
 */
export async function refreshIndicators(
  tx: Transaction,
  { now, firstCoveredSeason }: Readonly<{ now: EpochMs; firstCoveredSeason: string }>,
): Promise<RefreshedIndicators> {
  const players = await mappedPlayers(tx);
  if (players.length === 0) {
    return { refreshed: [], seasonNotRead: [] };
  }
  const seasons = await seasonSpans(tx);
  const listed = await listedSeasons(tx);
  const schedule = { games: await scheduleSince(tx, players, now), seasons };
  const computedAt = new Date(now);
  const seasonNotRead: PlayerId[] = [];
  const rows = players.flatMap((player) => {
    const career = { listedSeasons: listed.get(player.playerId) ?? [], firstCoveredSeason };
    const indicators = indicatorsOf(player, schedule, gameDay(now));
    const first = firstNbaGameOf(player.lines, career, seasons);
    if (!indicators.ok || !first.ok) {
      seasonNotRead.push(player.playerId);
      return [];
    }
    const { firstNbaGame } = first;
    return {
      playerId: player.playerId,
      ...indicators.indicators,
      firstNbaGameId: firstNbaGame?.firstNbaGameId ?? null,
      firstNbaGameOn: firstNbaGame?.firstNbaGameOn ?? null,
      computedAt,
    };
  });
  if (rows.length > 0) {
    await tx
      .insert(playerIndicators)
      .values(rows)
      .onConflictDoUpdate({ target: playerIndicators.playerId, set: EXCLUDED });
  }
  return { refreshed: rows.map(({ playerId }) => playerId), seasonNotRead };
}

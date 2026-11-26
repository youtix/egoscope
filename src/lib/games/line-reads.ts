// What the box-score ingestion reads before it judges a season's lines (STA-03, STA-08,
// STA-33): the requested players it may store lines for, their stored lines in the
// season, and which of them an earlier read gave lines. An internal part of `lines.ts`,
// kept apart for the size limits.
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';

import { boxScores, games, statsSourceMappings, teamSourceRefs } from '@/lib/db';

import type { BoxScoreRow } from './types';
import type { Transaction } from '@/lib/db';
import type { GameId, PlayerId } from '@/lib/stats-engine';
import type { PlayersRequest, SourcePlayerId, SourceTeamId } from '@/lib/stats-source';

const STATS_SOURCE = 'sportsdataverse_espn';

/**
 * The requested players that a read may store lines for, and their state in the season:
 * their stored lines, by `lineKey`, and those whom a read made since their mapping was
 * established gave lines of the season.
 */
export type SeasonPlayers = Readonly<{
  /** The requested players with an established mapping, by their source identity. */
  bySource: ReadonlyMap<SourcePlayerId, PlayerId>;
  /** The same players' ids, in the order of `bySource`. */
  playerIds: readonly PlayerId[];
  stored: ReadonlyMap<string, BoxScoreRow>;
  read: ReadonlySet<PlayerId>;
}>;

/** The key of a player's stored line in a game. */
export const lineKey = (gameId: GameId, playerId: PlayerId): string =>
  `${String(gameId)}:${playerId}`;

/**
 * The players of the request with an established mapping, by their source identity,
 * their stored lines in the season's games, and those whom an earlier read gave lines
 * there (STA-03, STA-08, STA-33, JOU-10, JOU-12, CL-STA-04): a player with a stored line
 * of the season fetched since his mapping was established, other than the placeholder
 * of an unavailable sheet, which no read gives. A mapping changed then confirmed again
 * keeps his lines but was established since, so no read counts for him until the next.
 */
export async function seasonPlayers(
  tx: Transaction,
  request: PlayersRequest,
): Promise<SeasonPlayers> {
  const requestedEstablished = and(
    eq(statsSourceMappings.statsSource, STATS_SOURCE),
    eq(statsSourceMappings.status, 'established'),
    inArray(statsSourceMappings.sourcePlayerRef, [...request.players]),
  );
  const mapped = await tx
    // An established mapping always holds its identity, which the request names.
    .select({
      playerId: statsSourceMappings.playerId,
      ref: sql<SourcePlayerId>`${statsSourceMappings.sourcePlayerRef}`,
    })
    .from(statsSourceMappings)
    .where(requestedEstablished);
  const rows = await tx
    .select({
      line: getTableColumns(boxScores),
      isRead: sql<boolean>`${boxScores.status} <> 'unavailable' AND ${boxScores.fetchedAt} >= ${statsSourceMappings.establishedAt}`,
    })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .innerJoin(statsSourceMappings, eq(statsSourceMappings.playerId, boxScores.playerId))
    .where(
      and(
        requestedEstablished,
        eq(games.statsSource, STATS_SOURCE),
        eq(games.season, request.season),
      ),
    );
  return {
    bySource: new Map(mapped.map(({ playerId, ref }) => [ref, playerId])),
    playerIds: mapped.map(({ playerId }) => playerId),
    stored: new Map(rows.map(({ line }) => [lineKey(line.gameId, line.playerId), line])),
    read: new Set(rows.flatMap(({ line, isRead }) => (isRead ? line.playerId : []))),
  };
}

/** The application team of each of the source's teams (CL-STA-23). */
export async function teamIdsOf(tx: Transaction): Promise<Map<SourceTeamId, number>> {
  const rows = await tx
    .select({ ref: teamSourceRefs.sourceTeamRef, teamId: teamSourceRefs.teamId })
    .from(teamSourceRefs)
    .where(eq(teamSourceRefs.statsSource, STATS_SOURCE));
  return new Map(rows.map(({ ref, teamId }) => [ref, teamId]));
}

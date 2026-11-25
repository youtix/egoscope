// The play-in and playoff series of a stored season, rebuilt by the engine from its
// schedule (STA-05, STA-07, CL-STA-18, CL-STA-20).
import { and, eq, gt, ne, sql } from 'drizzle-orm';

import { games, series } from '@/lib/db';
import { rebuildSeries } from '@/lib/stats-engine';

import { NO_SERIES, writeChanges } from './ingest-games';
import { only } from './ingest-teams';

import type { Place } from './ingest-games';
import type { GameRow } from './types';
import type { Transaction } from '@/lib/db';
import type { GameId, RebuiltSeries, SeriesGame } from '@/lib/stats-engine';
import type { Season, SourceGameId } from '@/lib/stats-source';

/** Where a game stands in its series: the series' stored identifier and the game's position (STA-05). */
type SeriesColumns = Readonly<{
  seriesId: number | null;
  gameNumber: number | null;
  homeSeriesWinsBefore: number | null;
  awaySeriesWinsBefore: number | null;
  isEliminationGame: boolean | null;
}>;

/** A stored game as the series rebuild reads it, with the round label and number of its source. */
function seriesGameOf(row: GameRow, place: Place): SeriesGame {
  const { homeScore: home, awayScore: away } = row;
  return {
    id: row.id,
    phase: row.phase,
    status: row.status,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    finalScore: home === null || away === null ? null : { home, away },
    scheduledStartAt: row.scheduledStartAt.getTime(),
    ...place,
  };
}

/** Stores the rebuilt series of a season, and gives the series columns of each of their games. */
async function upsertSeries(
  tx: Transaction,
  season: Season,
  rebuilt: readonly RebuiltSeries[],
): Promise<ReadonlyMap<GameId, SeriesColumns>> {
  if (rebuilt.length === 0) {
    return new Map();
  }
  const rows = await tx
    .insert(series)
    .values(
      rebuilt.map((one) => ({
        season,
        phase: one.phase,
        round: one.round,
        teamAId: one.teamAId,
        teamBId: one.teamBId,
        winsNeeded: one.winsNeeded,
        isRebuilt: one.isRebuilt,
      })),
    )
    .onConflictDoUpdate({
      target: [series.season, series.phase, series.teamAId, series.teamBId],
      set: {
        round: sql`excluded.round`,
        winsNeeded: sql`excluded.wins_needed`,
        isRebuilt: sql`excluded.is_rebuilt`,
      },
    })
    .returning({
      seriesId: series.id,
      phase: series.phase,
      teamAId: series.teamAId,
      teamBId: series.teamBId,
    });
  return new Map(
    rebuilt.flatMap((one) => {
      const { seriesId } = only(
        rows.filter(
          (row) =>
            row.phase === one.phase && row.teamAId === one.teamAId && row.teamBId === one.teamBId,
        ),
      );
      return one.games.map(({ gameId, ...position }) => [gameId, { seriesId, ...position }]);
    }),
  );
}

/**
 * Rebuilds the play-in and playoff series of a stored season with the engine (STA-05,
 * STA-07, CL-STA-18): each game's series, number, wins before and elimination flag,
 * unknown when its series cannot be rebuilt, its number the source's wherever the source
 * gives one. A game that `places` holds takes its round label and number from the file
 * just read; any other, such as a held-back row's or one of a season not read now, from
 * what is stored. Whether a later season has a stored game decides whether a series
 * without a winner may still be under way (CL-STA-20). A series left without games goes.
 * Gives the games that changed.
 */
export async function storeSeries(
  tx: Transaction,
  season: Season,
  read: Readonly<{ places: ReadonlyMap<SourceGameId, Place>; at: Date }>,
): Promise<readonly GameId[]> {
  const rows = await tx
    .select({ row: games, round: series.round })
    .from(games)
    .leftJoin(series, eq(games.seriesId, series.id))
    .where(and(eq(games.season, season), ne(games.phase, 'regular_season')));
  const placed = rows.map(({ row, round }) => ({
    row,
    place: read.places.get(row.sourceGameRef) ?? {
      roundLabel: round,
      sourceGameNumber: row.gameNumber,
    },
  }));
  const later = await tx
    .select({ id: games.id })
    .from(games)
    .where(gt(games.season, season))
    .limit(1);
  const rebuilt = rebuildSeries(
    season,
    placed.map(({ row, place }) => seriesGameOf(row, place)),
    later.length > 0,
  );
  const positions = await upsertSeries(tx, season, rebuilt);
  const changes = placed.map(({ row, place }) => {
    const position = positions.get(row.id) ?? NO_SERIES;
    const gameNumber = place.sourceGameNumber ?? position.gameNumber;
    return { row, content: { ...position, gameNumber } };
  });
  const changed = await writeChanges(tx, changes, read.at);
  const withoutGames = sql`NOT EXISTS (SELECT 1 FROM ${games} WHERE ${games.seriesId} = ${series.id})`;
  await tx.delete(series).where(and(eq(series.season, season), withoutGames));
  return changed;
}

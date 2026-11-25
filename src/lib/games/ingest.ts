// Stores what the statistics source's getSeasonGames answers for one season, once for
// every player (STA-42): its teams (ingest-teams.ts), the season row with its one source
// and its coverage, and every official game (ingest-games.ts) with its play-in and
// playoff series rebuilt by the engine (ingest-series.ts). It calls no port: the fetch
// queue passes it the answer that it read under quota.
import { eq, max } from 'drizzle-orm';

import { games, seasons } from '@/lib/db';
import { record } from '@/lib/journal';
import { err, ok } from '@/lib/result';

import { storeGames } from './ingest-games';
import { storeSeries } from './ingest-series';
import { only, storeTeams } from './ingest-teams';

import type { Content, SeasonGamesIngestion, StoredGames } from './ingest-games';
import type { StatsSourceKey } from './ingest-teams';
import type { SeasonRow } from './types';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { GameId } from '@/lib/stats-engine';
import type { Season } from '@/lib/stats-source';

/** What an ingestion changed: the scope of the statistics update's recalculation (STA-32). */
export type IngestedSeasonGames = Readonly<{
  newGameIds: readonly GameId[];
  modifiedGameIds: readonly GameId[];
  seasons: readonly Season[];
}>;

/** The season is assigned to another source, the only one that serves it (CL-STA-23). */
export type OtherSourceRefused = Readonly<{ kind: 'other_source'; assigned: StatsSourceKey }>;

/** Whether a season is to be read, or is earlier than the first season the source covers. */
export type MetSeason = 'to_read' | 'not_covered';

// The longest status value that the warning of a held-back row keeps (CL-STA-17).
const MAX_STATUS_LENGTH = 100;

/**
 * Writes the row of `season` when the app first meets it, under the source that serves
 * it, its coverage pending until its games are read (`coverage_fetched_at` empty); a
 * season earlier than the source's first covered one gets none, since it is not covered
 * and is never read (STA-45, CL-STA-22, CL-STA-23, CL-STA-29).
 */
export async function meetSeason(
  tx: Transaction,
  met: Readonly<{ season: Season; statsSource: StatsSourceKey; firstCoveredSeason: Season }>,
): Promise<MetSeason> {
  if (met.season < met.firstCoveredSeason) {
    return 'not_covered';
  }
  await tx
    .insert(seasons)
    .values({ season: met.season, statsSource: met.statsSource })
    .onConflictDoNothing();
  return 'to_read';
}

/** The row of the season read, written under its source when the app meets the season now (CL-STA-23). */
async function seasonRow(tx: Transaction, ingestion: SeasonGamesIngestion): Promise<SeasonRow> {
  const { season, statsSource } = ingestion;
  const [found] = await tx.select().from(seasons).where(eq(seasons.season, season));
  return found ?? only(await tx.insert(seasons).values({ season, statsSource }).returning());
}

/** Whether a season's row is assigned to `source`: one source serves each season (CL-STA-23). */
const isAssignedTo = (row: SeasonRow, source: string): boolean => row.statsSource === source;

/**
 * Stores what the season's games say of its coverage, its games now read: the phases
 * whose final games have lines and the final games listed without lines (STA-45,
 * CL-STA-22). Says whether it changed, the first read included. The adapter's
 * `phasesWithBoxScores` is not read: it counts the whole file, the rows left to the
 * season before included, while the coverage stored is that of the games kept.
 */
async function storeCoverage(
  tx: Transaction,
  ingestion: SeasonGamesIngestion,
  stored: Readonly<{ before: SeasonRow; contents: readonly Content[] }>,
): Promise<Readonly<{ isChanged: boolean }>> {
  const { before } = stored;
  const played = stored.contents.filter(({ status }) => status === 'final');
  const phasesWithLines = games.phase.enumValues.filter((phase) =>
    played.some((game) => game.phase === phase && game.homeLinesPublished === true),
  );
  const gamesWithoutLines = played.filter((game) => game.homeLinesPublished !== true).length;
  await tx
    .update(seasons)
    .set({ phasesWithLines, gamesWithoutLines, coverageFetchedAt: new Date(ingestion.fetchedAt) })
    .where(eq(seasons.season, ingestion.season));
  return {
    isChanged:
      before.coverageFetchedAt === null ||
      before.gamesWithoutLines !== gamesWithoutLines ||
      before.phasesWithLines.join(',') !== phasesWithLines.join(','),
  };
}

/**
 * Journals a warning for each schedule row that the adapter held back, its status value
 * not recognized yet: the value as the source wrote it, cut to a bounded length, and the
 * source's game identifier in the technical details; the game keeps what is stored
 * (CL-STA-17, CL-DSN-11).
 */
async function journalHeldBack(
  tx: Transaction,
  { answer, fetchedAt }: SeasonGamesIngestion,
): Promise<void> {
  for (const row of answer.heldBack) {
    await record(tx, {
      messageKey: 'stats_status_unknown',
      params: { status: row.status.slice(0, MAX_STATUS_LENGTH) },
      occurredAt: fetchedAt,
      technicalDetails: { sourceGameRef: row.game },
    });
  }
}

/**
 * The seasons whose series are rebuilt from what is stored (CL-STA-18, CL-STA-20): the
 * season latest until now when this one's first games make it the latest, which flips its
 * `hasLaterSeasonGame`, and the later seasons that games moved to this one left.
 */
function otherSeasons(
  season: Season,
  stored: StoredGames,
  previous: string | null,
): readonly Season[] {
  const isFlipped = stored.newIds.length > 0 && previous !== null && previous < season;
  return [...new Set([...(isFlipped ? [previous] : []), ...stored.movedFrom])];
}

/** Rebuilds the series of the season read, then of the other seasons, and gives the games that changed. */
async function storeAllSeries(
  tx: Transaction,
  ingestion: SeasonGamesIngestion,
  stored: Readonly<{ games: StoredGames; others: readonly Season[] }>,
): Promise<Readonly<{ own: readonly GameId[]; elsewhere: readonly GameId[] }>> {
  const at = new Date(ingestion.fetchedAt);
  const own = await storeSeries(tx, ingestion.season, { places: stored.games.places, at });
  const elsewhere: GameId[] = [];
  for (const other of stored.others) {
    elsewhere.push(...(await storeSeries(tx, other, { places: new Map(), at })));
  }
  return { own, elsewhere };
}

/** The stored games that changed, each once, the new games apart (STA-32). */
function modifiedGames(newIds: readonly GameId[], changed: readonly GameId[]): readonly GameId[] {
  const modified = new Set(changed);
  for (const id of newIds) {
    modified.delete(id);
  }
  return [...modified];
}

/**
 * Stores one season's answer of getSeasonGames, once for every player (STA-04, STA-05,
 * STA-29, STA-31, STA-42, VUE-01): its teams, the season row with its coverage, and its
 * official games with their series, the games that never count dropped (CL-STA-16); a
 * held-back row is journaled and its game keeps what is stored (CL-STA-17). The first
 * games of the latest season flip `hasLaterSeasonGame` for the season latest until then,
 * and a game that moves to this season changes the season it leaves: the series of each
 * are rebuilt from what is stored. Refuses a season that another source serves
 * (CL-STA-23). Gives the new and modified games and the seasons touched (STA-32).
 */
export async function ingestSeasonGames(
  tx: Transaction,
  ingestion: SeasonGamesIngestion,
): Promise<Result<IngestedSeasonGames, OtherSourceRefused>> {
  const { season, statsSource, answer } = ingestion;
  const row = await seasonRow(tx, ingestion);
  if (!isAssignedTo(row, statsSource)) {
    return err({ kind: 'other_source', assigned: row.statsSource });
  }
  const { latest } = only(await tx.select({ latest: max(games.season) }).from(games));
  const teamIds = await storeTeams(tx, { season, statsSource, teams: answer.teams });
  const stored = await storeGames(tx, ingestion, teamIds);
  const others = otherSeasons(season, stored, latest);
  const changed = await storeAllSeries(tx, ingestion, { games: stored, others });
  const coverage = await storeCoverage(tx, ingestion, { before: row, contents: stored.contents });
  await journalHeldBack(tx, ingestion);
  const own = [...stored.modifiedIds, ...changed.own];
  const isTouched = coverage.isChanged || stored.newIds.length > 0 || own.length > 0;
  return ok({
    newGameIds: stored.newIds,
    modifiedGameIds: modifiedGames(stored.newIds, [...own, ...changed.elsewhere]),
    seasons: [...(isTouched ? [season] : []), ...others],
  });
}

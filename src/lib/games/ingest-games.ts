// The official games of one season's file, stored once per game identifier (STA-04,
// STA-05, STA-29, STA-31, STA-42, CL-STA-14, CL-STA-16, CL-STA-17, CL-STA-28).
import { and, eq, inArray } from 'drizzle-orm';

import { games } from '@/lib/db';
import { gameDayStart } from '@/lib/time';

import type { StatsSourceKey, TeamIds } from './ingest-teams';
import type { GameRow, NewGameRow } from './types';
import type { Transaction } from '@/lib/db';
import type { GameId, SeriesRound } from '@/lib/stats-engine';
import type {
  Season,
  SeasonGames,
  SourceGame,
  SourceGameId,
  SourceTeamId,
} from '@/lib/stats-source';
import type { EpochMs } from '@/lib/time';

/** One season's answer of getSeasonGames, from the source that served it, read at `fetchedAt` (STA-42). */
export type SeasonGamesIngestion = Readonly<{
  season: Season;
  statsSource: StatsSourceKey;
  answer: SeasonGames;
  fetchedAt: EpochMs;
}>;

/** What the ingestion writes of a game. */
export type Content = Omit<
  NewGameRow,
  'id' | 'consolidatedAt' | 'lastFetchedAt' | 'scheduleChangedAt'
>;

/** The round label and game number that the source gives a game (CL-STA-18). */
export type Place = Readonly<{ roundLabel: SeriesRound | null; sourceGameNumber: number | null }>;

/** What `storeGames` did, and what the series rebuild and the coverage read of it. */
export type StoredGames = Readonly<{
  newIds: readonly GameId[];
  modifiedIds: readonly GameId[];
  /** The later seasons that the games moved to this one were stored under. */
  movedFrom: ReadonlySet<Season>;
  places: ReadonlyMap<SourceGameId, Place>;
  contents: readonly Content[];
}>;

/** A game that the file lists, under the identifier stored, with the row whose values it takes. */
type Listed = Readonly<{ ref: SourceGameId; game: SourceGame; makeUp: SourceGameId | null }>;

// A row of a season's file is that season's from 1 July of its first year; an earlier
// row belongs to the season before, whose own file lists it (CL-STA-28, evaluation T14).
const SEASON_CUT = '-07-01';
const YEAR_DIGITS = 4;
// The most games one insert writes, well under the parameters that a statement takes.
const INSERT_BATCH = 500;
// The columns whose change is a change of the game's schedule (STA-28, STA-31).
const SCHEDULE_COLUMNS: ReadonlySet<string> = new Set([
  'gameDayOn',
  'scheduledStartAt',
  'isStartTimeTbd',
  'homeTeamId',
  'awayTeamId',
  'status',
]);

/** The series columns of a game in no series, as every regular-season game is (STA-05). */
export const NO_SERIES = {
  seriesId: null,
  gameNumber: null,
  homeSeriesWinsBefore: null,
  awaySeriesWinsBefore: null,
  isEliminationGame: null,
} as const;

/** A value as the change check compares it: an instant by its milliseconds. */
const comparable = (value: unknown): unknown => (value instanceof Date ? value.getTime() : value);

/**
 * The official games of the file that are the season's (STA-04, CL-STA-16, CL-STA-28):
 * the games that never count dropped, a row dated before the season's cut left to the
 * season before, and a make-up folded into the postponed original that the adapter
 * links it to, which takes its values under its own identifier (CL-STA-17).
 */
function listedGames(season: Season, answer: SeasonGames): readonly Listed[] {
  const cut = `${season.slice(0, YEAR_DIGITS)}${SEASON_CUT}`;
  const official = answer.games.filter((game) => game.exclusion === null);
  const refs = new Set(official.map(({ game }) => game));
  const makeUps = new Map(
    official.flatMap((game) =>
      game.makeUpOf !== null && refs.has(game.makeUpOf) ? [[game.makeUpOf, game] as const] : [],
    ),
  );
  const folded = new Set(Array.from(makeUps.values(), ({ game }) => game));
  return official
    .filter(({ game }) => !folded.has(game))
    .map((game) => {
      const makeUp = makeUps.get(game.game);
      return { ref: game.game, game: makeUp ?? game, makeUp: makeUp?.game ?? null };
    })
    .filter(({ game }) => game.gameDay >= cut);
}

/**
 * The row of a listed game (STA-05, STA-29, STA-31): its start, the deemed 00:00 US
 * Eastern of its day while its time is to be determined (CL-STA-14), its teams, null for
 * a placeholder, its overtimes, null when unknown (CL-STA-03), and its lines published
 * when it is final and the coverage does not list it without lines (CL-STA-22).
 */
function contentOf(
  { ref, game, makeUp }: Listed,
  context: Readonly<{ ingestion: SeasonGamesIngestion; teamIds: TeamIds; noLines: Set<string> }>,
): Content {
  const teamOf = (team: SourceTeamId | null) =>
    team === null ? null : (context.teamIds.get(team) ?? null);
  const hasLines = game.status === 'final' && !context.noLines.has(game.game);
  return {
    statsSource: context.ingestion.statsSource,
    sourceGameRef: ref,
    makeUpSourceGameRef: makeUp,
    season: context.ingestion.season,
    phase: game.phase,
    status: game.status,
    scheduledStartAt: new Date(game.isTimeKnown ? game.tipOff : gameDayStart(game.gameDay)),
    isStartTimeTbd: !game.isTimeKnown,
    gameDayOn: game.gameDay,
    homeTeamId: teamOf(game.homeTeam),
    awayTeamId: teamOf(game.awayTeam),
    homeScore: game.score?.home ?? null,
    awayScore: game.score?.away ?? null,
    overtimeCount: game.overtimes,
    homeLinesPublished: hasLines,
    awayLinesPublished: hasLines,
    ...(game.phase === 'regular_season' && NO_SERIES),
  };
}

/**
 * What `content` changes in a stored game, its schedule change instant moved to `at` when
 * its day, start, time-to-be-determined mark, teams or status change (STA-28, STA-31);
 * nothing when it changes nothing.
 */
function changeOf(
  row: GameRow,
  content: Partial<Content>,
  at: Date,
): (Partial<Content> & Readonly<{ scheduleChangedAt?: Date }>) | null {
  const changed = Object.entries(content)
    .filter(([column, value]) => comparable(Reflect.get(row, column)) !== comparable(value))
    .map(([column]) => column);
  if (changed.length === 0) {
    return null;
  }
  const isRescheduled = changed.some((column) => SCHEDULE_COLUMNS.has(column));
  return { ...content, ...(isRescheduled && { scheduleChangedAt: at }) };
}

/** Writes what each content changes in its stored game, and gives the games that changed. */
export async function writeChanges(
  tx: Transaction,
  contents: readonly Readonly<{ row: GameRow; content: Partial<Content> }>[],
  at: Date,
): Promise<readonly GameId[]> {
  const changed: GameId[] = [];
  for (const { row, content } of contents) {
    const change = changeOf(row, content, at);
    if (change === null) {
      continue;
    }
    await tx.update(games).set(change).where(eq(games.id, row.id));
    changed.push(row.id);
  }
  return changed;
}

async function insertGames(
  tx: Transaction,
  contents: readonly Content[],
  at: Date,
): Promise<readonly GameId[]> {
  const ids: GameId[] = [];
  for (let start = 0; start < contents.length; start += INSERT_BATCH) {
    const batch = contents.slice(start, start + INSERT_BATCH);
    const rows = await tx
      .insert(games)
      .values(batch.map((content) => ({ ...content, lastFetchedAt: at, scheduleChangedAt: at })))
      .returning({ id: games.id });
    ids.push(...rows.map(({ id }) => id));
  }
  return ids;
}

async function storedGames(
  tx: Transaction,
  statsSource: StatsSourceKey,
  listed: readonly Listed[],
): Promise<ReadonlyMap<SourceGameId, GameRow>> {
  const refs = listed.map(({ ref }) => ref);
  const rows = await tx
    .select()
    .from(games)
    .where(and(eq(games.statsSource, statsSource), inArray(games.sourceGameRef, refs)));
  return new Map(rows.map((row) => [row.sourceGameRef, row]));
}

/**
 * Stores the season's listed games, once per identifier (CL-STA-28): a game stored under
 * an earlier season stays there, one stored under a later season moves to this one, a
 * new one is inserted and a stored one takes what changed; every game listed takes the
 * fetch instant (STA-42).
 */
export async function storeGames(
  tx: Transaction,
  ingestion: SeasonGamesIngestion,
  teamIds: TeamIds,
): Promise<StoredGames> {
  const { season } = ingestion;
  const listed = listedGames(season, ingestion.answer);
  const stored = await storedGames(tx, ingestion.statsSource, listed);
  const own = listed.filter(({ ref }) => (stored.get(ref)?.season ?? season) >= season);
  const noLines = new Set(ingestion.answer.coverage.gamesWithoutBoxScores);
  const contents = own.map((entry) => contentOf(entry, { ingestion, teamIds, noLines }));
  const at = new Date(ingestion.fetchedAt);
  const newIds = await insertGames(
    tx,
    contents.filter(({ sourceGameRef }) => !stored.has(sourceGameRef)),
    at,
  );
  const pairs = contents.flatMap((content) => {
    const row = stored.get(content.sourceGameRef);
    return row === undefined ? [] : { row, content };
  });
  const modifiedIds = await writeChanges(tx, pairs, at);
  const ids = pairs.map(({ row }) => row.id);
  await tx.update(games).set({ lastFetchedAt: at }).where(inArray(games.id, ids));
  return {
    newIds,
    modifiedIds,
    movedFrom: new Set(pairs.flatMap(({ row }) => (row.season > season ? row.season : []))),
    places: new Map(
      own.map(({ ref, game }) => [
        ref,
        {
          roundLabel: game.series?.round ?? null,
          sourceGameNumber: game.series?.gameNumber ?? null,
        },
      ]),
    ),
    contents,
  };
}

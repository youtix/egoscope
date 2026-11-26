// The box-score lines of one season's read, stored for the followed players (STA-08,
// STA-33, STA-34): an internal part of the ingestion, which takes the source's answer
// from its caller and calls nothing out. Only a line he played is kept, checked by the
// engine; the flags of the teams whose lines the source holds say "not played" for the
// rest; a correction in the window, or on a manual refetch, replaces the stored values
// and traces each one (CL-STA-26).
import { and, eq, inArray } from 'drizzle-orm';

import { boxScores, games, statCorrections } from '@/lib/db';
import { now } from '@/lib/time';

import { lineKey, seasonPlayers, teamIdsOf } from './line-reads';
import { differencesOf, isPlayed, isUnchanged, valuesOf } from './line-values';

import type { LineValues } from './line-values';
import type { BoxScoreRow, GameRow, NewBoxScoreRow, NewStatCorrectionRow } from './types';
import type { Transaction } from '@/lib/db';
import type { GameId, PlayerId } from '@/lib/stats-engine';
import type {
  PlayersRequest,
  SourceBoxScore,
  SourceGameId,
  SourcePlayerId,
  SourceTeamId,
  StatsSource,
} from '@/lib/stats-source';

const STATS_SOURCE = 'sportsdataverse_espn';
// The rows of one insert, well under the 65,535 parameters of a Postgres statement.
const ROWS_PER_INSERT = 500;

/** What a read of `getSeasonBoxScores` holds: the port's own answer type, so no statistic comes from elsewhere (STA-01). */
type SeasonBoxScores = Extract<
  Extract<Awaited<ReturnType<StatsSource['getSeasonBoxScores']>>, { ok: true }>['value'],
  { kind: 'read' }
>['data'];

/**
 * What `ingestLines` takes: the request made of `getSeasonBoxScores` and the lines it
 * read, untouched, and whether a manual refetch asked for it (STA-01, STA-34, STA-44).
 */
export type LinesRead = Readonly<{
  request: PlayersRequest;
  lines: SeasonBoxScores;
  isManualRefetch: boolean;
}>;

/** Followed players and games: the cases of these players that these games concern. */
export type LinesScope = Readonly<{ playerIds: readonly PlayerId[]; gameIds: readonly GameId[] }>;

/**
 * What a read changed: the games and players whose lines, or whose teams' published
 * lines, changed; those of which a traced value changed, empty when none did, which
 * gives the recalculation the cause "statistics correction" (CL-SEN-17); and the
 * players whose team a correction changed, whose team history follows (CL-JOU-03,
 * CL-TAX-19).
 */
export type LinesChange = Readonly<{
  changed: LinesScope;
  corrected: LinesScope;
  teamHistoryChanged: readonly PlayerId[];
}>;

type Side = 'home' | 'away';
type TeamSide = Readonly<{ side: Side; teamId: number }>;
/** What the answer holds of one game: the teams with lines, and the requested players' lines. */
type GameAnswer = { teams: Set<SourceTeamId>; lines: Map<PlayerId, SourceBoxScore> };

/**
 * One requested player in one answered game, with his stored line if any, and whether
 * an earlier read of the season's file since his mapping was established gave him
 * lines: only then can the game hold a line of his to correct (STA-33).
 */
type LineTarget = Readonly<{
  game: GameRow;
  answer: GameAnswer;
  /** The sides of the game whose lines the answer holds. */
  sides: ReadonlySet<Side>;
  playerId: PlayerId;
  stored: BoxScoreRow | undefined;
  wasRead: boolean;
}>;

type IdSets = Readonly<{ players: Set<PlayerId>; games: Set<GameId> }>;

/** The state of one ingestion: the writes gathered before any is made, and what they change. */
type Run = Readonly<{
  at: Date;
  isManualRefetch: boolean;
  /** The application team of each source team. */
  teamIds: ReadonlyMap<SourceTeamId, number>;
  inserts: NewBoxScoreRow[];
  updates: { id: number; values: LineValues }[];
  deletes: number[];
  traces: NewStatCorrectionRow[];
  published: Readonly<Record<Side, GameId[]>>;
  changed: IdSets;
  corrected: IdSets;
  teamHistoryChanged: Set<PlayerId>;
}>;

const idSets = (): IdSets => ({ players: new Set(), games: new Set() });

/**
 * The side of the game that a source team plays, from the game's own teams, whatever
 * a line's home flag says: none for a team foreign to the game.
 */
function sideOf(run: Run, game: GameRow, team: SourceTeamId): TeamSide | undefined {
  const teamId = run.teamIds.get(team);
  if (teamId === undefined) {
    return undefined;
  }
  if (teamId === game.homeTeamId) {
    return { side: 'home', teamId };
  }
  return teamId === game.awayTeamId ? { side: 'away', teamId } : undefined;
}

/** Whether the source held the lines of that side of the game before this read (CL-STA-04). */
const isPublished = (game: GameRow, side: Side): boolean =>
  side === 'home' ? game.homeLinesPublished : game.awayLinesPublished;

function markChanged(run: Run, { playerId, game }: LineTarget): void {
  run.changed.players.add(playerId);
  run.changed.games.add(game.id);
}

/**
 * Traces a change of a stored or published state, which only the correction window or
 * a manual refetch allows, the game not consolidated yet (STA-33, STA-34): says whether
 * it is allowed.
 */
function didCorrect(run: Run, target: LineTarget, next: LineValues | null): boolean {
  const { playerId, game } = target;
  if (game.consolidatedAt !== null && !run.isManualRefetch) {
    return false;
  }
  const origin = run.isManualRefetch ? 'manual_refetch' : 'correction_window';
  const differences = differencesOf(target.stored, next);
  for (const difference of differences) {
    run.traces.push({ ...difference, playerId, gameId: game.id, correctedAt: run.at, origin });
    run.corrected.players.add(playerId);
    run.corrected.games.add(game.id);
  }
  if (differences.some(({ element }) => element === 'team')) {
    run.teamHistoryChanged.add(playerId);
  }
  markChanged(run, target);
  return true;
}

/** A new row of the player's line in the game. */
const newRow = (run: Run, { playerId, game }: LineTarget, values: LineValues): NewBoxScoreRow => ({
  ...values,
  playerId,
  gameId: game.id,
  statsSource: STATS_SOURCE,
  fetchedAt: run.at,
});

/**
 * Stores a line he played, filed under the game's team that the source names: a first
 * one untraced, else as a correction. A first line is one of a player whom no read
 * since his mapping was established gave lines of the season, or of a side of the game
 * whose lines no earlier read held.
 */
function storePlayed(run: Run, target: LineTarget, line: SourceBoxScore): void {
  const { game, stored } = target;
  const team = sideOf(run, game, line.team);
  if (team === undefined) {
    return;
  }
  const values = valuesOf(line, team.teamId, game.overtimeCount);
  if (stored === undefined && (!target.wasRead || !isPublished(game, team.side))) {
    // No line of his read in this game before: no stored value to correct.
    run.inserts.push(newRow(run, target, values));
    markChanged(run, target);
  } else if (stored === undefined) {
    // A player read since his mapping was established, on a side of the game whose lines
    // an earlier read held without his, which said he did not play: the source adds it.
    if (didCorrect(run, target, values)) {
      run.inserts.push(newRow(run, target, values));
    }
  } else if (!isUnchanged(stored, values) && didCorrect(run, target, values)) {
    run.updates.push({ id: stored.id, values });
  }
}

/**
 * Whether the answer says that he did not play, for a stored line: his own line, or the
 * lines of his stored team without one of his (CL-STA-04). The placeholder of an
 * unavailable sheet stays until a line he played replaces it (STA-35).
 */
function isNotPlayed({ game, answer, sides, playerId }: LineTarget, stored: BoxScoreRow): boolean {
  if (stored.status === 'unavailable') {
    return false;
  }
  const side = stored.teamId === game.homeTeamId ? 'home' : 'away';
  return answer.lines.has(playerId) || sides.has(side);
}

function judgeLine(run: Run, target: LineTarget): void {
  const line = target.answer.lines.get(target.playerId);
  const { stored } = target;
  if (line !== undefined && isPlayed(line)) {
    storePlayed(run, target, line);
  } else if (stored !== undefined && isNotPlayed(target, stored) && didCorrect(run, target, null)) {
    // Traced first, then deleted: the trace outlives the line (CL-STA-26).
    run.deletes.push(stored.id);
  }
}

/** Sets the flag of each side of the game whose lines the answer holds for the first time (CL-STA-04). */
function publishSides(run: Run, game: GameRow, sides: ReadonlySet<Side>): void {
  for (const side of sides) {
    if (isPublished(game, side)) {
      continue;
    }
    run.published[side].push(game.id);
    run.changed.games.add(game.id);
  }
}

/** Indexes the answer by game, keeping only the requested players' lines: the answer itself is not copied. */
function indexAnswer(
  lines: SeasonBoxScores,
  players: ReadonlyMap<SourcePlayerId, PlayerId>,
): Map<SourceGameId, GameAnswer> {
  const byGame = new Map<SourceGameId, GameAnswer>();
  for (const line of lines) {
    const answer = byGame.get(line.game) ?? { teams: new Set(), lines: new Map() };
    answer.teams.add(line.team);
    const playerId = players.get(line.player);
    if (playerId !== undefined) {
      answer.lines.set(playerId, line);
    }
    byGame.set(line.game, answer);
  }
  return byGame;
}

/** The season's answered games: a game that another season owns is not this read's (CL-STA-28). */
async function answeredGames(
  tx: Transaction,
  read: LinesRead,
  answers: Map<SourceGameId, GameAnswer>,
) {
  const rows = await tx
    .select()
    .from(games)
    .where(and(eq(games.statsSource, STATS_SOURCE), eq(games.season, read.request.season)));
  return rows.flatMap((game) => {
    const answer = answers.get(game.sourceGameRef);
    return answer === undefined ? [] : { game, answer };
  });
}

async function insertAll<T>(
  rows: readonly T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await insert(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

/** Makes the gathered writes: the traces first, then the lines, then the flags. */
async function write(tx: Transaction, run: Run): Promise<void> {
  await insertAll(run.traces, (rows) => tx.insert(statCorrections).values(rows));
  if (run.deletes.length > 0) {
    await tx.delete(boxScores).where(inArray(boxScores.id, run.deletes));
  }
  for (const { id, values } of run.updates) {
    await tx
      .update(boxScores)
      .set({ ...values, fetchedAt: run.at })
      .where(eq(boxScores.id, id));
  }
  await insertAll(run.inserts, (rows) => tx.insert(boxScores).values(rows));
  if (run.published.home.length > 0) {
    await tx
      .update(games)
      .set({ homeLinesPublished: true })
      .where(inArray(games.id, run.published.home));
  }
  if (run.published.away.length > 0) {
    await tx
      .update(games)
      .set({ awayLinesPublished: true })
      .where(inArray(games.id, run.published.away));
  }
}

const byCodeUnits = (left: string, right: string): number => (left < right ? -1 : 1);

const scopeOf = (players: Iterable<PlayerId>, gameIds: Iterable<GameId>): LinesScope => ({
  playerIds: [...new Set(players)].toSorted(byCodeUnits),
  gameIds: [...gameIds].toSorted((left, right) => left - right),
});

/** What the run changed: a newly published side concerns every requested player. */
function changeOf(run: Run, playerIds: readonly PlayerId[]): LinesChange {
  const hasNewSides = run.published.home.length + run.published.away.length > 0;
  const changed = hasNewSides ? [...run.changed.players, ...playerIds] : run.changed.players;
  return {
    changed: scopeOf(changed, run.changed.games),
    corrected: scopeOf(run.corrected.players, run.corrected.games),
    teamHistoryChanged: [...run.teamHistoryChanged].toSorted(byCodeUnits),
  };
}

/** Judges each requested player's line in each answered game of the season, and the game's sides. */
async function judge(tx: Transaction, read: LinesRead, run: Run): Promise<readonly PlayerId[]> {
  const players = await seasonPlayers(tx, read.request);
  const { playerIds } = players;
  const answered = await answeredGames(tx, read, indexAnswer(read.lines, players.bySource));
  for (const { game, answer } of answered) {
    const sides = new Set([...answer.teams].flatMap((team) => sideOf(run, game, team)?.side ?? []));
    publishSides(run, game, sides);
    for (const playerId of playerIds) {
      const stored = players.stored.get(lineKey(game.id, playerId));
      judgeLine(run, {
        game,
        answer,
        sides,
        playerId,
        stored,
        wasRead: players.read.has(playerId),
      });
    }
  }
  return playerIds;
}

/**
 * Stores, in the caller's transaction, the box-score lines that a read of
 * `getSeasonBoxScores` gave for one season (STA-01, STA-08, STA-10, STA-33, STA-34,
 * CL-STA-04, CL-STA-06, CL-STA-26): it calls nothing out and takes no statistic but the
 * source's. Only the requested players with an established mapping get lines, only in
 * the games of that season, and only lines they played: a did-not-play line, its reason
 * included, is never stored. Each line keeps the engine's status and failed checks, a
 * missing value as null, the "rounded minutes" mention of whole minutes, the team of the
 * game that the source says he played for and the ejection as the source gives it. Each
 * side whose lines the answer holds gets its lines-published flag, so that no line there
 * means not played. A player whom no read since his mapping was established gave lines
 * of the season gets his lines as first lines, untraced, whatever those flags say, a
 * mapping confirmed again included (JOU-12). While a game is not
 * consolidated, or on a manual refetch, every element that differs from a stored or
 * published state replaces it and is traced with the origin "correction window" or
 * "manual refetch", and a line that turns "not played" is deleted after its trace; a
 * consolidated game otherwise only gets first lines.
 */
export async function ingestLines(tx: Transaction, read: LinesRead): Promise<LinesChange> {
  const run: Run = {
    at: new Date(now()),
    isManualRefetch: read.isManualRefetch,
    teamIds: await teamIdsOf(tx),
    inserts: [],
    updates: [],
    deletes: [],
    traces: [],
    published: { home: [], away: [] },
    changed: idSets(),
    corrected: idSets(),
    teamHistoryChanged: new Set(),
  };
  const playerIds = await judge(tx, read, run);
  await write(tx, run);
  return changeOf(run, playerIds);
}

// What every read of requests shares: the request rows with their players, the origin that
// a trigger and a kind derive, the rank in the to-do list and the deadline, both derived at
// each read and never stored (BKT-16, BKT-17).
import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { backtestRequests, followedPlayers } from '@/lib/db';
import { nextGame } from '@/lib/games';
import { getParam } from '@/lib/params';
import { deadlineOf, rankTodo } from '@/lib/stats-engine';
import { toEpochMs, userDay } from '@/lib/time';

import type { BacktestRequestRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { ReadRefusal } from '@/lib/games';
import type { Deadline, NextGame, NoGameScheduled } from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

/** A connection or the caller's transaction, to read through. */
export type Reader = Database | Transaction;

/** Where a request stands (BKT-13). */
export type BacktestRequestStatus = BacktestRequestRow['status'];

/** What a request asks: a first research, a supplement or a full redo (BKT-01, BKT-08, BKT-09). */
export type BacktestRequestKind = BacktestRequestRow['kind'];

/** What created a request (BKT-01, BKT-03 to BKT-06). */
export type BacktestRequestTrigger = BacktestRequestRow['trigger'];

/**
 * Where a request comes from as the screens name it, derived from its trigger and its kind
 * and never stored (05 « Données manipulées »): from a detection, by hand, or supplementary.
 */
export type BacktestRequestOrigin = 'from_detection' | 'manual' | 'supplementary';

/**
 * A request's deadline (BKT-16, CL-BKT-24): the next game of its player, with the mark
 * "time TBD" and the whole days left when its time is to be determined, or "no game
 * scheduled" with its reason; or the refusal of the games read when the schedule of the
 * season of today is not read yet (STA-48, CL-STA-28).
 */
export type RequestDeadline = Deadline | ReadRefusal;

/**
 * The next game of a request's player, the one that gives its deadline (BKT-16, STA-26):
 * its identifier, its phase, its opponent and where his team plays it.
 */
export type RequestGame = Pick<NextGame, 'gameId' | 'phase' | 'opponentTeamId' | 'venue'>;

/** The followed player a request is for. */
export type RequestPlayer = Readonly<{ id: string; displayName: string }>;

// The rank of the first request of the to-do list.
const FIRST_RANK = 1;

/** The instant of a `timestamptz` read back, in epoch milliseconds. */
export const instant = (date: Date): EpochMs => toEpochMs(date.getTime());

/** The instant of a `timestamptz` that may be null, in epoch milliseconds. */
export const optionalInstant = (date: Date | null): EpochMs | null =>
  date === null ? null : instant(date);

/**
 * The origin of a request, derived from its trigger and its kind (05 « Données
 * manipulées »): « née d'une détection » for the detection trigger on an initial request or a
 * supplement; « complémentaire » for any other supplement; « manuelle » for the rest, the
 * initial requests and full redos asked by hand.
 */
export function originOf(
  trigger: BacktestRequestTrigger,
  kind: BacktestRequestKind,
): BacktestRequestOrigin {
  if (trigger === 'detection' && kind !== 'full_redo') {
    return 'from_detection';
  }
  return kind === 'supplement' ? 'supplementary' : 'manual';
}

/** What a read of requests starts from: a request's own columns and its player's name. */
export type RequestRow = Pick<
  BacktestRequestRow,
  | 'id'
  | 'reference'
  | 'kind'
  | 'trigger'
  | 'status'
  | 'createdAt'
  | 'lastCopiedAt'
  | 'promptProducedAt'
> &
  Readonly<{ playerId: string; playerName: string }>;

export const REQUEST_COLUMNS = {
  id: backtestRequests.id,
  reference: backtestRequests.reference,
  kind: backtestRequests.kind,
  trigger: backtestRequests.trigger,
  status: backtestRequests.status,
  createdAt: backtestRequests.createdAt,
  lastCopiedAt: backtestRequests.lastCopiedAt,
  promptProducedAt: backtestRequests.promptProducedAt,
  playerId: followedPlayers.id,
  playerName: followedPlayers.displayName,
};

/** The part of the requests, newest first, that a page of the list reads. */
export type RequestWindow = Readonly<{ limit: number; offset: number }>;

/**
 * The requests of one status with their players, newest first, all of them or the `window`
 * of them (BKT-17).
 */
export async function requestRows(
  db: Reader,
  status: BacktestRequestStatus,
  window?: RequestWindow,
): Promise<readonly RequestRow[]> {
  const query = db
    .select(REQUEST_COLUMNS)
    .from(backtestRequests)
    .innerJoin(followedPlayers, eq(followedPlayers.id, backtestRequests.playerId))
    .where(eq(backtestRequests.status, status))
    .orderBy(desc(backtestRequests.createdAt), desc(backtestRequests.id))
    .$dynamic();
  return window === undefined ? query : query.limit(window.limit).offset(window.offset);
}

/** The requests to do in the order of the to-do list: the oldest first (BKT-17, CL-IHM-16). */
export function rankedTodo<T extends Readonly<{ id: number; createdAt: Date }>>(
  rows: readonly T[],
): readonly T[] {
  return rankTodo(
    rows.map((row) => ({
      backtestRequestId: row.id,
      createdAt: instant(row.createdAt),
      urgentDeadlineAt: undefined,
      row,
    })),
  ).map(({ row }) => row);
}

/** The rank, from 1, of each request of a to-do list that `rows` hold in order (BKT-17). */
export const ranksOf = (rows: readonly Readonly<{ id: number }>[]): ReadonlyMap<number, number> =>
  new Map(rows.map((row, index) => [row.id, index + FIRST_RANK]));

/** The rank of each request to do in the to-do list (BKT-17). */
export async function todoRanks(db: Reader): Promise<ReadonlyMap<number, number>> {
  const rows = await db
    .select({ id: backtestRequests.id, createdAt: backtestRequests.createdAt })
    .from(backtestRequests)
    .where(eq(backtestRequests.status, 'to_do'));
  return ranksOf(rankedTodo(rows));
}

/** A request's deadline, and the game it comes from while there is one (BKT-16). */
type DeadlineReading = Readonly<{ deadline: RequestDeadline; nextGame: RequestGame | null }>;

/** The game of a deadline, when the answer is a game and not "no game scheduled". */
function gameOf(next: NextGame | NoGameScheduled): RequestGame | null {
  if (next.kind === 'no_game_scheduled') {
    return null;
  }
  const { gameId, phase, opponentTeamId, venue } = next;
  return { gameId, phase, opponentTeamId, venue };
}

/**
 * What gives the deadline of a player: his next game at `at`, read once for a player whose
 * several requests are listed, the owner's day being today in his time zone (BKT-16).
 */
export async function deadlineReader(
  db: Reader,
  at: EpochMs,
): Promise<(playerId: string) => Promise<DeadlineReading>> {
  const todayOn = userDay(at, await getParam(db, 'display.timeZone'));
  const known = new Map<string, DeadlineReading>();
  return async (playerId) => {
    const reading = known.get(playerId);
    if (reading !== undefined) {
      return reading;
    }
    const result = await nextGame(db, playerId, at);
    const read: DeadlineReading = result.ok
      ? { deadline: deadlineOf(result.value, todayOn), nextGame: gameOf(result.value) }
      : { deadline: result.error, nextGame: null };
    known.set(playerId, read);
    return read;
  };
}

/** What a list of requests shows of each one (BKT-16, BKT-17, IHM-27). */
export type RequestSummary = Readonly<{
  id: number;
  reference: string;
  player: RequestPlayer;
  kind: BacktestRequestKind;
  trigger: BacktestRequestTrigger;
  origin: BacktestRequestOrigin;
  status: BacktestRequestStatus;
  createdAt: EpochMs;
  /** The request's position in the to-do list, from 1, while it is to do; null otherwise (BKT-17). */
  rank: number | null;
  deadline: RequestDeadline;
  /** The game of the deadline, with its opponent; null when there is none (BKT-16). */
  nextGame: RequestGame | null;
  /** When the prompt was last copied or shared (BKT-20, CL-BKT-12); null before any copy. */
  lastCopiedAt: EpochMs | null;
  /** Whether the prompt was produced after its last copy, so that the copied text is out of date (BKT-20). */
  isCopiedTextStale: boolean;
}>;

/** What a list shows of a request, given its rank and its deadline. */
export function summaryOf(
  row: RequestRow,
  rank: number | undefined,
  { deadline, nextGame: game }: DeadlineReading,
): RequestSummary {
  return {
    id: row.id,
    reference: row.reference,
    player: { id: row.playerId, displayName: row.playerName },
    kind: row.kind,
    trigger: row.trigger,
    origin: originOf(row.trigger, row.kind),
    status: row.status,
    createdAt: instant(row.createdAt),
    rank: rank ?? null,
    deadline,
    nextGame: game,
    lastCopiedAt: optionalInstant(row.lastCopiedAt),
    isCopiedTextStale: row.lastCopiedAt !== null && row.promptProducedAt > row.lastCopiedAt,
  };
}

/** The ranks of the requests to do and the instant at which their deadlines are read. */
export type SummaryContext = Readonly<{ ranks: ReadonlyMap<number, number>; at: EpochMs }>;

/** The summaries of `rows`, in their order, ranked and with their deadlines as `context` says. */
export async function summarize(
  db: Reader,
  rows: readonly RequestRow[],
  context: SummaryContext,
): Promise<readonly RequestSummary[]> {
  const deadlineOfPlayer = await deadlineReader(db, context.at);
  const summaries: RequestSummary[] = [];
  for (const row of rows) {
    summaries.push(summaryOf(row, context.ranks.get(row.id), await deadlineOfPlayer(row.playerId)));
  }
  return summaries;
}

import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { backtestRequests, followedPlayers } from '@/lib/db';
import { getParam, getUiSetting } from '@/lib/params';

import {
  instant,
  originOf,
  rankedTodo,
  ranksOf,
  requestRows,
  summarize,
  todoRanks,
} from './request-reads';

import type {
  BacktestRequestKind,
  BacktestRequestOrigin,
  BacktestRequestStatus,
  BacktestRequestTrigger,
  Reader,
  RequestPlayer,
  RequestSummary,
} from './request-reads';
import type { EpochMs } from '@/lib/time';

const FIRST_PAGE = 1;
// The status that the list shows when it is given none: the requests the owner has to act on.
const DEFAULT_LIST_STATUS: BacktestRequestStatus = 'to_do';
// A player identifier as Postgres writes a uuid: a malformed one names no player.
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/** Which requests the list shows, and which page of them (BKT-17, IHM-18). */
export type RequestListQuery = Readonly<{
  /** The requests to do when left out. */
  status?: BacktestRequestStatus;
  /** From 1: the first page when left out or not a whole number of at least 1. */
  page?: number;
}>;

/** A page of the list, and whether another follows. */
export type RequestListPage = Readonly<{
  requests: readonly RequestSummary[];
  page: number;
  hasNextPage: boolean;
}>;

/** `page` when it is a whole number of at least 1, the first page otherwise (IHM-18). */
function pageNumber(page: number | undefined): number {
  return page !== undefined && Number.isSafeInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE;
}

/**
 * A page of the requests of one status, the requests to do by default, newest first,
 * `display.listPageSize` requests a page, each with its player, trigger, origin, deadline
 * (the next game of its player at `at`), rank while it is to do and copy state (BKT-16,
 * BKT-17, BKT-20, IHM-18). The deadline and the rank are derived at each read and never
 * stored.
 */
export async function list(
  db: Reader,
  at: EpochMs,
  query: RequestListQuery = {},
): Promise<RequestListPage> {
  const { status = DEFAULT_LIST_STATUS } = query;
  const page = pageNumber(query.page);
  const pageSize = await getParam(db, 'display.listPageSize');
  const rows = await requestRows(db, status, {
    limit: pageSize + 1,
    offset: (page - FIRST_PAGE) * pageSize,
  });
  const ranks = status === 'to_do' ? await todoRanks(db) : new Map<number, number>();
  const requests = await summarize(db, rows.slice(0, pageSize), { ranks, at });
  return { requests, page, hasNextPage: rows.length > pageSize };
}

/**
 * The requests to do in the order of the to-do list, the oldest first, each as `list`
 * shows it (BKT-17, BKT-19, CL-IHM-16, CL-BKT-21). Age orders them and changes nothing
 * else: a request left alone stays to do at any age and keeps its rank, and this read
 * starts no reminder, no expiry and no call to an outside service. No request is urgent in
 * Lot 1.
 */
export async function requestsToDo(db: Reader, at: EpochMs): Promise<readonly RequestSummary[]> {
  const rows = rankedTodo(await requestRows(db, 'to_do'));
  return summarize(db, rows, { ranks: ranksOf(rows), at });
}

/** A request of one player, as the player page, the data deletion and the withdrawal read it (JOU-25). */
export type PlayerRequest = Readonly<{
  id: number;
  reference: string;
  kind: BacktestRequestKind;
  trigger: BacktestRequestTrigger;
  origin: BacktestRequestOrigin;
  status: BacktestRequestStatus;
  createdAt: EpochMs;
}>;

/**
 * Every request of the player `playerId`, whatever its status, the to-do, imported and
 * canceled ones, newest first, each with its identifier, reference, kind, trigger, derived
 * origin and status (BKT-12, CL-JOU-06): the player page's backtest block, the counts of
 * the deletion of his data and the withdrawal, which discards the import drafts of each.
 * Nothing for an identifier that is no player's.
 */
export async function requestsOfPlayer(
  db: Reader,
  playerId: string,
): Promise<readonly PlayerRequest[]> {
  if (!UUID_PATTERN.test(playerId)) {
    return [];
  }
  const rows = await db
    .select({
      id: backtestRequests.id,
      reference: backtestRequests.reference,
      kind: backtestRequests.kind,
      trigger: backtestRequests.trigger,
      status: backtestRequests.status,
      createdAt: backtestRequests.createdAt,
    })
    .from(backtestRequests)
    .where(eq(backtestRequests.playerId, playerId))
    .orderBy(desc(backtestRequests.createdAt), desc(backtestRequests.id));
  return rows.map((row) => ({
    ...row,
    origin: originOf(row.trigger, row.kind),
    createdAt: instant(row.createdAt),
  }));
}

/** The request of the "backtest in progress" banner (IHM-40, CL-IHM-13). */
export type InProgress = Readonly<{
  id: number;
  reference: string;
  player: RequestPlayer;
  lastCopiedAt: EpochMs;
  /** The other requests to do whose prompt was copied. */
  otherCount: number;
}>;

/** Whether a request's prompt was copied, which narrows its copy time. */
const isCopied = <Row extends Readonly<{ lastCopiedAt: Date | null }>>(
  row: Row,
): row is Row & Readonly<{ lastCopiedAt: Date }> => row.lastCopiedAt !== null;

/**
 * The request in progress, the one to do whose prompt was copied most recently, with the
 * number of the other copied requests to do (IHM-40, CL-IHM-13, CL-BKT-12); nothing when
 * no request to do was copied, or while the owner hid the banner with "Later" and no prompt
 * was copied since. Read from the stored copy time, so that every device shows the same.
 */
export async function inProgress(db: Reader): Promise<InProgress | null> {
  const rows = await db
    .select({
      id: backtestRequests.id,
      reference: backtestRequests.reference,
      lastCopiedAt: backtestRequests.lastCopiedAt,
      playerId: followedPlayers.id,
      playerName: followedPlayers.displayName,
    })
    .from(backtestRequests)
    .innerJoin(followedPlayers, eq(followedPlayers.id, backtestRequests.playerId))
    .where(eq(backtestRequests.status, 'to_do'))
    .orderBy(desc(backtestRequests.lastCopiedAt), desc(backtestRequests.id));
  const [latest, ...others] = rows.filter(isCopied);
  if (latest === undefined) {
    return null;
  }
  const lastCopiedAt = instant(latest.lastCopiedAt);
  const { value: hiddenAt } = await getUiSetting(db, 'inProgressBannerHiddenAt');
  if (hiddenAt !== null && lastCopiedAt <= hiddenAt) {
    return null;
  }
  return {
    id: latest.id,
    reference: latest.reference,
    player: { id: latest.playerId, displayName: latest.playerName },
    lastCopiedAt,
    otherCount: others.length,
  };
}

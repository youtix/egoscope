// The deadline of a backtest request and the order of the requests to do (BKT-16 to
// BKT-18), derived whenever they are read and never stored. The caller reads the game
// and the owner's day through the time module, the deemed start of a game whose time is
// to be determined included (STA-31, CL-STA-14): this part only compares instants and
// dates.

import type { BacktestRequestId, EpochMs, IsoDate } from '../types';

/** Why a player has no next game (STA-26). */
export type NoNextGameReason =
  'offseason' | 'team_eliminated' | 'player_without_team' | 'schedule_not_published';

/**
 * A game that gives a request its deadline (BKT-16): the player's next game (STA-26)
 * or, for an urgent request in Lot 2, the earliest expected game of its upcoming events
 * (CL-BKT-23). Its scheduled start is the deemed start, 00:00 US Eastern time on its US
 * date, while its time is to be determined (STA-31, CL-STA-14).
 */
export type DeadlineGame = Readonly<{
  kind: 'game';
  scheduledStartAt: EpochMs;
  isStartTimeTbd: boolean;
  gameDayOn: IsoDate;
}>;

/** The answer "no game scheduled" of STA-26, with its reason. */
export type NoGameScheduled = Readonly<{ kind: 'no_game_scheduled'; reason: NoNextGameReason }>;

/**
 * The deadline of a request (BKT-16): its game's scheduled start, which orders the
 * requests; with the mark "time TBD" and the whole days left until the game's US date
 * while that time is to be determined (CL-BKT-24); or "no game scheduled" with its
 * reason.
 */
export type Deadline =
  | Readonly<{ kind: 'game'; scheduledStartAt: EpochMs; isStartTimeTbd: false }>
  | Readonly<{
      kind: 'game';
      scheduledStartAt: EpochMs;
      isStartTimeTbd: true;
      daysRemaining: number;
    }>
  | NoGameScheduled;

/**
 * A request to do as the to-do list ranks it (BKT-17, BKT-18): its identifier, its
 * creation instant and, while it is urgent, the scheduled start of its deadline's game,
 * the deemed start for a game whose time is to be determined (CL-BKT-24). No request is
 * urgent in Lot 1 (CL-IHM-16).
 */
export type RequestToDo = Readonly<{
  backtestRequestId: BacktestRequestId;
  createdAt: EpochMs;
  urgentDeadlineAt: EpochMs | undefined;
}>;

const MS_PER_DAY = 86_400_000;

// 00:00 UTC on a date written YYYY-MM-DD.
function utcMidnight(day: IsoDate): EpochMs {
  const [year = NaN, month = NaN, date = NaN] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

// The calendar days from `fromOn` to `toOn`, two dates written YYYY-MM-DD.
function daysBetween(fromOn: IsoDate, toOn: IsoDate): number {
  return (utcMidnight(toOn) - utcMidnight(fromOn)) / MS_PER_DAY;
}

/**
 * The deadline of a request (BKT-16, CL-BKT-24), from its game and the owner's day,
 * today's date in his time zone (TRV-72): the game's scheduled start; for a game whose
 * time is to be determined, its deemed start with the mark "time TBD", which screens
 * show with the date and never as 00:00, and the whole days from the owner's day to the
 * game's US date, the date they show (0 when the game is that day); or the answer "no
 * game scheduled" of STA-26, with the reason that the caller passes in.
 */
export function deadlineOf(game: DeadlineGame | NoGameScheduled, todayOn: IsoDate): Deadline {
  if (game.kind === 'no_game_scheduled') {
    return game;
  }
  const { scheduledStartAt, gameDayOn } = game;
  return game.isStartTimeTbd
    ? {
        kind: 'game',
        scheduledStartAt,
        isStartTimeTbd: true,
        daysRemaining: daysBetween(todayOn, gameDayOn),
      }
    : { kind: 'game', scheduledStartAt, isStartTimeTbd: false };
}

// Urgent requests come first (BKT-18).
function urgencyRank(request: RequestToDo): number {
  return request.urgentDeadlineAt === undefined ? 1 : 0;
}

// The order of the to-do list, key after key: urgent requests first, by deadline, then
// by age; identifiers, distinct for distinct requests, break the ties that remain,
// between requests created at one instant.
function compareRanks(one: RequestToDo, other: RequestToDo): number {
  const differences = [
    urgencyRank(one) - urgencyRank(other),
    (one.urgentDeadlineAt ?? 0) - (other.urgentDeadlineAt ?? 0),
    one.createdAt - other.createdAt,
  ];
  return (
    differences.find((difference) => difference !== 0) ??
    one.backtestRequestId - other.backtestRequestId
  );
}

/**
 * The requests to do in the order of the to-do list (BKT-17, H-BKT-04, CL-BKT-23):
 * urgent requests first, from the nearest deadline to the farthest, those of one
 * deadline from the oldest to the most recent; then the others from the oldest to the
 * most recent, the only order of Lot 1, where no request is urgent (CL-IHM-16).
 * Requests created at one instant, as when the owner accepts a proposal for several
 * players at once, follow their identifiers, so that the order is total and never
 * depends on the order given. Age orders the requests and changes nothing else: a
 * request keeps its rank whatever its age (CL-BKT-21).
 */
export function rankTodo<T extends RequestToDo>(requests: readonly T[]): readonly T[] {
  return requests.toSorted(compareRanks);
}

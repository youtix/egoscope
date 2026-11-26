// The restraint rules of the sending (file 11, "Sobriété"), as pure functions: quiet hours,
// urgency, the grouping of a pass, the lines a digest details, the daily cap, the retries and
// the catch-up's timing. Every timing is an instant, and the action happens at the first tick
// after it (module map §4.1, ADR 0025); the parameters come in as arguments.
import {
  endOfLocalDay,
  localOccurrenceInstant,
  startOfLocalDay,
  toEpochMs,
  userDay,
} from '@/lib/time';

import type { NotificationMessageRow } from './types';
import type { TimeRange } from '@/lib/params';
import type { EpochMs, IsoDate } from '@/lib/time';

/** The kind of a message (`NotificationKind`). */
type NotificationKind = NotificationMessageRow['kind'];

const MS_PER_MINUTE = 60_000;
const ONE_MS = 1;

/** A quiet period: the instants from `start`, included, to `end`, excluded (CL-TEL-22). */
type QuietPeriod = Readonly<{ start: EpochMs; end: EpochMs }>;

function nextDay(day: IsoDate, zone: string): IsoDate {
  return userDay(endOfLocalDay(day, zone), zone);
}

function previousDay(day: IsoDate, zone: string): IsoDate {
  return userDay(toEpochMs(startOfLocalDay(day, zone) - ONE_MS), zone);
}

/** The quiet period that starts on `day`, ending the next day when it spans midnight. */
function periodStartingOn(day: IsoDate, quietHours: TimeRange, zone: string): QuietPeriod {
  const endDay = quietHours.start < quietHours.end ? day : nextDay(day, zone);
  return {
    start: localOccurrenceInstant(day, quietHours.start, zone),
    end: localOccurrenceInstant(endDay, quietHours.end, zone),
  };
}

/**
 * The quiet period that holds `at`, or undefined outside quiet hours (TEL-20). The range is
 * read in the owner's zone, start included and end excluded (CL-TEL-22); a range across
 * midnight is one period; equal start and end mean no quiet hours. Each bound is the instant
 * of its wall-clock time on its day, so a period lasts an hour more or less across a clock
 * change, and a bound that the change skips moves to the end of the gap (TRV-70).
 */
export function quietPeriodAt(
  at: EpochMs,
  quietHours: TimeRange,
  zone: string,
): QuietPeriod | undefined {
  if (quietHours.start === quietHours.end) {
    return undefined;
  }
  const today = userDay(at, zone);
  return [previousDay(today, zone), today]
    .map((day) => periodStartingOn(day, quietHours, zone))
    .find((period) => period.start <= at && at < period.end);
}

/**
 * When a message ready at `at` may leave: at once outside quiet hours, else at the end of the
 * quiet period, when the deferred messages and the catch-up leave (TEL-20, CL-TEL-12).
 */
export function releaseAt(at: EpochMs, quietHours: TimeRange, zone: string): EpochMs {
  return quietPeriodAt(at, quietHours, zone)?.end ?? at;
}

// The kinds that can be urgent (TEL-21, CL-TEL-18).
const URGENT_KINDS: ReadonlySet<NotificationKind> = new Set([
  'backtest_request_to_do',
  'deadline_changed',
  'deadline_reminder',
  'alert',
  'alert_update',
]);

/** What urgency reads of a message: its kind, its game's tip-off and its late mark. */
type UrgencyCandidate = Readonly<{
  kind: NotificationKind;
  tipOff: EpochMs | undefined;
  isLate: boolean;
}>;

/** The instant a message is composed at, and the settings urgency depends on. */
type UrgencyContext = Readonly<{
  at: EpochMs;
  quietHours: TimeRange;
  zone: string;
  urgentException: boolean;
}>;

/**
 * Says whether a message is urgent (TEL-21): the urgent exception is on, the message is a
 * backtest request, a deadline change, a reminder, an alert or an alert update, it is
 * composed during quiet hours, and its game has not started and tips off before the current
 * quiet period ends. A late alert never is (CL-TEL-13).
 */
export function isUrgent(candidate: UrgencyCandidate, context: UrgencyContext): boolean {
  const { tipOff } = candidate;
  if (
    tipOff === undefined ||
    candidate.isLate ||
    !context.urgentException ||
    !URGENT_KINDS.has(candidate.kind)
  ) {
    return false;
  }
  const period = quietPeriodAt(context.at, context.quietHours, context.zone);
  return period !== undefined && context.at < tipOff && tipOff < period.end;
}

/** What the grouping reads of a message of a pass. */
type PassMessage = Readonly<{ kind: NotificationKind; isUrgent: boolean }>;

/** The messages of a pass that leave alone, and those that its single digest holds. */
type PassGrouping<M> = Readonly<{ alone: readonly M[]; digest: readonly M[] }>;

/**
 * Splits the messages of one pass, or of the end of quiet hours (TEL-20), into those that
 * leave alone and those of the pass's single digest (TEL-19, CL-TEL-11): urgent messages
 * always leave alone; the alerts leave one by one while the pass produces no more of them
 * than `alertGroupingThreshold`, and beyond it every other alert joins the digest; the other
 * messages join it when there is more than one of them, and a single one leaves alone.
 */
export function groupPass<M extends PassMessage>(
  messages: readonly M[],
  alertGroupingThreshold: number,
): PassGrouping<M> {
  const alertCount = messages.filter((message) => message.kind === 'alert').length;
  const areAlertsAlone = alertCount <= alertGroupingThreshold;
  const isAlone = (message: M): boolean =>
    message.isUrgent || (areAlertsAlone && message.kind === 'alert');
  const grouped = messages.filter((message) => !isAlone(message));
  return grouped.length > 1
    ? { alone: messages.filter((message) => isAlone(message)), digest: grouped }
    : { alone: messages, digest: [] };
}

/** The kinds of message whose facts a digest holds. */
type DigestKind =
  | 'alert'
  | 'alert_update'
  | 'backtest_request_to_do'
  | 'deadline_changed'
  | 'deadline_reminder'
  | 'tracked_game_result'
  | 'new_type_proposal'
  | 'incident_start'
  | 'incident_reminder'
  | 'incident_end'
  | 'export_reminder';

// The order of a digest's lines, kind by kind (CL-TEL-11); the export reminder is of the
// incidents' category (notifications.md §4).
const DIGEST_ORDER: readonly (readonly DigestKind[])[] = [
  ['alert', 'alert_update'],
  ['backtest_request_to_do', 'deadline_changed', 'deadline_reminder'],
  ['tracked_game_result'],
  ['new_type_proposal'],
  ['incident_start', 'incident_reminder', 'incident_end', 'export_reminder'],
];

/** What the order of a digest reads of one of its facts. */
type DigestFact = Readonly<{
  kind: DigestKind;
  tipOff: EpochMs | undefined;
  createdAt: EpochMs;
}>;

/** The facts a digest details, in their order, and the number it sums up as "and N more". */
type DigestLines<F> = Readonly<{ detailed: readonly F[]; moreCount: number }>;

function kindRank(kind: DigestKind): number {
  return DIGEST_ORDER.findIndex((kinds) => kinds.includes(kind));
}

/** Earliest tip-off first, a fact without a game after those with one. */
function compareTipOffs(left: EpochMs | undefined, right: EpochMs | undefined): number {
  return left === undefined || right === undefined
    ? Number(left === undefined) - Number(right === undefined)
    : left - right;
}

function compareFacts(left: DigestFact, right: DigestFact): number {
  const byKind = kindRank(left.kind) - kindRank(right.kind);
  if (byKind !== 0) {
    return byKind;
  }
  const byGame = compareTipOffs(left.tipOff, right.tipOff);
  return byGame === 0 ? left.createdAt - right.createdAt : byGame;
}

/**
 * The lines of a digest (TEL-19, CL-TEL-11): alerts and alert updates, backtest requests and
 * reminders, tracked-game results, type proposals, then incidents; within a kind the nearest
 * game first, then creation order. The first `maxDetailedFacts` are detailed, and the others
 * are summed up as "and N more".
 */
export function digestLines<F extends DigestFact>(
  facts: readonly F[],
  maxDetailedFacts: number,
): DigestLines<F> {
  const ordered = facts.toSorted(compareFacts);
  return {
    detailed: ordered.slice(0, maxDetailedFacts),
    moreCount: Math.max(0, ordered.length - maxDetailedFacts),
  };
}

// The messages the daily cap never counts nor stops (CL-TEL-07).
const UNCOUNTED_KINDS: ReadonlySet<NotificationKind> = new Set([
  'link_confirmation',
  'daily_cap_reached',
]);

/**
 * Says whether a sent message counts toward the daily cap (TEL-22, CL-TEL-07): every sent
 * message counts once, a digest or a catch-up once, the test message too (CL-TEL-19); the
 * link confirmation and the cap message never do.
 */
export function isCountedTowardCap(kind: NotificationKind): boolean {
  return !UNCOUNTED_KINDS.has(kind);
}

/** What the cap reads of the owner's day: its counted sends and whether its cap message exists. */
type CapDay = Readonly<{ sentCount: number; capMessageExists: boolean }>;

/**
 * What becomes of a message about to leave (TEL-22, CL-TEL-07): `send` while the day's
 * counted sends are below `dailyCap`, and always for the messages the cap does not count;
 * once the cap is reached, `send_cap_message` for the first message, which the cap message
 * replaces and which is discarded, then `discard` for every later one, urgent ones included;
 * a test message is `refused` instead (CL-TEL-19).
 */
export function capDecision(
  kind: NotificationKind,
  day: CapDay,
  dailyCap: number,
): 'send' | 'send_cap_message' | 'discard' | 'refused' {
  if (!isCountedTowardCap(kind) || day.sentCount < dailyCap) {
    return 'send';
  }
  if (kind === 'test_message') {
    return 'refused';
  }
  return day.capMessageExists ? 'discard' : 'send_cap_message';
}

/** A temporary failure of a message: its instant, its rank and Telegram's delay if any. */
type SendFailure = Readonly<{
  failedAt: EpochMs;
  failureCount: number;
  retryAfterMs: number | undefined;
}>;

/** The next attempt after a temporary failure, or the end of the attempts. */
type RetryDecision = Readonly<{ kind: 'retry'; at: EpochMs }> | Readonly<{ kind: 'failed' }>;

/**
 * The next attempt after the n-th temporary failure of a message, n = `failureCount` from 1
 * (TEL-35): the later of the n-th of `retryIntervalsMinutes`, which are minimums, and the
 * delay Telegram's `retry_after` asks for; after the last interval the message is `failed`.
 */
export function nextAttempt(
  failure: SendFailure,
  retryIntervalsMinutes: readonly number[],
): RetryDecision {
  const intervalMinutes = retryIntervalsMinutes[failure.failureCount - 1];
  if (intervalMinutes === undefined) {
    return { kind: 'failed' };
  }
  const waitMs = Math.max(intervalMinutes * MS_PER_MINUTE, failure.retryAfterMs ?? 0);
  return { kind: 'retry', at: toEpochMs(failure.failedAt + waitMs) };
}

/** The pending catch-up: when it was created, its last failed try, the last other success. */
type CatchUpState = Readonly<{
  createdAt: EpochMs;
  lastFailureAt: EpochMs | undefined;
  lastSuccessAt: EpochMs | undefined;
}>;

/** The instant of the decision, and the settings the catch-up's timing depends on. */
type CatchUpContext = Readonly<{
  now: EpochMs;
  catchUpIntervalMinutes: number;
  quietHours: TimeRange;
  zone: string;
}>;

function earliestCatchUpTry(state: CatchUpState, catchUpIntervalMinutes: number): EpochMs {
  const { lastFailureAt, lastSuccessAt } = state;
  if (lastFailureAt === undefined) {
    return state.createdAt;
  }
  return lastSuccessAt !== undefined && lastSuccessAt > lastFailureAt
    ? lastSuccessAt
    : toEpochMs(lastFailureAt + catchUpIntervalMinutes * MS_PER_MINUTE);
}

/**
 * When the catch-up may next be tried (TEL-36, CL-TEL-12): at once when it never failed,
 * else `catchUpIntervalMinutes` after its last failure, or right after another send succeeded
 * since; never before `now`; and during quiet hours at their end, when it leaves just before
 * the quiet-hours digest, since it is never urgent.
 */
export function catchUpDueAt(state: CatchUpState, context: CatchUpContext): EpochMs {
  const due = earliestCatchUpTry(state, context.catchUpIntervalMinutes);
  return releaseAt(toEpochMs(Math.max(due, context.now)), context.quietHours, context.zone);
}

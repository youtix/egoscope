// The application's own count, per limit and period instance, in `quota_usage` (TRV-03,
// TRV-04, CL-TRV-12): the state of each limit at an instant, the writes that add a
// call's use, mark a limit reached and note its warning, and the holds of the calls
// running, one `quota_holds` row each.
import { and, eq, gt, gte, inArray, lt, or, sql } from 'drizzle-orm';

import { quotaHolds, quotaUsage } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { HOLD_STALE_AFTER_MS, SERVICES, servicesOf } from './limits';
import { bucketOf, fixedPeriodAt, leavesAt, rollingSince } from './periods';

import type { CountedLimit, LimitKey, Measure, QuotaService, Window } from './limits';
import type { Period } from './periods';
import type { Database, Transaction } from '@/lib/db';
import type { ServiceRole } from '@/lib/incidents';
import type { EpochMs } from '@/lib/time';
import type { SQL } from 'drizzle-orm';

type Executor = Database | Transaction;

/** One period instance of a limit, or one bucket of a rolling window, as stored. */
export type UsageRow = Readonly<{
  key: string;
  start: EpochMs;
  used: number;
  warningGivenAt: EpochMs | null;
  reachedAt: EpochMs | null;
  resetsAt: EpochMs | null;
}>;

/** A limit at an instant: its current period, the use it counts there and its rows. */
export type LimitState = Readonly<{
  limit: CountedLimit;
  /** The current period; for a rolling window, its current bucket and when its oldest leaves. */
  period: Period;
  /** The use counted in the current period, every bucket of a rolling window summed. */
  used: number;
  /** The rows the current period counts, oldest first. */
  rows: readonly UsageRow[];
  /** The instant until which a mark of the limit reached still holds, or null (TRV-06). */
  blockedUntil: EpochMs | null;
}>;

const instant = (value: Date | null): EpochMs | null =>
  value === null ? null : toEpochMs(value.getTime());

/** When a row's period ends: its fixed boundary, its bucket leaving the window, or its reported reset. */
export function rowEnd(window: Window, row: UsageRow): EpochMs {
  if (window.kind === 'fixed') {
    return fixedPeriodAt(window.unit, row.start).end;
  }
  if (window.kind === 'rolling') {
    return leavesAt(row.start, window.lengthMs);
  }
  const nominal = row.start + window.lengthMs;
  return toEpochMs(Math.min(row.resetsAt ?? nominal, nominal));
}

/** The earliest period start that the state of a limit at `at` may read. */
function since(window: Window, at: EpochMs): EpochMs {
  if (window.kind === 'fixed') {
    return fixedPeriodAt(window.unit, at).start;
  }
  return window.kind === 'rolling'
    ? rollingSince(window.lengthMs, at)
    : toEpochMs(at - window.lengthMs);
}

/** The rows of the current period of a limit, oldest first, and that period. */
function current(window: Window, rows: readonly UsageRow[], at: EpochMs) {
  const live = rows.filter((row) => row.start >= since(window, at) && rowEnd(window, row) > at);
  if (window.kind === 'fixed') {
    return { period: fixedPeriodAt(window.unit, at), rows: live };
  }
  if (window.kind === 'rolling') {
    const end =
      live[0] === undefined ? leavesAt(bucketOf(at), window.lengthMs) : rowEnd(window, live[0]);
    return { period: { start: bucketOf(at), end }, rows: live };
  }
  const latest = live.at(-1);
  return latest === undefined
    ? { period: { start: at, end: toEpochMs(at + window.lengthMs) }, rows: [] }
    : { period: { start: latest.start, end: rowEnd(window, latest) }, rows: [latest] };
}

/** The state of `limit` at `at` from its stored rows, oldest first. */
function stateOf(limit: CountedLimit, rows: readonly UsageRow[], at: EpochMs): LimitState {
  const { period, rows: counted } = current(limit.window, rows, at);
  const marks = rows
    .filter((row) => row.reachedAt !== null)
    .map((row) => row.resetsAt ?? rowEnd(limit.window, row))
    .filter((until) => until > at);
  return {
    limit,
    period,
    used: counted.reduce((sum, row) => sum + row.used, 0),
    rows: counted,
    blockedUntil: marks.length === 0 ? null : toEpochMs(Math.max(...marks)),
  };
}

/** The stored rows of `limits` that `filter` keeps, oldest first. */
async function rowsOf(
  db: Executor,
  limits: readonly CountedLimit[],
  filter: SQL | undefined,
): Promise<readonly UsageRow[]> {
  const keys = limits.map((limit) => limit.key);
  const rows = await db
    .select()
    .from(quotaUsage)
    .where(and(inArray(quotaUsage.limitKey, keys), filter))
    .orderBy(quotaUsage.periodStartAt);
  return rows.map((row) => ({
    key: row.limitKey,
    start: toEpochMs(row.periodStartAt.getTime()),
    used: row.used,
    warningGivenAt: instant(row.warningGivenAt),
    reachedAt: instant(row.reachedAt),
    resetsAt: instant(row.resetsAt),
  }));
}

/** The rows of `limits` marked reached from `from` on, by a count or a refusal, oldest first (TRV-06). */
export async function reachedSince(
  db: Executor,
  limits: readonly CountedLimit[],
  from: EpochMs,
): Promise<readonly UsageRow[]> {
  return rowsOf(db, limits, gte(quotaUsage.reachedAt, new Date(from)));
}

/**
 * The state of each of `limits` at `at`, in one read: the current period, its use and
 * the mark of a limit reached that still holds (TRV-04, TRV-06, CL-TRV-12).
 */
export async function readStates(
  db: Executor,
  limits: readonly CountedLimit[],
  at: EpochMs,
): Promise<readonly LimitState[]> {
  if (limits.length === 0) {
    return [];
  }
  const earliest = Math.min(...limits.map((limit) => since(limit.window, at)));
  const live = or(
    gte(quotaUsage.periodStartAt, new Date(earliest)),
    gt(quotaUsage.resetsAt, new Date(at)),
  );
  const stored = await rowsOf(db, limits, live);
  return limits.map((limit) =>
    stateOf(
      limit,
      stored.filter((row) => row.key === limit.key),
      at,
    ),
  );
}

/** What a write adds to the current row of a limit. */
export type RowChange = Readonly<{
  used?: number;
  /** The instant the provider says the limit resets, or a refusal's retry instant. */
  resetsAt?: EpochMs | null;
  reachedAt?: EpochMs;
  warningGivenAt?: EpochMs;
}>;

/** The start of the row that a write at `at` adds to: the current period's, a rolling window's bucket. */
function rowStart(state: LimitState, at: EpochMs): EpochMs {
  return state.limit.window.kind === 'rolling' ? bucketOf(at) : state.period.start;
}

/** The reset a new row of `state` starts with: a fixed period's declared boundary (CL-TRV-12). */
function declaredReset(state: LimitState): EpochMs | null {
  return state.limit.window.kind === 'fixed' ? state.period.end : null;
}

/**
 * Adds `change` to the current row of `state` in the caller's transaction `tx`,
 * creating it when needed: the use adds up, a reported reset and a mark of reached
 * replace the stored ones, a warning keeps its first instant (TRV-03 to TRV-06).
 */
export async function writeRow(
  tx: Transaction,
  state: LimitState,
  change: RowChange & Readonly<{ at: EpochMs }>,
): Promise<void> {
  const date = (value: EpochMs | null | undefined) =>
    value === null || value === undefined ? null : new Date(value);
  const resetsAt = change.resetsAt ?? null;
  await tx
    .insert(quotaUsage)
    .values({
      limitKey: state.limit.key,
      periodStartAt: new Date(rowStart(state, change.at)),
      used: change.used ?? 0,
      resetsAt: date(resetsAt ?? declaredReset(state)),
      reachedAt: date(change.reachedAt),
      warningGivenAt: date(change.warningGivenAt),
    })
    .onConflictDoUpdate({
      target: [quotaUsage.limitKey, quotaUsage.periodStartAt],
      set: {
        used: sql`${quotaUsage.used} + excluded.used`,
        ...(resetsAt !== null && { resetsAt: new Date(resetsAt) }),
        reachedAt: sql`coalesce(excluded.reached_at, ${quotaUsage.reachedAt})`,
        warningGivenAt: sql`coalesce(${quotaUsage.warningGivenAt}, excluded.warning_given_at)`,
      },
    });
}

/** The counted limits of every service that shares `role`, whose warning is one (TRV-05). */
export function limitsOfRole(role: ServiceRole): readonly CountedLimit[] {
  return servicesOf(role).flatMap((service) => SERVICES[service].limits);
}

/**
 * Makes the calls of the services of `service`'s role wait for each other's check and
 * record until `tx` ends, since they share the counts, the warning and the incident
 * (TRV-04, TRV-05).
 */
export async function lockService(tx: Transaction, service: QuotaService): Promise<void> {
  const key = `quotas.${SERVICES[service].role}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

/**
 * A call's estimate counted on one row of a limit until the call's own use replaces it,
 * stored as the `quota_holds` row `id` (TRV-04).
 */
export type Hold = Readonly<{ id: number; key: LimitKey; start: EpochMs; amount: number }>;

/**
 * Counts the `estimate` of a call checked at `at` on the current rows of `states`, in
 * the caller's transaction `tx`, so that a call checked while this one runs sees it,
 * each hold stored with its instant (TRV-04).
 */
export async function hold(
  tx: Transaction,
  states: readonly LimitState[],
  call: Readonly<{ estimate: Readonly<Partial<Record<Measure, number>>>; at: EpochMs }>,
): Promise<readonly Hold[]> {
  const holds: Hold[] = [];
  for (const state of states) {
    const amount = call.estimate[state.limit.measure] ?? 0;
    if (amount <= 0) {
      continue;
    }
    await writeRow(tx, state, { at: call.at, used: amount });
    const key = state.limit.key;
    const start = rowStart(state, call.at);
    const stored = await tx
      .insert(quotaHolds)
      .values({ limitKey: key, periodStartAt: new Date(start), amount, heldAt: new Date(call.at) })
      .returning({ id: quotaHolds.id });
    holds.push(...stored.map(({ id }) => ({ id, key, start, amount })));
  }
  return holds;
}

/** Takes `amount` back off the row of `key` that starts at `start`, if the purge left it. */
async function subtract(
  tx: Transaction,
  taken: Readonly<{ key: string; start: EpochMs; amount: number }>,
): Promise<void> {
  const row = and(
    eq(quotaUsage.limitKey, taken.key),
    eq(quotaUsage.periodStartAt, new Date(taken.start)),
  );
  await tx
    .update(quotaUsage)
    .set({ used: sql`${quotaUsage.used} - ${taken.amount}` })
    .where(row);
}

/**
 * Takes the estimates of `holds` back off their rows, in the caller's transaction `tx`:
 * each once, a hold that the sweep or another release already took being left alone
 * (TRV-04).
 */
export async function release(tx: Transaction, holds: readonly Hold[]): Promise<void> {
  for (const held of holds) {
    const deleted = await tx
      .delete(quotaHolds)
      .where(eq(quotaHolds.id, held.id))
      .returning({ id: quotaHolds.id });
    if (deleted.length > 0) {
      await subtract(tx, held);
    }
  }
}

/**
 * Releases, in the caller's transaction `tx`, the holds on the limits of `service`'s
 * role older than `HOLD_STALE_AFTER_MS` at `at`: holds that a function stopped at its
 * time limit, or a release that failed, left behind (TRV-04, CL-TRV-07).
 */
export async function sweepHolds(
  tx: Transaction,
  service: QuotaService,
  at: EpochMs,
): Promise<void> {
  const keys = limitsOfRole(SERVICES[service].role).map((limit) => limit.key);
  const staleBefore = new Date(at - HOLD_STALE_AFTER_MS);
  const staleHolds = and(inArray(quotaHolds.limitKey, keys), lt(quotaHolds.heldAt, staleBefore));
  const stale = await tx.delete(quotaHolds).where(staleHolds).returning();
  for (const row of stale) {
    await subtract(tx, {
      key: row.limitKey,
      start: toEpochMs(row.periodStartAt.getTime()),
      amount: row.amount,
    });
  }
}

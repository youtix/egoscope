// What the fetch queue does with each answer of the stats source (module map §2.4, games;
// CL-STA-15): it classifies the answer, reschedules the unit as a due instant (never a wait
// inside a function), and opens or closes the source's incidents. Internal to `games`,
// used by fetch-queue.ts, which passes the unit it leased and calls `settleUnit` for every
// answer but a normal one, and `recordRecovery` in the unit's transaction for a normal one.
//
// The state of the source lives in the units of the queue: a unit waiting after an outage has
// `wait_reason = 'outage'`, counts its failed attempts and records in `failing_since` when the
// first of them failed; a unit whose file answered with a changed format records when in
// `schema_changed_at`, which an outage or a quota wait keeps, until the file reads again.
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';

import { fetchQueueItems } from '@/lib/db';
import { close, open } from '@/lib/incidents';
import { getParams } from '@/lib/params';
import { nextAvailableAt } from '@/lib/quotas';
import {
  gameDay,
  gameDayStart,
  localOccurrenceInstant,
  now,
  toEpochMs,
  toIsoDate,
} from '@/lib/time';

import type { FetchQueueItemRow, NewFetchQueueItemRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { ParamReader } from '@/lib/params';
import type { Deferred } from '@/lib/quotas';
import type { Result } from '@/lib/result';
import type { StatsSourceError, StatsSourceOutcome } from '@/lib/stats-source';
import type { EpochMs, IsoDate } from '@/lib/time';

const MS_PER_HOUR = 3_600_000;
// A probe 36 hours after a game day's start, which lands in the next day whatever the clock
// change (a day lasts 23 to 25 hours), to name that next day.
const NEXT_DAY_PROBE_HOURS = 36;
const YEAR_LENGTH = 4;
// The schedule of a season is due after 25 October of its first year, a week after the
// source's producer restarts (statistics service sheet; CL-STA-30).
const SCHEDULE_DUE_AFTER = '10-26';

/** The cause of the incident that STA-37 opens: the source has not answered for the delay. */
const NOT_ANSWERING = { kind: 'stats_source_unavailable', cause: 'not_answering' } as const;
const FORMAT_CHANGED = { kind: 'stats_source_schema_changed' } as const;

/** The part of a queue unit that its answer's handling reads. */
export type Unit = Pick<FetchQueueItemRow, 'id' | 'attempts' | 'waitReason' | 'failingSince'>;

/**
 * What an answer of the source is (CL-STA-15): `normal` for anything but the others, a
 * missing resource and players that no file lists included; an `outage`; a `quota` answer
 * or deferral, with the reset when it gives one; a `schema_changed` file; a file
 * `not_published`; or `interrupted`, when the call's own signal stopped it and the source
 * said nothing.
 */
export type AnswerClass =
  | Readonly<{ kind: 'normal' }>
  | Readonly<{ kind: 'outage' }>
  | Readonly<{ kind: 'quota'; resumeAt: EpochMs | null }>
  | Readonly<{ kind: 'schema_changed' }>
  | Readonly<{ kind: 'not_published' }>
  | Readonly<{ kind: 'interrupted' }>;

/** The answers that `settleUnit` handles: every one but a normal answer. */
type Setback = Exclude<AnswerClass, Readonly<{ kind: 'normal' }>>;

/** The class of a failure of the source's port (CL-STA-15). */
function answerOfFailure(error: StatsSourceError): AnswerClass {
  if (error.kind === 'unavailable' || error.kind === 'unauthorized') {
    return { kind: 'outage' };
  }
  if (error.kind === 'rate_limited') {
    return { kind: 'quota', resumeAt: null };
  }
  if (error.kind === 'schema_changed' || error.kind === 'not_published') {
    return { kind: error.kind };
  }
  return { kind: error.kind === 'aborted' ? 'interrupted' : 'normal' };
}

/**
 * Classifies what a guarded call gave back (CL-STA-15): a network error, a timeout (a call
 * that outlasts its deadline answers so), a server error, an unreadable file, and
 * credentials the source refuses are outages; a call deferred by the quota guard or refused
 * for quota is a quota answer; the rest is data.
 */
export function classifyAnswer(
  reading: Result<StatsSourceOutcome<unknown>, Deferred>,
): AnswerClass {
  if (!reading.ok) {
    return { kind: 'quota', resumeAt: reading.error.availableAt };
  }
  const outcome = reading.value;
  return outcome.ok ? { kind: 'normal' } : answerOfFailure(outcome.error);
}

/** The retry delays and the delay of the incident, in milliseconds (STA-36, STA-37). */
export type RetryTiming = Readonly<{
  firstDelayMs: number;
  intervalMs: number;
  incidentAfterMs: number;
}>;

const toMs = (hours: number): number => Math.round(hours * MS_PER_HOUR);

/** The delays in force, from the parameters `games.retryFirstDelayHours`, `games.retryIntervalHours` and `games.incidentAfterHours` (STA-36, STA-37). */
export function retryTiming(values: ParamReader): RetryTiming {
  return {
    firstDelayMs: toMs(values.get('games.retryFirstDelayHours')),
    intervalMs: toMs(values.get('games.retryIntervalHours')),
    incidentAfterMs: toMs(values.get('games.incidentAfterHours')),
  };
}

/**
 * The instant of the next attempt after the `failures`-th consecutive failure, which
 * happened at `at`: the first delay after the first one, the interval after each later one
 * (STA-36).
 */
export function retryAt(failures: number, at: EpochMs, timing: RetryTiming): EpochMs {
  return toEpochMs(at + (failures <= 1 ? timing.firstDelayMs : timing.intervalMs));
}

/** A resource whose absence from the source can mean a changed format: a file of a season. */
type FileResource = 'season_games' | 'season_box_scores' | 'season_players' | 'player_records';

/**
 * What tells a file that the source does not publish from a changed format (CL-STA-15,
 * CL-STA-30): its season and the season of today's date, whether the source ever published
 * it (its stats_source_versions row), the US date of the season's first game when the
 * schedule is stored, and the time of day and zone at which the daily update's cut-off falls.
 */
export type FileFacts = Readonly<{
  resource: FileResource;
  season: string;
  currentSeason: string;
  wasPublished: boolean;
  firstGameDay: IsoDate | null;
  cutoff: string;
  timeZone: string;
}>;

/**
 * The instant from which the absence of `file` is a fault, or null while no date is known
 * (CL-STA-30): after 25 October of the season's first year for the schedule and the teams;
 * for a file that holds rows only once games are played, the daily update's cut-off that
 * follows the season's first game day.
 */
function dueAt(file: FileFacts): EpochMs | null {
  if (file.resource === 'season_games') {
    return gameDayStart(toIsoDate(`${file.season.slice(0, YEAR_LENGTH)}-${SCHEDULE_DUE_AFTER}`));
  }
  if (file.firstGameDay === null) {
    return null;
  }
  const updateDay = gameDay(
    toEpochMs(gameDayStart(file.firstGameDay) + NEXT_DAY_PROBE_HOURS * MS_PER_HOUR),
  );
  return localOccurrenceInstant(updateDay, file.cutoff, file.timeZone);
}

/**
 * Says whether a file the source does not publish is a fault at `at` (CL-STA-15, CL-STA-30):
 * only a file of the current season, once the source has published it or its due date has
 * passed. Before, the file of the coming season is the normal off-season state, and a file of
 * another season is data.
 */
export function isMissingFileAFault(file: FileFacts, at: EpochMs): boolean {
  if (file.season !== file.currentSeason) {
    return false;
  }
  const due = dueAt(file);
  return file.wasPublished || (due !== null && at >= due);
}

/** What `settleUnit` did with the unit: it waits for `nextAttemptAt`, or it is done and deleted. */
export type Settled =
  Readonly<{ kind: 'waiting'; nextAttemptAt: EpochMs }> | Readonly<{ kind: 'done' }>;

/** What a wait changes in the unit: its next attempt, and the state it waits in. */
type Wait = Readonly<
  Partial<
    Pick<NewFetchQueueItemRow, 'attempts' | 'waitReason' | 'failingSince' | 'schemaChangedAt'>
  > & {
    nextAttemptAt: EpochMs;
  }
>;

/** Puts the unit back to wait, its lease released. */
async function wait(tx: Transaction, unit: Unit, until: Wait): Promise<Settled> {
  const { nextAttemptAt, ...state } = until;
  await tx
    .update(fetchQueueItems)
    .set({ ...state, nextAttemptAt: new Date(nextAttemptAt), leaseExpiresAt: null })
    .where(eq(fetchQueueItems.id, unit.id));
  return { kind: 'waiting', nextAttemptAt };
}

/** The failures in a row of `unit` once one more of kind `reason` happened. */
const failuresAfter = (unit: Unit, reason: Unit['waitReason']): number =>
  unit.waitReason === reason ? unit.attempts + 1 : 1;

/**
 * Opens the incident of STA-37 when a unit has waited after outages in a row for its delay,
 * since the earliest first failure among them.
 */
async function openIfFailingLongEnough(
  tx: Transaction,
  at: EpochMs,
  timing: RetryTiming,
): Promise<void> {
  const startedBefore = new Date(at - timing.incidentAfterMs);
  const [earliest] = await tx
    .select({ since: fetchQueueItems.failingSince })
    .from(fetchQueueItems)
    .where(
      and(
        eq(fetchQueueItems.waitReason, 'outage'),
        lte(fetchQueueItems.failingSince, startedBefore),
      ),
    )
    .orderBy(asc(fetchQueueItems.failingSince))
    .limit(1);
  if (earliest?.since) {
    await open(tx, { ...NOT_ANSWERING, since: toEpochMs(earliest.since.getTime()) });
  }
}

/**
 * An outage: the next attempt is due after the delay of the schedule, the start of the
 * outages in a row is kept or, after another answer, set now, and the incident opens after
 * its delay (STA-36, STA-37).
 */
async function settleOutage(db: Database, unit: Unit, timing: RetryTiming): Promise<Settled> {
  const at = now();
  const attempts = failuresAfter(unit, 'outage');
  return db.transaction(async (tx) => {
    const settled = await wait(tx, unit, {
      attempts,
      waitReason: 'outage',
      failingSince: attempts > 1 ? unit.failingSince : new Date(at),
      nextAttemptAt: retryAt(attempts, at, timing),
    });
    await openIfFailingLongEnough(tx, at, timing);
    return settled;
  });
}

/**
 * Records that the source answered (CL-STA-15): it is no longer failing, so "Stats source
 * unavailable" closes by itself and the units that waited after an outage are due at once
 * (STA-36, STA-37).
 */
async function recordAnswer(tx: Transaction): Promise<void> {
  await close(tx, NOT_ANSWERING);
  await tx
    .update(fetchQueueItems)
    .set({ attempts: 0, waitReason: null, failingSince: null, nextAttemptAt: new Date(now()) })
    .where(eq(fetchQueueItems.waitReason, 'outage'));
}

/**
 * A changed or missing file, which is an answer of the source: nothing of it is ingested, the
 * unit records the change, the incident opens, and the file is read again at the retry
 * interval (CL-STA-15).
 */
async function settleChangedFormat(
  db: Database,
  unit: Unit,
  timing: RetryTiming,
): Promise<Settled> {
  const at = now();
  return db.transaction(async (tx) => {
    const settled = await wait(tx, unit, {
      attempts: failuresAfter(unit, null),
      waitReason: null,
      failingSince: null,
      schemaChangedAt: new Date(at),
      nextAttemptAt: toEpochMs(at + timing.intervalMs),
    });
    await recordAnswer(tx);
    await open(tx, FORMAT_CHANGED);
    return settled;
  });
}

/**
 * A quota answer: the unit waits for the reset that the answer gave, or else for the next
 * period of the quota the owner entered, as the quota guard computes it, which has opened
 * "quota reached" itself (STA-39, TRV-06); with no reset to come the unit waits the retry
 * interval, so that a refusal that no limit explains never makes it due at once.
 */
async function settleQuota(
  db: Database,
  unit: Unit,
  waiting: Readonly<{ resumeAt: EpochMs | null; intervalMs: number }>,
): Promise<Settled> {
  const resume = waiting.resumeAt ?? (await nextAvailableAt(db, 'statsSource'));
  const at = now();
  const nextAttemptAt =
    resume !== null && resume > at ? resume : toEpochMs(at + waiting.intervalMs);
  return db.transaction(async (tx) =>
    wait(tx, unit, {
      attempts: unit.attempts,
      waitReason: 'quota',
      failingSince: null,
      nextAttemptAt,
    }),
  );
}

/**
 * Records that the source answered normally to `unit`, in the transaction that ingests its
 * answer (CL-STA-15): the source is no longer failing, so "Stats source unavailable" closes
 * by itself, and the units that waited after an outage are due at once (STA-36, STA-37); the
 * unit's file reads again, so "Stats source format changed" closes once no unit's file still
 * has a changed format.
 */
export async function recordRecovery(tx: Transaction, unit: Unit): Promise<void> {
  await recordAnswer(tx);
  await tx
    .update(fetchQueueItems)
    .set({ schemaChangedAt: null })
    .where(eq(fetchQueueItems.id, unit.id));
  const [stillChanged] = await tx
    .select({ id: fetchQueueItems.id })
    .from(fetchQueueItems)
    .where(isNotNull(fetchQueueItems.schemaChangedAt))
    .limit(1);
  if (stillChanged === undefined) {
    await close(tx, FORMAT_CHANGED);
  }
}

/** A unit with nothing to ingest, which the source answered: recovery recorded, the unit deleted. */
async function finish(db: Database, unit: Unit): Promise<Settled> {
  await db.transaction(async (tx) => {
    await recordRecovery(tx, unit);
    await tx.delete(fetchQueueItems).where(eq(fetchQueueItems.id, unit.id));
  });
  return { kind: 'done' };
}

/** A call stopped by its own signal: the unit is due as it was, its lease released. */
async function release(db: Database, unit: Unit): Promise<Settled> {
  return db.transaction(async (tx) => wait(tx, unit, { nextAttemptAt: now() }));
}

/** An answer that is not a normal one, with the unit that got it and what tells a missing file from an unpublished one. */
export type Answered = Readonly<{ unit: Unit; answer: Setback; file: FileFacts }>;

/**
 * Settles the unit that got an answer that is not a normal one (CL-STA-15): an outage
 * reschedules it after 1 hour, then every 4 hours, and opens "Stats source unavailable"
 * after 12 hours of continuous failure (STA-36, STA-37); a quota answer makes it wait for
 * the reset (STA-39, TRV-06); a changed format, or a file missing when it should be there,
 * opens "Stats source format changed" and ingests nothing; a file not yet published between
 * seasons is the normal off-season state, so the unit is done; an interrupted call leaves
 * the unit due as it was. Rescheduling is a due instant, never a wait, and the caller
 * records it in the wake plan.
 */
export async function settleUnit(db: Database, { unit, answer, file }: Answered): Promise<Settled> {
  const timing = retryTiming(await getParams(db));
  if (answer.kind === 'outage') {
    return settleOutage(db, unit, timing);
  }
  if (answer.kind === 'quota') {
    return settleQuota(db, unit, { resumeAt: answer.resumeAt, intervalMs: timing.intervalMs });
  }
  if (answer.kind === 'interrupted') {
    return release(db, unit);
  }
  const isFault = answer.kind === 'schema_changed' || isMissingFileAFault(file, now());
  return isFault ? settleChangedFormat(db, unit, timing) : finish(db, unit);
}

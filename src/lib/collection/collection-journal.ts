import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';

import {
  collectionGaps,
  collectionSourceReads,
  incidents,
  pressSourceIncidents,
  pressSources,
  taskRuns,
} from '@/lib/db';
import { valueAt } from '@/lib/params';
import { toEpochMs } from '@/lib/time';

import type { CollectionGapRow, CollectionSourceReadRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { AnyColumn, SQL } from 'drizzle-orm';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

type TaskRunRow = typeof taskRuns.$inferSelect;
type IncidentRow = typeof incidents.$inferSelect;

const DAY_MS = 86_400_000;
// A collection run is a task run of this task (collection.md section 1.7).
const COLLECTION_TASK = 'news-collection';
// The incidents of a run: those of these kinds it opened or closed (collection.md section 4).
const COLLECTION_INCIDENT_KINDS = [
  'press_source_down',
  'press_source_silent',
  'feed_too_short',
  'collection_impossible',
] as const;

/** The instant of a `timestamptz` read back, in epoch milliseconds. */
const instant = (date: Date): EpochMs => toEpochMs(date.getTime());
const instantOrNull = (date: Date | null): EpochMs | null => (date === null ? null : instant(date));

/** Where a run came from: the schedule, a run after a missed one included, or the owner (CL-COL-07). */
export type CollectionRunOrigin = TaskRunRow['trigger'];

/** The counters of a source read, or their totals over a run (COL-48). */
export type CollectionCounters = Readonly<{
  itemsRead: number;
  newArticles: number;
  duplicates: number;
  tooOld: number;
  incomplete: number;
  unsupportedLanguage: number;
  dateAnomalies: number;
}>;

/** The result of a source read: a success, or a failure with its reason (COL-41, COL-48). */
export type SourceReadResult =
  | Readonly<{ outcome: 'success' }>
  | Readonly<{
      outcome: 'failure';
      failureReason: NonNullable<CollectionSourceReadRow['failureReason']>;
    }>;

/** The read of one source in a run, the source's part of the journal entry (COL-48). */
export type SourceRead = SourceReadResult &
  Readonly<{
    pressSourceId: number;
    outletName: string;
    readAt: EpochMs;
    readAttempts: number;
    counters: CollectionCounters;
    /** On the first run after a reactivation: the deactivation and reactivation instants (CL-COL-04). */
    uncollectedPeriod: Readonly<{ startAt: EpochMs; endAt: EpochMs }> | null;
    /** The new address that a permanent redirection announced (CL-COL-19). */
    permanentRedirectUrl: string | null;
    /** On a read that ends a down or silent state: when the interruption began (COL-43). */
    interruptionStartedAt: EpochMs | null;
  }>;

/** A source read whose admitted age catch-up lengthened, and that age (COL-45, CL-COL-07). */
export type CatchUpRead = Readonly<{
  pressSourceId: number;
  outletName: string;
  admittedAgeMs: number;
}>;

/** A collection incident that a run opened, closed, or both (COL-48). */
export type RunIncident = Readonly<{
  incidentId: number;
  kind: IncidentRow['kind'];
  pressSourceId: number | null;
  openedAt: EpochMs;
  closedAt: EpochMs | null;
  openedDuringRun: boolean;
  closedDuringRun: boolean;
}>;

/** A collection run as its journal entry shows it (COL-48, CL-COL-07, collection.md section 1.7). */
export type CollectionRun = Readonly<{
  taskRunId: number;
  origin: CollectionRunOrigin;
  withCatchUp: boolean;
  catchUp: readonly CatchUpRead[];
  startedAt: EpochMs;
  finishedAt: EpochMs | null;
  result: TaskRunRow['result'];
  reads: readonly SourceRead[];
  totals: CollectionCounters;
  gaps: readonly CollectionGapRow[];
  incidents: readonly RunIncident[];
}>;

/** The runs that `runs` lists: those that read the source, those started in [from, to). */
export type RunFilter = Readonly<{ pressSourceId?: number; from?: EpochMs; to?: EpochMs }>;

/** A started task run, the only kind that the journal shows. */
type StartedRun = TaskRunRow & Readonly<{ startedAt: Date }>;

/** A read row with the name of its source. */
type NamedRead = Readonly<{ row: CollectionSourceReadRow; outletName: string }>;

const isStarted = (row: TaskRunRow): row is StartedRun => row.startedAt !== null;

const STARTED_COLLECTION_RUN = and(
  eq(taskRuns.taskKey, COLLECTION_TASK),
  isNotNull(taskRuns.startedAt),
);

/** The counters of `reads`, one by one or summed. */
const countersOf = (reads: readonly CollectionCounters[]): CollectionCounters => ({
  itemsRead: reads.reduce((sum, read) => sum + read.itemsRead, 0),
  newArticles: reads.reduce((sum, read) => sum + read.newArticles, 0),
  duplicates: reads.reduce((sum, read) => sum + read.duplicates, 0),
  tooOld: reads.reduce((sum, read) => sum + read.tooOld, 0),
  incomplete: reads.reduce((sum, read) => sum + read.incomplete, 0),
  unsupportedLanguage: reads.reduce((sum, read) => sum + read.unsupportedLanguage, 0),
  dateAnomalies: reads.reduce((sum, read) => sum + read.dateAnomalies, 0),
});

/** The journal's view of a read row of the source `outletName`. */
function sourceReadOf({ row, outletName }: NamedRead): SourceRead {
  const result: SourceReadResult =
    row.failureReason === null
      ? { outcome: 'success' }
      : { outcome: 'failure', failureReason: row.failureReason };
  const { uncollectedPeriodStartAt: startAt, uncollectedPeriodEndAt: endAt } = row;
  return {
    ...result,
    pressSourceId: row.pressSourceId,
    outletName,
    readAt: instant(row.readAt),
    readAttempts: row.readAttempts,
    counters: countersOf([row]),
    uncollectedPeriod:
      startAt === null || endAt === null
        ? null
        : { startAt: instant(startAt), endAt: instant(endAt) },
    permanentRedirectUrl: row.permanentRedirectUrl,
    interruptionStartedAt: instantOrNull(row.interruptionStartedAt),
  };
}

/** The reads of the runs `ids`, by run, each list in the order of the reads. */
async function readsOf(
  db: Reader,
  ids: readonly number[],
): Promise<ReadonlyMap<number, readonly NamedRead[]>> {
  const rows = await db
    .select({ row: collectionSourceReads, outletName: pressSources.outletName })
    .from(collectionSourceReads)
    .innerJoin(pressSources, eq(pressSources.id, collectionSourceReads.pressSourceId))
    .where(inArray(collectionSourceReads.taskRunId, [...ids]))
    .orderBy(asc(collectionSourceReads.id));
  return Map.groupBy(rows, ({ row }) => row.taskRunId);
}

/** The gaps that the runs `ids` found, by run, in the order they were found (COL-46). */
async function gapsOf(
  db: Reader,
  ids: readonly number[],
): Promise<ReadonlyMap<number | null, readonly CollectionGapRow[]>> {
  const rows = await db
    .select()
    .from(collectionGaps)
    .where(inArray(collectionGaps.taskRunId, [...ids]))
    .orderBy(asc(collectionGaps.id));
  return Map.groupBy(rows, (gap) => gap.taskRunId);
}

/** Whether the instant of `column` falls between the start and the end of the joined run. */
const duringRun = (column: AnyColumn): SQL<boolean> =>
  sql<boolean>`coalesce(${and(
    gte(column, taskRuns.startedAt),
    or(isNull(taskRuns.finishedAt), lte(column, taskRuns.finishedAt)),
  )}, false)`;

/**
 * The collection incidents that the runs `ids` opened or closed, by run, oldest first;
 * runs never overlap, so each change belongs to one run (TRV-28).
 */
async function incidentsOf(
  db: Reader,
  ids: readonly number[],
): Promise<ReadonlyMap<number, readonly RunIncident[]>> {
  const openedDuringRun = duringRun(incidents.openedAt);
  const closedDuringRun = duringRun(incidents.closedAt);
  const rows = await db
    .select({
      taskRunId: taskRuns.id,
      incidentId: incidents.id,
      kind: incidents.kind,
      pressSourceId: pressSourceIncidents.pressSourceId,
      openedAt: incidents.openedAt,
      closedAt: incidents.closedAt,
      openedDuringRun,
      closedDuringRun,
    })
    .from(taskRuns)
    .innerJoin(incidents, or(openedDuringRun, closedDuringRun))
    .leftJoin(pressSourceIncidents, eq(pressSourceIncidents.incidentId, incidents.id))
    .where(and(inArray(taskRuns.id, [...ids]), inArray(incidents.kind, COLLECTION_INCIDENT_KINDS)))
    .orderBy(asc(incidents.openedAt), asc(incidents.id));
  const byRun = Map.groupBy(rows, (row) => row.taskRunId);
  return new Map(
    [...byRun].map(([taskRunId, runRows]) => [
      taskRunId,
      runRows.map((row) => ({
        incidentId: row.incidentId,
        kind: row.kind,
        pressSourceId: row.pressSourceId,
        openedAt: instant(row.openedAt),
        closedAt: instantOrNull(row.closedAt),
        openedDuringRun: row.openedDuringRun,
        closedDuringRun: row.closedDuringRun,
      })),
    ]),
  );
}

/**
 * The reads of `taskRun` whose admitted age catch-up lengthened: the maximum age in force at
 * the run's start plus the time from the source's reference instant to that start
 * (COL-45, CL-COL-04).
 */
async function catchUpOf(
  db: Reader,
  taskRun: StartedRun,
  reads: readonly NamedRead[],
): Promise<readonly CatchUpRead[]> {
  // A read of a catch-up, with the reference instant it caught up from.
  type CaughtUp = Omit<CatchUpRead, 'admittedAgeMs'> & Readonly<{ referenceAt: Date }>;
  const caughtUp = reads
    .map(({ row, outletName }) => ({
      pressSourceId: row.pressSourceId,
      outletName,
      referenceAt: row.catchUpReferenceAt,
    }))
    .filter((read): read is CaughtUp => read.referenceAt !== null);
  if (caughtUp.length === 0) {
    return [];
  }
  const startedAt = instant(taskRun.startedAt);
  const maxAgeMs = (await valueAt(db, 'collection.maxArticleAgeDays', startedAt)) * DAY_MS;
  return caughtUp.map(({ referenceAt, ...source }) => ({
    ...source,
    admittedAgeMs: maxAgeMs + startedAt - instant(referenceAt),
  }));
}

/**
 * The journal entries of the started collection runs among `rows`, in their order: three
 * queries, and one or two more per run with catch-up.
 */
async function entriesOf(db: Reader, rows: readonly TaskRunRow[]): Promise<CollectionRun[]> {
  const started = rows.filter(isStarted);
  const ids = started.map((taskRun) => taskRun.id);
  const reads = await readsOf(db, ids);
  const gaps = await gapsOf(db, ids);
  const runIncidents = await incidentsOf(db, ids);
  return Promise.all(
    started.map(async (taskRun): Promise<CollectionRun> => {
      const runReads = reads.get(taskRun.id) ?? [];
      const sourceReads = runReads.map((read) => sourceReadOf(read));
      const catchUp = await catchUpOf(db, taskRun, runReads);
      return {
        taskRunId: taskRun.id,
        origin: taskRun.trigger,
        withCatchUp: catchUp.length > 0,
        catchUp,
        startedAt: instant(taskRun.startedAt),
        finishedAt: instantOrNull(taskRun.finishedAt),
        result: taskRun.result,
        reads: sourceReads,
        totals: countersOf(sourceReads.map((read) => read.counters)),
        gaps: gaps.get(taskRun.id) ?? [],
        incidents: runIncidents.get(taskRun.id) ?? [],
      };
    }),
  );
}

/**
 * The collection journal: the started collection runs, newest first, those that read
 * `pressSourceId` when given, those started at or after `from` and before `to` when given;
 * each with its origin, its catch-up mark and the sources it names with their admitted
 * age, its reads with their results and counters, its totals, the gaps it found and the
 * collection incidents it opened or closed (COL-48, COL-49, CL-COL-07).
 */
export async function runs(db: Reader, filter: RunFilter = {}): Promise<readonly CollectionRun[]> {
  const { pressSourceId, from, to } = filter;
  const readTheSource =
    pressSourceId === undefined
      ? undefined
      : inArray(
          taskRuns.id,
          db
            .select({ id: collectionSourceReads.taskRunId })
            .from(collectionSourceReads)
            .where(eq(collectionSourceReads.pressSourceId, pressSourceId)),
        );
  const startedFrom = from === undefined ? undefined : gte(taskRuns.startedAt, new Date(from));
  const startedBefore = to === undefined ? undefined : lt(taskRuns.startedAt, new Date(to));
  const rows = await db
    .select()
    .from(taskRuns)
    .where(and(STARTED_COLLECTION_RUN, startedFrom, startedBefore, readTheSource))
    .orderBy(desc(taskRuns.startedAt));
  return entriesOf(db, rows);
}

/**
 * The journal entry of the collection run `taskRunId`, as `runs` gives it; null when no
 * started collection run has that identifier (COL-48).
 */
export async function run(db: Reader, taskRunId: number): Promise<CollectionRun | null> {
  const rows = await db
    .select()
    .from(taskRuns)
    .where(and(STARTED_COLLECTION_RUN, eq(taskRuns.id, taskRunId)));
  const [entry] = await entriesOf(db, rows);
  return entry ?? null;
}

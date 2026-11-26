// A player's backtest coverage (backtest-and-import.md section 1.4): what each saved
// import adds to it and to its request's status, what a merge or a split of types
// carries over, and the reads that say what it holds per research type and whether the
// player is profiled. The rules on counting periods and first uncovered days are the
// engine's (CL-BKT-05); dates are calendar dates written YYYY-MM-DD, compared as written
// (CL-IMP-09).
import 'server-only';

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';

import { backtestCoveragePeriods, backtestRequests, backtestRequestTypes, imports } from '@/lib/db';
import { firstNbaGame } from '@/lib/games';
import { firstUncoveredOn, isTypeCovered, isTypeSupplementNeeded } from '@/lib/stats-engine';
import { handledByCalendarList, validatedSheets, versionCounters } from '@/lib/taxonomy';
import { now, toEpochMs } from '@/lib/time';

import type { BacktestCoveragePeriodRow, NewBacktestCoveragePeriodRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { IsoDate, RetainedPeriod, TypeCoverage } from '@/lib/stats-engine';
import type { TypeRef } from '@/lib/taxonomy';
import type { EpochMs } from '@/lib/time';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

/** Where a covered period comes from: an import, or the merge or split of its type (CL-BKT-06). */
export type CoverageOrigin = BacktestCoveragePeriodRow['origin'];

/** What the save of an import hands over, inside its transaction (IMP-10, IMP-30). */
export type SavedImport = Readonly<{
  /** The import row that the save has just written. */
  importId: number;
  /** The coverage the import retained, each type's period as the engine computed it (IMP-10). */
  retainedPeriods: readonly RetainedPeriod[];
  /** Whether the owner confirmed importing a result for a canceled request (IMP-08). */
  isCanceledRequestConfirmed: boolean;
}>;

/**
 * Why an import's coverage is not recorded: a retained period of a calendar-derived type,
 * which no coverage holds (CL-BKT-03), or a canceled request whose import the owner has
 * not confirmed (BKT-13, IMP-08).
 */
export type ImportRecordRefusal = 'calendar_derived_type' | 'canceled_request_not_confirmed';

/** A period of a player's coverage of one type, both days included (BKT-10, CL-BKT-06). */
export type CoveragePeriod = Readonly<{
  startOn: IsoDate;
  endOn: IsoDate;
  sheetVersionNumber: number;
  origin: CoverageOrigin;
  /** The import that brought it; null for a period that a merge or a split carried over. */
  importId: number | null;
  /** The import's instant, or the merge's or split's. */
  recordedAt: EpochMs;
}>;

/** A player's coverage of one research type and what it derives (BKT-10, CL-BKT-05). */
export type TypeCoverageEntry = Readonly<{
  eventTypeId: string;
  name: string;
  /** Its covered periods, by start day, then in the order they were recorded. */
  coveredPeriods: readonly CoveragePeriod[];
  /** Whether the coverage includes the type: one period at least, whatever its version. */
  isIncluded: boolean;
  /** Included, but only under versions older than its latest broadening version. */
  isCoveredUnderEarlierVersion: boolean;
  /** The first day of his career that no counting period holds; null while unknown. */
  firstUncoveredOn: IsoDate | null;
}>;

/**
 * What a merge or a split of types hands over to the coverage (TAX-27, TAX-29,
 * CL-BKT-06): the surviving type, the types it absorbed and its version in force before
 * the merge; or the split type and the types born of it.
 */
export type CoverageInheritance =
  | Readonly<{
      kind: 'merge';
      survivorTypeId: string;
      absorbedTypeIds: readonly string[];
      survivorVersionBeforeMerge: number;
    }>
  | Readonly<{ kind: 'split'; originalTypeId: string; resultingTypeIds: readonly string[] }>;

/** Days of a type, both included. */
type Span = Readonly<{ startOn: IsoDate; endOn: IsoDate }>;

// The version that a period a split type's children inherit is recorded under (CL-BKT-06).
const SPLIT_INHERITED_VERSION = 0;

/**
 * The import with its player, its instant and its request's status, or a bug. The
 * request's row stays locked until the transaction ends, so that a cancellation cannot
 * slip in between this read and the move to imported.
 */
async function importOf(tx: Transaction, importId: number) {
  const [row] = await tx
    .select({
      playerId: imports.playerId,
      requestId: imports.backtestRequestId,
      importedAt: imports.importedAt,
      status: backtestRequests.status,
    })
    .from(imports)
    .innerJoin(backtestRequests, eq(backtestRequests.id, imports.backtestRequestId))
    .where(eq(imports.id, importId))
    .for('update', { of: backtestRequests });
  if (row === undefined) {
    throw new Error(`recordImport: no import ${String(importId)}`);
  }
  return row;
}

async function hasCalendarType(
  tx: Transaction,
  periods: readonly RetainedPeriod[],
): Promise<boolean> {
  const calendarTypes = await handledByCalendarList(tx);
  const calendarIds = new Set(calendarTypes.map((type) => type.id));
  return periods.some((period) => calendarIds.has(period.eventTypeId));
}

/** The sheet version of each type of the request, that of its prompt (BKT-10, IMP-30). */
async function requestVersions(
  tx: Transaction,
  requestId: number,
): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({
      eventTypeId: backtestRequestTypes.eventTypeId,
      version: backtestRequestTypes.sheetVersionNumber,
    })
    .from(backtestRequestTypes)
    .where(eq(backtestRequestTypes.backtestRequestId, requestId));
  return new Map(rows.map((row) => [row.eventTypeId, row.version]));
}

/** Writes `rows`, when there are any, since an insert needs one at least. */
async function insertPeriods(
  tx: Transaction,
  rows: readonly NewBacktestCoveragePeriodRow[],
): Promise<void> {
  if (rows.length > 0) {
    await tx.insert(backtestCoveragePeriods).values([...rows]);
  }
}

/**
 * Records, inside the save's transaction, what a saved import adds (BKT-10, BKT-13,
 * IMP-30, CL-BKT-20): each retained period, under the sheet version that the request's
 * prompt gave its type, with the import and its instant, added to the player's coverage
 * whatever the request, since coverage is a union per player and type; and the request
 * imported at the import's instant, from to do, or from canceled once the owner
 * confirmed it (IMP-08), its cancellation kept, while an imported request stays as it
 * is, `imported` being final. Refuses a calendar-derived type, which no coverage holds
 * (CL-BKT-03), and writes nothing then. Throws for an unknown import or a type its
 * request does not plan, which the import never retains.
 */
export async function recordImport(
  tx: Transaction,
  saved: SavedImport,
): Promise<{ ok: true } | { ok: false; error: ImportRecordRefusal }> {
  const imported = await importOf(tx, saved.importId);
  if (imported.status === 'canceled' && !saved.isCanceledRequestConfirmed) {
    return { ok: false, error: 'canceled_request_not_confirmed' };
  }
  if (await hasCalendarType(tx, saved.retainedPeriods)) {
    return { ok: false, error: 'calendar_derived_type' };
  }
  const versions = await requestVersions(tx, imported.requestId);
  const rows = saved.retainedPeriods.map((period) => {
    const sheetVersionNumber = versions.get(period.eventTypeId);
    if (sheetVersionNumber === undefined) {
      throw new Error(`recordImport: the request does not plan ${period.eventTypeId}`);
    }
    return {
      playerId: imported.playerId,
      eventTypeId: period.eventTypeId,
      startOn: period.startOn,
      endOn: period.endOn,
      sheetVersionNumber,
      origin: 'import',
      importId: saved.importId,
      recordedAt: imported.importedAt,
    } as const;
  });
  await insertPeriods(tx, rows);
  await tx
    .update(backtestRequests)
    .set({
      status: 'imported',
      importedAt: imported.importedAt,
      rowVersion: sql`${backtestRequests.rowVersion} + 1`,
    })
    .where(
      and(eq(backtestRequests.id, imported.requestId), ne(backtestRequests.status, 'imported')),
    );
  return { ok: true };
}

/**
 * Whether the player is profiled, "already processed": one saved import at least, even
 * of an empty result; with none he has no backtest yet (BKT-10, H-VUE-02).
 */
export async function isProfiled(db: Reader, playerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(eq(imports.playerId, playerId))
    .limit(1);
  return row !== undefined;
}

/** The type's latest broadening version, a merge's or a split's included (CL-BKT-05 rule 1). */
async function latestBroadeningVersion(db: Reader, typeId: string): Promise<number | undefined> {
  const versions = await versionCounters(db, typeId);
  return versions.findLast((version) => version.isBroadening)?.versionNumber;
}

/** A covered period as the reads give it. */
function coveragePeriod(row: BacktestCoveragePeriodRow): CoveragePeriod {
  return {
    startOn: row.startOn,
    endOn: row.endOn,
    sheetVersionNumber: row.sheetVersionNumber,
    origin: row.origin,
    importId: row.importId,
    recordedAt: toEpochMs(row.recordedAt.getTime()),
  };
}

/** What every entry of a player's coverage is derived from. */
type PlayerRows = Readonly<{
  rows: readonly BacktestCoveragePeriodRow[];
  careerStart: IsoDate | undefined;
}>;

async function typeEntry(
  db: Reader,
  type: TypeRef,
  { rows, careerStart }: PlayerRows,
): Promise<TypeCoverageEntry> {
  const coveredPeriods = rows
    .filter((row) => row.eventTypeId === type.id)
    .map((row) => coveragePeriod(row));
  // A type without periods is uncovered from his career start, whatever its versions.
  const typeCoverage: TypeCoverage = {
    coveredPeriods,
    latestBroadeningVersion:
      coveredPeriods.length === 0 ? undefined : await latestBroadeningVersion(db, type.id),
  };
  const isIncluded = isTypeCovered(typeCoverage);
  return {
    eventTypeId: type.id,
    name: type.name,
    coveredPeriods,
    isIncluded,
    isCoveredUnderEarlierVersion: isIncluded && isTypeSupplementNeeded(typeCoverage),
    firstUncoveredOn: firstUncoveredOn(typeCoverage, careerStart) ?? null,
  };
}

/**
 * A player's coverage, one entry per validated research type in the order of the
 * taxonomy, a calendar-derived type never listed (BKT-10, CL-BKT-03, CL-BKT-05,
 * CL-BKT-06): each covered period with its import, date and sheet version; whether the
 * coverage includes the type, as soon as one period exists whatever its version, the
 * read of the routing (BKT-30), the profiles (SEN-46) and the alert sheet; whether it is
 * covered only under versions older than the type's latest broadening version; and the
 * first day of his career, from his first NBA game, that no counting period holds. The
 * types that a merge absorbed or a split replaced are withdrawn, so their periods stay
 * as history, never consulted.
 */
export async function coverage(
  db: Reader,
  playerId: string,
): Promise<readonly TypeCoverageEntry[]> {
  const types = await validatedSheets(db, 'import');
  const rows = await db
    .select()
    .from(backtestCoveragePeriods)
    .where(eq(backtestCoveragePeriods.playerId, playerId))
    .orderBy(asc(backtestCoveragePeriods.startOn), asc(backtestCoveragePeriods.id));
  const firstGame = await firstNbaGame(db, playerId);
  const playerRows = { rows, careerStart: firstGame?.firstNbaGameOn };
  return Promise.all(types.map(async (type) => typeEntry(db, type, playerRows)));
}

const later = (left: IsoDate, right: IsoDate): IsoDate => (left > right ? left : right);
const earlier = (left: IsoDate, right: IsoDate): IsoDate => (left < right ? left : right);

/** The days of `spans`, sorted by start, as disjoint spans: overlapping ones joined. */
function union(spans: readonly Span[]): readonly Span[] {
  const joined: Span[] = [];
  for (const span of spans) {
    const last = joined.at(-1);
    if (last === undefined || span.startOn > last.endOn) {
      joined.push(span);
    } else {
      joined[joined.length - 1] = { startOn: last.startOn, endOn: later(last.endOn, span.endOn) };
    }
  }
  return joined;
}

/** The days that both lists of disjoint sorted spans hold, as disjoint sorted spans. */
function intersection(left: readonly Span[], right: readonly Span[]): readonly Span[] {
  const common: Span[] = [];
  for (const one of left) {
    for (const other of right) {
      const startOn = later(one.startOn, other.startOn);
      const endOn = earlier(one.endOn, other.endOn);
      if (startOn <= endOn) {
        common.push({ startOn, endOn });
      }
    }
  }
  return common;
}

async function inheritMerge(
  tx: Transaction,
  merge: Extract<CoverageInheritance, { kind: 'merge' }>,
): Promise<void> {
  const mergedTypeIds = [merge.survivorTypeId, ...merge.absorbedTypeIds];
  const rows = await tx
    .select({
      playerId: backtestCoveragePeriods.playerId,
      eventTypeId: backtestCoveragePeriods.eventTypeId,
      startOn: backtestCoveragePeriods.startOn,
      endOn: backtestCoveragePeriods.endOn,
    })
    .from(backtestCoveragePeriods)
    .where(inArray(backtestCoveragePeriods.eventTypeId, mergedTypeIds))
    .orderBy(asc(backtestCoveragePeriods.startOn));
  const recorded = {
    eventTypeId: merge.survivorTypeId,
    sheetVersionNumber: merge.survivorVersionBeforeMerge,
    origin: 'merge',
    importId: null,
    recordedAt: new Date(now()),
  } as const;
  const players = [...new Set(rows.map((row) => row.playerId))];
  const inherited = players.flatMap((playerId) => {
    const spansOf = (typeId: string) =>
      union(rows.filter((row) => row.playerId === playerId && row.eventTypeId === typeId));
    let common = spansOf(merge.survivorTypeId);
    for (const typeId of merge.absorbedTypeIds) {
      common = intersection(common, spansOf(typeId));
    }
    return common.map((span) => ({ ...span, ...recorded, playerId }));
  });
  await tx
    .delete(backtestCoveragePeriods)
    .where(eq(backtestCoveragePeriods.eventTypeId, merge.survivorTypeId));
  await insertPeriods(tx, inherited);
}

async function inheritSplit(
  tx: Transaction,
  split: Extract<CoverageInheritance, { kind: 'split' }>,
): Promise<void> {
  const rows = await tx
    .select({
      playerId: backtestCoveragePeriods.playerId,
      startOn: backtestCoveragePeriods.startOn,
      endOn: backtestCoveragePeriods.endOn,
    })
    .from(backtestCoveragePeriods)
    .where(eq(backtestCoveragePeriods.eventTypeId, split.originalTypeId));
  const recorded = {
    sheetVersionNumber: SPLIT_INHERITED_VERSION,
    origin: 'split',
    importId: null,
    recordedAt: new Date(now()),
  } as const;
  const inherited = split.resultingTypeIds.flatMap((eventTypeId) =>
    rows.map((row) => ({ ...row, ...recorded, eventTypeId })),
  );
  await insertPeriods(tx, inherited);
}

/**
 * Carries a player's coverage over a merge or a split of types, inside the caller's
 * transaction, after `taxonomy.merge` or `taxonomy.split` (TAX-27, TAX-29, CL-BKT-06).
 * Merge: for each player, the surviving type's coverage becomes the days covered for
 * every merged type, surviving and absorbed alike, recorded under the survivor's
 * version before the merge, so that a merge that broadened the type stops them
 * counting (CL-BKT-05 rule 1); the absorbed types' own periods stay as history. Split:
 * each resulting type inherits every period of the split type, under version 0, before
 * its version 1. The periods carried over are dated now and count for "coverage
 * includes the type" like any other.
 */
export async function inheritCoverage(
  tx: Transaction,
  inheritance: CoverageInheritance,
): Promise<void> {
  await (inheritance.kind === 'merge'
    ? inheritMerge(tx, inheritance)
    : inheritSplit(tx, inheritance));
}

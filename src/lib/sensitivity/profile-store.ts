// The writer of profiles and general trends (sensitivity-and-profiles.md sections 1.1 to
// 1.5): each written whole in its three views, one transaction per profile or trend, with
// the verdict history of its default view and the value versions of its historical-only
// view; and the existence rule that erases what the evaluation no longer gives (CL-SEN-16,
// CL-SEN-18, CL-SEN-19, CL-SEN-26). Internal to the module: the recalculation jobs call it,
// and profile-rows.ts builds and compares the rows.
import 'server-only';

import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';

import {
  generalTrends,
  profileValueVersions,
  sensitivityProfiles,
  verdictHistoryEntries,
} from '@/lib/db';
import { verdictChanges } from '@/lib/stats-engine';

import {
  calculationValues,
  hasSameValues,
  profileReasons,
  verdictOf,
  versionInstant,
  viewOf,
  VIEWS,
} from './profile-rows';

import type { CalculationRow, CaseScope, JobWrite, StoredRow } from './profile-rows';
import type { Database, Transaction } from '@/lib/db';
import type {
  EvaluatedTrend,
  EventTypeId,
  PlayerId,
  PlayerProfile,
  ProfileView,
} from '@/lib/stats-engine';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

/** A connection, or the caller's transaction, which each write joins. */
type Executor = Database | Transaction;

/** A player's profiles of the types a job covers, as the engine evaluated them (SEN-19). */
export type PlayerProfilesWrite = JobWrite &
  Readonly<{
    playerId: PlayerId;
    eventTypeIds: readonly EventTypeId[];
    profiles: readonly PlayerProfile[];
  }>;

/** The general trends of the types a job covers, null for a type that has none (SEN-28). */
export type TrendsWrite = JobWrite &
  Readonly<{
    trends: readonly Readonly<{ eventTypeId: EventTypeId; trend: EvaluatedTrend | null }>[];
  }>;

/** A player–type pair. */
export type ProfilePair = Readonly<{ playerId: PlayerId; eventTypeId: EventTypeId }>;

const DEFAULT_VIEW = 'all_cases';
const HISTORICAL_VIEW = 'historical_only';

/** The row a history entry or a value version belongs to, and the versions' column that names it. */
type Owner = Readonly<{
  key: (id: number) => Readonly<{ sensitivityProfileId: number } | { generalTrendId: number }>;
  versionColumn: AnyPgColumn;
}>;
const PROFILE_OWNER: Owner = {
  key: (id) => ({ sensitivityProfileId: id }),
  versionColumn: profileValueVersions.sensitivityProfileId,
};
const TREND_OWNER: Owner = {
  key: (id) => ({ generalTrendId: id }),
  versionColumn: profileValueVersions.generalTrendId,
};

/**
 * How one profile or trend is read and written whole, its three views in one statement:
 * its pair or type, its owner, the rows it writes, and the reading of its stored rows and
 * the upsert of its rows, which gives the identifier of each view.
 */
type Whole = Readonly<{
  scope: CaseScope;
  owner: Owner;
  rows: readonly CalculationRow[];
  read: (tx: Transaction) => Promise<readonly StoredRow[]>;
  upsert: (tx: Transaction) => Promise<readonly Readonly<{ id: number; view: ProfileView }>[]>;
}>;

/** A write of a profile or trend: its rows as they were stored, and the identifiers its upsert gave. */
type Written = Whole &
  Readonly<{
    stored: readonly StoredRow[];
    ids: readonly Readonly<{ id: number; view: ProfileView }>[];
  }>;

/** The stored row of `view`, none before a first calculation. */
const storedView = (written: Written, view: ProfileView): StoredRow | undefined =>
  written.stored.find((row) => row.view === view);

/**
 * Records the value version of the historical-only view (SUI-08, CL-SEN-18, CL-SEN-19). A job
 * appends one at its instant when one of the five values differs from the stored row, which
 * its latest version holds, since the daily purge keeps the version in force. The full job
 * after a withdrawal, a player-data deletion or a restore's re-application replaces every
 * version by one when it changes any value of the row, a tally count alone included, so
 * that no count or mean gap from before the withdrawal stays beside the new one.
 */
async function recordVersion(tx: Transaction, written: Written, write: JobWrite): Promise<void> {
  const row = viewOf(written.rows, HISTORICAL_VIEW);
  const { validCount, meanGap, verdictLevel, verdictDirection, profileConfidence } = row;
  const values = { validCount, meanGap, verdictLevel, verdictDirection, profileConfidence };
  const isReplace = write.versions.kind === 'replace';
  const before = storedView(written, HISTORICAL_VIEW);
  if (before !== undefined && hasSameValues(before, isReplace ? row : values)) {
    return;
  }
  const { id } = viewOf(written.ids, HISTORICAL_VIEW);
  if (isReplace) {
    await tx.delete(profileValueVersions).where(eq(written.owner.versionColumn, id));
  }
  const effectiveAt = new Date(versionInstant(written.scope, write));
  await tx
    .insert(profileValueVersions)
    .values({ ...written.owner.key(id), ...values, effectiveAt });
}

/**
 * Records the verdict-history entry of the default view when its verdict level, direction
 * or profile confidence changed, with the job's cause (SEN-37, CL-SEN-17, CL-SEN-19); none
 * for a first calculation.
 */
async function recordHistory(tx: Transaction, written: Written, write: JobWrite): Promise<void> {
  const before = storedView(written, DEFAULT_VIEW);
  const after = verdictOf(viewOf(written.rows, DEFAULT_VIEW));
  const change = verdictChanges(before === undefined ? null : verdictOf(before), after);
  if (change === null) {
    return;
  }
  await tx.insert(verdictHistoryEntries).values({
    ...written.owner.key(viewOf(written.ids, DEFAULT_VIEW).id),
    changedAt: new Date(write.computedAt),
    oldVerdictLevel: change.oldVerdict.level,
    oldVerdictDirection: change.oldVerdict.direction,
    oldProfileConfidence: change.oldProfileConfidence,
    newVerdictLevel: change.newVerdict.level,
    newVerdictDirection: change.newVerdict.direction,
    newProfileConfidence: change.newProfileConfidence,
    cause: write.causeOf(written.scope.eventTypeId),
  });
}

/**
 * Writes one profile or trend whole in one transaction, which joins the caller's, with its
 * history entry and its value version (CL-SEN-16, SEN-37, CL-SEN-18). Gives its type,
 * alone, when its default view's values changed, a first calculation included.
 */
async function writeWhole(db: Executor, whole: Whole, write: JobWrite): Promise<EventTypeId[]> {
  return db.transaction(async (tx) => {
    const stored = await whole.read(tx);
    const written = { ...whole, stored, ids: await whole.upsert(tx) };
    await recordHistory(tx, written, write);
    await recordVersion(tx, written, write);
    const before = storedView(written, DEFAULT_VIEW);
    const isSame = before !== undefined && hasSameValues(before, viewOf(whole.rows, DEFAULT_VIEW));
    return isSame ? [] : [whole.scope.eventTypeId];
  });
}

/** The upsert's assignments: every column of `table` but `keys` takes the value proposed for insertion. */
function proposedValues(table: PgTable, keys: readonly string[]): Record<string, SQL> {
  const columns = Object.entries(getTableColumns(table)).filter(([key]) => !keys.includes(key));
  return Object.fromEntries(
    columns.map(([key, column]) => [key, sql`excluded.${sql.identifier(column.name)}`]),
  );
}

const PROFILE_UPDATE = proposedValues(sensitivityProfiles, [
  'id',
  'playerId',
  'eventTypeId',
  'view',
]);
const TREND_UPDATE = proposedValues(generalTrends, ['id', 'eventTypeId', 'view']);

/** One profile of the player, read and written whole (SEN-19, CL-SEN-19). */
function profileWhole(playerId: PlayerId, profile: PlayerProfile, write: JobWrite): Whole {
  const { eventTypeId } = profile;
  const rows = VIEWS.map((view) => {
    const values = viewOf(profile.views, view);
    const confidenceStepDownReasons = profileReasons(values.confidenceStepDownReasons);
    return {
      playerId,
      eventTypeId,
      ...calculationValues(values, write),
      confidenceStepDownReasons,
    };
  });
  const table = sensitivityProfiles;
  const pair = and(eq(table.playerId, playerId), eq(table.eventTypeId, eventTypeId));
  return {
    scope: { playerId, eventTypeId },
    owner: PROFILE_OWNER,
    rows,
    read: async (tx) => tx.select().from(table).where(pair),
    upsert: async (tx) =>
      tx
        .insert(table)
        .values(rows)
        .onConflictDoUpdate({
          target: [table.playerId, table.eventTypeId, table.view],
          set: PROFILE_UPDATE,
        })
        .returning({ id: table.id, view: table.view }),
  };
}

/** One general trend, read and written whole (SEN-28, CL-SEN-19). */
function trendWhole(eventTypeId: EventTypeId, trend: EvaluatedTrend, write: JobWrite): Whole {
  const rows = VIEWS.map((view) => {
    const values = viewOf(trend.views, view);
    const { confidenceStepDownReasons, distinctPlayerCount, topContributorValidCount } = values;
    const counts = { distinctPlayerCount, topContributorValidCount };
    const reasons = { confidenceStepDownReasons: [...confidenceStepDownReasons] };
    return { eventTypeId, ...calculationValues(values, write), ...reasons, ...counts };
  });
  const table = generalTrends;
  return {
    scope: { playerId: null, eventTypeId },
    owner: TREND_OWNER,
    rows,
    read: async (tx) => tx.select().from(table).where(eq(table.eventTypeId, eventTypeId)),
    upsert: async (tx) =>
      tx
        .insert(table)
        .values(rows)
        .onConflictDoUpdate({ target: [table.eventTypeId, table.view], set: TREND_UPDATE })
        .returning({ id: table.id, view: table.view }),
  };
}

/** Each identifier of `ids` once, in their order. */
const distinct = (ids: readonly EventTypeId[]): EventTypeId[] => [...new Set(ids)];

/**
 * Writes a player's profiles of the types a job covers (SEN-19 to SEN-27, SEN-36, SEN-37,
 * CL-SEN-16 to CL-SEN-19, CL-SEN-26), inside the caller's transaction where there is one:
 * each profile whole, in its three views, one transaction per profile, with the job's
 * instant and parameter snapshot; in the same transaction, a verdict-history entry with
 * the cause the job gives its type when the default view's verdict level, direction or
 * profile confidence changed, and the value version of its historical-only view
 * (`VersionWrite`). A covered type that the evaluation gives no profile, its tally left
 * with no event, has its profile erased, with its history and versions. Gives the pairs
 * whose default-view values changed: written for the first time, changed or erased.
 */
export async function writePlayerProfiles(
  db: Executor,
  write: PlayerProfilesWrite,
): Promise<readonly ProfilePair[]> {
  const changed: EventTypeId[] = [];
  for (const profile of write.profiles) {
    changed.push(...(await writeWhole(db, profileWhole(write.playerId, profile, write), write)));
  }
  const kept = new Set(write.profiles.map(({ eventTypeId }) => eventTypeId));
  const left = write.eventTypeIds.filter((eventTypeId) => !kept.has(eventTypeId));
  const { playerId, eventTypeId } = sensitivityProfiles;
  const erased =
    left.length === 0
      ? []
      : await db
          .delete(sensitivityProfiles)
          .where(and(eq(playerId, write.playerId), inArray(eventTypeId, left)))
          .returning({ eventTypeId });
  return distinct([...changed, ...erased.map((row) => row.eventTypeId)]).map((typeId) => ({
    playerId: write.playerId,
    eventTypeId: typeId,
  }));
}

/**
 * Writes the general trends of the types a job covers (SEN-28 to SEN-30, SEN-36, SEN-37,
 * CL-SEN-16 to CL-SEN-19), inside the caller's transaction where there is one: each trend
 * whole, in its three views, one transaction per trend, with its verdict-history entry and
 * its value version as a profile has them; a type without a trend, left with no event, has
 * its trend erased with its history and versions. Gives the types whose default-view
 * values changed: written for the first time, changed or erased.
 */
export async function writeTrends(
  db: Executor,
  write: TrendsWrite,
): Promise<readonly EventTypeId[]> {
  const changed: EventTypeId[] = [];
  const left: EventTypeId[] = [];
  for (const { eventTypeId, trend } of write.trends) {
    if (trend === null) {
      left.push(eventTypeId);
    } else {
      changed.push(...(await writeWhole(db, trendWhole(eventTypeId, trend, write), write)));
    }
  }
  const { eventTypeId } = generalTrends;
  const erased =
    left.length === 0
      ? []
      : await db.delete(generalTrends).where(inArray(eventTypeId, left)).returning({ eventTypeId });
  return distinct([...changed, ...erased.map((row) => row.eventTypeId)]);
}

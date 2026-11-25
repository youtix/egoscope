import 'server-only';

import { asc, eq, max, sql } from 'drizzle-orm';

import {
  backtestRequests,
  boxScores,
  cases,
  events,
  exportDownloads,
  followedPlayers,
  games,
  getDb,
  installation,
  sensitivityProfiles,
  teams,
} from '@/lib/db';
import { close, open } from '@/lib/incidents';
import { getParam } from '@/lib/params';
import { ok } from '@/lib/result';
import { now, toEpochMs } from '@/lib/time';

import type { Database, DatabaseError, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';
import type { AnyColumn, SQL } from 'drizzle-orm';

/** `ExportKind`: the full export and the spreadsheet exports (TRV-52). */
export type ExportKind = typeof exportDownloads.$inferSelect.kind;

/** The spreadsheet exports, one CSV file each (TRV-52). */
export type PartialExportKind = Exclude<ExportKind, 'full'>;

/** The columns of a CSV file in order, each a header and the column or expression it reads. */
export type CsvColumns = readonly (readonly [header: string, value: AnyColumn | SQL])[];

type Reader = Database | Transaction;

const PAGE_SIZE = 1000;
const MS_PER_DAY = 86_400_000;
const REMINDER = { kind: 'export_reminder' } as const;
// The view whose valid cases the player list totals (JOU-28).
const DEFAULT_VIEW = 'all_cases';
const TWO_DIGITS = 2;

/**
 * The values of `values` in the rows of its table whose `link[0]` is the row's `link[1]`,
 * space-separated in the order of `order`, as the spreadsheet exports list them (TRV-52).
 */
export function spaceSeparated(
  values: AnyColumn,
  link: readonly [inner: AnyColumn, outer: AnyColumn],
  order: AnyColumn,
): SQL<string | null> {
  return sql<string | null>`(select string_agg(${values}::text, ' ' order by ${order})
    from ${values.table} where ${link[0]} = ${link[1]})`;
}

/** A player's day and month of birth, `MM-DD`, empty when none (TRV-52, JOU-01). */
export const birthday = sql<
  string | null
>`lpad(${followedPlayers.birthdayMonth}::text, ${TWO_DIGITS}, '0')
  || '-' || lpad(${followedPlayers.birthdayDay}::text, ${TWO_DIGITS}, '0')`;

/**
 * `PlayerBacktestStatus`, by its code (JOU-25, CL-JOU-14): the kind of the player's
 * request to do, else `imported` once a request was imported, else `never_requested`.
 */
export const playerBacktestStatus = sql<string>`coalesce(
  (select case ${backtestRequests.kind} when 'initial' then 'request_to_do'
      when 'supplement' then 'supplementary_request_to_do' else 'full_redo_to_do' end
    from ${backtestRequests} where ${backtestRequests.playerId} = ${followedPlayers.id}
      and ${backtestRequests.status} = 'to_do' limit 1),
  (select 'imported' from ${backtestRequests} where ${backtestRequests.playerId} = ${followedPlayers.id}
    and ${backtestRequests.status} = 'imported' limit 1),
  'never_requested')`;

/** The total of a player's valid cases, from his profiles of the default view (JOU-28). */
export const validCaseCount =
  sql<number>`(select coalesce(sum(${sensitivityProfiles.validCount}), 0)
  from ${sensitivityProfiles} where ${sensitivityProfiles.playerId} = ${followedPlayers.id}
    and ${sensitivityProfiles.view} = ${DEFAULT_VIEW})`.mapWith(Number);

/** The team that the player of a case faced in its measured game, by its abbreviation (TRV-52). */
export const caseOpponent = sql<string | null>`(select ${teams.abbreviation} from ${boxScores}
  join ${teams} on ${teams.id} = case when ${games.homeTeamId} = ${boxScores.teamId}
    then ${games.awayTeamId} else ${games.homeTeamId} end
  where ${boxScores.playerId} = ${cases.playerId} and ${boxScores.gameId} = ${cases.measuredGameId}
  limit 1)`;

/** The page at `offset` of the rows of the CSV file of `kind`, joined to what its columns read. */
async function pageOf(
  tx: Transaction,
  file: Readonly<{ kind: PartialExportKind; columns: CsvColumns }>,
  offset: number,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const columns = Object.fromEntries(file.columns);
  switch (file.kind) {
    case 'players': {
      return tx
        .select(columns)
        .from(followedPlayers)
        .leftJoin(teams, eq(teams.id, followedPlayers.currentTeamId))
        .orderBy(asc(followedPlayers.id))
        .limit(PAGE_SIZE)
        .offset(offset);
    }
    case 'events': {
      return tx
        .select(columns)
        .from(events)
        .innerJoin(followedPlayers, eq(followedPlayers.id, events.playerId))
        .orderBy(asc(events.id))
        .limit(PAGE_SIZE)
        .offset(offset);
    }
    case 'cases': {
      return tx
        .select(columns)
        .from(cases)
        .innerJoin(followedPlayers, eq(followedPlayers.id, cases.playerId))
        .leftJoin(games, eq(games.id, cases.measuredGameId))
        .orderBy(asc(cases.id))
        .limit(PAGE_SIZE)
        .offset(offset);
    }
    case 'profiles': {
      return tx
        .select(columns)
        .from(sensitivityProfiles)
        .innerJoin(followedPlayers, eq(followedPlayers.id, sensitivityProfiles.playerId))
        .orderBy(asc(sensitivityProfiles.id))
        .limit(PAGE_SIZE)
        .offset(offset);
    }
  }
}

/**
 * The rows of the spreadsheet export `kind`, read in `tx` a page at a time, so that a
 * long file streams without being held whole (TRV-52, CA-TRV-17).
 * @yields {readonly Record<string, unknown>[]} Each page of rows, keyed by header.
 */
export async function* partialPages(
  tx: Transaction,
  kind: PartialExportKind,
  columns: CsvColumns,
): AsyncGenerator<readonly Readonly<Record<string, unknown>>[], void, undefined> {
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await pageOf(tx, { kind, columns }, offset);
    if (page.length > 0) {
      yield page;
    }
    if (page.length < PAGE_SIZE) {
      return;
    }
  }
}

/**
 * Records that the export `kind` was downloaded; a full one closes the export reminder,
 * which a partial one leaves open (TRV-52, TRV-54, CL-TRV-22). One transaction of the
 * pooled connection; "not configured" when no database is.
 */
export async function recordDownload(kind: ExportKind): Promise<Result<void, DatabaseError>> {
  const pooled = await getDb();
  if (!pooled.ok) {
    return pooled;
  }
  await pooled.db.transaction(async (tx) => {
    await tx.insert(exportDownloads).values({ kind, downloadedAt: new Date(now()) });
    if (kind === 'full') {
      await close(tx, REMINDER);
    }
  });
  return ok(undefined);
}

/**
 * The instant of the last full export downloaded, which the status screen shows and from
 * which the export reminder counts; null when none was (TRV-54, CL-TRV-22).
 */
export async function lastExport(db: Reader): Promise<EpochMs | null> {
  const [last] = await db
    .select({ at: max(exportDownloads.downloadedAt) })
    .from(exportDownloads)
    .where(eq(exportDownloads.kind, 'full'));
  const at = last?.at ?? null;
  return at === null ? null : toEpochMs(at.getTime());
}

/** The instant of the first start, from which the reminder counts when no full export was made. */
async function firstStart(tx: Transaction): Promise<EpochMs | null> {
  const [row] = await tx.select({ at: installation.firstStartedAt }).from(installation);
  return row === undefined ? null : toEpochMs(row.at.getTime());
}

/**
 * The purge's daily step of the export reminder, in its transaction `tx`: once
 * `backups.exportReminderDays` have passed by `at.now` since the last full export
 * downloaded or, when none was, since the first start, it opens the incident
 * `export_reminder`, open since that delay ended, with an `incident_opened` fact of the
 * pass `at.passId` (TRV-54, CL-TRV-22, TEL-15). Returns the new incident's id, or null
 * when the reminder is not due or already open.
 */
export async function exportReminderDue(
  tx: Transaction,
  at: Readonly<{ now: EpochMs; passId?: string }>,
): Promise<number | null> {
  const since = (await lastExport(tx)) ?? (await firstStart(tx));
  if (since === null) {
    return null;
  }
  const days = await getParam(tx, 'backups.exportReminderDays');
  const dueAt = since + days * MS_PER_DAY;
  return at.now < dueAt ? null : open(tx, { ...REMINDER, since: toEpochMs(dueAt) }, at.passId);
}

import 'server-only';

import { eq } from 'drizzle-orm';

import { backtestRequests, backtestRequestTypes, followedPlayers } from '@/lib/db';

import {
  deadlineReader,
  instant,
  optionalInstant,
  REQUEST_COLUMNS,
  summaryOf,
  todoRanks,
} from './request-reads';
import { typeNames, validatedVersions } from './sheet-versions';

import type { Reader, RequestSummary } from './request-reads';
import type { BacktestRequestRow } from './types';
import type { EpochMs } from '@/lib/time';

/** The cancellation of a request: when, and why (BKT-14). */
export type RequestCancellation = Readonly<{
  at: EpochMs;
  reasonCode: BacktestRequestRow['cancellationReasonCode'];
  reasonText: string | null;
}>;

/** A type of a request: its planned period and the sheet version its prompt used (BKT-08, BKT-15, TAX-23). */
export type RequestType = Readonly<{
  eventTypeId: string;
  name: string;
  /** False once a reduction took the type out of the prompt, the row staying planned (CL-BKT-07). */
  isRequested: boolean;
  /** The version of the type's sheet that the prompt was produced under. */
  sheetVersionNumber: number;
  /** The version in force now, null while the type is not a validated research type. */
  currentVersionNumber: number | null;
  /** Whether the sheet of a requested type of a request to do changed since its prompt (TAX-23, BKT-15). */
  isSheetOutdated: boolean;
  /** An ISO date; null means from the player's first NBA game, whose date is unknown (CL-BKT-05). */
  periodStartOn: string | null;
  periodEndOn: string;
}>;

/** The period that the requested types of a request span together (05 « Période globale »). */
export type OverallPeriod = Readonly<{ startOn: string | null; endOn: string }>;

/** A request with all that its screen shows (BKT-15, BKT-16, BKT-20, TAX-23, IHM-27). */
export type RequestDetail = RequestSummary &
  Readonly<{
    triggerEventTypeId: string | null;
    triggerImportId: number | null;
    /** The owner's calendar date at creation, an ISO date. */
    createdOn: string;
    importedAt: EpochMs | null;
    cancellation: RequestCancellation | null;
    types: readonly RequestType[];
    /** Null when no type is requested. */
    period: OverallPeriod | null;
    prompt: Readonly<{ text: string; producedAt: EpochMs }>;
    /** The version a save sends back (CL-IHM-18). */
    rowVersion: number;
  }>;

/** The earlier of two ISO dates, which compare as written (CL-IMP-09). */
const earlier = (one: string, other: string): string => (other < one ? other : one);

/** The later of two ISO dates. */
const later = (one: string, other: string): string => (other > one ? other : one);

/** The overall period of the requested types: the earliest start, an unknown one first, to the latest end. */
function overallPeriod(types: readonly RequestType[]): OverallPeriod | null {
  const [first, ...others] = types.filter((type) => type.isRequested);
  if (first === undefined) {
    return null;
  }
  let { periodStartOn: startOn, periodEndOn: endOn } = first;
  for (const type of others) {
    startOn =
      startOn === null || type.periodStartOn === null ? null : earlier(startOn, type.periodStartOn);
    endOn = later(endOn, type.periodEndOn);
  }
  return { startOn, endOn };
}

/**
 * The types of a request with their periods and versions, flagged when their sheet is
 * newer than the one the prompt used: only a requested type of a request to do can be
 * (TAX-23, BKT-15).
 */
async function typesOf(
  db: Reader,
  requestId: number,
  isToDo: boolean,
): Promise<readonly RequestType[]> {
  const rows = await db
    .select()
    .from(backtestRequestTypes)
    .where(eq(backtestRequestTypes.backtestRequestId, requestId))
    .orderBy(backtestRequestTypes.eventTypeId);
  const names = await typeNames(db);
  const validated = await validatedVersions(db);
  return rows.map((row) => {
    const currentVersionNumber = validated.get(row.eventTypeId)?.versionNumber ?? null;
    return {
      eventTypeId: row.eventTypeId,
      name: names.get(row.eventTypeId) ?? row.eventTypeId,
      isRequested: row.isRequested,
      sheetVersionNumber: row.sheetVersionNumber,
      currentVersionNumber,
      isSheetOutdated:
        isToDo && row.isRequested && (currentVersionNumber ?? 0) > row.sheetVersionNumber,
      periodStartOn: row.periodStartOn,
      periodEndOn: row.periodEndOn,
    };
  });
}

/**
 * The request `requestId` with what its screen shows, or null when none has that identifier
 * (BKT-15, BKT-16, BKT-20, TAX-23, CA-BKT-17): its player, trigger, kind and derived origin;
 * its status with its dates and reason; its planned types, the requested ones with their
 * period, the overall period, and each requested type of a request to do whose current
 * sheet version is newer than the one its prompt used; its prompt with its last copy and
 * whether the copied text is out of date; its rank while it is to do; and its deadline, the
 * next game of its player at `at`: its start and its opponent, "time TBD" with the whole days
 * left when its time is to be determined (CL-BKT-24), or "no game scheduled" with its reason,
 * such as "team eliminated".
 */
export async function get(
  db: Reader,
  requestId: number,
  at: EpochMs,
): Promise<RequestDetail | null> {
  const [row] = await db
    .select({
      ...REQUEST_COLUMNS,
      triggerEventTypeId: backtestRequests.triggerEventTypeId,
      triggerImportId: backtestRequests.triggerImportId,
      createdOn: backtestRequests.createdOn,
      importedAt: backtestRequests.importedAt,
      canceledAt: backtestRequests.canceledAt,
      cancellationReasonCode: backtestRequests.cancellationReasonCode,
      cancellationReasonText: backtestRequests.cancellationReasonText,
      promptText: backtestRequests.promptText,
      rowVersion: backtestRequests.rowVersion,
    })
    .from(backtestRequests)
    .innerJoin(followedPlayers, eq(followedPlayers.id, backtestRequests.playerId))
    .where(eq(backtestRequests.id, requestId));
  if (row === undefined) {
    return null;
  }
  const isToDo = row.status === 'to_do';
  const ranks = isToDo ? await todoRanks(db) : new Map<number, number>();
  const deadlineOfPlayer = await deadlineReader(db, at);
  const types = await typesOf(db, requestId, isToDo);
  return {
    ...summaryOf(row, ranks.get(row.id), await deadlineOfPlayer(row.playerId)),
    triggerEventTypeId: row.triggerEventTypeId,
    triggerImportId: row.triggerImportId,
    createdOn: row.createdOn,
    importedAt: optionalInstant(row.importedAt),
    cancellation:
      row.canceledAt === null
        ? null
        : {
            at: instant(row.canceledAt),
            reasonCode: row.cancellationReasonCode,
            reasonText: row.cancellationReasonText,
          },
    types,
    period: overallPeriod(types),
    prompt: { text: row.promptText, producedAt: instant(row.promptProducedAt) },
    rowVersion: row.rowVersion,
  };
}

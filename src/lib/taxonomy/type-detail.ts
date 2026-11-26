// What the page of one type and the to-do list read about it: the type with its links and
// dated transitions, its versions with their counts, its history, and the events still
// to review. Apart from queries.ts only to keep each file within the size limits.
import 'server-only';

import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  events,
  eventTypes,
  eventTypeStatusChanges,
  followedPlayers,
  typeSheetChanges,
  typeSheetVersions,
} from '@/lib/db';
import { toIsoDate } from '@/lib/time';

import { allTypes, instant, SHEET_CONTENT, sheetContent, typeRef } from './queries';

import type { EventTypeStatus, Reader, SheetContent, TypeRef } from './queries';
import type { EventTypeRow, TypeSheetChangeRow, TypeSheetVersionRow } from './types';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A dated transition of a type: `{ at, from, to }`, `from` null for a split-born type (TAX-10). */
export type StatusTransition = Readonly<{
  at: EpochMs;
  from: EventTypeStatus | null;
  to: EventTypeStatus;
}>;

/**
 * Everything the page of a type shows of it: `id`, `status`, `origin`, `createdAt`,
 * `sheet` (its current `SheetContent`), `currentVersionNumber`, `calendarDerivation`,
 * `switchedOffCriterion`, the reasons (`rejectionReason`, `rejectionComment`,
 * `withdrawalReasonKind`, `withdrawalReason`), the links (`mergedInto`, the types it
 * absorbed in `mergedFrom`, `splitFrom`, `splitInto`), `noFitReason`, its dated
 * `transitions` in order and its `rowVersion`, which a save compares (CL-IHM-18).
 */
export type TypeDetail = Readonly<
  Pick<
    EventTypeRow,
    | 'id'
    | 'status'
    | 'origin'
    | 'currentVersionNumber'
    | 'calendarDerivation'
    | 'switchedOffCriterion'
    | 'rejectionReason'
    | 'rejectionComment'
    | 'withdrawalReasonKind'
    | 'withdrawalReason'
    | 'noFitReason'
    | 'rowVersion'
  > & {
    createdAt: EpochMs;
    sheet: SheetContent;
    mergedInto: TypeRef | null;
    mergedFrom: readonly TypeRef[];
    splitFrom: TypeRef | null;
    splitInto: readonly TypeRef[];
    transitions: readonly StatusTransition[];
  }
>;

async function transitionsOf(db: Reader, typeId: string): Promise<readonly StatusTransition[]> {
  const rows = await db
    .select({
      at: eventTypeStatusChanges.changedAt,
      from: eventTypeStatusChanges.fromStatus,
      to: eventTypeStatusChanges.toStatus,
    })
    .from(eventTypeStatusChanges)
    .where(eq(eventTypeStatusChanges.eventTypeId, typeId))
    .orderBy(asc(eventTypeStatusChanges.changedAt), asc(eventTypeStatusChanges.id));
  return rows.map((row) => ({ ...row, at: instant(row.at) }));
}

/** The links of `type` to the other types, by reference (TAX-27, TAX-29). */
function linksOf(type: EventTypeRow, types: readonly EventTypeRow[]) {
  const refs = (isLinked: (candidate: EventTypeRow) => boolean) =>
    types.filter((candidate) => isLinked(candidate)).map((candidate) => typeRef(candidate));
  return {
    mergedInto: refs((candidate) => candidate.id === type.mergedIntoTypeId)[0] ?? null,
    mergedFrom: refs((candidate) => candidate.mergedIntoTypeId === type.id),
    splitFrom: refs((candidate) => candidate.id === type.splitFromTypeId)[0] ?? null,
    splitInto: refs((candidate) => candidate.splitFromTypeId === type.id),
  };
}

/**
 * The type of `typeId` as its page shows it (TAX-10, TAX-13, TAX-27, TAX-29, TAX-31,
 * CL-TAX-17, CL-TAX-20), or null when no type has that identifier.
 */
export async function getType(db: Reader, typeId: string): Promise<TypeDetail | null> {
  const types = await allTypes(db);
  const type = types.find((candidate) => candidate.id === typeId);
  if (type === undefined) {
    return null;
  }
  return {
    id: type.id,
    status: type.status,
    origin: type.origin,
    createdAt: instant(type.createdAt),
    sheet: sheetContent(type),
    currentVersionNumber: type.currentVersionNumber,
    calendarDerivation: type.calendarDerivation,
    switchedOffCriterion: type.switchedOffCriterion,
    rejectionReason: type.rejectionReason,
    rejectionComment: type.rejectionComment,
    withdrawalReasonKind: type.withdrawalReasonKind,
    withdrawalReason: type.withdrawalReason,
    noFitReason: type.noFitReason,
    rowVersion: type.rowVersion,
    ...linksOf(type, types),
    transitions: await transitionsOf(db, typeId),
  };
}

/**
 * A version of a sheet with what it did to events (TAX-20, TAX-26): `versionNumber`,
 * `createdAt`, `kind`, `substantiveScope`, `mergeCoversUnion`, `isBroadening`, `reason`
 * and the four counts `requalifiedConformingCount`, `reassignedCount`, `erasedCount` and
 * `supplementaryRequestsProposedCount`.
 */
export type VersionCounters = Readonly<
  Omit<TypeSheetVersionRow, 'id' | 'eventTypeId' | 'content' | 'createdAt'> & {
    createdAt: EpochMs;
  }
>;

/**
 * The versions of the sheet of `typeId`, first to last, each with its date, kind, scope,
 * reason and the four counts that stay visible whatever later edits do (TAX-20, TAX-22,
 * TAX-26, CL-TAX-06).
 */
export async function versionCounters(
  db: Reader,
  typeId: string,
): Promise<readonly VersionCounters[]> {
  const rows = await db
    .select({
      versionNumber: typeSheetVersions.versionNumber,
      createdAt: typeSheetVersions.createdAt,
      kind: typeSheetVersions.kind,
      substantiveScope: typeSheetVersions.substantiveScope,
      mergeCoversUnion: typeSheetVersions.mergeCoversUnion,
      isBroadening: typeSheetVersions.isBroadening,
      reason: typeSheetVersions.reason,
      requalifiedConformingCount: typeSheetVersions.requalifiedConformingCount,
      reassignedCount: typeSheetVersions.reassignedCount,
      erasedCount: typeSheetVersions.erasedCount,
      supplementaryRequestsProposedCount: typeSheetVersions.supplementaryRequestsProposedCount,
    })
    .from(typeSheetVersions)
    .where(eq(typeSheetVersions.eventTypeId, typeId))
    .orderBy(asc(typeSheetVersions.versionNumber));
  return rows.map((row) => ({ ...row, createdAt: instant(row.createdAt) }));
}

// A history entry's content: the sheet's, plus the switched-off criterion (TAX-21, CL-TAX-17).
const SHEET_CHANGE_CONTENT = SHEET_CONTENT.extend({
  switchedOffCriterion: z.enum(eventTypes.switchedOffCriterion.enumValues).nullable(),
});

/** A history entry's content: `SheetContent` plus `switchedOffCriterion` (TAX-21, CL-TAX-17). */
export type SheetChangeContent = Readonly<z.infer<typeof SHEET_CHANGE_CONTENT>>;

/**
 * An entry of a sheet's history (TAX-21): `changedAt`, `changeKind`, `substantiveScope`,
 * `reason`, `before` and `after` (each a `SheetChangeContent`) and the
 * `resultingVersionNumber` of a substantive change.
 */
export type SheetHistoryEntry = Readonly<
  Pick<
    TypeSheetChangeRow,
    'changeKind' | 'substantiveScope' | 'reason' | 'resultingVersionNumber'
  > & {
    changedAt: EpochMs;
    before: SheetChangeContent;
    after: SheetChangeContent;
  }
>;

/**
 * The history of the sheet of `typeId`, oldest first: every saved change, formal or
 * substantive, and every change of the criterion switch, with its date, qualification,
 * reason and the content before and after (TAX-21, CL-TAX-06, CL-TAX-17).
 */
export async function sheetHistory(
  db: Reader,
  typeId: string,
): Promise<readonly SheetHistoryEntry[]> {
  const rows = await db
    .select()
    .from(typeSheetChanges)
    .where(eq(typeSheetChanges.eventTypeId, typeId))
    .orderBy(asc(typeSheetChanges.changedAt), asc(typeSheetChanges.id));
  return rows.map((row) => ({
    changedAt: instant(row.changedAt),
    changeKind: row.changeKind,
    substantiveScope: row.substantiveScope,
    reason: row.reason,
    before: SHEET_CHANGE_CONTENT.parse(row.contentBefore),
    after: SHEET_CHANGE_CONTENT.parse(row.contentAfter),
    resultingVersionNumber: row.resultingVersionNumber,
  }));
}

const TYPE_LINK_MARK = z.enum(events.typeLinkMark.enumValues);

/** The mark of an event to review: `'to_requalify' | 'to_distribute'` (TAX-25, TAX-29). */
export type TypeLinkMark = z.infer<typeof TYPE_LINK_MARK>;

/**
 * An event to review (TAX-25, TAX-29): `eventId`, `mark`, `typeId`, `player` (`id` and
 * `displayName`), its reference date (`referenceDateOn` as written, or `referenceAt`, an
 * instant, whichever it has) and `version`, the sheet it is qualified under (`typeId`,
 * `versionNumber`), which may be another type's (CL-TAX-08).
 */
export type EventToReview = Readonly<{
  eventId: number;
  mark: TypeLinkMark;
  typeId: string;
  player: Readonly<{ id: string; displayName: string }>;
  referenceDateOn: IsoDate | null;
  referenceAt: EpochMs | null;
  version: Readonly<{ typeId: string; versionNumber: number }>;
}>;

/**
 * The events marked to requalify or to distribute, of `typeId` or of every type, by type
 * then in the order they were recorded (TAX-25, TAX-29): the to-do list's items.
 */
export async function eventsToReview(
  db: Reader,
  typeId?: string,
): Promise<readonly EventToReview[]> {
  const rows = await db
    .select({
      eventId: events.id,
      mark: events.typeLinkMark,
      typeId: events.eventTypeId,
      player: { id: followedPlayers.id, displayName: followedPlayers.displayName },
      referenceDateOn: events.referenceDateOn,
      referenceAt: events.referenceAt,
      version: { typeId: events.sheetEventTypeId, versionNumber: events.sheetVersionNumber },
    })
    .from(events)
    .innerJoin(followedPlayers, eq(followedPlayers.id, events.playerId))
    .where(
      and(
        isNotNull(events.typeLinkMark),
        typeId === undefined ? undefined : eq(events.eventTypeId, typeId),
      ),
    )
    .orderBy(asc(events.eventTypeId), asc(events.id));
  return rows.map(({ mark, referenceDateOn: on, referenceAt: at, ...row }) => ({
    ...row,
    mark: TYPE_LINK_MARK.parse(mark),
    referenceDateOn: on === null ? null : toIsoDate(on),
    referenceAt: at === null ? null : instant(at),
  }));
}

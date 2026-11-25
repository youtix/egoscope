// The public dates and the sources of a correction (IMP-32, CL-IMP-09, CL-IMP-25): how a
// corrected list of sources replaces the stored one, the links it keeps keeping their
// checks. They sit apart from corrections.ts only to keep each file within the size limits.
import 'server-only';

import { asc, eq, inArray } from 'drizzle-orm';

import { eventSources } from '@/lib/db';

import type { EventSourceRow, NewEventSourceRow } from './types';
import type { Transaction } from '@/lib/db';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A historical public date: a day, or a day with its instant and the offset it was written with (CL-IMP-09). */
export type PublicDate =
  | Readonly<{ on: IsoDate; at: null }>
  | Readonly<{ on: IsoDate; at: EpochMs; offsetMinutes: number }>;

/** A source as a correction keeps it, checked by the caller as at an import (IMP-14, CL-IMP-14). */
export type CorrectedSource = Readonly<{
  url: string;
  cleanedUrl: string;
  outlet: string | null;
  title: string | null;
  publication: PublicDate;
}>;

/** A stored day, instant and offset, and the precision they make (CL-IMP-09). */
type DateColumns = Readonly<{
  on: string | null;
  at: Date | null;
  offset: number | null;
}>;

/** The columns of a source that a correction writes (`event_sources`). */
type SourceColumns = Readonly<{
  position: NewEventSourceRow['position'];
  url: NewEventSourceRow['url'];
  cleanedUrl: NewEventSourceRow['cleanedUrl'];
  outlet: string | null;
  title: string | null;
  publicationDateOn: NewEventSourceRow['publicationDateOn'];
  publicationAt: Date | null;
  publicationOffsetMinutes: number | null;
}>;

/** How the stored sources of an event become the corrected ones. */
type SourcePlan = Readonly<{
  removed: readonly number[];
  edited: readonly Readonly<{ id: number; set: SourceColumns }>[];
  added: readonly SourceColumns[];
}>;

/** The columns of the public date `date`: `exact` when timed, `approximate` otherwise (CL-IMP-09). */
export function dateColumns(
  date: PublicDate,
): DateColumns & Readonly<{ on: IsoDate; precision: 'exact' | 'approximate' }> {
  return date.at === null
    ? { on: date.on, at: null, offset: null, precision: 'approximate' }
    : { on: date.on, at: new Date(date.at), offset: date.offsetMinutes, precision: 'exact' };
}

/** Whether two stored dates are the same day, instant and offset. */
export function isSameDate(left: DateColumns, right: DateColumns): boolean {
  return (
    left.on === right.on &&
    left.at?.getTime() === right.at?.getTime() &&
    left.offset === right.offset
  );
}

/** The columns of `source` at its 1-based `position` (CL-IMP-16). */
function sourceColumns(source: CorrectedSource, position: number): SourceColumns {
  const date = dateColumns(source.publication);
  return {
    position,
    url: source.url,
    cleanedUrl: source.cleanedUrl,
    outlet: source.outlet,
    title: source.title,
    publicationDateOn: date.on,
    publicationAt: date.at,
    publicationOffsetMinutes: date.offset,
  };
}

/** Whether the stored source already holds `columns`. */
function isUnchanged(stored: EventSourceRow, columns: SourceColumns): boolean {
  return (
    stored.position === columns.position &&
    stored.cleanedUrl === columns.cleanedUrl &&
    stored.outlet === columns.outlet &&
    stored.title === columns.title &&
    isSameDate(
      {
        on: stored.publicationDateOn,
        at: stored.publicationAt,
        offset: stored.publicationOffsetMinutes,
      },
      {
        on: columns.publicationDateOn,
        at: columns.publicationAt,
        offset: columns.publicationOffsetMinutes,
      },
    )
  );
}

/**
 * How `stored` becomes `sources`: a source whose link is unchanged keeps its row and its
 * checks, and a corrected or added link is a new row, not checked yet (CL-IMP-25).
 */
function sourcePlan(stored: readonly EventSourceRow[], sources: readonly CorrectedSource[]) {
  const unused = [...stored];
  const edited: { id: number; set: SourceColumns }[] = [];
  const added: SourceColumns[] = [];
  for (const [index, source] of sources.entries()) {
    const columns = sourceColumns(source, index + 1);
    const keptIndex = unused.findIndex((row) => row.url === source.url);
    const kept = keptIndex === -1 ? undefined : unused.splice(keptIndex, 1)[0];
    if (kept === undefined) {
      added.push(columns);
    } else if (!isUnchanged(kept, columns)) {
      edited.push({ id: kept.id, set: columns });
    }
  }
  return { removed: unused.map((row) => row.id), edited, added };
}

/**
 * The plan that replaces the sources of event `eventId` with `sources`, read in the
 * caller's transaction `tx`: none when the correction leaves them as they are.
 */
export async function plannedSources(
  tx: Transaction,
  eventId: number,
  sources: readonly CorrectedSource[] | undefined,
): Promise<SourcePlan | null> {
  if (sources === undefined) {
    return null;
  }
  const stored = await tx
    .select()
    .from(eventSources)
    .where(eq(eventSources.playerEventId, eventId))
    .orderBy(asc(eventSources.position));
  const plan = sourcePlan(stored, sources);
  return plan.removed.length + plan.edited.length + plan.added.length > 0 ? plan : null;
}

/**
 * Writes `plan` to the sources of its event `of.eventId` at `of.at`: the sources left out
 * deleted with their checks, the others moved or completed, and the new links added
 * unchecked, for the link check to fetch (CL-IMP-25).
 */
export async function saveSources(
  tx: Transaction,
  plan: SourcePlan,
  of: Readonly<{ eventId: number; at: Date }>,
): Promise<void> {
  if (plan.removed.length > 0) {
    await tx.delete(eventSources).where(inArray(eventSources.id, [...plan.removed]));
  }
  for (const { id, set } of plan.edited) {
    await tx.update(eventSources).set(set).where(eq(eventSources.id, id));
  }
  if (plan.added.length > 0) {
    await tx
      .insert(eventSources)
      .values(
        plan.added.map((source) => ({ ...source, playerEventId: of.eventId, addedAt: of.at })),
      );
  }
}

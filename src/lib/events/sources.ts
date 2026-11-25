import 'server-only';

import { eq, inArray, max, sql } from 'drizzle-orm';

import { eventSources } from '@/lib/db';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import type { EventSourceRow, NewEventSourceRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A connection or the caller's transaction, to write one row through. */
type Executor = Database | Transaction;

/**
 * A date as written and, when it had a time, its absolute instant and the offset it
 * was written with (CL-IMP-09, TRV-68): a historical event's public date, or the
 * publication date of a source.
 */
export type DateOrInstant =
  | Readonly<{ on: IsoDate; at: null }>
  | Readonly<{ on: IsoDate; at: EpochMs; offsetMinutes: number }>;

/**
 * A source to record, reduced to what DSN-06 lists: its link and its title exactly as
 * published, its outlet and its publication date, with the cleaned link that the
 * caller computed for the shared-link match (CL-IMP-14). It has no field for an excerpt
 * of the article (DSN-08).
 */
export type NewSource = Readonly<{
  url: string;
  cleanedUrl: string;
  outlet: string | null;
  title: string | null;
  publicationDate: DateOrInstant;
}>;

/** Sources added to a recorded event, and the import that adds them, null for the owner's (IMP-26, IMP-31). */
export type SourceAddition = Readonly<{
  playerEventId: number;
  importId: number | null;
  sources: readonly NewSource[];
}>;

/** The one mark a link check stores, for a page that does not exist (IMP-17, CL-IMP-25). */
export type LinkStatus = NonNullable<EventSourceRow['linkStatus']>;

/** What the owner found on opening a source during the spot check (IMP-23). */
export type SpotCheckVerdict = NonNullable<EventSourceRow['spotCheckVerdict']>;

/** Why a check was not recorded: its source is gone, erased with its event meanwhile. */
export type SourceGone = Readonly<{ kind: 'source_gone' }>;

const SOURCE_GONE: SourceGone = { kind: 'source_gone' };

/** The columns of the time of a date as written: its instant and offset, or none (CL-IMP-09). */
export function timeColumns(date: DateOrInstant): Readonly<{
  at: Date | null;
  offsetMinutes: number | null;
}> {
  return date.at === null
    ? { at: null, offsetMinutes: null }
    : { at: new Date(date.at), offsetMinutes: date.offsetMinutes };
}

/**
 * The rows of `sources` of an event, numbered from `firstPosition` in the order given,
 * each link and title kept exactly as given (DSN-08, H-DSN-04), added now.
 */
export function sourceRows(
  addition: SourceAddition,
  firstPosition: number,
): readonly NewEventSourceRow[] {
  const addedAt = new Date(now());
  return addition.sources.map((source, index) => {
    const { at, offsetMinutes } = timeColumns(source.publicationDate);
    return {
      playerEventId: addition.playerEventId,
      position: firstPosition + index,
      url: source.url,
      cleanedUrl: source.cleanedUrl,
      outlet: source.outlet,
      title: source.title,
      publicationDateOn: source.publicationDate.on,
      publicationAt: at,
      publicationOffsetMinutes: offsetMinutes,
      addedByImportId: addition.importId,
      addedAt,
    };
  });
}

/**
 * Writes the source rows of events (DSN-06) and gives their identifiers in the order of
 * `rows`: an identity grows row by row through one statement, so the ascending order
 * is the order written.
 */
export async function insertSourceRows(
  tx: Transaction,
  rows: readonly NewEventSourceRow[],
): Promise<readonly number[]> {
  if (rows.length === 0) {
    return [];
  }
  const written = await tx
    .insert(eventSources)
    .values([...rows])
    .returning({ id: eventSources.id });
  return written.map(({ id }) => id).toSorted((left, right) => left - right);
}

/**
 * Numbers the sources of each event in the order of CL-IMP-16: by calendar date, a
 * source with a time before one without on the same date, timed sources by instant,
 * full ties in their earlier order, so that sources added later take their place
 * among the others (IMP-14, IMP-26).
 */
export async function putInSourceOrder(
  tx: Transaction,
  playerEventIds: readonly number[],
): Promise<void> {
  const ranked = tx
    .select({
      id: eventSources.id,
      rank: sql<number>`row_number() over (partition by ${eventSources.playerEventId} order by ${eventSources.publicationDateOn}, ${eventSources.publicationAt} nulls last, ${eventSources.position})`.as(
        'rank',
      ),
    })
    .from(eventSources)
    .where(inArray(eventSources.playerEventId, [...playerEventIds]))
    .as('ranked');
  await tx
    .update(eventSources)
    .set({ position: sql`${ranked.rank}` })
    .where(eq(eventSources.id, ranked.id))
    .from(ranked);
}

/**
 * Adds sources to a recorded event, the only way any module writes one (module map
 * §1.2 rule 7): each link and title exactly as given, never trimmed nor rewritten, with
 * its outlet, its publication date and, when it had a time, its instant and offset,
 * and no excerpt of the article (DSN-06, DSN-08, CL-IMP-09). The event's sources are
 * then numbered in the order of CL-IMP-16. Gives the identifiers of the added sources,
 * in the order given.
 */
export async function addSources(
  tx: Transaction,
  addition: SourceAddition,
): Promise<readonly number[]> {
  const [last] = await tx
    .select({ position: max(eventSources.position) })
    .from(eventSources)
    .where(eq(eventSources.playerEventId, addition.playerEventId));
  const ids = await insertSourceRows(tx, sourceRows(addition, (last?.position ?? 0) + 1));
  await putInSourceOrder(tx, [addition.playerEventId]);
  return ids;
}

/** Applies `values` to the source `sourceId`, or says that it is gone. */
async function updateSource(
  db: Executor,
  sourceId: number,
  values: Partial<NewEventSourceRow>,
): Promise<Result<undefined, SourceGone>> {
  const updated = await db
    .update(eventSources)
    .set(values)
    .where(eq(eventSources.id, sourceId))
    .returning({ id: eventSources.id });
  return updated.length === 0 ? err(SOURCE_GONE) : ok(undefined);
}

/**
 * Records the link check of a source (IMP-17, CL-IMP-25): the instant of the check, so
 * that the link is checked once, and `linkStatus`, `not_found`, only when the page was
 * found missing (a final 404 or 410, or a host name that does not resolve); null for
 * any other outcome, which marks nothing.
 */
export async function recordLinkCheck(
  db: Executor,
  sourceId: number,
  linkStatus: LinkStatus | null,
): Promise<Result<undefined, SourceGone>> {
  return updateSource(db, sourceId, { linkCheckedAt: new Date(now()), linkStatus });
}

/** Records the owner's spot-check verdict on a source (IMP-23). */
export async function recordSpotCheck(
  db: Executor,
  sourceId: number,
  verdict: SpotCheckVerdict,
): Promise<Result<undefined, SourceGone>> {
  return updateSource(db, sourceId, { spotCheckVerdict: verdict });
}

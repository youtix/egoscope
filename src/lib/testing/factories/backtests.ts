import { eq } from 'drizzle-orm';

import {
  backtestCoveragePeriods,
  backtestRequests,
  backtestRequestTypes,
  imports,
  nextValue,
} from '@/lib/db';
import { now } from '@/lib/time';

import { firstRow } from '../rows';
import { MEDIA_STORM } from './taxonomy';

import type { Database, SequenceName } from '@/lib/db';

/** A backtest request as the database holds it. */
export type RequestRow = typeof backtestRequests.$inferSelect;

/** An import as the database holds it. */
export type ImportRow = typeof imports.$inferSelect;

// The digits of a year, which a calendar date starts with, and of a request reference's
// number, zero-padded (REQ-2026-0001).
const YEAR_DIGITS = 4;
const REFERENCE_DIGITS = 4;
// The version of the type's sheet that the factories' prompts use.
const SHEET_VERSION = 1;

/** The sequence that numbers the request references of `year`. */
function referenceSequence(year: number): SequenceName {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- SequenceName types the year as `${number}`, which only a number fills; a year prints without a fraction or an exponent.
  return `request_reference_${year}`;
}

/** A period of a type that a request asks for or that an import covers, as calendar dates. */
export type TypePeriod = Readonly<{ eventTypeId: string; startOn: string; endOn: string }>;

/** What `insertRequest` takes: the player, the types and periods asked, and the columns to write otherwise. */
export type RequestFactoryOptions = Readonly<{
  playerId: string;
  types?: readonly TypePeriod[];
  overrides?: Partial<typeof backtestRequests.$inferInsert>;
}>;

// The types that a request asks by default: the media storm over three seasons.
const DEFAULT_TYPES: readonly TypePeriod[] = [
  { eventTypeId: MEDIA_STORM, startOn: '2023-10-24', endOn: '2026-11-08' },
];

/**
 * Writes a backtest request to do for the player, an initial one asked by hand on
 * `createdOn`, 2 November 2026 by default, its prompt produced and its reference the
 * next of its year, as the application numbers them; with the types it asks under the
 * first version of their sheets, the media storm by default. `overrides` replaces any
 * column of the request (TRV-76).
 */
export async function insertRequest(
  db: Database,
  { playerId, types = DEFAULT_TYPES, overrides = {} }: RequestFactoryOptions,
): Promise<RequestRow> {
  const createdOn = overrides.createdOn ?? '2026-11-02';
  const year = Number(createdOn.slice(0, YEAR_DIGITS));
  const number = await db.transaction(async (tx) => nextValue(tx, referenceSequence(year)));
  const producedAt = new Date(now());
  const rows = await db
    .insert(backtestRequests)
    .values({
      reference: `REQ-${String(year)}-${String(number).padStart(REFERENCE_DIGITS, '0')}`,
      playerId,
      kind: 'initial',
      trigger: 'manual_action',
      createdOn,
      promptText: 'Research the public events of the player over the periods requested.',
      promptProducedAt: producedAt,
      ...overrides,
    })
    .returning();
  const request = firstRow(rows, 'the request written');
  await db.insert(backtestRequestTypes).values(
    types.map((type) => ({
      backtestRequestId: request.id,
      eventTypeId: type.eventTypeId,
      sheetVersionNumber: SHEET_VERSION,
      periodStartOn: type.startOn,
      periodEndOn: type.endOn,
    })),
  );
  return request;
}

/** What `insertImport` takes: the request imported, and the types and periods that its result covers. */
export type ImportFactoryOptions = Readonly<{
  request: RequestRow;
  covered?: readonly TypePeriod[];
}>;

/**
 * Imports a result for the request (TRV-76): marks the request imported, writes its
 * import under the next sequence number, a first import, and the coverage of each type
 * that the result covers, the media storm by default, so that its player is profiled.
 */
export async function insertImport(
  db: Database,
  { request, covered = DEFAULT_TYPES }: ImportFactoryOptions,
): Promise<ImportRow> {
  const importedAt = new Date(now());
  await db
    .update(backtestRequests)
    .set({ status: 'imported', importedAt })
    .where(eq(backtestRequests.id, request.id));
  const sequenceNumber = await db.transaction(async (tx) => nextValue(tx, 'import_sequence'));
  const written = firstRow(
    await db
      .insert(imports)
      .values({
        sequenceNumber,
        backtestRequestId: request.id,
        playerId: request.playerId,
        importedAt,
        mode: 'first_import',
      })
      .returning(),
    'the import written',
  );
  await db.insert(backtestCoveragePeriods).values(
    covered.map(
      (period) =>
        ({
          playerId: request.playerId,
          ...period,
          sheetVersionNumber: SHEET_VERSION,
          origin: 'import',
          importId: written.id,
          recordedAt: importedAt,
        }) as const,
    ),
  );
  return written;
}

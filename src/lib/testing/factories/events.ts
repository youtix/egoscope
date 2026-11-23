import { events } from '@/lib/db';
import { now } from '@/lib/time';

import { firstRow } from '../rows';
import { MEDIA_STORM } from './taxonomy';

import type { Database } from '@/lib/db';

/** An event as the database holds it. */
export type EventRow = typeof events.$inferSelect;

/** What an event factory takes: the player, and the columns to write otherwise. */
export type EventFactoryOptions = Readonly<{
  playerId: string;
  overrides?: Partial<typeof events.$inferInsert>;
}>;

// The type and the first version of its sheet that an event is written under by default.
const OF_MEDIA_STORM = {
  eventTypeId: MEDIA_STORM,
  sheetEventTypeId: MEDIA_STORM,
  sheetVersionNumber: 1,
  description: 'Every outlet covered the player on the same day.',
} as const;

/** Writes one event and gives it as the database holds it. */
async function insertEvent(db: Database, values: typeof events.$inferInsert): Promise<EventRow> {
  return firstRow(await db.insert(events).values(values).returning(), 'the event written');
}

/**
 * Writes a historical media storm of the player that `originImportId`, the import of a
 * research result, recorded (TRV-76): dated to the day, 20 November 2024 by default,
 * with high research confidence and an established precedence. `overrides` replaces
 * any column; `originImportId` is required.
 */
export async function insertHistoricalEvent(
  db: Database,
  {
    playerId,
    originImportId,
    overrides = {},
  }: EventFactoryOptions & Readonly<{ originImportId: number }>,
): Promise<EventRow> {
  return insertEvent(db, {
    ...OF_MEDIA_STORM,
    playerId,
    origin: 'historical',
    referenceDateOn: '2024-11-20',
    referenceDatePrecision: 'approximate',
    researchConfidence: 'high',
    precedence: 'established',
    originImportId,
    ...overrides,
  });
}

/**
 * Writes a detected media storm of the player (TRV-76), dated now by its earliest
 * source and classified by the model; `overrides` replaces any column.
 */
export async function insertDetectedEvent(
  db: Database,
  { playerId, overrides = {} }: EventFactoryOptions,
): Promise<EventRow> {
  return insertEvent(db, {
    ...OF_MEDIA_STORM,
    playerId,
    origin: 'detected',
    referenceAt: new Date(now()),
    referenceDatePrecision: 'exact',
    detectedStatus: 'detected',
    referenceDateRule: 'earliest_source',
    classificationOrigin: 'model',
    ...overrides,
  });
}

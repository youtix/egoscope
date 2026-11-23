import { eq } from 'drizzle-orm';

import { eventTypes, typeSheetVersions } from '@/lib/db';

import { firstRow } from '../rows';

import type { Database } from '@/lib/db';

/** An event type as the database holds it. */
export type EventTypeRow = typeof eventTypes.$inferSelect;

/** The research type that the factories write unless told otherwise: a media storm. */
export const MEDIA_STORM = 'media-storm';

// The version of a sheet that a type's validation produces (TAX-20).
const FIRST_VERSION = 1;

// A validated research type, its sheet complete (TAX-01, TAX-12).
const VALIDATED_SHEET = {
  id: MEDIA_STORM,
  name: 'Media storm',
  status: 'validated',
  origin: 'scoping',
  definition: 'Wide coverage of one player by the press in a short time.',
  inclusionCriteria: 'Three outlets or more write about the player within two days.',
  exclusionCriteria: 'The routine coverage of a game.',
  datingRule: 'The day of the first article.',
  genericExample: 'A player leads every sports page for two days.',
  documentationDifficulty: 'medium',
  currentVersionNumber: FIRST_VERSION,
} as const;

/**
 * Writes an event type and the first version of its sheet (TAX-01, TAX-20), unless a
 * type of that identifier exists, so that scenarios that need the same type combine: a
 * validated research type, the media storm, by default; `overrides` replaces any
 * column. Gives the type as the database holds it.
 */
export async function insertEventType(
  db: Database,
  overrides: Partial<typeof eventTypes.$inferInsert> = {},
): Promise<EventTypeRow> {
  const type = { ...VALIDATED_SHEET, ...overrides };
  await db.insert(eventTypes).values(type).onConflictDoNothing({ target: eventTypes.id });
  await db
    .insert(typeSheetVersions)
    .values({
      eventTypeId: type.id,
      versionNumber: FIRST_VERSION,
      kind: 'validation',
      content: { name: type.name, definition: type.definition },
    })
    .onConflictDoNothing();
  return firstRow(
    await db.select().from(eventTypes).where(eq(eventTypes.id, type.id)),
    `the event type ${type.id}`,
  );
}

/** The calendar-derived type that the factories write: the player's birthday. */
export const BIRTHDAY = 'birthday';

/**
 * Writes the calendar-derived type of the player's birthday, known in advance and
 * validated (TAX-01, TAX-10); `overrides` replaces any column.
 */
export async function insertCalendarType(
  db: Database,
  overrides: Partial<typeof eventTypes.$inferInsert> = {},
): Promise<EventTypeRow> {
  return insertEventType(db, {
    id: BIRTHDAY,
    name: "Player's birthday",
    datingRule: 'The day of the birthday.',
    genericExample: 'A player plays on his birthday.',
    knownInAdvance: true,
    calendarDerivation: 'birthday',
    ...overrides,
  });
}

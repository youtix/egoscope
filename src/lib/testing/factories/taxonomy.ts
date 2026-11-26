import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';

import { eventTypes, typeSheetVersions } from '@/lib/db';
import candidateTypeSheets from '@data/seeds/event-types.json';

import { firstRow } from '../rows';

import type { Database } from '@/lib/db';

// The identifiers of the nine candidate types that the reference data seeds, proposed,
// before any scenario (TAX-15).
const SEEDED_TYPE_IDS = candidateTypeSheets.map((sheet) => sheet.id);

/** An event type as the database holds it. */
export type EventTypeRow = typeof eventTypes.$inferSelect;

/** The research type that the factories write unless told otherwise: a media storm. */
export const MEDIA_STORM = 'media-storm';

// The version of a sheet that a type's validation produces (TAX-20).
const FIRST_VERSION = 1;

// Every column of a type but its identifier at the value that an insert gives it when
// left out, its default: what a type written over a seeded proposal starts from.
const INSERT_DEFAULTS = Object.fromEntries(
  Object.keys(getTableColumns(eventTypes))
    .filter((column) => column !== 'id')
    .map((column) => [column, sql`DEFAULT`]),
);

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
} as const;

// The columns that a scenario gives, without those it gives as `undefined`: a column given
// so is left out, as an insert leaves it out, and takes the factory's default (TAX-15).
function givenColumns(
  overrides: Partial<typeof eventTypes.$inferInsert>,
): Partial<typeof eventTypes.$inferInsert> {
  const given = { ...overrides };
  for (const [column, value] of Object.entries(overrides)) {
    if (value === undefined) {
      Reflect.deleteProperty(given, column);
    }
  }
  return given;
}

/**
 * Writes an event type (TAX-01, TAX-20): a validated research type, the media storm, by
 * default; `overrides` replaces any column, and one given as `undefined` counts as left
 * out. A validated or withdrawn type gets the first
 * version of its sheet, which its validation produced; a proposed or rejected one, never
 * validated, has no version and no version number. A candidate type that the reference
 * data seeded and that is still proposed gives way to the type asked for, written whole
 * over its row as a new one, every column the type leaves out at its default, so that the
 * rows that refer to it stay (TAX-15). Such a proposal is replaced even when the owner
 * edited it, whenever a scenario asks for its identifier. Any other type of that
 * identifier that exists already is left as it is, overrides ignored, so that scenarios
 * that need the same type combine. Gives the type as the database holds it.
 */
export async function insertEventType(
  db: Database,
  overrides: Partial<typeof eventTypes.$inferInsert> = {},
): Promise<EventTypeRow> {
  const given = givenColumns(overrides);
  const status = given.status ?? VALIDATED_SHEET.status;
  const wasValidated = status === 'validated' || status === 'withdrawn';
  const type = {
    ...VALIDATED_SHEET,
    currentVersionNumber: wasValidated ? FIRST_VERSION : null,
    ...given,
  };
  // A proposed type was never validated, so it has no sheet version to replace.
  const { id, ...columns } = type;
  const replaced = await db
    .update(eventTypes)
    .set({ ...INSERT_DEFAULTS, ...columns })
    .where(
      and(
        eq(eventTypes.id, id),
        inArray(eventTypes.id, SEEDED_TYPE_IDS),
        eq(eventTypes.status, 'proposed'),
      ),
    )
    .returning({ version: eventTypes.currentVersionNumber });
  const written =
    replaced.length > 0
      ? replaced
      : await db
          .insert(eventTypes)
          .values(type)
          .onConflictDoNothing({ target: eventTypes.id })
          .returning({ version: eventTypes.currentVersionNumber });
  const version = written[0]?.version ?? null;
  if (version !== null) {
    await db.insert(typeSheetVersions).values({
      eventTypeId: type.id,
      versionNumber: version,
      kind: 'validation',
      content: { name: type.name, definition: type.definition },
    });
  }
  return firstRow(
    await db.select().from(eventTypes).where(eq(eventTypes.id, type.id)),
    `the event type ${type.id}`,
  );
}

/** The calendar-derived type that the factories write: the player's birthday. */
export const BIRTHDAY = 'birthday';

/**
 * Writes the calendar-derived type of the player's birthday, known in advance and
 * validated (TAX-01, TAX-10); `overrides` replaces any column, and one given as
 * `undefined` counts as left out.
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
    ...givenColumns(overrides),
  });
}

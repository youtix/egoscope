import { asc, eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import {
  createTestDatabase,
  drafts,
  eventTypes,
  journalEntries,
  typeSheetVersions,
} from '@/lib/db';
import { seedCandidateTypes } from '@/lib/taxonomy';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { firstRow } from '../rows';
import { applyScenarios } from '../scenarios';
import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertCalendarType, insertEventType } from './taxonomy';

import type { Database } from '@/lib/db';

const STARTED_AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));

/** Writes a journal entry that refers to the media storm, as the owner's edit of its sheet would. */
async function journalOfMediaStorm(db: Database) {
  const written = await db
    .insert(journalEntries)
    .values({
      category: 'user_action',
      level: 'info',
      messageKey: 'taxonomy.edited',
      eventTypeId: 'media-storm',
    })
    .returning();
  return firstRow(written, 'the journal entry');
}

describe('the taxonomy factories', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[TAX-01] [TAX-20] writes a validated media storm by default, its sheet complete under its first version', async () => {
    const type = await insertEventType(db);

    expect(type).toMatchObject({
      id: 'media-storm',
      name: 'Media storm',
      status: 'validated',
      origin: 'scoping',
      knownInAdvance: false,
      calendarDerivation: null,
      documentationDifficulty: 'medium',
      currentVersionNumber: 1,
    });
    await expect(db.select().from(typeSheetVersions)).resolves.toMatchObject([
      { eventTypeId: 'media-storm', versionNumber: 1, kind: 'validation' },
    ]);
  });

  it('keeps the type that exists under an identifier, so that scenarios needing it combine', async () => {
    await insertEventType(db);
    const again = await insertEventType(db, { name: 'Another name' });

    expect(again.name).toBe('Media storm');
    await expect(db.select().from(typeSheetVersions)).resolves.toHaveLength(1);
  });

  it('[TAX-15] writes the validated media storm asked for in place of the seeded proposal, touching no other type', async () => {
    await seedCandidateTypes(db, STARTED_AT);
    const others = await db
      .select()
      .from(eventTypes)
      .where(ne(eventTypes.id, 'media-storm'))
      .orderBy(asc(eventTypes.id));

    await expect(insertEventType(db)).resolves.toMatchObject({
      id: 'media-storm',
      name: 'Media storm',
      status: 'validated',
      definition: 'Wide coverage of one player by the press in a short time.',
      inclusionCriteria: 'Three outlets or more write about the player within two days.',
      coverageThresholdOutlets: null,
      coverageThresholdDays: null,
      cautionNotes: null,
      currentVersionNumber: 1,
    });
    await expect(db.select().from(typeSheetVersions)).resolves.toMatchObject([
      { eventTypeId: 'media-storm', versionNumber: 1, kind: 'validation' },
    ]);
    await expect(
      db
        .select()
        .from(eventTypes)
        .where(ne(eventTypes.id, 'media-storm'))
        .orderBy(asc(eventTypes.id)),
    ).resolves.toStrictEqual(others);
  });

  it('[TAX-15] writes a proposed type asked for in place of the seeded proposal, with the fields asked for', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    await expect(
      insertEventType(db, { id: 'bereavement', status: 'proposed', name: 'Loss of a relative' }),
    ).resolves.toMatchObject({
      id: 'bereavement',
      name: 'Loss of a relative',
      status: 'proposed',
      definition: 'Wide coverage of one player by the press in a short time.',
      currentVersionNumber: null,
    });
    await expect(db.select().from(typeSheetVersions)).resolves.toStrictEqual([]);
  });

  it('[TAX-15] writes the validated birthday asked for in place of the seeded proposal', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    await expect(insertCalendarType(db)).resolves.toMatchObject({
      id: 'birthday',
      name: "Player's birthday",
      status: 'validated',
      calendarDerivation: 'birthday',
      currentVersionNumber: 1,
    });
  });

  it('[TAX-15] writes the type that a scenario asks for over a seeded proposal that a journal entry refers to, and keeps the entry', async () => {
    onTestFinished(installFakeClock(fixedClock(STARTED_AT)));
    await seedCandidateTypes(db, STARTED_AT);
    const entry = await journalOfMediaStorm(db);

    await expect(applyScenarios(db, ['request-to-do'])).resolves.toStrictEqual({
      ok: true,
      value: ['request-to-do'],
    });

    await expect(db.select().from(journalEntries)).resolves.toStrictEqual([entry]);
    await expect(
      db
        .select({ status: eventTypes.status })
        .from(eventTypes)
        .where(eq(eventTypes.id, 'media-storm')),
    ).resolves.toStrictEqual([{ status: 'validated' }]);
  });

  it('[TAX-15] keeps the draft that explores a seeded proposal when it writes the type asked for over it', async () => {
    await seedCandidateTypes(db, STARTED_AT);
    const draft = await db
      .insert(drafts)
      .values({
        kind: 'exploration_response',
        explorationEventTypeId: 'media-storm',
        text: 'An answer pasted on the phone.',
        originDevice: 'phone',
      })
      .returning();

    await insertEventType(db);

    await expect(db.select().from(drafts)).resolves.toStrictEqual(draft);
  });

  it("[TAX-15] writes every column asked for over an edited seeded proposal, the others at their defaults and none of the proposal's left over", async () => {
    await seedCandidateTypes(db, STARTED_AT);
    await db
      .update(eventTypes)
      .set({ cautionNotes: 'A note of the owner.', isIntimateSubject: true, rowVersion: 3 })
      .where(eq(eventTypes.id, 'media-storm'));
    await journalOfMediaStorm(db);

    const { createdAt, ...written } = await insertEventType(db, {
      exclusionCriteria: 'A single article.',
    });

    expect(createdAt).toBeInstanceOf(Date);
    expect(written).toStrictEqual({
      id: 'media-storm',
      status: 'validated',
      origin: 'scoping',
      name: 'Media storm',
      definition: 'Wide coverage of one player by the press in a short time.',
      inclusionCriteria: 'Three outlets or more write about the player within two days.',
      exclusionCriteria: 'A single article.',
      datingRule: 'The day of the first article.',
      knownInAdvance: false,
      calendarDerivation: null,
      genericExample: 'A player leads every sports page for two days.',
      documentationDifficulty: 'medium',
      cautionNotes: null,
      isIntimateSubject: false,
      coverageThresholdOutlets: null,
      coverageThresholdDays: null,
      switchedOffCriterion: null,
      currentVersionNumber: 1,
      rejectionReason: null,
      rejectionComment: null,
      withdrawalReasonKind: null,
      withdrawalReason: null,
      mergedIntoTypeId: null,
      splitFromTypeId: null,
      noFitReason: null,
      rowVersion: 1,
    });
    await expect(db.select().from(typeSheetVersions)).resolves.toMatchObject([
      { eventTypeId: 'media-storm', versionNumber: 1, kind: 'validation' },
    ]);
  });

  it('keeps a proposed type that the reference data does not seed, as before', async () => {
    await insertEventType(db, { id: 'trade-request', status: 'proposed', name: 'Trade request' });

    await expect(insertEventType(db, { id: 'trade-request' })).resolves.toMatchObject({
      name: 'Trade request',
      status: 'proposed',
      currentVersionNumber: null,
    });
    await expect(db.select().from(typeSheetVersions)).resolves.toStrictEqual([]);
  });

  it('writes the columns that it is given in place of its own', async () => {
    await expect(
      insertEventType(db, { id: 'bereavement', name: 'Death of a loved one' }),
    ).resolves.toMatchObject({
      id: 'bereavement',
      name: 'Death of a loved one',
      status: 'validated',
    });
  });

  it.each([
    ['proposed', { status: 'proposed' } as const],
    ['rejected', { status: 'rejected', rejectionReason: 'out_of_scope' } as const],
  ])(
    '[TAX-20] writes a %s type, never validated, without a version of its sheet',
    async (status, overrides) => {
      await expect(insertEventType(db, { id: 'bereavement', ...overrides })).resolves.toMatchObject(
        { id: 'bereavement', status, currentVersionNumber: null },
      );
      await expect(db.select().from(typeSheetVersions)).resolves.toStrictEqual([]);
    },
  );

  it('[TAX-20] writes a withdrawn type with the version of its sheet that its validation produced', async () => {
    await expect(
      insertEventType(db, {
        status: 'withdrawn',
        withdrawalReasonKind: 'entered',
        withdrawalReason: 'Too close to another type.',
      }),
    ).resolves.toMatchObject({
      status: 'withdrawn',
      currentVersionNumber: 1,
    });
    await expect(db.select().from(typeSheetVersions)).resolves.toMatchObject([
      { eventTypeId: 'media-storm', versionNumber: 1, kind: 'validation' },
    ]);
  });

  it('[TAX-10] writes the birthday as a validated type derived from the calendar, known in advance', async () => {
    await expect(insertCalendarType(db)).resolves.toMatchObject({
      id: 'birthday',
      name: "Player's birthday",
      status: 'validated',
      origin: 'scoping',
      knownInAdvance: true,
      calendarDerivation: 'birthday',
    });
    await expect(insertCalendarType(db, { id: 'birthday-2' })).resolves.toMatchObject({
      id: 'birthday-2',
      calendarDerivation: 'birthday',
    });
  });
});

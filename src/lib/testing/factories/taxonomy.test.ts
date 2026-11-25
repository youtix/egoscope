import { asc, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, eventTypes, typeSheetVersions } from '@/lib/db';
import { seedCandidateTypes } from '@/lib/taxonomy';
import { toEpochMs } from '@/lib/time';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertCalendarType, insertEventType } from './taxonomy';

import type { Database } from '@/lib/db';

const STARTED_AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));

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

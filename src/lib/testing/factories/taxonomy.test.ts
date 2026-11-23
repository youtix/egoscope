import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, typeSheetVersions } from '@/lib/db';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertCalendarType, insertEventType } from './taxonomy';

import type { Database } from '@/lib/db';

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

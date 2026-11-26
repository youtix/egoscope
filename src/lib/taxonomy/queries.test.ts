import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, eventTypes } from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertEventType,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import {
  doNotReproposeList,
  handledByCalendarList,
  listByStatus,
  resolveTypeId,
  resolveTypeIds,
  sheetContent,
  validatedSheets,
} from './queries';

import type { Database } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
const DAY = 86_400_000;
/** The creation instant of the `n`th type of the taxonomy below. */
const dayOf = (n: number) => new Date(START + n * DAY);

/**
 * One type in every state and situation, in this order of creation: the media storm,
 * validated in version 2 with a coverage threshold; the birthday, validated, and the
 * former team, proposed, both calendar-derived; a proposed exploration type; a rejected
 * one; one withdrawn for a reason typed; one merged into the media storm; one split into
 * the last two, validated.
 */
async function writeTaxonomy(db: Database): Promise<void> {
  await insertEventType(db, {
    createdAt: dayOf(0),
    currentVersionNumber: 2,
    coverageThresholdOutlets: 3,
    coverageThresholdDays: 2,
    switchedOffCriterion: 'co_occurring',
  });
  await insertCalendarType(db, {
    createdAt: dayOf(1),
    definition: 'The player plays on his birthday.',
  });
  await insertCalendarType(db, {
    id: 'former-team',
    name: 'First game against a former team',
    status: 'proposed',
    calendarDerivation: 'former_team',
    definition: 'The player meets a former team for the first time.',
    createdAt: dayOf(2),
  });
  const others = [
    { id: 'locker-room-feud', name: 'Locker room feud', status: 'proposed', origin: 'exploration' },
    {
      id: 'tattoo-reveal',
      name: 'Tattoo reveal',
      status: 'rejected',
      rejectionReason: 'not_datable',
      rejectionComment: 'No outlet dates it.',
    },
    {
      id: 'trade-request',
      name: 'Trade request',
      status: 'withdrawn',
      withdrawalReasonKind: 'entered',
      withdrawalReason: 'Too rare to measure.',
    },
    {
      id: 'public-feud',
      name: 'Public feud',
      status: 'withdrawn',
      withdrawalReasonKind: 'merged_into',
      mergedIntoTypeId: MEDIA_STORM,
    },
    {
      id: 'coaching-change',
      name: 'Coaching change',
      status: 'withdrawn',
      withdrawalReasonKind: 'split_into',
    },
    { id: 'coach-fired', name: 'Coach fired', splitFromTypeId: 'coaching-change' },
    { id: 'coach-hired', name: 'Coach hired', splitFromTypeId: 'coaching-change' },
  ] as const;
  for (const [index, type] of others.entries()) {
    await insertEventType(db, {
      ...type,
      definition: `${type.name} as defined.`,
      createdAt: dayOf(index + 3),
    });
  }
}

/** Two types that a test creates by a split, by their references. */
const stormA = { id: 'storm-a', name: 'Storm A' };
const stormB = { id: 'storm-b', name: 'Storm B' };

/** Withdraws `typeId` with the withdrawal fields of `reason` (TAX-27, TAX-29, TAX-31). */
async function withdraw(
  db: Database,
  typeId: string,
  reason: Partial<typeof eventTypes.$inferInsert>,
): Promise<void> {
  await db
    .update(eventTypes)
    .set({ ...reason, status: 'withdrawn' })
    .where(eq(eventTypes.id, typeId));
}

/** A type not validated, as the do-not-repropose lists give it. */
const entry = (id: string, name: string) => ({ id, name, definition: `${name} as defined.` });

/** A research type of origin scoping, as the list of types shows the `n`th one. */
const listed = (id: string, name: string, n: number) => ({
  id,
  name,
  origin: 'scoping',
  calendarDerivation: null,
  createdAt: toEpochMs(dayOf(n).getTime()),
});

describe('the taxonomy read API', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    await writeTaxonomy(db);
    return async () => {
      restoreClock();
      await database.close();
    };
  });

  describe('validatedSheets', () => {
    it.each(['research_prompt', 'import', 'classification'] as const)(
      '[TAX-11] [TAX-33] [CL-TAX-14] gives the %s the validated research types only, in full, in their current version',
      async (purpose) => {
        const sheets = await validatedSheets(db, purpose);

        expect(sheets.map((sheet) => sheet.id)).toStrictEqual([
          MEDIA_STORM,
          'coach-fired',
          'coach-hired',
        ]);
        expect(sheets[0]).toStrictEqual({
          id: MEDIA_STORM,
          name: 'Media storm',
          versionNumber: 2,
          definition: 'Wide coverage of one player by the press in a short time.',
          inclusionCriteria: 'Three outlets or more write about the player within two days.',
          exclusionCriteria: 'The routine coverage of a game.',
          datingRule:
            'The day of the first article. Coverage threshold: 3 distinct outlets within 2 days.',
          knownInAdvance: false,
          genericExample: 'A player leads every sports page for two days.',
          calendarDerivation: null,
          coverageThreshold: { outlets: 3, days: 2 },
          switchedOffCriterion: 'co_occurring',
        });
        expect(sheets[1]).toMatchObject({
          datingRule: 'The day of the first article.',
          coverageThreshold: null,
          versionNumber: 1,
        });
      },
    );

    it('[TAX-11] [TAX-33] gives the calculation every validated type, the calendar-derived ones included', async () => {
      const sheets = await validatedSheets(db, 'calculation');

      expect(sheets.map((sheet) => sheet.id)).toStrictEqual([
        MEDIA_STORM,
        BIRTHDAY,
        'coach-fired',
        'coach-hired',
      ]);
      expect(sheets[1]).toMatchObject({
        datingRule: 'The day of the birthday.',
        knownInAdvance: true,
        calendarDerivation: 'birthday',
      });
    });

    it('[TAX-33] serves the current content of a sheet that a formal change rewrote', async () => {
      await db
        .update(eventTypes)
        .set({ definition: 'Coverage of one player by many outlets at once.' })
        .where(eq(eventTypes.id, MEDIA_STORM));

      const [mediaStorm] = await validatedSheets(db, 'research_prompt');

      expect(mediaStorm?.definition).toBe('Coverage of one player by many outlets at once.');
      expect(mediaStorm?.versionNumber).toBe(2);
    });

    it('[TAX-11] [CL-TAX-10] gives the exploration prompt every validated type by name and definition', async () => {
      expect(await validatedSheets(db, 'exploration')).toStrictEqual([
        {
          id: MEDIA_STORM,
          name: 'Media storm',
          definition: 'Wide coverage of one player by the press in a short time.',
        },
        {
          id: BIRTHDAY,
          name: "Player's birthday",
          definition: 'The player plays on his birthday.',
        },
        { id: 'coach-fired', name: 'Coach fired', definition: 'Coach fired as defined.' },
        { id: 'coach-hired', name: 'Coach hired', definition: 'Coach hired as defined.' },
      ]);
    });
  });

  describe('the do-not-repropose and handled-by-calendar lists', () => {
    it('[TAX-11] [CL-TAX-10] gives the exploration every type not validated, a rejection reason and never its comment', async () => {
      expect(await doNotReproposeList(db, 'exploration')).toStrictEqual([
        {
          id: 'former-team',
          name: 'First game against a former team',
          definition: 'The player meets a former team for the first time.',
          rejectionReason: null,
        },
        { ...entry('locker-room-feud', 'Locker room feud'), rejectionReason: null },
        { ...entry('tattoo-reveal', 'Tattoo reveal'), rejectionReason: 'not_datable' },
        { ...entry('trade-request', 'Trade request'), rejectionReason: null },
        { ...entry('public-feud', 'Public feud'), rejectionReason: null },
        { ...entry('coaching-change', 'Coaching change'), rejectionReason: null },
      ]);
    });

    it('[TAX-11] [CL-TAX-21] gives the classification the research types not validated by name and definition', async () => {
      expect(await doNotReproposeList(db, 'classification')).toStrictEqual([
        entry('locker-room-feud', 'Locker room feud'),
        entry('tattoo-reveal', 'Tattoo reveal'),
        entry('trade-request', 'Trade request'),
        entry('public-feud', 'Public feud'),
        entry('coaching-change', 'Coaching change'),
      ]);
    });

    it('[CL-TAX-21] lists the calendar-derived types handled by the calendar, whatever their state', async () => {
      expect(await handledByCalendarList(db)).toStrictEqual([
        {
          id: BIRTHDAY,
          name: "Player's birthday",
          definition: 'The player plays on his birthday.',
        },
        {
          id: 'former-team',
          name: 'First game against a former team',
          definition: 'The player meets a former team for the first time.',
        },
      ]);
    });
  });

  describe('resolveTypeId', () => {
    it('[TAX-11] [CL-IMP-22] resolves a validated type with its current version, compared without case, accents or outer spaces', async () => {
      const validated = { kind: 'validated', typeId: MEDIA_STORM, versionNumber: 2 };

      expect(await resolveTypeId(db, MEDIA_STORM)).toStrictEqual(validated);
      expect(await resolveTypeId(db, '  Média-STORM\t')).toStrictEqual(validated);
      expect(await resolveTypeId(db, 'media_storm')).toStrictEqual({ kind: 'unknown' });
      expect(await resolveTypeId(db, 'media  storm')).toStrictEqual({ kind: 'unknown' });
    });

    it('[TAX-28] resolves a merged type to the surviving type, at the end of a chain of merges', async () => {
      await insertEventType(db, {
        id: 'press-row',
        name: 'Press row',
        status: 'withdrawn',
        withdrawalReasonKind: 'merged_into',
        mergedIntoTypeId: 'public-feud',
      });
      const survivor = { id: MEDIA_STORM, name: 'Media storm' };

      expect(await resolveTypeId(db, 'Public-Feud')).toStrictEqual({
        kind: 'merged',
        typeId: 'public-feud',
        survivor,
      });
      expect(await resolveTypeId(db, 'press-row')).toStrictEqual({
        kind: 'merged',
        typeId: 'press-row',
        survivor,
      });
    });

    it('[TAX-30] resolves a split type to the types born of the split, for the owner to choose', async () => {
      expect(await resolveTypeId(db, 'coaching-change')).toStrictEqual({
        kind: 'split',
        typeId: 'coaching-change',
        into: [
          { id: 'coach-fired', name: 'Coach fired' },
          { id: 'coach-hired', name: 'Coach hired' },
        ],
      });
    });

    it('[TAX-31] resolves a type merged into a survivor withdrawn since as not validated to date', async () => {
      await withdraw(db, MEDIA_STORM, {
        withdrawalReasonKind: 'entered',
        withdrawalReason: 'Rare.',
      });

      expect(await resolveTypeId(db, MEDIA_STORM)).toStrictEqual({
        kind: 'not_validated',
        typeId: MEDIA_STORM,
      });
      expect(await resolveTypeId(db, 'public-feud')).toStrictEqual({
        kind: 'not_validated',
        typeId: 'public-feud',
      });
    });

    it('[TAX-28] [TAX-30] resolves a type merged into a survivor split since to the types born of that split', async () => {
      await withdraw(db, MEDIA_STORM, { withdrawalReasonKind: 'split_into' });
      await insertEventType(db, { ...stormA, splitFromTypeId: MEDIA_STORM, createdAt: dayOf(20) });
      await insertEventType(db, { ...stormB, splitFromTypeId: MEDIA_STORM, createdAt: dayOf(21) });

      expect(await resolveTypeId(db, 'public-feud')).toStrictEqual({
        kind: 'split',
        typeId: 'public-feud',
        into: [stormA, stormB],
      });
    });

    it('[TAX-30] [TAX-31] offers only the types born of a split that can still receive the event', async () => {
      await withdraw(db, 'coach-fired', {
        withdrawalReasonKind: 'entered',
        withdrawalReason: 'Rare.',
      });

      expect(await resolveTypeId(db, 'coaching-change')).toStrictEqual({
        kind: 'split',
        typeId: 'coaching-change',
        into: [{ id: 'coach-hired', name: 'Coach hired' }],
      });

      await withdraw(db, 'coach-hired', {
        withdrawalReasonKind: 'entered',
        withdrawalReason: 'Rare.',
      });

      expect(await resolveTypeId(db, 'coaching-change')).toStrictEqual({
        kind: 'not_validated',
        typeId: 'coaching-change',
      });
    });

    it('[TAX-28] [TAX-30] follows the later merges and splits of the types born of a split, each reached type once', async () => {
      const mediaStorm = { id: MEDIA_STORM, name: 'Media storm' };
      await withdraw(db, 'coach-fired', {
        withdrawalReasonKind: 'merged_into',
        mergedIntoTypeId: MEDIA_STORM,
      });
      await withdraw(db, 'coach-hired', { withdrawalReasonKind: 'split_into' });
      await insertEventType(db, {
        ...stormA,
        splitFromTypeId: 'coach-hired',
        createdAt: dayOf(20),
      });
      await insertEventType(db, {
        ...stormB,
        splitFromTypeId: 'coach-hired',
        createdAt: dayOf(21),
      });

      expect(await resolveTypeId(db, 'coaching-change')).toStrictEqual({
        kind: 'split',
        typeId: 'coaching-change',
        into: [mediaStorm, stormA, stormB],
      });

      await withdraw(db, stormA.id, {
        withdrawalReasonKind: 'merged_into',
        mergedIntoTypeId: MEDIA_STORM,
      });

      expect(await resolveTypeId(db, 'coaching-change')).toStrictEqual({
        kind: 'split',
        typeId: 'coaching-change',
        into: [mediaStorm, stormB],
      });
    });

    it('[TAX-28] throws, as a bug, on a chain of merges that leads back to one of its types', async () => {
      await withdraw(db, MEDIA_STORM, {
        withdrawalReasonKind: 'merged_into',
        mergedIntoTypeId: 'public-feud',
      });

      await expect(resolveTypeId(db, 'public-feud')).rejects.toThrow(
        'The merge and split links of the event types lead back to public-feud.',
      );
    });

    it('[TAX-30] throws, as a bug, on splits that lead back to a type already split on the way', async () => {
      await withdraw(db, 'coach-fired', { withdrawalReasonKind: 'split_into' });
      await db
        .update(eventTypes)
        .set({ splitFromTypeId: 'coach-fired' })
        .where(eq(eventTypes.id, 'coaching-change'));

      await expect(resolveTypeId(db, 'coaching-change')).rejects.toThrow(
        'The merge and split links of the event types lead back to coaching-change.',
      );
    });

    it('[TAX-28] [TAX-30] throws, as a bug, on a type born of a split merged back into the split type', async () => {
      await withdraw(db, 'coach-hired', {
        withdrawalReasonKind: 'merged_into',
        mergedIntoTypeId: 'coaching-change',
      });

      await expect(resolveTypeIds(db, ['coaching-change'])).rejects.toThrow(
        'The merge and split links of the event types lead back to coaching-change.',
      );
    });

    it('[TAX-28] [TAX-30] [CL-IMP-22] resolves several identifiers at once, each answer in the order of the identifiers', async () => {
      expect(
        await resolveTypeIds(db, [' Media-Storm', 'public-feud', 'courtside-proposal']),
      ).toStrictEqual([
        { kind: 'validated', typeId: MEDIA_STORM, versionNumber: 2 },
        {
          kind: 'merged',
          typeId: 'public-feud',
          survivor: { id: MEDIA_STORM, name: 'Media storm' },
        },
        { kind: 'unknown' },
      ]);
      expect(await resolveTypeIds(db, [])).toStrictEqual([]);
    });

    it.each(['locker-room-feud', 'tattoo-reveal', 'trade-request'])(
      '[TAX-11] resolves %s, proposed, rejected or withdrawn outside merge and split, as not validated to date',
      async (typeId) => {
        expect(await resolveTypeId(db, typeId)).toStrictEqual({ kind: 'not_validated', typeId });
      },
    );

    it.each([BIRTHDAY, 'former-team'])(
      '[TAX-11] [CL-IMP-29] resolves the calendar-derived %s as derived from the calendar, whatever its state',
      async (typeId) => {
        expect(await resolveTypeId(db, typeId)).toStrictEqual({ kind: 'calendar_derived', typeId });
      },
    );

    it('[TAX-11] gives an unknown identifier as unknown and creates no type', async () => {
      expect(await resolveTypeId(db, 'courtside-proposal')).toStrictEqual({ kind: 'unknown' });
      expect(await db.select().from(eventTypes)).toHaveLength(10);
    });
  });

  describe('listByStatus', () => {
    it('[TAX-10] [TAX-15] groups the types by state with their counts and origins, in the order of the taxonomy', async () => {
      const groups = await listByStatus(db);

      expect(groups.map(({ status, count }) => [status, count])).toStrictEqual([
        ['proposed', 2],
        ['validated', 4],
        ['rejected', 1],
        ['withdrawn', 3],
      ]);
      expect(groups[0]?.types).toStrictEqual([
        {
          ...listed('former-team', 'First game against a former team', 2),
          calendarDerivation: 'former_team',
        },
        { ...listed('locker-room-feud', 'Locker room feud', 3), origin: 'exploration' },
      ]);
      expect(groups[2]?.types).toStrictEqual([listed('tattoo-reveal', 'Tattoo reveal', 4)]);
    });

    it('[TAX-10] keeps a group for a state that no type is in', async () => {
      await db.delete(eventTypes).where(eq(eventTypes.status, 'rejected'));

      const groups = await listByStatus(db);

      expect(groups[2]).toStrictEqual({
        status: 'rejected',
        count: 0,
        types: [],
      });
    });
  });

  describe('sheetContent', () => {
    it('[TAX-20] [TAX-21] snapshots every field of the sheet, and neither the state nor the switched-off criterion', async () => {
      const [mediaStorm] = await db.select().from(eventTypes).where(eq(eventTypes.id, MEDIA_STORM));

      expect(mediaStorm && sheetContent(mediaStorm)).toStrictEqual({
        name: 'Media storm',
        definition: 'Wide coverage of one player by the press in a short time.',
        inclusionCriteria: 'Three outlets or more write about the player within two days.',
        exclusionCriteria: 'The routine coverage of a game.',
        datingRule: 'The day of the first article.',
        knownInAdvance: false,
        genericExample: 'A player leads every sports page for two days.',
        documentationDifficulty: 'medium',
        cautionNotes: null,
        isIntimateSubject: false,
        coverageThresholdOutlets: 3,
        coverageThresholdDays: 2,
      });
    });
  });
});

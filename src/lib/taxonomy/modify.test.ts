import { and, asc, eq, inArray } from 'drizzle-orm';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  calendarDerivationRequests,
  createTestDatabase,
  events,
  eventTypes,
  journalEntries,
  typeSheetChanges,
  typeSheetVersions,
} from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  insertEventType,
  insertPlayer,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { defaultQualification } from './modify';

import type { ModifiedSheet, Qualification, SheetModification } from './modify';
import type { SheetContent } from './queries';
import type { Database } from '@/lib/db';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const START = toEpochMs(Date.UTC(2026, 10, 26, 9, 0));
const PLAYER = leaguePlayerId('p01');
const OTHER_TYPE = 'locker-room-feud';
const FIRST_VERSION = 1;
const PROPERTY_RUNS = 25;

// The media storm as the factory validates it, in version 1.
const STORM_SHEET = {
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
  coverageThresholdOutlets: null,
  coverageThresholdDays: null,
} as const satisfies SheetContent;

// The media storm edited: its name and example reworded, its criterion narrowed.
const EDITED = {
  name: '  Press storm ',
  definition: STORM_SHEET.definition,
  inclusionCriteria: 'Four outlets or more write about the player within two days.',
  exclusionCriteria: STORM_SHEET.exclusionCriteria,
  datingRule: STORM_SHEET.datingRule,
  genericExample: 'A player leads every sports page for three days.',
  documentationDifficulty: 'hard',
  cautionNotes: 'Count each outlet once.',
  coverageThreshold: { outlets: 4, days: 2 },
} as const satisfies ModifiedSheet;

// The content that the edited sheet saves.
const EDITED_CONTENT = {
  ...STORM_SHEET,
  name: 'Press storm',
  inclusionCriteria: EDITED.inclusionCriteria,
  genericExample: EDITED.genericExample,
  documentationDifficulty: 'hard',
  cautionNotes: EDITED.cautionNotes,
  coverageThresholdOutlets: 4,
  coverageThresholdDays: 2,
} as const satisfies SheetContent;

// The fields of a sheet whose change alters no fact, drawn freely (TAX-22).
const FORMAL_FIELDS = fc.record({
  name: fc.string({ minLength: 1 }),
  genericExample: fc.string(),
  cautionNotes: fc.string(),
  documentationDifficulty: fc.constantFrom('easy', 'medium', 'hard'),
  knownInAdvance: fc.boolean(),
  isIntimateSubject: fc.boolean(),
});

// An event's links as a save that marks nothing leaves them.
const UNMARKED = { typeLinkMark: null, sheetVersionNumber: FIRST_VERSION, rowVersion: 1 } as const;

const NARROWS: Qualification = { kind: 'substantive', scope: 'narrows' };

/** The module under test, over a fresh fake of the runtime cache that the derivation's wake writes. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_taxonomy_modify');
  return import('./modify');
}

describe('the modification of a validated sheet', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let modify: Awaited<ReturnType<typeof load>>['modify'];

  beforeEach(async () => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    onTestFinished(installFakeClock(fixedClock(START)));
    ({ modify } = await load());
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(database.close);
    await insertPlayer(db);
    await insertEventType(db, { switchedOffCriterion: 'opponent_strength' });
    await insertEventType(db, { id: OTHER_TYPE, name: 'Locker room feud' });
  });

  /** Saves `change` of `typeId` in a transaction of its own, the edited sheet by default. */
  const save = async (typeId: string, change: Partial<SheetModification> = {}) =>
    db.transaction(async (tx) =>
      modify(tx, typeId, {
        sheet: EDITED,
        qualification: { kind: 'formal' },
        reason: '  A clearer sheet. ',
        expectedVersion: FIRST_VERSION,
        ...change,
      }),
    );

  const typeOf = async (typeId: string) => {
    const [row] = await db.select().from(eventTypes).where(eq(eventTypes.id, typeId));
    return row;
  };

  const versionsOf = async (typeId: string) =>
    db
      .select()
      .from(typeSheetVersions)
      .where(eq(typeSheetVersions.eventTypeId, typeId))
      .orderBy(asc(typeSheetVersions.versionNumber));

  const historyOf = async (typeId: string) =>
    db
      .select({
        changedAt: typeSheetChanges.changedAt,
        changeKind: typeSheetChanges.changeKind,
        substantiveScope: typeSheetChanges.substantiveScope,
        reason: typeSheetChanges.reason,
        contentBefore: typeSheetChanges.contentBefore,
        contentAfter: typeSheetChanges.contentAfter,
        resultingVersionNumber: typeSheetChanges.resultingVersionNumber,
      })
      .from(typeSheetChanges)
      .where(eq(typeSheetChanges.eventTypeId, typeId));

  const journaled = async (typeId: string) =>
    db
      .select({ messageKey: journalEntries.messageKey })
      .from(journalEntries)
      .where(
        and(
          inArray(journalEntries.messageKey, ['type_modified', 'type_modified_formally']),
          eq(journalEntries.eventTypeId, typeId),
        ),
      );

  const derivationRequests = async () =>
    db
      .select({
        kind: calendarDerivationRequests.kind,
        playerId: calendarDerivationRequests.playerId,
        eventTypeId: calendarDerivationRequests.eventTypeId,
        cause: calendarDerivationRequests.cause,
      })
      .from(calendarDerivationRequests);

  /** Writes an event of `typeId` under its first version, with the columns of `overrides`. */
  const eventOf = async (typeId: string, overrides: Partial<typeof events.$inferInsert> = {}) =>
    insertDetectedEvent(db, {
      playerId: PLAYER,
      overrides: { eventTypeId: typeId, sheetEventTypeId: typeId, ...overrides },
    });

  const linksOf = async (eventIds: readonly number[]) =>
    db
      .select({
        typeLinkMark: events.typeLinkMark,
        sheetVersionNumber: events.sheetVersionNumber,
        rowVersion: events.rowVersion,
      })
      .from(events)
      .where(inArray(events.id, [...eventIds]))
      .orderBy(asc(events.id));

  /** What the saves left for `typeId`: version numbers, history, journal, links of `eventIds`, derivation requests. */
  const writtenFor = async (typeId: string, eventIds: readonly number[]) => {
    const versions = await versionsOf(typeId);
    return {
      versions: versions.map((version) => version.versionNumber),
      history: await historyOf(typeId),
      journal: await journaled(typeId),
      links: await linksOf(eventIds),
      derivations: await derivationRequests(),
    };
  };

  it('[TAX-21] [TAX-22] rewrites the current content of a formal change under its version, with a history entry and a journal entry', async () => {
    const event = await eventOf(MEDIA_STORM);

    const saved = await save(MEDIA_STORM);

    const type = await typeOf(MEDIA_STORM);
    expect(saved).toStrictEqual({
      ok: true,
      value: { type, version: null, markedToRequalify: 0 },
    });
    expect(type).toMatchObject({
      ...EDITED_CONTENT,
      currentVersionNumber: FIRST_VERSION,
      switchedOffCriterion: 'opponent_strength',
      rowVersion: 2,
    });
    expect(await writtenFor(MEDIA_STORM, [event.id])).toStrictEqual({
      versions: [FIRST_VERSION],
      history: [
        {
          changedAt: new Date(START),
          changeKind: 'formal',
          substantiveScope: null,
          reason: 'A clearer sheet.',
          contentBefore: { ...STORM_SHEET, switchedOffCriterion: 'opponent_strength' },
          contentAfter: { ...EDITED_CONTENT, switchedOffCriterion: 'opponent_strength' },
          resultingVersionNumber: null,
        },
      ],
      journal: [{ messageKey: 'type_modified_formally' }],
      links: [UNMARKED],
      derivations: [],
    });
  });

  it('[TAX-21] [TAX-22] creates the next version of a substantive change, with its scope, and names it in the history entry', async () => {
    const saved = await save(MEDIA_STORM, { qualification: NARROWS });

    const versions = await versionsOf(MEDIA_STORM);
    const created = versions[1];
    expect(saved).toStrictEqual({
      ok: true,
      value: {
        type: await typeOf(MEDIA_STORM),
        version: { id: created?.id, versionNumber: 2 },
        markedToRequalify: 0,
      },
    });
    expect(created).toMatchObject({
      eventTypeId: MEDIA_STORM,
      versionNumber: 2,
      createdAt: new Date(START),
      kind: 'substantive_change',
      substantiveScope: 'narrows',
      mergeCoversUnion: null,
      isBroadening: false,
      reason: 'A clearer sheet.',
      content: EDITED_CONTENT,
      requalifiedConformingCount: 0,
      reassignedCount: 0,
      erasedCount: 0,
      supplementaryRequestsProposedCount: 0,
    });
    expect(await typeOf(MEDIA_STORM)).toMatchObject({ currentVersionNumber: 2 });
    expect(await writtenFor(MEDIA_STORM, [])).toStrictEqual({
      versions: [FIRST_VERSION, 2],
      history: [
        {
          changedAt: new Date(START),
          changeKind: 'substantive',
          substantiveScope: 'narrows',
          reason: 'A clearer sheet.',
          contentBefore: { ...STORM_SHEET, switchedOffCriterion: 'opponent_strength' },
          contentAfter: { ...EDITED_CONTENT, switchedOffCriterion: 'opponent_strength' },
          resultingVersionNumber: 2,
        },
      ],
      journal: [{ messageKey: 'type_modified' }],
      links: [],
      derivations: [],
    });
  });

  it.each([
    { scope: 'broadens', isBroadening: true, mark: null, markedToRequalify: 0 },
    { scope: 'narrows', isBroadening: false, mark: 'to_requalify', markedToRequalify: 2 },
    { scope: 'both', isBroadening: true, mark: 'to_requalify', markedToRequalify: 2 },
  ] as const)(
    '[TAX-24] [TAX-25] [CL-TAX-07] gives a change that $scope the type a broadening version: $isBroadening, and its earlier events the mark $mark',
    async ({ scope, isBroadening, mark, markedToRequalify }) => {
      const first = await eventOf(MEDIA_STORM);
      const second = await eventOf(MEDIA_STORM);
      const marked = await eventOf(MEDIA_STORM, { typeLinkMark: 'to_requalify' });
      const otherType = await eventOf(OTHER_TYPE);

      const saved = await save(MEDIA_STORM, { qualification: { kind: 'substantive', scope } });

      const versions = await versionsOf(MEDIA_STORM);
      expect(saved.ok && saved.value.markedToRequalify).toBe(markedToRequalify);
      expect(versions.map((version) => version.isBroadening)).toStrictEqual([false, isBroadening]);
      const rowVersion = mark === null ? 1 : 2;
      expect(await linksOf([first.id, second.id, marked.id, otherType.id])).toStrictEqual([
        { typeLinkMark: mark, sheetVersionNumber: FIRST_VERSION, rowVersion },
        { typeLinkMark: mark, sheetVersionNumber: FIRST_VERSION, rowVersion },
        { ...UNMARKED, typeLinkMark: 'to_requalify' },
        UNMARKED,
      ]);
    },
  );

  it('[CL-TAX-20] only rewrites the sheet of a calendar-derived type at a formal change', async () => {
    await insertCalendarType(db);
    const event = await eventOf(BIRTHDAY);

    const saved = await save(BIRTHDAY, { sheet: { ...EDITED, name: 'Birthday game' } });

    expect(saved.ok).toBe(true);
    expect(await writtenFor(BIRTHDAY, [event.id])).toMatchObject({
      versions: [FIRST_VERSION],
      journal: [{ messageKey: 'type_modified_formally' }],
      links: [UNMARKED],
      derivations: [],
    });
  });

  it('[CL-TAX-20] [CL-TAX-22] requests a full derivation for a substantive change of a calendar-derived type, which marks nothing and broadens no backtest', async () => {
    await insertCalendarType(db);
    const event = await eventOf(BIRTHDAY);
    const sheet = { ...EDITED, name: 'Birthday game', knownInAdvance: false };

    const saved = await save(BIRTHDAY, {
      sheet,
      qualification: { kind: 'substantive', scope: 'both' },
    });

    expect(saved.ok && saved.value.markedToRequalify).toBe(0);
    expect(await writtenFor(BIRTHDAY, [event.id])).toMatchObject({
      versions: [FIRST_VERSION, 2],
      journal: [{ messageKey: 'type_modified' }],
      links: [UNMARKED],
      derivations: [{ kind: 'full', playerId: null, eventTypeId: BIRTHDAY, cause: 'type_changed' }],
    });
    expect(await versionsOf(BIRTHDAY)).toMatchObject([
      { isBroadening: false },
      { substantiveScope: 'both', isBroadening: false },
    ]);
    expect(await typeOf(BIRTHDAY)).toMatchObject({
      knownInAdvance: true,
      calendarDerivation: 'birthday',
    });
  });

  it('[CL-TAX-20] never adds nor removes the "derived from the calendar" mark, whatever the sheet carries', async () => {
    await insertCalendarType(db);
    // A sheet holds no calendar mark: these carry one all the same, as a crafted request would.
    const withMark = { ...EDITED, calendarDerivation: 'former_team' };
    const withoutMark = { ...EDITED, calendarDerivation: null };
    const marked: ModifiedSheet = withMark;
    const unmarked: ModifiedSheet = withoutMark;

    await save(MEDIA_STORM, { sheet: marked });
    await save(BIRTHDAY, { sheet: unmarked });

    expect(await typeOf(MEDIA_STORM)).toMatchObject({ calendarDerivation: null });
    expect(await typeOf(BIRTHDAY)).toMatchObject({ calendarDerivation: 'birthday' });
  });

  it('[TAX-21] [CL-IHM-18] refuses a stale row version with the type as it stands, and writes nothing', async () => {
    const event = await eventOf(MEDIA_STORM);
    const current = await typeOf(MEDIA_STORM);

    const saved = await save(MEDIA_STORM, { qualification: NARROWS, expectedVersion: 7 });

    expect(saved).toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current },
    });
    expect(await typeOf(MEDIA_STORM)).toStrictEqual(current);
    expect(await writtenFor(MEDIA_STORM, [event.id])).toStrictEqual({
      versions: [FIRST_VERSION],
      history: [],
      journal: [],
      links: [UNMARKED],
      derivations: [],
    });
  });

  it('[TAX-21] accepts the changes of a validated sheet only', async () => {
    await insertEventType(db, { id: 'tattoo-reveal', name: 'Tattoo reveal', status: 'proposed' });

    expect(await save('tattoo-reveal')).toStrictEqual({
      ok: false,
      error: { kind: 'not_validated', status: 'proposed' },
    });
    expect(await save('unknown-type')).toStrictEqual({
      ok: false,
      error: { kind: 'no_longer_exists' },
    });
    expect(await historyOf('tattoo-reveal')).toStrictEqual([]);
  });

  it('[TAX-21] refuses a sheet left incomplete, a coverage threshold out of range and a blank reason, field by field', async () => {
    const before = await typeOf(MEDIA_STORM);
    const sheet: ModifiedSheet = {
      name: ' ',
      definition: '  ',
      inclusionCriteria: EDITED.inclusionCriteria,
      exclusionCriteria: EDITED.exclusionCriteria,
      datingRule: EDITED.datingRule,
      coverageThreshold: { outlets: 11, days: 2 },
    };

    const saved = await save(MEDIA_STORM, { sheet, reason: ' \n ' });

    expect(saved).toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_fields',
        fields: {
          name: 'required',
          coverageThreshold: 'out_of_range',
          definition: 'required',
          genericExample: 'required',
          documentationDifficulty: 'required',
          reason: 'required',
        },
      },
    });
    expect(await typeOf(MEDIA_STORM)).toStrictEqual(before);
    expect(await historyOf(MEDIA_STORM)).toStrictEqual([]);
  });
});

describe('defaultQualification', () => {
  const unchanged: ModifiedSheet = {
    name: STORM_SHEET.name,
    definition: STORM_SHEET.definition,
    inclusionCriteria: STORM_SHEET.inclusionCriteria,
    exclusionCriteria: STORM_SHEET.exclusionCriteria,
    datingRule: STORM_SHEET.datingRule,
    genericExample: STORM_SHEET.genericExample,
    documentationDifficulty: STORM_SHEET.documentationDifficulty,
  };

  it.each([
    { field: 'definition', after: { definition: 'Coverage of one player by every outlet.' } },
    { field: 'an inclusion criterion', after: { inclusionCriteria: 'Two outlets or more.' } },
    { field: 'an exclusion criterion', after: { exclusionCriteria: '' } },
    { field: 'dating rule', after: { datingRule: 'The day of the second article.' } },
    { field: 'coverage threshold', after: { coverageThreshold: { outlets: 3, days: 2 } } },
  ] as const)('[TAX-22] [H-TAX-08] proposes substantive when the $field changes', ({ after }) => {
    expect(defaultQualification({ before: STORM_SHEET, after: { ...unchanged, ...after } })).toBe(
      'substantive',
    );
  });

  it('[TAX-22] [H-TAX-08] proposes substantive when a coverage threshold changes its outlets or its window alone', () => {
    const before = { ...STORM_SHEET, coverageThresholdOutlets: 3, coverageThresholdDays: 2 };
    const withThreshold = (outlets: number, days: number) => ({
      before,
      after: { ...unchanged, coverageThreshold: { outlets, days } },
    });

    expect(defaultQualification(withThreshold(4, 2))).toBe('substantive');
    expect(defaultQualification(withThreshold(3, 5))).toBe('substantive');
    expect(defaultQualification(withThreshold(3, 2))).toBe('formal');
  });

  it('[TAX-22] [H-TAX-08] proposes formal when only the texts and marks that change no fact change, the defining texts compared as saved', () => {
    fc.assert(
      fc.property(FORMAL_FIELDS, (formalFields) => {
        const after = {
          ...unchanged,
          ...formalFields,
          definition: `  ${STORM_SHEET.definition}\n`,
        };

        expect(defaultQualification({ before: STORM_SHEET, after })).toBe('formal');
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

import { and, count, eq } from 'drizzle-orm';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  eventTypes,
  journalEntries,
  parameterOverrides,
  typeSheetVersions,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, insertCalendarType, insertEventType } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { createProposal, editProposal } from './proposals';
import { seedCandidateTypes } from './seed';

import type { ProposalOrigin, ProposalSheet } from './proposals';
import type { Database } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
const FIRST_VERSION = 1;
const IDENTIFIER_CHECK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LONGEST_IDENTIFIER = 50;
const PROPERTY_RUNS = 25;
// fast-check draws at most 10 units for a string unless it is given a size: this one reaches the 70 of the bound.
const LONG_NAMES = 'large';
// The longest slug before a suffix (CL-TAX-02): a name with more letters and digits is cut.
const MAX_SLUG_LENGTH = 40;
// Letters and digits in both cases, accents and compatibility forms, separators, and a character that has none.
const NAME_CHARACTERS = 'abAB09 -_éÉñß²ﬁ.!日'.split('');
// Mostly letters and digits, with the two separators: a name of 60 of them holds more than 40.
const LONG_NAME_CHARACTERS = 'aB0é²abcD9 -'.split('');
const CO_OCCURRING_PARAM = 'sensitivity.coOccurringCasesDoubtful';
// A name whose first 40 characters end a word: its identifier is cut there, not at 39.
const WORDS_ENDING_AT_FORTY = 'aaaaaaaaaa bbbbbbbbbb cccccccccc ddddddd eeee';
const NOT_OFFERED = {
  ok: false,
  error: { kind: 'invalid_fields', fields: { switchedOffCriterion: 'not_offered' } },
};

const FULL_SHEET = {
  name: 'Contract dispute',
  definition: 'A public dispute between a player and his club about his contract.',
  inclusionCriteria: 'The dispute is reported by at least two outlets.',
  exclusionCriteria: 'A routine negotiation that nobody reports.',
  datingRule: 'The day of the first report.',
  knownInAdvance: false,
  genericExample: 'A player refuses to report to camp.',
  cautionNotes: 'Rumors alone are not enough.',
  documentationDifficulty: 'hard',
  isIntimateSubject: true,
  coverageThreshold: { outlets: 4, days: 3 },
  switchedOffCriterion: 'opponent_strength',
} as const satisfies ProposalSheet;
const { coverageThreshold: FULL_THRESHOLD, ...FULL_TEXTS_AND_MARKS } = FULL_SHEET;

/** Creates the proposal `name` as `origin`, in a transaction of its own. */
async function propose(db: Database, name: string, origin: ProposalOrigin = 'exploration') {
  return db.transaction(async (tx) => createProposal(tx, origin, { name }));
}

/** The identifiers that two proposals of `name` get, and whether a refusal blames the name. */
async function twoProposals(db: Database, name: string) {
  const results = [await propose(db, name), await propose(db, name, 'detection')];
  return {
    ids: results.filter((result) => result.ok).map((result) => result.value.id),
    refusalsBlameTheName: results.every(
      (result) => result.ok || result.error.fields.name !== undefined,
    ),
  };
}

/** How many letters and digits `name` keeps once its accents are removed: a slug is at least that long. */
function lettersAndDigitsOf(name: string): number {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, '').length;
}

/** The identifiers that pass the check but are taken, or fail it; the good ones join `taken`. */
function identifierProblems(ids: readonly string[], taken: Set<string>): readonly string[] {
  const problems: string[] = [];
  for (const id of ids) {
    const isValid = IDENTIFIER_CHECK.test(id) && id.length <= LONGEST_IDENTIFIER;
    if (!isValid || id === 'merge' || id === 'explore' || taken.has(id)) {
      problems.push(id);
    }
    taken.add(id);
  }
  return problems;
}

/** What renaming `typeId` from `version` to `name` leaves: the next version, and every identifier then in the table. */
async function rename(
  db: Database,
  edit: Readonly<{ typeId: string; name: string; version: number }>,
) {
  const { typeId, name, version } = edit;
  const saved = await db.transaction(async (tx) =>
    editProposal(tx, typeId, { sheet: { name }, expectedVersion: version }),
  );
  const rows = await db.select({ id: eventTypes.id }).from(eventTypes);
  return {
    version: saved.ok ? version + 1 : version,
    ids: new Set([...(saved.ok ? [saved.value.id] : []), ...rows.map((row) => row.id)]),
  };
}

describe('the proposals of event types', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Creates a proposal, which the test expects to be accepted. */
  async function create(sheet: ProposalSheet, origin: ProposalOrigin = 'exploration') {
    const created = await db.transaction(async (tx) => createProposal(tx, origin, sheet));
    if (!created.ok) {
      throw new Error(`The proposal was refused: ${JSON.stringify(created.error)}`);
    }
    return created.value;
  }

  /** The identifiers of the proposals of `names`, made one after the other. */
  async function idsOf(names: readonly string[]) {
    let ids: readonly string[] = [];
    for (const name of names) {
      const { id } = await create({ name });
      ids = [...ids, id];
    }
    return ids;
  }

  const edit = async (typeId: string, sheet: ProposalSheet, expectedVersion = FIRST_VERSION) =>
    db.transaction(async (tx) => editProposal(tx, typeId, { sheet, expectedVersion }));

  const journaled = async (typeId: string) =>
    db
      .select({ messageKey: journalEntries.messageKey })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.messageKey, 'type_proposal_saved'),
          eq(journalEntries.eventTypeId, typeId),
        ),
      );

  const typeOf = async (typeId: string) => {
    const [row] = await db.select().from(eventTypes).where(eq(eventTypes.id, typeId));
    return row;
  };

  const versionCount = async () => db.select({ total: count() }).from(typeSheetVersions);

  const allowCoOccurring = async () =>
    db.insert(parameterOverrides).values({
      parameterKey: CO_OCCURRING_PARAM,
      value: true,
      changedAt: new Date(START),
    });

  describe('createProposal', () => {
    it.each([
      ['Contract dispute', 'contract-dispute'],
      ['Café brûlé à Zürich', 'cafe-brule-a-zurich'],
      ['  --Hello,   World!-- ', 'hello-world'],
      ['ﬁnal ² test', 'final-2-test'],
      ['Résumé of "10" games', 'resume-of-10-games'],
    ])('[TAX-02] [CL-TAX-02] gives the name "%s" the identifier %s', async (name, identifier) => {
      expect(await idsOf([name])).toStrictEqual([identifier]);
    });

    it('[TAX-02] [CL-TAX-02] cuts a long identifier at a hyphen to 40 characters at most', async () => {
      const ids = await idsOf([
        'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee',
        WORDS_ENDING_AT_FORTY,
        'x'.repeat(40),
        `${'y'.repeat(41)} z`,
        'w'.repeat(45),
      ]);

      expect(ids).toStrictEqual([
        'aaaaaaaaaa-bbbbbbbbbb-cccccccccc',
        'aaaaaaaaaa-bbbbbbbbbb-cccccccccc-ddddddd',
        'x'.repeat(40),
        'y'.repeat(40),
        'w'.repeat(40),
      ]);
    });

    it('[TAX-02] [CL-TAX-02] appends the smallest free suffix to an identifier that a type of any status holds', async () => {
      await insertEventType(db, { id: 'foo', name: 'Foo', status: 'proposed' });
      await insertEventType(db, { id: 'foo-3', name: 'Foo three' });

      expect(await idsOf(['Foo', 'Foo', 'FOO'])).toStrictEqual(['foo-2', 'foo-4', 'foo-5']);
    });

    it('[TAX-02] [CL-TAX-02] appends the suffix after the cut, to an identifier cut at forty characters that is held', async () => {
      expect(await idsOf([WORDS_ENDING_AT_FORTY, WORDS_ENDING_AT_FORTY])).toStrictEqual([
        'aaaaaaaaaa-bbbbbbbbbb-cccccccccc-ddddddd',
        'aaaaaaaaaa-bbbbbbbbbb-cccccccccc-ddddddd-2',
      ]);
    });

    it('[TAX-02] [TAX-15] [CL-TAX-02] never gives the identifier of a seeded candidate type', async () => {
      await seedCandidateTypes(db, START);

      expect(await idsOf(['Media storm', 'Player’s birthday', 'Bereavement'])).toStrictEqual([
        'media-storm-2',
        'player-s-birthday',
        'bereavement-2',
      ]);
    });

    it.each([
      ['Merge', 'merge-2'],
      ['EXPLORE', 'explore-2'],
      ['Explore!', 'explore-2'],
      ['Merge it', 'merge-it'],
    ])(
      '[CA-TAX-05] [CL-TAX-02] gives the name "%s" the identifier %s, the fixed segments under /types being taken',
      async (name, identifier) => {
        expect(await idsOf([name])).toStrictEqual([identifier]);
      },
    );

    it('[CA-TAX-05] [TAX-02] gives a new proposal of a rejected type’s name another identifier, the rejected one staying its own', async () => {
      await insertEventType(db, {
        id: 'media-storm',
        status: 'rejected',
        rejectionReason: 'not_clean',
      });

      expect(await idsOf(['Media storm', 'Media storm'])).toStrictEqual([
        'media-storm-2',
        'media-storm-3',
      ]);
      expect(await typeOf('media-storm')).toMatchObject({
        status: 'rejected',
        rejectionReason: 'not_clean',
      });
    });

    it.each(['日本語', '---', '😀'])(
      '[TAX-02] [CL-TAX-02] refuses the name %s, which has no letter or digit to build an identifier from',
      async (name) => {
        expect(await propose(db, name)).toStrictEqual({
          ok: false,
          error: { kind: 'invalid_fields', fields: { name: 'no_letters_or_digits' } },
        });
      },
    );

    it.each(['', ' '.repeat(3), '\t\n', '\u{85}', '\u{3000} \u{FEFF}'])(
      '[TAX-01] requires a name: %j is refused and nothing is saved',
      async (name) => {
        expect(await propose(db, name)).toStrictEqual({
          ok: false,
          error: { kind: 'invalid_fields', fields: { name: 'required' } },
        });
        expect(await db.select().from(eventTypes)).toStrictEqual([]);
      },
    );

    it('[TAX-01] [CL-TAX-14] [CL-TAX-17] holds every element of the sheet, its origin and its creation date', async () => {
      const created = await create(FULL_SHEET, 'detection');

      expect(created).toMatchObject({
        id: 'contract-dispute',
        status: 'proposed',
        origin: 'detection',
        createdAt: new Date(START),
        ...FULL_TEXTS_AND_MARKS,
        coverageThresholdOutlets: FULL_THRESHOLD.outlets,
        coverageThresholdDays: FULL_THRESHOLD.days,
        calendarDerivation: null,
        currentVersionNumber: null,
        rowVersion: FIRST_VERSION,
      });
      expect(await typeOf('contract-dispute')).toStrictEqual(created);
    });

    it('[TAX-01] [CL-TAX-14] [CL-TAX-17] creates an incomplete proposal from its name alone, the optional elements empty', async () => {
      const created = await create({
        name: '  Locker room feud  ',
        definition: ' \n ',
        datingRule: ' The day. ',
      });

      expect(created).toMatchObject({
        id: 'locker-room-feud',
        name: 'Locker room feud',
        status: 'proposed',
        origin: 'exploration',
        createdAt: new Date(START),
        definition: null,
        inclusionCriteria: null,
        exclusionCriteria: null,
        datingRule: 'The day.',
        knownInAdvance: false,
        genericExample: null,
        cautionNotes: null,
        documentationDifficulty: null,
        isIntimateSubject: false,
        coverageThresholdOutlets: null,
        coverageThresholdDays: null,
        switchedOffCriterion: null,
      });
    });

    it('[TAX-01] [CL-TAX-20] never sets the calendar derivation, whatever the input says', async () => {
      const created = await create({
        name: 'Fake birthday',
        knownInAdvance: true,
        // @ts-expect-error the sheet of a proposal has no calendar derivation to give
        calendarDerivation: 'birthday',
      });

      expect([created.calendarDerivation, created.knownInAdvance]).toStrictEqual([null, true]);
    });

    it.each([
      [{ outlets: 1, days: 3 }],
      [{ outlets: 11, days: 3 }],
      [{ outlets: 3, days: 0 }],
      [{ outlets: 3, days: 8 }],
      [{ outlets: 2.5, days: 3 }],
      [{ outlets: 3, days: 1.5 }],
    ])('[CL-TAX-14] refuses the coverage threshold %j', async (coverageThreshold) => {
      const created = await db.transaction(async (tx) =>
        createProposal(tx, 'exploration', { name: 'Storm', coverageThreshold }),
      );

      expect(created).toStrictEqual({
        ok: false,
        error: { kind: 'invalid_fields', fields: { coverageThreshold: 'out_of_range' } },
      });
    });

    it.each([[{ outlets: 2, days: 1 }], [{ outlets: 10, days: 7 }]])(
      '[CL-TAX-14] accepts the coverage threshold %j, its bounds included',
      async (coverageThreshold) => {
        const created = await create({ name: 'Storm', coverageThreshold });

        expect([created.coverageThresholdOutlets, created.coverageThresholdDays]).toStrictEqual([
          coverageThreshold.outlets,
          coverageThreshold.days,
        ]);
      },
    );

    it('[CL-TAX-17] offers co-occurring cases as the switched-off criterion only while their parameter is on', async () => {
      const sheet = { name: 'Pair', switchedOffCriterion: 'co_occurring' } as const;
      const refused = await db.transaction(async (tx) => createProposal(tx, 'exploration', sheet));
      await allowCoOccurring();

      expect(refused).toStrictEqual(NOT_OFFERED);
      expect(await create(sheet)).toMatchObject({ switchedOffCriterion: 'co_occurring' });
    });

    it('[TAX-01] [TAX-20] journals the save and creates no version of the sheet', async () => {
      const created = await create(FULL_SHEET);

      expect(await journaled(created.id)).toStrictEqual([{ messageKey: 'type_proposal_saved' }]);
      expect(await versionCount()).toStrictEqual([{ total: 0 }]);
    });

    it('[TAX-02] [CL-TAX-02] always gives an identifier that passes the check, and never one in use, even for a name taken twice', async () => {
      await seedCandidateTypes(db, START);
      const seeded = await db.select({ id: eventTypes.id }).from(eventTypes);
      const seen = new Set(seeded.map(({ id }) => id));
      const unit = fc.constantFrom(...NAME_CHARACTERS);
      // Half the names are long and mostly letters, so that most runs go past the cut for certain.
      const longUnit = fc.constantFrom(...LONG_NAME_CHARACTERS);
      const names = fc.oneof(
        fc.string({ unit, maxLength: 70, size: LONG_NAMES }),
        fc.string({ unit: longUnit, minLength: 60, maxLength: 70 }),
      );
      let namesPastTheCut = 0;

      await fc.assert(
        fc.asyncProperty(names, async (name) => {
          const { ids, refusalsBlameTheName } = await twoProposals(db, name);
          namesPastTheCut += lettersAndDigitsOf(name) > MAX_SLUG_LENGTH ? 1 : 0;

          expect(refusalsBlameTheName).toBe(true);
          expect(identifierProblems(ids, seen)).toStrictEqual([]);
        }),
        { numRuns: PROPERTY_RUNS * 2 },
      );

      // Without this, a property that never draws a name past the cut would pass whatever the cut does.
      expect(namesPastTheCut).toBeGreaterThan(0);
    });
  });

  describe('editProposal', () => {
    it('[TAX-20] [TAX-01] changes the sheet of a proposal, its identifier, origin and creation date staying, and creates no version', async () => {
      const created = await create({ name: 'Contract dispute' }, 'detection');

      const saved = await edit(created.id, {
        ...FULL_SHEET,
        name: 'Contract standoff',
        coverageThreshold: { outlets: 5, days: 2 },
      });

      expect(saved).toMatchObject({
        ok: true,
        value: {
          ...FULL_TEXTS_AND_MARKS,
          id: 'contract-dispute',
          status: 'proposed',
          origin: 'detection',
          createdAt: created.createdAt,
          name: 'Contract standoff',
          coverageThresholdOutlets: 5,
          coverageThresholdDays: 2,
          currentVersionNumber: null,
          rowVersion: FIRST_VERSION + 1,
        },
      });
      expect(await typeOf(created.id)).toStrictEqual(saved.ok ? saved.value : undefined);
      expect(await versionCount()).toStrictEqual([{ total: 0 }]);
    });

    it('[TAX-20] empties what the edit leaves out, since it carries the whole sheet', async () => {
      const created = await create(FULL_SHEET);

      const saved = await edit(created.id, { name: 'Contract dispute' });

      expect(saved).toMatchObject({
        ok: true,
        value: {
          definition: null,
          inclusionCriteria: null,
          cautionNotes: null,
          documentationDifficulty: null,
          isIntimateSubject: false,
          coverageThresholdOutlets: null,
          switchedOffCriterion: null,
        },
      });
    });

    it('[TAX-20] journals every save', async () => {
      const created = await create({ name: 'Contract dispute' });
      await edit(created.id, { name: 'Contract dispute', definition: 'A dispute.' });
      await edit(created.id, { name: 'Contract dispute', definition: 'A public dispute.' }, 2);

      expect(await journaled(created.id)).toHaveLength(3);
    });

    it('[TAX-02] [TAX-20] keeps the identifier when the name changes, and gives it to no new proposal', async () => {
      const created = await create({ name: 'Contract dispute' });
      await edit(created.id, { name: 'Holdout' });

      expect(await idsOf(['Contract dispute', 'Holdout'])).toStrictEqual([
        'contract-dispute-2',
        'holdout',
      ]);
      expect(await typeOf(created.id)).toMatchObject({ name: 'Holdout' });
    });

    it('[TAX-02] [CL-TAX-02] never changes the identifier of a proposal whatever its name becomes', async () => {
      const { id } = await create({ name: 'Contract dispute' });
      let version = FIRST_VERSION;

      await fc.assert(
        fc.asyncProperty(fc.string({ maxLength: 60, size: LONG_NAMES }), async (name) => {
          const outcome = await rename(db, { typeId: id, name, version });
          version = outcome.version;

          expect(outcome.ids).toStrictEqual(new Set([id]));
        }),
        { numRuns: PROPERTY_RUNS },
      );
    });

    it('[TAX-02] accepts a name without a letter or a digit, the identifier being given already', async () => {
      const created = await create({ name: 'Contract dispute' });

      expect(await edit(created.id, { name: '日本語' })).toMatchObject({
        ok: true,
        value: { id: 'contract-dispute', name: '日本語' },
      });
    });

    it('[TAX-01] refuses the fields to fix, field by field, and saves nothing', async () => {
      const created = await create({ name: 'Contract dispute' });

      const refused = await edit(created.id, {
        name: '',
        coverageThreshold: { outlets: 11, days: 1 },
      });

      expect(refused).toStrictEqual({
        ok: false,
        error: {
          kind: 'invalid_fields',
          fields: { name: 'required', coverageThreshold: 'out_of_range' },
        },
      });
      expect(await typeOf(created.id)).toStrictEqual(created);
    });

    it('[CL-IHM-18] [TAX-20] refuses a save made from an older version, and shows the proposal as it now stands', async () => {
      const created = await create({ name: 'Contract dispute' });
      await edit(created.id, { name: 'Holdout' });

      const stale = await edit(created.id, { name: 'Walkout' });

      expect(stale).toMatchObject({
        ok: false,
        error: {
          kind: 'changed_elsewhere',
          current: { id: 'contract-dispute', name: 'Holdout', rowVersion: FIRST_VERSION + 1 },
        },
      });
      expect(await typeOf(created.id)).toMatchObject({ name: 'Holdout' });
    });

    it('[CL-IHM-19] [TAX-20] refuses an edit of a type that no longer exists', async () => {
      expect(await edit('no-such-type', { name: 'Anything' })).toStrictEqual({
        ok: false,
        error: { kind: 'no_longer_exists' },
      });
    });

    it.each([
      ['validated', {}],
      ['withdrawn', { withdrawalReasonKind: 'entered', withdrawalReason: 'No longer wanted.' }],
      ['rejected', { rejectionReason: 'out_of_scope' }],
    ] as const)(
      '[TAX-20] changes a proposed type only: a %s one is refused',
      async (status, columns) => {
        const type = await insertEventType(db, { id: 'old-type', status, ...columns });

        const refused = await edit(type.id, { name: 'Renamed' });

        expect(refused).toStrictEqual({ ok: false, error: { kind: 'not_proposed', status } });
        expect(await typeOf(type.id)).toStrictEqual(type);
        expect(await journaled(type.id)).toStrictEqual([]);
      },
    );

    it('[CL-TAX-20] [TAX-15] edits a seeded calendar-derived proposal, which keeps its mark and its known-in-advance flag', async () => {
      const birthday = await insertCalendarType(db, { status: 'proposed' });

      const saved = await edit(birthday.id, {
        name: 'Birthday game',
        datingRule: 'The day of the birthday game.',
        knownInAdvance: false,
      });

      expect(saved).toMatchObject({
        ok: true,
        value: {
          id: 'birthday',
          name: 'Birthday game',
          datingRule: 'The day of the birthday game.',
          calendarDerivation: 'birthday',
          knownInAdvance: true,
        },
      });
    });

    it('[CL-TAX-17] keeps co-occurring cases switched off when the parameter was turned off since, and refuses to switch them off anew', async () => {
      await allowCoOccurring();
      const held = await create({ name: 'Pair', switchedOffCriterion: 'co_occurring' });
      const other = await create({ name: 'Other pair' });
      await db
        .delete(parameterOverrides)
        .where(eq(parameterOverrides.parameterKey, CO_OCCURRING_PARAM));
      const coOccurring = { switchedOffCriterion: 'co_occurring' } as const;

      const kept = await edit(held.id, { name: 'Pair', ...coOccurring });
      const refused = await edit(other.id, { name: 'Other pair', ...coOccurring });

      expect(kept).toMatchObject({ ok: true, value: coOccurring });
      expect(refused).toStrictEqual(NOT_OFFERED);
    });
  });
});

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { eventTypes, eventTypeStatusChanges } from './taxonomy';

import type { Database } from '../types';

// The tables of event-types.md that hold a type and its status history.
const TABLES = ['event_type_status_changes', 'event_types'];

// Their columns, table by table and each table's in the order of event-types.md, with
// the type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'event_type_status_changes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'event_type_status_changes.event_type_id text NOT NULL',
  'event_type_status_changes.changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'event_type_status_changes.from_status text',
  'event_type_status_changes.to_status text NOT NULL',
  'event_types.id text NOT NULL',
  "event_types.status text NOT NULL DEFAULT 'proposed'::text",
  'event_types.origin text NOT NULL',
  'event_types.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'event_types.name text NOT NULL',
  'event_types.definition text',
  'event_types.inclusion_criteria text',
  'event_types.exclusion_criteria text',
  'event_types.dating_rule text',
  'event_types.known_in_advance boolean NOT NULL DEFAULT false',
  'event_types.calendar_derivation text',
  'event_types.generic_example text',
  'event_types.documentation_difficulty text',
  'event_types.caution_notes text',
  'event_types.is_intimate_subject boolean NOT NULL DEFAULT false',
  'event_types.coverage_threshold_outlets smallint',
  'event_types.coverage_threshold_days smallint',
  'event_types.switched_off_criterion text',
  'event_types.current_version_number smallint',
  'event_types.rejection_reason text',
  'event_types.rejection_comment text',
  'event_types.withdrawal_reason_kind text',
  'event_types.withdrawal_reason text',
  'event_types.merged_into_type_id text',
  'event_types.split_from_type_id text',
  'event_types.no_fit_reason text',
  'event_types.row_version integer NOT NULL DEFAULT 1',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX event_type_status_changes_pkey ON public.event_type_status_changes USING btree (id)',
  'CREATE INDEX event_type_status_changes_type_idx ON public.event_type_status_changes USING btree (event_type_id, changed_at)',
  'CREATE UNIQUE INDEX event_types_pkey ON public.event_types USING btree (id)',
];

// Their references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'event_type_status_changes FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'event_types FOREIGN KEY (merged_into_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'event_types FOREIGN KEY (split_from_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
];

// A proposal of the scoping, with the items of its sheet that a validation requires.
const PROPOSAL = { id: 'media-storm', origin: 'scoping', name: 'Media storm' } as const;
const SHEET = {
  definition: 'Wide coverage of one player in a short time.',
  inclusionCriteria: 'Three outlets within two days.',
  exclusionCriteria: 'The routine coverage of a game.',
  datingRule: 'The day of the first article.',
  genericExample: 'A player leads every sports page for two days.',
  documentationDifficulty: 'medium',
} as const;
const VALIDATED = { ...PROPOSAL, ...SHEET, status: 'validated', currentVersionNumber: 1 } as const;
const WITHDRAWN = { ...VALIDATED, status: 'withdrawn' } as const;
// A type withdrawn by the owner's reason, its text, and one withdrawn by a split.
const ENTERED = { ...WITHDRAWN, withdrawalReasonKind: 'entered' } as const;
const REASON = { withdrawalReason: 'No longer studied.' } as const;
const SPLIT = { ...WITHDRAWN, withdrawalReasonKind: 'split_into' } as const;
const REJECTED = { ...PROPOSAL, status: 'rejected', rejectionReason: 'other' } as const;
// The surviving type of a merge.
const MERGED = { mergedIntoTypeId: 'media-storm' } as const;
// A coverage threshold of 3 outlets within 2 days (CL-TAX-14).
const THRESHOLD = { coverageThresholdOutlets: 3, coverageThresholdDays: 2 } as const;
// The calendar-derived mark of a type known in advance (ADR 0015).
const DERIVED = { calendarDerivation: 'birthday', knownInAdvance: true } as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

/** The error of a query that a foreign key refused. */
const referenceOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23503', constraint },
});

/** The error of a deletion that an ON DELETE RESTRICT foreign key refused. */
const restrictionOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23001', constraint },
});

describe('the event-type tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that event-types.md gives its tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[CL-TAX-02] keys a proposal by a kebab-case slug of at most 50 characters, with the defaults of the model', async () => {
    const slugs = ['media-storm', 'former-team', 'merge-2', '3-point-record', 'a'.repeat(50)];
    await db.insert(eventTypes).values(slugs.map((id) => ({ ...PROPOSAL, id })));

    const [first] = await db.select().from(eventTypes);

    await expect(db.select({ id: eventTypes.id }).from(eventTypes)).resolves.toHaveLength(5);
    expect(first).toMatchObject({ ...PROPOSAL, status: 'proposed', knownInAdvance: false });
    expect(first).toMatchObject({ isIntimateSubject: false, definition: null, rowVersion: 1 });
  });

  it.each([
    'Media-storm',
    'media_storm',
    '-media',
    'media-',
    'media--storm',
    'tête',
    '',
    'a'.repeat(51),
  ])('[CL-TAX-02] refuses the type identifier "%s"', async (id) => {
    const insert = db.insert(eventTypes).values({ ...PROPOSAL, id });

    await expect(insert).rejects.toMatchObject(violationOf('event_types_id_check'));
  });

  it('[CL-TAX-02] never issues a type identifier twice, nor changes or frees it while history names it', async () => {
    await db.insert(eventTypes).values(PROPOSAL);
    await db
      .insert(eventTypeStatusChanges)
      .values({ eventTypeId: PROPOSAL.id, fromStatus: 'proposed', toStatus: 'rejected' });
    const history = 'event_type_status_changes_event_type_id_event_types_id_fk';

    const again = db.insert(eventTypes).values({ ...PROPOSAL, name: 'Media frenzy' });
    const changed = db
      .update(eventTypes)
      .set({ id: 'frenzy' })
      .where(eq(eventTypes.id, PROPOSAL.id));
    const freed = db.delete(eventTypes).where(eq(eventTypes.id, PROPOSAL.id));

    await expect(again).rejects.toMatchObject(duplicateOf('event_types_pkey'));
    await expect(changed).rejects.toMatchObject(referenceOf(history));
    await expect(freed).rejects.toMatchObject(restrictionOf(history));
  });

  // Each type breaks one value check of event_types, named after its column.
  it.each([
    ['a status', { status: OUTSIDE }, 'status'],
    ['an origin', { origin: OUTSIDE }, 'origin'],
    ['a calendar mark', { ...DERIVED, calendarDerivation: OUTSIDE }, 'calendar_derivation'],
    ['a difficulty', { documentationDifficulty: OUTSIDE }, 'documentation_difficulty'],
    ['a switched-off criterion', { switchedOffCriterion: OUTSIDE }, 'switched_off_criterion'],
    ['a rejection reason', { ...REJECTED, rejectionReason: OUTSIDE }, 'rejection_reason'],
    [
      'a withdrawal reason',
      { ...WITHDRAWN, withdrawalReasonKind: OUTSIDE },
      'withdrawal_reason_kind',
    ],
  ] as const)(
    'refuses a type with %s that the glossary does not list',
    async (_set, change, column) => {
      const insert = db.insert(eventTypes).values({ ...PROPOSAL, ...change });

      await expect(insert).rejects.toMatchObject(violationOf(`event_types_${column}_check`));
    },
  );

  it.each([
    ['a blank name', { name: ' ' }, 'name'],
    [
      'a threshold of 1 outlet',
      { ...THRESHOLD, coverageThresholdOutlets: 1 },
      'coverage_threshold_outlets',
    ],
    [
      'a threshold of 11 outlets',
      { ...THRESHOLD, coverageThresholdOutlets: 11 },
      'coverage_threshold_outlets',
    ],
    [
      'a threshold of 0 days',
      { ...THRESHOLD, coverageThresholdDays: 0 },
      'coverage_threshold_days',
    ],
    [
      'a threshold of 8 days',
      { ...THRESHOLD, coverageThresholdDays: 8 },
      'coverage_threshold_days',
    ],
    ['a version 0', { currentVersionNumber: 0 }, 'current_version_number'],
  ] as const)('refuses a type with %s', async (_value, change, column) => {
    const insert = db.insert(eventTypes).values({ ...PROPOSAL, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`event_types_${column}_check`));
  });

  it('accepts every value of the glossary on a type, and each state its checks allow', async () => {
    const reasons = [
      'not_clean',
      'not_datable',
      'duplicate_of_existing_type',
      'out_of_scope',
    ] as const;
    await db.insert(eventTypes).values([
      { ...PROPOSAL, ...DERIVED, id: 'birthday', switchedOffCriterion: 'playing_time_too_low' },
      { ...PROPOSAL, ...DERIVED, id: 'former-team', calendarDerivation: 'former_team' },
      { ...PROPOSAL, id: 'a', origin: 'exploration', switchedOffCriterion: 'injury_return' },
      { ...PROPOSAL, origin: 'detection', noFitReason: 'None fits.' },
      {
        ...PROPOSAL,
        id: 'b',
        documentationDifficulty: 'easy',
        switchedOffCriterion: 'co_occurring',
      },
      {
        ...PROPOSAL,
        id: 'c',
        documentationDifficulty: 'hard',
        switchedOffCriterion: 'unusual_stakes',
      },
      { ...PROPOSAL, id: 'd', switchedOffCriterion: 'opponent_strength' },
      { ...PROPOSAL, id: 'e', coverageThresholdOutlets: 2, coverageThresholdDays: 1 },
      { ...PROPOSAL, id: 'f', coverageThresholdOutlets: 10, coverageThresholdDays: 7 },
      { ...REJECTED, id: 'g', rejectionComment: 'Too vague.' },
      ...reasons.map((rejectionReason) => ({
        ...REJECTED,
        id: rejectionReason.replaceAll('_', '-'),
        rejectionReason,
      })),
      { ...WITHDRAWN, ...MERGED, id: 'h', withdrawalReasonKind: 'merged_into' },
      { ...ENTERED, ...REASON, id: 'i' },
      { ...SPLIT, id: 'j' },
    ]);

    await expect(db.select().from(eventTypes)).resolves.toHaveLength(17);
  });

  // A validated or withdrawn type has its sheet complete: each type lacks one item.
  it.each([
    ['validated type', 'version number', { ...VALIDATED, currentVersionNumber: null }],
    ['validated type', 'definition', { ...VALIDATED, definition: null }],
    ['validated type', 'inclusion criteria', { ...VALIDATED, inclusionCriteria: null }],
    ['validated type', 'exclusion criteria', { ...VALIDATED, exclusionCriteria: null }],
    ['validated type', 'dating rule', { ...VALIDATED, datingRule: null }],
    ['validated type', 'generic example', { ...VALIDATED, genericExample: null }],
    ['validated type', 'difficulty', { ...VALIDATED, documentationDifficulty: null }],
    ['withdrawn type', 'definition', { ...SPLIT, definition: null }],
  ] as const)('refuses a %s without its %s', async (_status, _item, type) => {
    const insert = db.insert(eventTypes).values(type);

    await expect(insert).rejects.toMatchObject(violationOf('event_types_complete_sheet_check'));
  });

  // Each type breaks one clause of one row check of event_types.
  it.each([
    ['rejected without a reason', { status: 'rejected' }, 'rejected'],
    ['proposed with a rejection reason', { rejectionReason: 'other' }, 'rejected'],
    ['commented but not rejected', { rejectionComment: 'Too vague.' }, 'commented_rejection'],
    ['withdrawn without a reason', WITHDRAWN, 'withdrawn'],
    ['validated with a withdrawal reason', { ...SPLIT, status: 'validated' }, 'withdrawn'],
    ['merged for an entered reason', { ...ENTERED, ...REASON, ...MERGED }, 'merged_into'],
    ['merged by a split', { ...SPLIT, ...MERGED }, 'merged_into'],
    ['withdrawn for a reason without its text', ENTERED, 'entered_reason'],
    [
      'merged with a text',
      { ...SPLIT, withdrawalReasonKind: 'merged_into', ...REASON },
      'entered_reason',
    ],
    ['with a threshold in outlets only', { coverageThresholdOutlets: 3 }, 'coverage_threshold'],
    ['with a threshold in days only', { coverageThresholdDays: 2 }, 'coverage_threshold'],
    [
      'of the calendar born of an exploration',
      { ...DERIVED, origin: 'exploration' },
      'calendar_derived',
    ],
    [
      'of the calendar not known in advance',
      { ...DERIVED, knownInAdvance: false },
      'calendar_derived',
    ],
    ['of the scoping saying no type fits', { noFitReason: 'None fits.' }, 'detection_proposal'],
  ] as const)('refuses a type %s', async (_type, change, check) => {
    await db.insert(eventTypes).values(VALIDATED);

    const insert = db.insert(eventTypes).values({ ...PROPOSAL, ...change, id: 'record-approach' });

    await expect(insert).rejects.toMatchObject(violationOf(`event_types_${check}_check`));
  });

  it('records the five transitions of a type, each dated', async () => {
    await db.insert(eventTypes).values(PROPOSAL);
    const transitions = [
      { fromStatus: 'proposed', toStatus: 'rejected' },
      { fromStatus: 'rejected', toStatus: 'proposed' },
      { fromStatus: 'proposed', toStatus: 'validated' },
      { fromStatus: 'validated', toStatus: 'withdrawn' },
      { fromStatus: 'withdrawn', toStatus: 'validated' },
    ] as const;
    const type = { eventTypeId: PROPOSAL.id } as const;
    await db
      .insert(eventTypeStatusChanges)
      .values(transitions.map((pair) => ({ ...type, ...pair })));

    const stored = await db
      .select({
        fromStatus: eventTypeStatusChanges.fromStatus,
        toStatus: eventTypeStatusChanges.toStatus,
      })
      .from(eventTypeStatusChanges)
      .orderBy(eventTypeStatusChanges.id);

    expect(stored).toStrictEqual(transitions);
  });

  it.each([
    ['proposed', 'proposed'],
    ['proposed', 'withdrawn'],
    ['validated', 'validated'],
    ['validated', 'proposed'],
    ['validated', 'rejected'],
    ['rejected', 'rejected'],
    ['rejected', 'validated'],
    ['rejected', 'withdrawn'],
    ['withdrawn', 'withdrawn'],
    ['withdrawn', 'proposed'],
    ['withdrawn', 'rejected'],
  ] as const)(
    'refuses a type status change from %s to %s, which is no transition',
    async (fromStatus, toStatus) => {
      await db.insert(eventTypes).values(PROPOSAL);

      const insert = db
        .insert(eventTypeStatusChanges)
        .values({ eventTypeId: PROPOSAL.id, fromStatus, toStatus });

      await expect(insert).rejects.toMatchObject(
        violationOf('event_type_status_changes_transition_check'),
      );
    },
  );

  it('refuses a type status change from or to a status that the glossary does not list', async () => {
    await db.insert(eventTypes).values(PROPOSAL);
    const type = { eventTypeId: PROPOSAL.id } as const;

    const from = db
      .insert(eventTypeStatusChanges)
      .values({ ...type, fromStatus: OUTSIDE, toStatus: 'validated' });
    const to = db
      .insert(eventTypeStatusChanges)
      .values({ ...type, fromStatus: 'proposed', toStatus: OUTSIDE });

    await expect(from).rejects.toMatchObject(
      violationOf('event_type_status_changes_from_status_check'),
    );
    await expect(to).rejects.toMatchObject(
      violationOf('event_type_status_changes_to_status_check'),
    );
  });

  it('gives a type born of a split the origin of its parent, and a birth from none to validated', async () => {
    const child = { ...VALIDATED, id: 'online-storm', splitFromTypeId: 'media-storm' } as const;
    await db.insert(eventTypes).values([SPLIT, child]);
    await db
      .insert(eventTypeStatusChanges)
      .values({ eventTypeId: child.id, toStatus: 'validated' });

    const proposed = db
      .insert(eventTypeStatusChanges)
      .values({ eventTypeId: child.id, toStatus: 'proposed' });
    const ownOrigin = db
      .insert(eventTypes)
      .values({ ...child, id: 'print-storm', origin: sql`'split'` });

    await expect(
      db.select({ origin: eventTypes.origin }).from(eventTypes).where(eq(eventTypes.id, child.id)),
    ).resolves.toStrictEqual([{ origin: 'scoping' }]);
    await expect(proposed).rejects.toMatchObject(
      violationOf('event_type_status_changes_split_birth_check'),
    );
    await expect(ownOrigin).rejects.toMatchObject(violationOf('event_types_origin_check'));
  });
});

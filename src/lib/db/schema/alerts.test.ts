import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { DETECTED_EVENT, insertParents, PARENTS } from '../test-parents';
import {
  alertSheetEvents,
  alertSheetOutcomes,
  alertSheets,
  alertSheetSections,
  alertSheetSnapshots,
} from './alerts';
import { events } from './events';

import type { Database } from '../types';

// The tables of alert-sheets.md about a sheet, its sections, events, outcomes and snapshots.
const TABLES = [
  'alert_sheet_events',
  'alert_sheet_outcomes',
  'alert_sheet_sections',
  'alert_sheet_snapshots',
  'alert_sheets',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'alert_sheet_events.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheet_events.alert_sheet_section_id integer NOT NULL',
  'alert_sheet_events.player_event_id integer NOT NULL',
  'alert_sheet_events.added_at timestamp with time zone NOT NULL',
  'alert_sheet_events.detection_confidence_at_issue smallint',
  'alert_sheet_outcomes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheet_outcomes.alert_sheet_event_id integer NOT NULL',
  'alert_sheet_outcomes.recorded_at timestamp with time zone NOT NULL',
  'alert_sheet_outcomes.shown_gap double precision',
  'alert_sheet_outcomes.shown_gap_status text',
  'alert_sheet_outcomes.shown_baseline_mean double precision',
  'alert_sheet_outcomes.shown_baseline_deviation double precision',
  'alert_sheet_outcomes.shown_baseline_status text',
  'alert_sheet_outcomes.shown_category text',
  'alert_sheet_sections.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheet_sections.alert_sheet_id integer NOT NULL',
  'alert_sheet_sections.kind text NOT NULL',
  'alert_sheet_sections.event_type_id text NOT NULL',
  'alert_sheet_sections.added_at timestamp with time zone NOT NULL',
  'alert_sheet_sections.profile_state text NOT NULL',
  'alert_sheet_sections.frozen_at timestamp with time zone',
  'alert_sheet_sections.profile_status_notice text',
  'alert_sheet_sections.type_not_covered boolean NOT NULL DEFAULT false',
  'alert_sheet_sections.profile_changed_since_issue_at timestamp with time zone',
  'alert_sheet_sections.vacated_by_event_id integer',
  'alert_sheet_snapshots.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheet_snapshots.alert_sheet_section_id integer',
  'alert_sheet_snapshots.alert_sheet_outcome_id integer',
  'alert_sheet_snapshots.kind text NOT NULL',
  'alert_sheet_snapshots.mean_gap double precision',
  'alert_sheet_snapshots.range_low double precision',
  'alert_sheet_snapshots.range_high double precision',
  'alert_sheet_snapshots.valid_count integer NOT NULL',
  'alert_sheet_snapshots.historical_count integer',
  'alert_sheet_snapshots.tracked_count integer',
  'alert_sheet_snapshots.excluded_count integer',
  'alert_sheet_snapshots.player_count integer',
  'alert_sheet_snapshots.verdict_level text NOT NULL',
  'alert_sheet_snapshots.verdict_direction text',
  'alert_sheet_snapshots.profile_confidence text NOT NULL',
  'alert_sheet_snapshots.fragile boolean',
  'alert_sheet_snapshots.valid_case_threshold integer',
  'alert_sheet_snapshots.computed_at timestamp with time zone NOT NULL',
  "alert_sheet_snapshots.detail jsonb NOT NULL DEFAULT '{}'::jsonb",
  'alert_sheets.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'alert_sheets.player_id uuid NOT NULL',
  'alert_sheets.team_id_at_production integer',
  'alert_sheets.produced_at timestamp with time zone NOT NULL',
  'alert_sheets.profile_values_entered_at timestamp with time zone',
  "alert_sheets.status text NOT NULL DEFAULT 'open'::text",
  'alert_sheets.cancellation_reason text',
  'alert_sheets.is_late boolean NOT NULL DEFAULT false',
  'alert_sheets.caveats_frozen_at timestamp with time zone',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX alert_sheet_events_event_uq ON public.alert_sheet_events USING btree (player_event_id)',
  'CREATE UNIQUE INDEX alert_sheet_events_pkey ON public.alert_sheet_events USING btree (id)',
  'CREATE UNIQUE INDEX alert_sheet_outcomes_pkey ON public.alert_sheet_outcomes USING btree (id)',
  'CREATE UNIQUE INDEX alert_sheet_outcomes_uq ON public.alert_sheet_outcomes USING btree (alert_sheet_event_id)',
  "CREATE UNIQUE INDEX alert_sheet_sections_initial_uq ON public.alert_sheet_sections USING btree (alert_sheet_id) WHERE (kind = 'initial'::text)",
  'CREATE UNIQUE INDEX alert_sheet_sections_pkey ON public.alert_sheet_sections USING btree (id)',
  'CREATE INDEX alert_sheet_sections_type_idx ON public.alert_sheet_sections USING btree (event_type_id)',
  'CREATE UNIQUE INDEX alert_sheet_sections_uq ON public.alert_sheet_sections USING btree (alert_sheet_id, event_type_id)',
  'CREATE UNIQUE INDEX alert_sheet_snapshots_outcome_uq ON public.alert_sheet_snapshots USING btree (alert_sheet_outcome_id) WHERE (alert_sheet_outcome_id IS NOT NULL)',
  'CREATE UNIQUE INDEX alert_sheet_snapshots_pkey ON public.alert_sheet_snapshots USING btree (id)',
  'CREATE UNIQUE INDEX alert_sheet_snapshots_section_uq ON public.alert_sheet_snapshots USING btree (alert_sheet_section_id, kind) WHERE (alert_sheet_section_id IS NOT NULL)',
  'CREATE INDEX alert_sheets_late_idx ON public.alert_sheets USING btree (produced_at) WHERE is_late',
  'CREATE UNIQUE INDEX alert_sheets_pkey ON public.alert_sheets USING btree (id)',
  'CREATE INDEX alert_sheets_player_idx ON public.alert_sheets USING btree (player_id, produced_at)',
  'CREATE INDEX alert_sheets_status_idx ON public.alert_sheets USING btree (status, produced_at)',
];

// Their references: each row goes with its sheet, and a snapshot names no live profile row.
const FOREIGN_KEYS = [
  'alert_sheet_events FOREIGN KEY (alert_sheet_section_id) REFERENCES alert_sheet_sections(id) ON DELETE CASCADE',
  'alert_sheet_events FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE RESTRICT',
  'alert_sheet_outcomes FOREIGN KEY (alert_sheet_event_id) REFERENCES alert_sheet_events(id) ON DELETE CASCADE',
  'alert_sheet_sections FOREIGN KEY (alert_sheet_id) REFERENCES alert_sheets(id) ON DELETE CASCADE',
  'alert_sheet_sections FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'alert_sheet_sections FOREIGN KEY (vacated_by_event_id) REFERENCES events(id) ON DELETE RESTRICT',
  'alert_sheet_snapshots FOREIGN KEY (alert_sheet_outcome_id) REFERENCES alert_sheet_outcomes(id) ON DELETE CASCADE',
  'alert_sheet_snapshots FOREIGN KEY (alert_sheet_section_id) REFERENCES alert_sheet_sections(id) ON DELETE CASCADE',
  'alert_sheets FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE RESTRICT',
  'alert_sheets FOREIGN KEY (team_id_at_production) REFERENCES teams(id) ON DELETE RESTRICT',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
const SHEET_ID = 1;
const SECTION_ID = 1;
const SHEET = { playerId: PARENTS.playerId, teamIdAtProduction: 1, producedAt: at(10) } as const;
const SECTION = {
  alertSheetId: SHEET_ID,
  kind: 'initial',
  eventTypeId: 'media-storm',
  addedAt: at(10),
  profileState: 'pending',
} as const;
const FROZEN = { ...SECTION, profileState: 'frozen', frozenAt: at(12) } as const;
const SHEET_EVENT = {
  alertSheetSectionId: SECTION_ID,
  playerEventId: PARENTS.eventId,
  addedAt: at(10),
} as const;
const OUTCOME = { alertSheetEventId: 1, recordedAt: at(23) } as const;
// The profile a section showed when the sheet was issued, frozen in its values.
const SNAPSHOT = {
  alertSheetSectionId: SECTION_ID,
  kind: 'profile',
  validCount: 0,
  verdictLevel: 'inconclusive',
  profileConfidence: 'low',
  computedAt: at(10),
} as const;
const PROBABLE = {
  ...SNAPSHOT,
  meanGap: -4.5,
  rangeLow: -7.25,
  rangeHigh: -1.5,
  validCount: 12,
  historicalCount: 9,
  trackedCount: 3,
  excludedCount: 2,
  playerCount: 1,
  verdictLevel: 'probable',
  verdictDirection: 'decrease',
  profileConfidence: 'high',
  fragile: false,
  validCaseThreshold: 5,
  detail: { shownCases: 12 },
} as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('a sheet with its sections, events, outcomes and snapshots', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(alertSheets).values(SHEET);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that alert-sheets.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[ALE-01] [ALE-06] [ALE-26] [CL-ALE-13] opens a sheet on time, and keeps every status and cancellation reason', async () => {
    const reasons = [
      'all_events_dismissed',
      'attachment_corrected',
      'event_no_longer_applies',
    ] as const;
    await db.insert(alertSheets).values([
      {
        ...SHEET,
        status: 'closed',
        profileValuesEnteredAt: at(10),
        isLate: true,
        caveatsFrozenAt: at(23),
      },
      ...reasons.map(
        (cancellationReason) => ({ ...SHEET, status: 'canceled', cancellationReason }) as const,
      ),
    ]);

    const [first] = await db.select().from(alertSheets).where(eq(alertSheets.id, SHEET_ID));

    expect(first).toStrictEqual({
      ...SHEET,
      id: SHEET_ID,
      profileValuesEnteredAt: null,
      status: 'open',
      cancellationReason: null,
      isLate: false,
      caveatsFrozenAt: null,
    });
    await expect(db.$count(alertSheets)).resolves.toBe(5);
  });

  it.each([
    [
      'profile values entered before its production',
      { profileValuesEnteredAt: at(9) },
      'profile_values_entered',
    ],
    ['a status outside the list', { status: OUTSIDE }, 'status'],
    ['a cancellation without its reason', { status: 'canceled' }, 'canceled'],
    [
      'an open sheet with a cancellation reason',
      { cancellationReason: 'attachment_corrected' },
      'canceled',
    ],
    [
      'a cancellation reason outside the list',
      { status: 'canceled', cancellationReason: OUTSIDE },
      'cancellation_reason',
    ],
  ] as const)(
    '[ALE-05] [ALE-26] [CL-ALE-04] refuses a sheet with %s',
    async (_case, values, check) => {
      const insert = db.insert(alertSheets).values({ ...SHEET, ...values });

      await expect(insert).rejects.toMatchObject(violationOf(`alert_sheets_${check}_check`));
    },
  );

  it('[ALE-20] [ALE-31] [CL-ALE-16] gives a sheet one initial section and one section per type', async () => {
    await db.insert(alertSheetSections).values([
      { ...FROZEN, profileStatusNotice: 'recalculation_in_progress', typeNotCovered: true },
      { ...SECTION, kind: 'later_event', eventTypeId: 'bereavement' },
      {
        ...FROZEN,
        kind: 'type_change',
        eventTypeId: 'birthday',
        profileStatusNotice: 'no_measured_case_yet',
      },
    ]);
    const sameType = db.insert(alertSheetSections).values({ ...SECTION, kind: 'later_event' });
    await expect(sameType).rejects.toMatchObject(duplicateOf('alert_sheet_sections_uq'));
    await db.insert(alertSheets).values(SHEET);
    await db.insert(alertSheetSections).values({ ...SECTION, alertSheetId: 2 });
    const secondInitial = db
      .insert(alertSheetSections)
      .values({ ...SECTION, alertSheetId: 2, eventTypeId: 'bereavement' });
    await expect(secondInitial).rejects.toMatchObject(
      duplicateOf('alert_sheet_sections_initial_uq'),
    );

    const [later] = await db
      .select()
      .from(alertSheetSections)
      .where(eq(alertSheetSections.kind, 'later_event'));

    expect(later).toMatchObject({
      typeNotCovered: false,
      profileChangedSinceIssueAt: null,
      vacatedByEventId: null,
    });
  });

  it.each([
    ['a kind outside the list', { ...SECTION, kind: OUTSIDE }, 'kind'],
    ['a profile state outside the list', { ...SECTION, profileState: OUTSIDE }, 'profile_state'],
    ['a frozen profile without its instant', { ...FROZEN, frozenAt: null }, 'frozen'],
    ['a pending profile with a freezing instant', { ...SECTION, frozenAt: at(12) }, 'frozen'],
    [
      'a notice outside the list',
      { ...FROZEN, profileStatusNotice: OUTSIDE },
      'profile_status_notice',
    ],
    [
      'a notice on a pending profile',
      { ...SECTION, profileStatusNotice: 'no_measured_case_yet' },
      'notice',
    ],
  ] as const)(
    '[ALE-05] [ALE-19] [CL-ALE-04] refuses a section with %s',
    async (_case, section, check) => {
      const insert = db.insert(alertSheetSections).values(section);

      await expect(insert).rejects.toMatchObject(
        violationOf(`alert_sheet_sections_${check}_check`),
      );
    },
  );

  it('[ALE-08] [ALE-20] [ALE-27] puts an event on one sheet only, with one outcome, and keeps the event it shows', async () => {
    await db.insert(alertSheetSections).values(SECTION);
    await db.insert(alertSheetEvents).values({ ...SHEET_EVENT, detectionConfidenceAtIssue: 100 });
    await db
      .insert(alertSheetSections)
      .values({ ...SECTION, kind: 'later_event', eventTypeId: 'bereavement' });
    const elsewhere = db
      .insert(alertSheetEvents)
      .values({ ...SHEET_EVENT, alertSheetSectionId: 2 });
    await expect(elsewhere).rejects.toMatchObject(duplicateOf('alert_sheet_events_event_uq'));
    await db.insert(events).values({ ...DETECTED_EVENT, description: 'A second storm.' });
    const confidenceCheck = violationOf('alert_sheet_events_detection_confidence_at_issue_check');
    const negative = db
      .insert(alertSheetEvents)
      .values({ ...SHEET_EVENT, playerEventId: 2, detectionConfidenceAtIssue: -1 });
    await expect(negative).rejects.toMatchObject(confidenceCheck);
    const overFull = db
      .insert(alertSheetEvents)
      .values({ ...SHEET_EVENT, playerEventId: 2, detectionConfidenceAtIssue: 101 });
    await expect(overFull).rejects.toMatchObject(confidenceCheck);
    await db
      .insert(alertSheetOutcomes)
      .values({ ...OUTCOME, shownGap: -3.5, shownGapStatus: 'final' });
    const again = db.insert(alertSheetOutcomes).values(OUTCOME);
    await expect(again).rejects.toMatchObject(duplicateOf('alert_sheet_outcomes_uq'));

    const withdrawal = db.delete(events).where(eq(events.id, PARENTS.eventId));

    await expect(withdrawal).rejects.toMatchObject({
      cause: { code: '23001', constraint: 'alert_sheet_events_player_event_id_events_id_fk' },
    });
  });

  it.each([
    ['a gap without its status', { shownGap: -3.5 }, 'shown_gap'],
    ['a gap status without its gap', { shownGapStatus: 'provisional' }, 'shown_gap'],
    [
      'a gap status outside the list',
      { shownGap: -3.5, shownGapStatus: OUTSIDE },
      'shown_gap_status',
    ],
    [
      'a baseline status outside the list',
      { shownBaselineStatus: OUTSIDE },
      'shown_baseline_status',
    ],
    ['a category outside the list', { shownCategory: OUTSIDE }, 'shown_category'],
  ] as const)('[ALE-27] [CL-ALE-12] refuses an outcome with %s', async (_case, values, check) => {
    await db.insert(alertSheetSections).values(SECTION);
    await db.insert(alertSheetEvents).values(SHEET_EVENT);

    const insert = db.insert(alertSheetOutcomes).values({ ...OUTCOME, ...values });

    await expect(insert).rejects.toMatchObject(violationOf(`alert_sheet_outcomes_${check}_check`));
  });

  it('[ALE-09] [ALE-12] [ALE-19] [CL-ALE-12] freezes the values a snapshot shows, owned by its section or outcome and by no live profile row', async () => {
    await db.insert(alertSheetSections).values(FROZEN);
    await db.insert(alertSheetEvents).values(SHEET_EVENT);
    await db
      .insert(alertSheetOutcomes)
      .values({ ...OUTCOME, shownBaselineStatus: 'final', shownCategory: 'confirmed' });
    await db.insert(alertSheetSnapshots).values([
      PROBABLE,
      {
        ...SNAPSHOT,
        kind: 'trend',
        verdictLevel: 'possible',
        verdictDirection: 'increase',
        profileConfidence: 'medium',
      },
      { ...PROBABLE, alertSheetSectionId: null, alertSheetOutcomeId: 1 },
    ]);
    const sameKind = db.insert(alertSheetSnapshots).values(SNAPSHOT);
    await expect(sameKind).rejects.toMatchObject(duplicateOf('alert_sheet_snapshots_section_uq'));
    const sameOutcome = db
      .insert(alertSheetSnapshots)
      .values({ ...SNAPSHOT, alertSheetSectionId: null, alertSheetOutcomeId: 1 });
    await expect(sameOutcome).rejects.toMatchObject(
      duplicateOf('alert_sheet_snapshots_outcome_uq'),
    );

    const [shown] = await db
      .select()
      .from(alertSheetSnapshots)
      .where(eq(alertSheetSnapshots.id, 1));

    expect(shown).toStrictEqual({ ...PROBABLE, id: 1, alertSheetOutcomeId: null });
    await expect(describeForeignKeys(db, ['alert_sheet_snapshots'])).resolves.toStrictEqual([
      'alert_sheet_snapshots FOREIGN KEY (alert_sheet_outcome_id) REFERENCES alert_sheet_outcomes(id) ON DELETE CASCADE',
      'alert_sheet_snapshots FOREIGN KEY (alert_sheet_section_id) REFERENCES alert_sheet_sections(id) ON DELETE CASCADE',
    ]);
  });

  it.each([
    ['no owner', { ...SNAPSHOT, alertSheetSectionId: null }, 'owner'],
    ['two owners', { ...SNAPSHOT, alertSheetOutcomeId: 1 }, 'owner'],
    [
      'a trend for an outcome',
      { ...SNAPSHOT, alertSheetSectionId: null, alertSheetOutcomeId: 1, kind: 'trend' },
      'outcome_kind',
    ],
    ['a kind outside the list', { ...SNAPSHOT, kind: OUTSIDE }, 'kind'],
    ['a range that ends below its start', { ...SNAPSHOT, rangeLow: -1, rangeHigh: -2 }, 'range'],
    ['a negative number of valid cases', { ...SNAPSHOT, validCount: -1 }, 'valid_count'],
    [
      'a verdict level outside the list',
      { ...SNAPSHOT, verdictLevel: OUTSIDE, verdictDirection: 'increase' },
      'verdict_level',
    ],
    [
      'a direction on an inconclusive verdict',
      { ...SNAPSHOT, verdictDirection: 'increase' },
      'verdict',
    ],
    [
      'a possible verdict without its direction',
      { ...SNAPSHOT, verdictLevel: 'possible' },
      'verdict',
    ],
    [
      'a direction outside the list',
      { ...SNAPSHOT, verdictLevel: 'possible', verdictDirection: OUTSIDE },
      'verdict_direction',
    ],
    [
      'a confidence outside the list',
      { ...SNAPSHOT, profileConfidence: OUTSIDE },
      'profile_confidence',
    ],
  ] as const)(
    '[ALE-09] [ALE-19] [SEN-38] refuses a snapshot with %s',
    async (_case, snapshot, check) => {
      await db.insert(alertSheetSections).values(SECTION);
      await db.insert(alertSheetEvents).values(SHEET_EVENT);
      await db.insert(alertSheetOutcomes).values(OUTCOME);

      const insert = db.insert(alertSheetSnapshots).values(snapshot);

      await expect(insert).rejects.toMatchObject(
        violationOf(`alert_sheet_snapshots_${check}_check`),
      );
    },
  );

  it('[ALE-31] [CL-ALE-16] erases a sheet with everything it holds', async () => {
    await db.insert(alertSheetSections).values(SECTION);
    await db.insert(alertSheetEvents).values(SHEET_EVENT);
    await db.insert(alertSheetOutcomes).values(OUTCOME);
    await db
      .insert(alertSheetSnapshots)
      .values([SNAPSHOT, { ...SNAPSHOT, alertSheetSectionId: null, alertSheetOutcomeId: 1 }]);

    await db.delete(alertSheets).where(eq(alertSheets.id, SHEET_ID));

    const held = [alertSheetSections, alertSheetEvents, alertSheetOutcomes, alertSheetSnapshots];
    await expect(Promise.all(held.map(async (table) => db.$count(table)))).resolves.toStrictEqual([
      0, 0, 0, 0,
    ]);
  });
});

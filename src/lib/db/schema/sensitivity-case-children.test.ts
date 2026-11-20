import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { cases } from './sensitivity';
import {
  caseHistoryEntries,
  caseManualDecisions,
  caseReviewFlags,
  caseTriggeredCriteria,
} from './sensitivity-case-children';

import type { Database } from '../types';

// The tables of events-and-cases.md that hang off one case.
const TABLES = [
  'case_history_entries',
  'case_manual_decisions',
  'case_review_flags',
  'case_triggered_criteria',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'case_history_entries.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'case_history_entries.case_id integer NOT NULL',
  'case_history_entries.recorded_at timestamp with time zone NOT NULL DEFAULT now()',
  'case_history_entries.status text NOT NULL',
  'case_history_entries.status_reason text',
  'case_history_entries.measured_game_id integer',
  'case_history_entries.normalized_gap double precision',
  'case_history_entries.gap_status text',
  'case_history_entries.cause text NOT NULL',
  'case_manual_decisions.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'case_manual_decisions.case_id integer NOT NULL',
  'case_manual_decisions.decided_at timestamp with time zone NOT NULL DEFAULT now()',
  'case_manual_decisions.kind text NOT NULL',
  'case_manual_decisions.exclusion_reason text',
  'case_manual_decisions.reinstatement_reason text',
  'case_manual_decisions.comment text',
  'case_manual_decisions.previous_status text NOT NULL',
  'case_manual_decisions.measured_game_id integer NOT NULL',
  'case_review_flags.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'case_review_flags.case_id integer NOT NULL',
  'case_review_flags.flag text NOT NULL',
  'case_review_flags.measured_game_id integer NOT NULL',
  'case_review_flags.raised_at timestamp with time zone NOT NULL DEFAULT now()',
  'case_review_flags.acknowledged_at timestamp with time zone',
  'case_triggered_criteria.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'case_triggered_criteria.case_id integer NOT NULL',
  'case_triggered_criteria.criterion text NOT NULL',
  'case_triggered_criteria.condition text',
  'case_triggered_criteria.triggering_values jsonb NOT NULL',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX case_history_entries_case_idx ON public.case_history_entries USING btree (case_id, recorded_at)',
  'CREATE UNIQUE INDEX case_history_entries_pkey ON public.case_history_entries USING btree (id)',
  'CREATE INDEX case_manual_decisions_case_idx ON public.case_manual_decisions USING btree (case_id, decided_at)',
  'CREATE UNIQUE INDEX case_manual_decisions_pkey ON public.case_manual_decisions USING btree (id)',
  'CREATE UNIQUE INDEX case_review_flags_key ON public.case_review_flags USING btree (case_id, flag)',
  'CREATE UNIQUE INDEX case_review_flags_pkey ON public.case_review_flags USING btree (id)',
  'CREATE UNIQUE INDEX case_triggered_criteria_key ON public.case_triggered_criteria USING btree (case_id, criterion, condition) NULLS NOT DISTINCT',
  'CREATE UNIQUE INDEX case_triggered_criteria_pkey ON public.case_triggered_criteria USING btree (id)',
];

// Their references: each row goes with its case and keeps the game it is about.
const FOREIGN_KEYS = [
  'case_history_entries FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE',
  'case_history_entries FOREIGN KEY (measured_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'case_manual_decisions FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE',
  'case_manual_decisions FOREIGN KEY (measured_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'case_review_flags FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE',
  'case_review_flags FOREIGN KEY (measured_game_id) REFERENCES games(id) ON DELETE RESTRICT',
  'case_triggered_criteria FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE',
];

// A row of the parent case, and the owner's decisions on the parent game.
const OF_CASE = { caseId: PARENTS.caseId } as const;
const AT_GAME = { ...OF_CASE, measuredGameId: PARENTS.gameId } as const;
const EXCLUSION = {
  ...AT_GAME,
  kind: 'exclude',
  exclusionReason: 'playing_time',
  previousStatus: 'measured',
} as const;
const REINSTATEMENT = {
  ...AT_GAME,
  kind: 'reinstate',
  reinstatementReason: 'incorrect_context_indication',
  previousStatus: 'excluded',
} as const;
// The reasons of a case that waits for its game, besides the statistics pending, and
// those of a case that cannot be measured.
const AWAITING_REASONS = [
  'game_not_played_yet',
  'mapping_not_established',
  'baseline_building',
  'precedence_to_verify',
  'dating_to_verify',
] as const;
const UNMEASURABLE_REASONS = [
  'no_game_within_window',
  'box_score_incomplete',
  'box_score_suspect',
  'box_score_unavailable',
  'insufficient_baseline',
  'season_not_covered',
  'precedence_not_established',
  'derived_game_missed',
] as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the tables that hang off a case', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that events-and-cases.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[SEN-11] [SEN-13] [SEN-14] [SEN-17] keeps each triggered criterion once, a context one by its condition', async () => {
    const values = { minutes: 14, threshold: 17.5 };
    await db.insert(caseTriggeredCriteria).values([
      ...(['playing_time_too_low', 'opponent_strength', 'co_occurring', 'manual'] as const).map(
        (criterion) => ({ ...OF_CASE, criterion, triggeringValues: values }),
      ),
      ...(['injury_return', 'unusual_stakes'] as const).flatMap((criterion) =>
        (['flagged', 'calculated'] as const).map((condition) => ({
          ...OF_CASE,
          criterion,
          condition,
          triggeringValues: values,
        })),
      ),
    ]);

    const again = db
      .insert(caseTriggeredCriteria)
      .values({ ...OF_CASE, criterion: 'manual', triggeringValues: {} });
    const unknown = db
      .insert(caseTriggeredCriteria)
      .values({ ...OF_CASE, criterion: OUTSIDE, triggeringValues: {} });
    const condition = db
      .insert(caseTriggeredCriteria)
      .values({ ...OF_CASE, criterion: 'injury_return', condition: OUTSIDE, triggeringValues: {} });
    const conditioned = db.insert(caseTriggeredCriteria).values({
      ...OF_CASE,
      criterion: 'playing_time_too_low',
      condition: 'calculated',
      triggeringValues: {},
    });

    await expect(again).rejects.toMatchObject(duplicateOf('case_triggered_criteria_key'));
    await expect(unknown).rejects.toMatchObject(
      violationOf('case_triggered_criteria_criterion_check'),
    );
    await expect(condition).rejects.toMatchObject(
      violationOf('case_triggered_criteria_condition_check'),
    );
    await expect(conditioned).rejects.toMatchObject(
      violationOf('case_triggered_criteria_conditioned_criterion_check'),
    );
    await expect(db.$count(caseTriggeredCriteria)).resolves.toBe(8);
  });

  it('[SEN-16] [CL-SEN-11] [CL-SEN-12] raises each review flag once per case, about its game', async () => {
    await db
      .insert(caseReviewFlags)
      .values(
        (['first_game_with_new_team', 'ejection', 'manual_decision_to_review'] as const).map(
          (flag) => ({ ...AT_GAME, flag }),
        ),
      );

    const again = db.insert(caseReviewFlags).values({ ...AT_GAME, flag: 'ejection' });
    const unknown = db.insert(caseReviewFlags).values({ ...AT_GAME, flag: OUTSIDE });

    await expect(again).rejects.toMatchObject(duplicateOf('case_review_flags_key'));
    await expect(unknown).rejects.toMatchObject(violationOf('case_review_flags_flag_check'));
    await expect(db.$count(caseReviewFlags)).resolves.toBe(3);
  });

  it('[SEN-17] [CL-SEN-12] records each exclusion and reinstatement with its closed-list reason, commented where it must be', async () => {
    await db.insert(caseManualDecisions).values([
      ...(['playing_time', 'injury_return', 'unusual_stakes', 'opponent_strength'] as const).map(
        (exclusionReason) => ({ ...EXCLUSION, exclusionReason }),
      ),
      {
        ...EXCLUSION,
        exclusionReason: 'other_confounding_factor',
        comment: 'A trade the day before.',
      },
      REINSTATEMENT,
      {
        ...REINSTATEMENT,
        reinstatementReason: 'criterion_unsuited_to_case',
        comment: 'He chose to rest.',
      },
    ]);

    await expect(db.$count(caseManualDecisions)).resolves.toBe(7);
  });

  it.each([
    [
      'of a kind the glossary does not list',
      { ...EXCLUSION, kind: OUTSIDE, exclusionReason: null },
      'kind',
    ],
    [
      'for an exclusion reason the glossary does not list',
      { ...EXCLUSION, exclusionReason: OUTSIDE },
      'exclusion_reason',
    ],
    [
      'for a reinstatement reason the glossary does not list',
      { ...REINSTATEMENT, reinstatementReason: OUTSIDE },
      'reinstatement_reason',
    ],
    [
      'of a case that was waiting',
      { ...REINSTATEMENT, previousStatus: sql`'awaiting_game'` },
      'previous_status',
    ],
    ['excluding without a reason', { ...EXCLUSION, exclusionReason: null }, 'exclusion'],
    [
      'excluding with a reason to reinstate',
      { ...EXCLUSION, reinstatementReason: 'incorrect_context_indication' },
      'exclusion',
    ],
    ['excluding an excluded case', { ...EXCLUSION, previousStatus: 'excluded' }, 'exclusion'],
    [
      'reinstating without a reason',
      { ...REINSTATEMENT, reinstatementReason: null },
      'reinstatement',
    ],
    [
      'reinstating with a reason to exclude',
      { ...REINSTATEMENT, exclusionReason: 'playing_time' },
      'reinstatement',
    ],
    [
      'reinstating a measured case',
      { ...REINSTATEMENT, previousStatus: 'measured' },
      'reinstatement',
    ],
    [
      'excluding for another factor without a comment',
      { ...EXCLUSION, exclusionReason: 'other_confounding_factor' },
      'comment',
    ],
    [
      'reinstating as unsuited without a comment',
      { ...REINSTATEMENT, reinstatementReason: 'criterion_unsuited_to_case' },
      'comment',
    ],
  ] as const)('[SEN-17] refuses a manual decision %s', async (_case, decision, check) => {
    const insert = db.insert(caseManualDecisions).values(decision);

    await expect(insert).rejects.toMatchObject(violationOf(`case_manual_decisions_${check}_check`));
  });

  it('[SEN-07] [SEN-37] [CL-SEN-17] records each change of a case with the cause of its recalculation', async () => {
    const causes = [
      'new_cases',
      'stats_correction',
      'baseline_updated',
      'manual_decision',
      'event_dismissed',
      'parameter_change',
      'recalculation',
      'event_corrected_or_removed',
      'event_reinstated',
      'taxonomy_changed',
    ] as const;
    await db.insert(caseHistoryEntries).values([
      ...causes.map(
        (cause) =>
          ({
            ...OF_CASE,
            status: 'awaiting_game',
            statusReason: 'statistics_pending',
            cause,
          }) as const,
      ),
      {
        ...AT_GAME,
        status: 'measured',
        normalizedGap: 0.71,
        gapStatus: 'provisional',
        cause: 'new_cases',
      },
      {
        ...AT_GAME,
        status: 'excluded',
        normalizedGap: 0.71,
        gapStatus: 'final',
        cause: 'manual_decision',
      },
      ...UNMEASURABLE_REASONS.map(
        (statusReason) =>
          ({
            ...AT_GAME,
            status: 'not_measurable',
            statusReason,
            cause: 'stats_correction',
          }) as const,
      ),
      ...AWAITING_REASONS.map(
        (statusReason) =>
          ({ ...OF_CASE, status: 'awaiting_game', statusReason, cause: 'new_cases' }) as const,
      ),
    ]);

    await expect(db.$count(caseHistoryEntries)).resolves.toBe(25);
  });

  it.each([
    ['a status', { status: OUTSIDE }, 'status'],
    ['a reason', { statusReason: OUTSIDE }, 'status_reason'],
    ['a gap status', { gapStatus: OUTSIDE }, 'gap_status'],
    ['a cause', { cause: OUTSIDE }, 'cause'],
  ] as const)(
    '[SEN-37] refuses a case history entry with %s that the glossary does not list',
    async (_value, change, column) => {
      const insert = db
        .insert(caseHistoryEntries)
        .values({ ...OF_CASE, status: 'awaiting_game', cause: 'new_cases', ...change });

      await expect(insert).rejects.toMatchObject(
        violationOf(`case_history_entries_${column}_check`),
      );
    },
  );

  it('[CL-VUE-03] deletes with a case its criteria, flags, decisions and history', async () => {
    await db
      .insert(caseTriggeredCriteria)
      .values({ ...OF_CASE, criterion: 'manual', triggeringValues: {} });
    await db.insert(caseReviewFlags).values({ ...AT_GAME, flag: 'ejection' });
    await db.insert(caseManualDecisions).values(EXCLUSION);
    await db
      .insert(caseHistoryEntries)
      .values({ ...OF_CASE, status: 'awaiting_game', cause: 'new_cases' });

    await db.delete(cases).where(eq(cases.id, PARENTS.caseId));

    await expect(
      Promise.all(
        [caseTriggeredCriteria, caseReviewFlags, caseManualDecisions, caseHistoryEntries].map(
          async (table) => db.$count(table),
        ),
      ),
    ).resolves.toStrictEqual([0, 0, 0, 0]);
  });
});

import { asc, eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  caseManualDecisions,
  caseReviewFlags,
  cases,
  createTestDatabase,
  games,
  journalEntries,
  recalculationJobs,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertValidCase,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { acknowledgeReviewFlag, excludeCase, reinstateCase } from './manual-decisions';

import type { CaseDecision, DecisionRefusal } from './manual-decisions';
import type { CaseRow } from './types';
import type { Database } from '@/lib/db';
import type { Result } from '@/lib/result';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9));
const LATER = toEpochMs(Date.UTC(2026, 10, 25, 10));
// The default maximum length of a free text, and a comment one character longer (DSN-20).
const MAX_LENGTH = 200;
const TOO_LONG_COMMENT = 'x'.repeat(MAX_LENGTH + 1);
const BLANK_COMMENT = ' '.repeat(3);
// A second research type, whose case of the profiled player shares his measured game.
const OTHER_TYPE = 'transfer-rumor';
const EXCLUSION_REASONS = [
  'playing_time',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'other_confounding_factor',
];
const DONE: Result<undefined, DecisionRefusal> = { ok: true, value: undefined };
const INVALID_REASON: Result<undefined, DecisionRefusal> = {
  ok: false,
  error: { kind: 'invalid_reason' },
};
const COMMENT_REQUIRED: Result<undefined, DecisionRefusal> = {
  ok: false,
  error: { kind: 'comment_required' },
};

/** A decision with `reason`, an optional comment, and the case version the page showed. */
const decision = (reason: string, comment: string | null = null, version = 1): CaseDecision => ({
  reason,
  comment,
  expectedVersion: version,
});

/** The refusal of a decision on a case whose state, as the decision reads it, is `status`. */
const notAllowed = (status: CaseRow['status']): Result<undefined, DecisionRefusal> => ({
  ok: false,
  error: { kind: 'status_not_allowed', status },
});

describe('the manual decisions on a case', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let measured: CaseRow;

  /** The case `caseId` moved to `set`, as a recalculation would store it. */
  async function caseWith(caseId: number, set: Partial<CaseRow>): Promise<CaseRow> {
    const [row] = await db.update(cases).set(set).where(eq(cases.id, caseId)).returning();
    if (row === undefined) {
      throw new Error(`The case ${String(caseId)} is gone.`);
    }
    return row;
  }

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    const world = await profiledPlayer(db);
    const [first] = world.cases;
    if (first === undefined) {
      throw new Error('The profiled player has no case.');
    }
    measured = await caseWith(first.id, { status: 'measured' });
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  const exclude = async (input: CaseDecision, caseId = measured.id) =>
    db.transaction(async (tx) => excludeCase(tx, caseId, input));
  const reinstate = async (input: CaseDecision) =>
    db.transaction(async (tx) => reinstateCase(tx, measured.id, input));

  /** The decisions recorded, without their identifiers, oldest first. */
  async function decisions() {
    return db
      .select({
        caseId: caseManualDecisions.caseId,
        decidedAt: caseManualDecisions.decidedAt,
        kind: caseManualDecisions.kind,
        exclusionReason: caseManualDecisions.exclusionReason,
        reinstatementReason: caseManualDecisions.reinstatementReason,
        comment: caseManualDecisions.comment,
        previousStatus: caseManualDecisions.previousStatus,
        measuredGameId: caseManualDecisions.measuredGameId,
      })
      .from(caseManualDecisions)
      .orderBy(asc(caseManualDecisions.id));
  }

  /** What the decisions wrote: decisions, journal entries, jobs, and the case's version. */
  async function written() {
    const [row] = await db.select().from(cases).where(eq(cases.id, measured.id));
    return {
      decisions: await decisions(),
      journal: await db
        .select({
          messageKey: journalEntries.messageKey,
          caseId: journalEntries.caseId,
          playerId: journalEntries.playerId,
          eventTypeId: journalEntries.eventTypeId,
        })
        .from(journalEntries)
        .orderBy(asc(journalEntries.id)),
      jobs: await db
        .select({
          scope: recalculationJobs.scope,
          cause: recalculationJobs.cause,
          playerIds: recalculationJobs.playerIds,
          eventTypeIds: recalculationJobs.eventTypeIds,
        })
        .from(recalculationJobs),
      rowVersion: row?.rowVersion,
    };
  }

  const NOTHING_WRITTEN = { decisions: [], journal: [], jobs: [], rowVersion: 1 };

  it('[SEN-17] [CL-SEN-12] [CL-SEN-17] excludes a measured case: traced on its game, journaled by case alone, its job recorded', async () => {
    await expect(exclude(decision('playing_time'))).resolves.toStrictEqual(DONE);
    await expect(written()).resolves.toStrictEqual({
      decisions: [
        {
          caseId: measured.id,
          decidedAt: new Date(START),
          kind: 'exclude',
          exclusionReason: 'playing_time',
          reinstatementReason: null,
          comment: null,
          previousStatus: 'measured',
          measuredGameId: measured.measuredGameId,
        },
      ],
      journal: [
        { messageKey: 'case_excluded', caseId: measured.id, playerId: null, eventTypeId: null },
      ],
      jobs: [
        {
          scope: 'event_or_case_change',
          cause: 'manual_decision',
          playerIds: [measured.playerId],
          eventTypeIds: [measured.eventTypeId],
        },
      ],
      rowVersion: 2,
    });
  });

  it.each(EXCLUSION_REASONS)('[SEN-17] accepts the exclusion reason %s', async (reason) => {
    await expect(
      exclude(decision(reason, 'Ejected in the second quarter.')),
    ).resolves.toStrictEqual(DONE);
    await expect(decisions()).resolves.toStrictEqual([
      expect.objectContaining({
        exclusionReason: reason,
        comment: 'Ejected in the second quarter.',
      }),
    ]);
  });

  it.each([
    ['a reinstatement reason', 'incorrect_context_indication'],
    ['a reason about the performance itself', 'poor_performance'],
    ['an empty reason', ''],
  ])('[SEN-17] refuses an exclusion for %s and writes nothing', async (_label, reason) => {
    await expect(exclude(decision(reason))).resolves.toStrictEqual(INVALID_REASON);
    await expect(written()).resolves.toStrictEqual(NOTHING_WRITTEN);
  });

  it.each([...EXCLUSION_REASONS, 'great_performance'])(
    '[SEN-17] refuses a reinstatement for %s and writes nothing',
    async (reason) => {
      await caseWith(measured.id, { status: 'excluded' });
      await expect(reinstate(decision(reason, 'A comment.'))).resolves.toStrictEqual(
        INVALID_REASON,
      );
      await expect(written()).resolves.toStrictEqual(NOTHING_WRITTEN);
    },
  );

  it.each([null, '', BLANK_COMMENT])(
    '[SEN-17] requires a comment for "other confounding factor" and "criterion unsuited to this case", refusing %j',
    async (comment) => {
      await expect(exclude(decision('other_confounding_factor', comment))).resolves.toStrictEqual(
        COMMENT_REQUIRED,
      );
      await caseWith(measured.id, { status: 'excluded' });
      await expect(
        reinstate(decision('criterion_unsuited_to_case', comment)),
      ).resolves.toStrictEqual(COMMENT_REQUIRED);
      await expect(written()).resolves.toStrictEqual(NOTHING_WRITTEN);
    },
  );

  it('[SEN-17] [DSN-10] refuses a comment that breaks the wording rules, and writes nothing', async () => {
    await expect(
      exclude(decision('other_confounding_factor', TOO_LONG_COMMENT)),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_comment',
        breaches: [{ kind: 'too_long', length: MAX_LENGTH + 1, maxLength: MAX_LENGTH }],
      },
    });
    await expect(written()).resolves.toStrictEqual(NOTHING_WRITTEN);
  });

  it('[SEN-17] keeps the comment of any reason, trimmed', async () => {
    await expect(
      exclude(decision('unusual_stakes', '  Final game of a tied series.  ')),
    ).resolves.toStrictEqual(DONE);
    await expect(decisions()).resolves.toStrictEqual([
      expect.objectContaining({ comment: 'Final game of a tied series.' }),
    ]);
  });

  it('[SEN-17] reinstates an excluded case with its reason and comment, journaled and recalculated', async () => {
    await caseWith(measured.id, { status: 'excluded' });
    await expect(
      reinstate(decision('criterion_unsuited_to_case', 'He left injured.')),
    ).resolves.toStrictEqual(DONE);
    await expect(written()).resolves.toStrictEqual({
      decisions: [
        expect.objectContaining({
          kind: 'reinstate',
          exclusionReason: null,
          reinstatementReason: 'criterion_unsuited_to_case',
          comment: 'He left injured.',
          previousStatus: 'excluded',
          measuredGameId: measured.measuredGameId,
        }),
      ],
      journal: [
        { messageKey: 'case_reinstated', caseId: measured.id, playerId: null, eventTypeId: null },
      ],
      jobs: [expect.objectContaining({ cause: 'manual_decision' })],
      rowVersion: 2,
    });
  });

  it('[SEN-17] refuses to exclude a case not measured, or to reinstate one not excluded', async () => {
    await expect(reinstate(decision('incorrect_context_indication'))).resolves.toStrictEqual(
      notAllowed('measured'),
    );
    await caseWith(measured.id, { status: 'excluded' });
    await expect(exclude(decision('playing_time'))).resolves.toStrictEqual(notAllowed('excluded'));
    await caseWith(measured.id, { status: 'awaiting_game', statusReason: 'statistics_pending' });
    await expect(exclude(decision('playing_time'))).resolves.toStrictEqual(
      notAllowed('awaiting_game'),
    );
    await expect(written()).resolves.toStrictEqual(NOTHING_WRITTEN);
  });

  it('[SEN-17] undoes a decision by the opposite one, before any recalculation has run', async () => {
    await exclude(decision('injury_return'));
    await expect(exclude(decision('playing_time', null, 2))).resolves.toStrictEqual(
      notAllowed('excluded'),
    );
    await reinstate(decision('incorrect_context_indication', null, 2));
    await exclude(decision('opponent_strength', null, 3));
    const after = await written();
    expect({
      decisions: after.decisions.map(({ kind, previousStatus }) => [kind, previousStatus]),
      jobs: after.jobs.length,
      rowVersion: after.rowVersion,
    }).toStrictEqual({
      decisions: [
        ['exclude', 'measured'],
        ['reinstate', 'excluded'],
        ['exclude', 'measured'],
      ],
      jobs: 3,
      rowVersion: 4,
    });
  });

  it('[SEN-17] [CL-SEN-12] ignores a decision made on another game than the case’s', async () => {
    const [other] = await db
      .select({ id: games.id })
      .from(games)
      .where(ne(games.id, measured.measuredGameId ?? 0))
      .limit(1);
    await db.insert(caseManualDecisions).values({
      caseId: measured.id,
      decidedAt: new Date(START),
      kind: 'exclude',
      exclusionReason: 'playing_time',
      previousStatus: 'measured',
      measuredGameId: other?.id ?? 0,
    });
    await expect(exclude(decision('unusual_stakes'))).resolves.toStrictEqual(DONE);
  });

  it.each([
    ['not_measurable', 'box_score_incomplete'],
    ['awaiting_game', 'statistics_pending'],
  ] as const)(
    '[SEN-17] [CL-SEN-12] keeps the state of a case %s at the game of an earlier decision',
    async (status, statusReason) => {
      await exclude(decision('playing_time'));
      await caseWith(measured.id, { status, statusReason });
      await expect(
        reinstate(decision('incorrect_context_indication', null, 2)),
      ).resolves.toStrictEqual(notAllowed(status));
      await expect(exclude(decision('unusual_stakes', null, 2))).resolves.toStrictEqual(
        notAllowed(status),
      );
      const after = await written();
      expect({
        decisions: after.decisions.map(({ kind, measuredGameId }) => [kind, measuredGameId]),
        journal: after.journal.length,
        jobs: after.jobs.length,
        rowVersion: after.rowVersion,
      }).toStrictEqual({
        decisions: [['exclude', measured.measuredGameId]],
        journal: 1,
        jobs: 1,
        rowVersion: 2,
      });
    },
  );

  it('[SEN-17] [CL-SEN-12] reads the state of a case from its own decisions, not from those of another case of its game', async () => {
    await insertEventType(db, { id: OTHER_TYPE, name: 'Transfer rumor' });
    const sibling = await insertValidCase(db, {
      playerId: measured.playerId,
      measuredGameId: measured.measuredGameId ?? 0,
      overrides: { eventTypeId: OTHER_TYPE },
    });
    await expect(exclude(decision('playing_time'), sibling.id)).resolves.toStrictEqual(DONE);
    await expect(exclude(decision('unusual_stakes'))).resolves.toStrictEqual(DONE);
    const recorded = await decisions();
    expect(
      recorded.map(({ caseId, exclusionReason, measuredGameId }) => [
        caseId,
        exclusionReason,
        measuredGameId,
      ]),
    ).toStrictEqual([
      [sibling.id, 'playing_time', measured.measuredGameId],
      [measured.id, 'unusual_stakes', measured.measuredGameId],
    ]);
  });

  it('[SEN-17] orders the decisions of a case as they were made, even when the clock stepped back', async () => {
    const restore = installFakeClock(fixedClock(LATER));
    await exclude(decision('injury_return'));
    restore();
    await expect(
      reinstate(decision('incorrect_context_indication', null, 2)),
    ).resolves.toStrictEqual(DONE);
    await expect(exclude(decision('opponent_strength', null, 3))).resolves.toStrictEqual(DONE);
    const recorded = await decisions();
    expect(recorded.map(({ kind, decidedAt }) => [kind, decidedAt])).toStrictEqual([
      ['exclude', new Date(LATER)],
      ['reinstate', new Date(START)],
      ['exclude', new Date(START)],
    ]);
  });

  it('[SEN-17] stores no comment for a blank one on a reason that needs none', async () => {
    await expect(exclude(decision('playing_time', BLANK_COMMENT))).resolves.toStrictEqual(DONE);
    await expect(decisions()).resolves.toStrictEqual([
      expect.objectContaining({ exclusionReason: 'playing_time', comment: null }),
    ]);
  });

  it('[SEN-17] [CL-IHM-18] refuses a decision sent with another version, or on a case that is gone', async () => {
    await expect(exclude(decision('playing_time', null, 0))).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: measured },
    });
    await expect(exclude(decision('playing_time'), measured.id + 1000)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no_longer_exists' },
    });
    await expect(written()).resolves.toStrictEqual(NOTHING_WRITTEN);
  });

  it('[SEN-17] acknowledges a review flag: the flag stays, its to-do item goes, its first instant kept', async () => {
    const [flag] = await db
      .insert(caseReviewFlags)
      .values({
        caseId: measured.id,
        flag: 'first_game_with_new_team',
        measuredGameId: measured.measuredGameId ?? 0,
      })
      .returning();
    const flagId = flag?.id ?? 0;
    const acknowledge = async (id: number) =>
      db.transaction(async (tx) => acknowledgeReviewFlag(tx, id));
    await expect(acknowledge(flagId)).resolves.toStrictEqual(DONE);
    const restore = installFakeClock(fixedClock(LATER));
    await expect(acknowledge(flagId)).resolves.toStrictEqual(DONE);
    restore();
    await expect(db.select().from(caseReviewFlags)).resolves.toStrictEqual([
      expect.objectContaining({ id: flagId, acknowledgedAt: new Date(START) }),
    ]);
    await expect(acknowledge(flagId + 1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no_longer_exists' },
    });
  });
});

import { asc, eq, notInArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  caseHistoryEntries,
  caseReviewFlags,
  caseTriggeredCriteria,
  createTestDatabase,
  games,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  MEDIA_STORM,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { writePlayerCases } from './case-store';

import type { PlayerCaseResults } from './case-store';
import type { CaseRow } from './types';
import type { Database } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { CaseId, EvaluatedCase, PlayerEventId } from '@/lib/stats-engine';
import type { EventRow, ProfiledPlayer } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9));
const MINUTE_MS = 60_000;
const REFERENCE_AT = toEpochMs(Date.UTC(2025, 0, 10, 8));

type EventIds = readonly [PlayerEventId, ...PlayerEventId[]];

/** A media storm case awaiting its game, holding `eventIds`. */
function awaiting(eventIds: EventIds, overrides: Partial<EvaluatedCase> = {}): EvaluatedCase {
  return {
    eventTypeId: MEDIA_STORM,
    eventIds,
    origin: 'historical',
    referenceInstantAt: REFERENCE_AT,
    referenceInstantOrigin: 'date_only',
    status: 'awaiting_game',
    statusReason: 'game_not_played_yet',
    measuredGameId: null,
    teamGamesMissedBefore: null,
    playingTimeThresholdMinutes: null,
    measuredMinutes: null,
    hasRoundedMinutes: null,
    measuredGameScore: null,
    performanceIndex: null,
    baseline: null,
    normalizedGap: null,
    gapStatus: null,
    triggeredCriteria: [],
    opponentStrengthNotEvaluable: false,
    stakesNotEvaluable: false,
    decision: null,
    statusWithoutDecision: null,
    reviewFlags: [],
    isCoOccurring: false,
    coOccurringTypeIds: [],
    ...overrides,
  };
}

/** A media storm case measured on `gameId`, holding `eventIds`, with a final gap of 1.25. */
function measured(
  gameId: number,
  eventIds: EventIds,
  overrides: Partial<EvaluatedCase> = {},
): EvaluatedCase {
  const baseline = { season: '2024-25', phase: 'regular_season', gameCount: 20 } as const;
  return awaiting(eventIds, {
    status: 'measured',
    statusReason: null,
    measuredGameId: gameId,
    teamGamesMissedBefore: 0,
    playingTimeThresholdMinutes: 17.5,
    measuredMinutes: 34.25,
    hasRoundedMinutes: false,
    measuredGameScore: 21.4,
    performanceIndex: 0.625,
    baseline: { ...baseline, mean: 0.5, standardDeviation: 0.1, status: 'final', isPartial: false },
    normalizedGap: 1.25,
    gapStatus: 'final',
    statusWithoutDecision: 'measured',
    ...overrides,
  });
}

/** The history columns of a case awaiting `measuredGameId` for `statusReason`, without a gap. */
const awaitingOn = (measuredGameId: number, statusReason: string) => ({
  status: 'awaiting_game',
  statusReason,
  measuredGameId,
  normalizedGap: null,
  gapStatus: null,
});

/** The case ids a write gave, none when it failed. */
const idsOf = <E>(written: Result<readonly CaseId[], E>): readonly CaseId[] =>
  written.ok ? written.value : [];

describe('the rows of an evaluated case', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let world: ProfiledPlayer;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    world = await profiledPlayer(db);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** The profiled player's first case, its measured game and its one event. */
  function profiled(): Readonly<{ row: CaseRow; gameId: number; event: EventRow }> {
    const [row] = world.cases;
    const event = world.events.find(({ caseId }) => caseId === (row?.id ?? null));
    const gameId = row?.measuredGameId ?? undefined;
    if (row === undefined || event === undefined || gameId === undefined) {
      throw new Error('The first profiled case');
    }
    return { row, gameId, event };
  }

  /** Writes `evaluated` for the profiled player with the job's `cause`, in a transaction of its own. */
  async function write(
    evaluated: readonly EvaluatedCase[],
    { cause = 'recalculation' }: Partial<Pick<PlayerCaseResults, 'cause'>> = {},
  ) {
    const results = { playerId: world.player.id, cases: evaluated, precedences: new Map(), cause };
    return db.transaction(async (tx) => writePlayerCases(tx, results, []));
  }

  /** The game that no case of the profiled player has, the earliest after `rank` others. */
  async function freeGame(rank = 0): Promise<Readonly<{ id: number; tipOff: number }>> {
    const taken = world.cases.flatMap(({ measuredGameId }) => measuredGameId ?? []);
    const [game] = await db
      .select()
      .from(games)
      .where(notInArray(games.id, taken))
      .orderBy(asc(games.scheduledStartAt), asc(games.id))
      .limit(1)
      .offset(rank);
    return { id: game?.id ?? 0, tipOff: game?.scheduledStartAt.getTime() ?? 0 };
  }

  it('[SEN-11] [SEN-13] [SEN-15] rewrites the criteria of a case whole, with their values', async () => {
    const { row, gameId, event } = profiled();
    const criteriaOf = async () =>
      db
        .select()
        .from(caseTriggeredCriteria)
        .where(eq(caseTriggeredCriteria.caseId, row.id))
        .orderBy(asc(caseTriggeredCriteria.id));
    const injuryReturn = [
      {
        criterion: 'injury_return',
        condition: 'flagged',
        triggeringValues: { injuryReturn: 'yes' },
      },
      {
        criterion: 'injury_return',
        condition: 'calculated',
        triggeringValues: { runLength: 5, gamesWithoutBoxScore: 1 },
      },
    ] as const;
    const opponent = {
      criterion: 'opponent_strength',
      condition: null,
      triggeringValues: { wins: 52, losses: 18, isPreviousSeason: false },
    } as const;
    const excluded = (triggeredCriteria: EvaluatedCase['triggeredCriteria']) =>
      measured(gameId, [event.id], { status: 'excluded', triggeredCriteria });

    await write([excluded(injuryReturn)]);
    const first = await criteriaOf();
    await write([excluded(injuryReturn)]);
    const again = await criteriaOf();
    await write([excluded([opponent])]);
    const second = await criteriaOf();
    await write([measured(gameId, [event.id])]);

    expect(first).toMatchObject(
      injuryReturn.map((criterion) => ({ ...criterion, caseId: row.id })),
    );
    expect(again).toStrictEqual(first);
    expect(second).toMatchObject([{ ...opponent, caseId: row.id }]);
    expect(await criteriaOf()).toStrictEqual([]);
  });

  it('[SEN-16] [CL-SEN-12] keeps a review flag and its acknowledgment while its game is unchanged, and drops it for another game or once no longer raised', async () => {
    const { row, gameId, event } = profiled();
    const flagsOf = async () =>
      db.select().from(caseReviewFlags).where(eq(caseReviewFlags.caseId, row.id));
    const flagged = { reviewFlags: ['ejection'] } as const;
    await write([measured(gameId, [event.id], flagged)]);
    const acknowledgedAt = new Date(START + MINUTE_MS);
    await db
      .update(caseReviewFlags)
      .set({ acknowledgedAt })
      .where(eq(caseReviewFlags.caseId, row.id));
    const [raised] = await flagsOf();

    await write([measured(gameId, [event.id], flagged)]);
    const kept = await flagsOf();
    const other = await freeGame();
    await write([measured(other.id, [event.id], flagged)]);
    const moved = await flagsOf();
    await write([measured(other.id, [event.id])]);
    const dropped = await flagsOf();
    await write([measured(other.id, [event.id], flagged)]);
    await write([awaiting([event.id], flagged)]);

    expect(raised).toMatchObject({
      flag: 'ejection',
      measuredGameId: gameId,
      raisedAt: new Date(START),
    });
    expect(kept).toStrictEqual([{ ...raised, acknowledgedAt }]);
    expect(moved).toMatchObject([
      { flag: 'ejection', measuredGameId: other.id, acknowledgedAt: null },
    ]);
    expect(dropped).toStrictEqual([]);
    expect(await flagsOf()).toStrictEqual([]);
  });

  it('[SEN-07] [SEN-08] [SEN-37] [CL-SEN-17] writes a history entry with the job’s cause only when the state, reason, measured game or gap changes, each on its own', async () => {
    const detected = await insertDetectedEvent(db, { playerId: world.player.id });
    const ids = [detected.id] as const;
    const [blocking, next] = [await freeGame(), await freeGame(1)];
    const onBlocking = { measuredGameId: blocking.id } as const;
    const pending = { statusReason: 'statistics_pending' } as const;
    const provisional = { gapStatus: 'provisional' } as const;
    const corrected = {
      measuredMinutes: 30,
      normalizedGap: 1.5,
      gapStatus: 'provisional',
    } as const;
    const steps = [
      { cause: 'new_cases', evaluated: awaiting(ids, onBlocking) },
      { cause: 'recalculation', evaluated: awaiting(ids, onBlocking) },
      { cause: 'recalculation', evaluated: awaiting(ids, { ...onBlocking, ...pending }) },
      {
        cause: 'event_corrected_or_removed',
        evaluated: awaiting(ids, { ...pending, measuredGameId: next.id }),
      },
      { cause: 'recalculation', evaluated: measured(next.id, ids, provisional) },
      {
        cause: 'stats_correction',
        evaluated: measured(next.id, ids, { ...provisional, measuredMinutes: 30 }),
      },
      { cause: 'stats_correction', evaluated: measured(next.id, ids, corrected) },
      {
        cause: 'baseline_updated',
        evaluated: measured(next.id, ids, { ...corrected, gapStatus: 'final' }),
      },
      {
        cause: 'parameter_change',
        evaluated: measured(next.id, ids, { ...corrected, gapStatus: 'final', status: 'excluded' }),
      },
    ] as const;

    const [caseId = 0] = idsOf(await write([steps[0].evaluated], { cause: steps[0].cause }));
    for (const { evaluated, cause } of steps.slice(1)) {
      await write([evaluated], { cause });
    }

    const history = await db
      .select()
      .from(caseHistoryEntries)
      .where(eq(caseHistoryEntries.caseId, caseId))
      .orderBy(asc(caseHistoryEntries.id));
    const measuredOn = (status: string, normalizedGap: number, gapStatus: string) => ({
      status,
      statusReason: null,
      measuredGameId: next.id,
      normalizedGap,
      gapStatus,
    });
    expect(history).toMatchObject([
      {
        ...awaitingOn(blocking.id, 'game_not_played_yet'),
        cause: 'new_cases',
        recordedAt: new Date(START),
      },
      { ...awaitingOn(blocking.id, 'statistics_pending'), cause: 'recalculation' },
      { ...awaitingOn(next.id, 'statistics_pending'), cause: 'event_corrected_or_removed' },
      { ...measuredOn('measured', 1.25, 'provisional'), cause: 'recalculation' },
      { ...measuredOn('measured', 1.5, 'provisional'), cause: 'stats_correction' },
      { ...measuredOn('measured', 1.5, 'final'), cause: 'baseline_updated' },
      { ...measuredOn('excluded', 1.5, 'final'), cause: 'parameter_change' },
    ]);
  });
});

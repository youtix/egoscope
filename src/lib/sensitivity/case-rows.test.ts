import { asc, eq, inArray, notInArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  caseHistoryEntries,
  caseReviewFlags,
  cases,
  caseTriggeredCriteria,
  createTestDatabase,
  events,
  games,
} from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  MEDIA_STORM,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, gameDay, installFakeClock, toEpochMs } from '@/lib/time';

import { writePlayerCases } from './case-store';
import { eraseEventData } from './erase';

import type { PlayerCaseResults } from './case-store';
import type { CaseRow } from './types';
import type { Database } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { CaseId, EvaluatedCase, PlayerEventId } from '@/lib/stats-engine';
import type { EventRow, ProfiledPlayer } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9));
const LATER = toEpochMs(Date.UTC(2026, 10, 26, 9));
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

  /** The profiled player's case `index`, its measured game and its one event. */
  function profiled(index = 0): Readonly<{ row: CaseRow; gameId: number; event: EventRow }> {
    const row = world.cases.at(index);
    const event = world.events.find(({ caseId }) => caseId === (row?.id ?? null));
    const gameId = row?.measuredGameId ?? undefined;
    if (row === undefined || event === undefined || gameId === undefined) {
      throw new Error(`The profiled case ${String(index)}`);
    }
    return { row, gameId, event };
  }

  async function caseOf(caseId: CaseId = 0): Promise<CaseRow | undefined> {
    const [row] = await db.select().from(cases).where(eq(cases.id, caseId));
    return row;
  }

  /** The profiled player's birthday that `game` derives, a calendar-derived event recorded at `createdAt`. */
  async function insertBirthday(
    game: Readonly<{ id: number; tipOff: number }>,
    createdAt: Date,
  ): Promise<PlayerEventId> {
    const [derived] = await db
      .insert(events)
      .values({
        playerId: world.player.id,
        eventTypeId: BIRTHDAY,
        sheetEventTypeId: BIRTHDAY,
        sheetVersionNumber: 1,
        origin: 'calendar',
        derivedGameId: game.id,
        createdAt,
        description: 'The player plays on his birthday.',
        referenceDateOn: gameDay(toEpochMs(game.tipOff)),
      })
      .returning({ id: events.id });
    return derived?.id ?? 0;
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

  it('[SEN-11] [SEN-13] [SEN-15] rewrites the criteria of each case whole, with their values, whenever they change, those alone included, and only then', async () => {
    const [one, other] = [profiled(0), profiled(1)];
    const criteriaOf = async () =>
      db
        .select()
        .from(caseTriggeredCriteria)
        .where(inArray(caseTriggeredCriteria.caseId, [one.row.id, other.row.id]))
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
    // A box-score correction raises the minutes, still under the threshold: the values alone change.
    const playingTime = (minutes: number) =>
      ({
        criterion: 'playing_time_too_low',
        condition: null,
        triggeringValues: { minutes, threshold: 17.5 },
      }) as const;
    type Criteria = EvaluatedCase['triggeredCriteria'];
    const excluded = (ones: Criteria, others: Criteria) => [
      measured(one.gameId, [one.event.id], { status: 'excluded', triggeredCriteria: ones }),
      measured(other.gameId, [other.event.id], { status: 'excluded', triggeredCriteria: others }),
    ];

    await write(excluded(injuryReturn, [playingTime(14)]));
    const first = await criteriaOf();
    // A change of a key column moves the first row after the others, and back keeps its values:
    // stored last, it still comes first, since the store reads the criteria by id.
    const moved = eq(caseTriggeredCriteria.id, first[0]?.id ?? 0);
    await db.update(caseTriggeredCriteria).set({ condition: null }).where(moved);
    await db
      .update(caseTriggeredCriteria)
      .set({ condition: injuryReturn[0].condition })
      .where(moved);
    await write(excluded(injuryReturn, [playingTime(14)]));
    const again = await criteriaOf();
    await write(excluded([opponent], [playingTime(15)]));
    const second = await criteriaOf();
    await write([one, other].map(({ gameId, event }) => measured(gameId, [event.id])));

    expect(first).toMatchObject([
      ...injuryReturn.map((criterion) => ({ ...criterion, caseId: one.row.id })),
      { ...playingTime(14), caseId: other.row.id },
    ]);
    expect(again).toStrictEqual(first);
    expect(second).toMatchObject([
      { ...opponent, caseId: one.row.id },
      { ...playingTime(15), caseId: other.row.id },
    ]);
    expect(await criteriaOf()).toStrictEqual([]);
  });

  it('[SEN-07] [CL-SEN-05] writes every column that the recalculation of a case computes, on a new case and on a kept one', async () => {
    const detected = await insertDetectedEvent(db, { playerId: world.player.id });
    const [first, second] = [await freeGame(), await freeGame(1)];
    const pending = awaiting([detected.id], {
      referenceInstantAt: null,
      referenceInstantOrigin: 'known_in_advance',
      statusReason: 'statistics_pending',
      measuredGameId: first.id,
    });
    const [caseId = 0] = idsOf(await write([pending]));
    const created = await caseOf(caseId);
    const restoreClock = installFakeClock(fixedClock(LATER));
    const otherwise = {
      teamGamesMissedBefore: 2,
      hasRoundedMinutes: true,
      gapStatus: 'provisional',
      opponentStrengthNotEvaluable: true,
      stakesNotEvaluable: true,
    } as const;
    await write([measured(second.id, [detected.id], otherwise)]);
    restoreClock();

    const fixed = {
      id: caseId,
      playerId: world.player.id,
      eventTypeId: MEDIA_STORM,
      origin: 'tracked',
      createdAt: detected.createdAt,
      rowVersion: 1,
    };
    const unmeasured = {
      teamGamesMissedBefore: null,
      playingTimeThresholdMinutes: null,
      measuredMinutes: null,
      hasRoundedMinutes: null,
      measuredGameScore: null,
      performanceIndex: null,
      baselineSeason: null,
      baselinePhase: null,
      baselineGameCount: null,
      baselineMean: null,
      baselineStandardDeviation: null,
      baselineStatus: null,
      baselineIsPartial: null,
      normalizedGap: null,
      gapStatus: null,
    };
    expect(created).toStrictEqual({
      ...fixed,
      ...unmeasured,
      status: 'awaiting_game',
      statusReason: 'statistics_pending',
      referenceInstantAt: null,
      referenceInstantOrigin: 'known_in_advance',
      measuredGameId: first.id,
      opponentStrengthNotEvaluable: false,
      stakesNotEvaluable: false,
      computedAt: new Date(START),
    });
    expect(await caseOf(caseId)).toStrictEqual({
      ...fixed,
      ...otherwise,
      status: 'measured',
      statusReason: null,
      referenceInstantAt: new Date(REFERENCE_AT),
      referenceInstantOrigin: 'date_only',
      measuredGameId: second.id,
      playingTimeThresholdMinutes: 17.5,
      measuredMinutes: 34.25,
      measuredGameScore: 21.4,
      performanceIndex: 0.625,
      baselineSeason: '2024-25',
      baselinePhase: 'regular_season',
      baselineGameCount: 20,
      baselineMean: 0.5,
      baselineStandardDeviation: 0.1,
      baselineStatus: 'final',
      baselineIsPartial: false,
      normalizedGap: 1.25,
      computedAt: new Date(LATER),
    });
  });

  it.each([
    { recorded: 'a calendar-derived event a minute before its game’s tip-off', offset: -1 },
    { recorded: 'a calendar-derived event at its game’s tip-off', offset: 0 },
    { recorded: 'a detected event', offset: null },
  ] as const)(
    '[CL-VUE-13] [SUI-04] [SUI-05] gives the new case of $recorded its origin and creation instant',
    async ({ offset }) => {
      const game = await freeGame();
      const createdAt = new Date(toEpochMs(game.tipOff + (offset ?? -1) * MINUTE_MS));
      await insertCalendarType(db);
      const derived = await insertBirthday(game, createdAt);
      const detected = await insertDetectedEvent(db, {
        playerId: world.player.id,
        overrides: { createdAt },
      });
      const known = {
        referenceInstantAt: null,
        referenceInstantOrigin: 'known_in_advance',
      } as const;

      const written = await write([
        offset === null
          ? awaiting([detected.id])
          : awaiting([derived], { eventTypeId: BIRTHDAY, ...known }),
      ]);

      expect(await caseOf(idsOf(written)[0])).toMatchObject({
        origin: offset === 0 ? 'historical' : 'tracked',
        createdAt,
      });
    },
  );

  it('[SUI-04] [CL-SUI-17] keeps the origin and creation instant of a historical case that an earlier-recorded detected event joins, and leaves its rebuild free to set them again', async () => {
    const { row, gameId, event } = profiled();
    const detectedAt = new Date(event.createdAt.getTime() - MINUTE_MS);
    const detected = await insertDetectedEvent(db, {
      playerId: world.player.id,
      overrides: { createdAt: detectedAt },
    });
    await write([measured(gameId, [event.id, detected.id], { origin: 'tracked' })]);
    const joined = await caseOf(row.id);

    await db.transaction(async (tx) => {
      await tx.delete(events).where(eq(events.id, event.id));
      await eraseEventData(tx, row.id, 'withdrawal');
    });

    expect(joined).toMatchObject({ origin: 'historical', createdAt: row.createdAt });
    expect(await caseOf(row.id)).toMatchObject({ origin: 'tracked', createdAt: detectedAt });
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

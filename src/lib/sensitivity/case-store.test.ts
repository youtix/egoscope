import { asc, eq, inArray, notInArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  caseHistoryEntries,
  caseManualDecisions,
  caseReviewFlags,
  cases,
  caseTriggeredCriteria,
  createTestDatabase,
  events,
  games,
} from '@/lib/db';
import { err, ok } from '@/lib/result';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  insertHistoricalEvent,
  MEDIA_STORM,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, gameDay, installFakeClock, toEpochMs } from '@/lib/time';

import { writePlayerCases } from './case-store';
import { eraseEventData } from './erase';

import type { PlayerCaseResults } from './case-store';
import type { CaseRow, RegroupingReactions } from './types';
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

/** The case ids a write gave, none when it failed. */
const idsOf = <E>(written: Result<readonly CaseId[], E>): readonly CaseId[] =>
  written.ok ? written.value : [];

/**
 * A reaction that records its call in `calls`, with the emptied case and the events of the
 * surviving case as it reads them, and gives `answer`.
 */
function recording(
  calls: unknown[],
  name: string,
  answer: Result<undefined, string> = ok(undefined),
): RegroupingReactions<string> {
  return async (tx, regrouping) => {
    const { emptiedCaseId, survivingCaseId } = regrouping;
    const [emptied] = await tx.select().from(cases).where(eq(cases.id, emptiedCaseId));
    const joined = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.caseId, survivingCaseId))
      .orderBy(asc(events.id));
    calls.push({ name, regrouping, emptied, joined: joined.map(({ id }) => id) });
    return answer;
  };
}

/** A reaction that writes a history row on the surviving case. */
const writing: RegroupingReactions<string> = async (tx, { survivingCaseId }) => {
  await tx
    .insert(caseHistoryEntries)
    .values({ caseId: survivingCaseId, status: 'measured', cause: 'new_cases' });
  return ok(undefined);
};

describe('the writer of a player’s evaluated cases', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
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
  function profiled(index: number): Readonly<{ row: CaseRow; gameId: number; event: EventRow }> {
    const row = world.cases.at(index);
    const event = world.events.find(({ caseId }) => caseId === (row?.id ?? null));
    const gameId = row?.measuredGameId ?? undefined;
    if (row === undefined || event === undefined || gameId === undefined) {
      throw new Error(`The profiled case ${String(index)}`);
    }
    return { row, gameId, event };
  }

  /** What a write of the tests may set besides its cases: the reactions, the precedences and the cause. */
  type WriteOptions = Partial<Pick<PlayerCaseResults, 'precedences' | 'cause'>> &
    Readonly<{ reactions?: readonly RegroupingReactions<string>[] }>;

  /** Writes `evaluated` for the profiled player, in a transaction of its own. */
  async function write(evaluated: readonly EvaluatedCase[], options: WriteOptions = {}) {
    const { reactions = [], precedences = new Map(), cause = 'recalculation' } = options;
    const results = { playerId: world.player.id, cases: evaluated, precedences, cause };
    return db.transaction(async (tx) => writePlayerCases(tx, results, reactions));
  }

  async function caseOf(caseId: CaseId = 0): Promise<CaseRow | undefined> {
    const [row] = await db.select().from(cases).where(eq(cases.id, caseId));
    return row;
  }

  async function eventOf(eventId: number): Promise<EventRow | undefined> {
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    return row;
  }

  /** The earliest game that no case of the profiled player has. */
  async function freeGame(): Promise<Readonly<{ id: number; tipOff: number }>> {
    const taken = world.cases.flatMap(({ measuredGameId }) => measuredGameId ?? []);
    const [game] = await db
      .select()
      .from(games)
      .where(notInArray(games.id, taken))
      .orderBy(asc(games.scheduledStartAt))
      .limit(1);
    return { id: game?.id ?? 0, tipOff: game?.scheduledStartAt.getTime() ?? 0 };
  }

  /** How many history rows, flags, decisions and criteria the case `caseId` has. */
  async function childCounts(caseId: number): Promise<readonly number[]> {
    const tables = [
      caseHistoryEntries,
      caseReviewFlags,
      caseManualDecisions,
      caseTriggeredCriteria,
    ];
    const counts = [];
    for (const table of tables) {
      const rows = await db.select({ id: table.id }).from(table).where(eq(table.caseId, caseId));
      counts.push(rows.length);
    }
    return counts;
  }

  it('[SEN-05] [CL-VUE-03] [SUI-04] moves an event to the stored case of its new game, its origin and creation instant unchanged, and deletes the emptied case with its rows', async () => {
    const kept = profiled(0);
    const emptied = profiled(1);
    const caseId = emptied.row.id;
    await db.insert(caseHistoryEntries).values({ caseId, status: 'measured', cause: 'new_cases' });
    await db
      .insert(caseReviewFlags)
      .values({ caseId, flag: 'ejection', measuredGameId: emptied.gameId });
    await db.insert(caseManualDecisions).values({
      caseId,
      kind: 'exclude',
      exclusionReason: 'playing_time',
      previousStatus: 'measured',
      measuredGameId: emptied.gameId,
    });
    await db.insert(caseTriggeredCriteria).values({
      caseId,
      criterion: 'playing_time_too_low',
      triggeringValues: { minutes: 14, threshold: 17.5 },
    });

    const written = await write([
      measured(kept.gameId, [kept.event.id, emptied.event.id], { origin: 'tracked' }),
    ]);

    expect(written).toStrictEqual(ok([kept.row.id]));
    expect(await caseOf(kept.row.id)).toMatchObject({
      origin: kept.row.origin,
      createdAt: kept.row.createdAt,
      measuredMinutes: 34.25,
      measuredGameScore: 21.4,
      baselineMean: 0.5,
      normalizedGap: 1.25,
      computedAt: new Date(START),
    });
    expect([await eventOf(emptied.event.id), await eventOf(kept.event.id)]).toMatchObject([
      { caseId: kept.row.id, rowVersion: emptied.event.rowVersion + 1 },
      { caseId: kept.row.id, rowVersion: kept.event.rowVersion },
    ]);
    expect(await caseOf(caseId)).toBeUndefined();
    expect(await childCounts(caseId)).toStrictEqual([0, 0, 0, 0]);
  });

  it('[CL-VUE-03] keeps the case of the earliest-recorded event of a group whose game has no case, else makes a new one', async () => {
    const moved = profiled(2);
    const split = profiled(3);
    const later = await insertHistoricalEvent(db, {
      playerId: world.player.id,
      originImportId: world.imported.id,
      overrides: { caseId: split.row.id, createdAt: new Date(START + MINUTE_MS) },
    });
    const game = await freeGame();

    const written = await write([
      measured(game.id, [moved.event.id]),
      measured(split.gameId, [split.event.id]),
      awaiting([later.id]),
    ]);

    const created = idsOf(written)[2];
    expect(idsOf(written)).toStrictEqual([moved.row.id, split.row.id, created]);
    expect(await caseOf(moved.row.id)).toMatchObject({ measuredGameId: game.id });
    expect(await caseOf(created)).toMatchObject({
      origin: 'historical',
      createdAt: new Date(START + MINUTE_MS),
      status: 'awaiting_game',
      measuredGameId: null,
    });
    expect(await eventOf(later.id)).toMatchObject({ caseId: created });
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
        .returning();
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
          : awaiting([derived?.id ?? 0], { eventTypeId: BIRTHDAY, ...known }),
      ]);

      expect(await caseOf(idsOf(written)[0])).toMatchObject({
        origin: offset === 0 ? 'historical' : 'tracked',
        createdAt,
      });
    },
  );

  it('[CL-SUI-17] leaves the rebuild of a written case free to set its origin and creation instant again', async () => {
    const { row, gameId, event } = profiled(0);
    const detected = await insertDetectedEvent(db, {
      playerId: world.player.id,
      overrides: { createdAt: new Date(START + MINUTE_MS) },
    });
    await write([measured(gameId, [event.id, detected.id])]);

    await db.transaction(async (tx) => {
      await tx.delete(events).where(eq(events.id, event.id));
      await eraseEventData(tx, row.id, 'withdrawal');
    });

    expect(await caseOf(row.id)).toMatchObject({
      origin: 'tracked',
      createdAt: new Date(START + MINUTE_MS),
    });
  });

  it('[CL-SUI-16] [CL-VUE-03] runs the regrouping reactions in order once the event has joined, while the emptied case is as it was, then deletes it, and deletes a case it finds with no event without a reaction', async () => {
    const kept = profiled(0);
    const emptied = profiled(1);
    const [orphan] = await db
      .insert(cases)
      .values({
        playerId: world.player.id,
        eventTypeId: MEDIA_STORM,
        origin: 'historical',
        status: 'awaiting_game',
        statusReason: 'game_not_played_yet',
        referenceInstantOrigin: 'known_in_advance',
      })
      .returning();
    const calls: unknown[] = [];

    const written = await write([measured(kept.gameId, [kept.event.id, emptied.event.id])], {
      reactions: [recording(calls, 'notifications'), recording(calls, 'tracking')],
    });

    expect(written.ok).toBe(true);
    const regrouping = { emptiedCaseId: emptied.row.id, survivingCaseId: kept.row.id };
    const joined = [kept.event.id, emptied.event.id];
    expect(calls).toStrictEqual(
      ['notifications', 'tracking'].map((name) => ({
        name,
        regrouping,
        emptied: emptied.row,
        joined,
      })),
    );
    expect([await caseOf(emptied.row.id), await caseOf(orphan?.id)]).toStrictEqual([
      undefined,
      undefined,
    ]);
  });

  it('[CL-SUI-16] stops at a failed reaction and rolls every write back, the earlier reactions’ included', async () => {
    const kept = profiled(0);
    const emptied = profiled(1);
    const calls: unknown[] = [];
    const reactions = [
      writing,
      recording(calls, 'failing', err('refused')),
      recording(calls, 'never'),
    ];

    const written = await write([measured(kept.gameId, [kept.event.id, emptied.event.id])], {
      reactions,
    });

    expect(written).toStrictEqual(err('refused'));
    expect(calls).toMatchObject([{ name: 'failing' }]);
    expect([await caseOf(emptied.row.id), await caseOf(kept.row.id)]).toStrictEqual([
      emptied.row,
      kept.row,
    ]);
    expect(await eventOf(emptied.event.id)).toStrictEqual(emptied.event);
    expect(await childCounts(kept.row.id)).toStrictEqual([0, 0, 0, 0]);
  });

  it('[SEN-11] [SEN-13] [SEN-15] [SEN-17] rewrites the criteria of a case whole, with their values', async () => {
    const { row, gameId, event } = profiled(0);
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

  it('[SEN-16] [CL-SEN-12] keeps a review flag and its acknowledgment while its game is unchanged, and drops it for another game', async () => {
    const { row, gameId, event } = profiled(0);
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
    expect(await flagsOf()).toStrictEqual([]);
  });

  it('[SEN-07] [SEN-08] [SEN-37] [CL-SEN-17] writes a history entry with the job’s cause only when the state, reason, game or gap changes', async () => {
    const detected = await insertDetectedEvent(db, { playerId: world.player.id });
    const { id: gameId } = await freeGame();
    const caseId = idsOf(await write([awaiting([detected.id])], { cause: 'new_cases' }))[0];

    await write([awaiting([detected.id])], { cause: 'recalculation' });
    await write([measured(gameId, [detected.id])], { cause: 'baseline_updated' });
    await write([measured(gameId, [detected.id], { measuredMinutes: 30 })]);
    const corrected = { normalizedGap: -0.5, gapStatus: 'provisional' } as const;
    await write([measured(gameId, [detected.id], corrected)], { cause: 'stats_correction' });

    const history = await db
      .select()
      .from(caseHistoryEntries)
      .where(eq(caseHistoryEntries.caseId, caseId ?? 0))
      .orderBy(asc(caseHistoryEntries.id));
    const game = { status: 'measured', statusReason: null, measuredGameId: gameId } as const;
    expect(history).toMatchObject([
      {
        status: 'awaiting_game',
        statusReason: 'game_not_played_yet',
        measuredGameId: null,
        normalizedGap: null,
        gapStatus: null,
        cause: 'new_cases',
        recordedAt: new Date(START),
      },
      { ...game, normalizedGap: 1.25, gapStatus: 'final', cause: 'baseline_updated' },
      { ...game, ...corrected, cause: 'stats_correction' },
    ]);
  });

  it('[IMP-18] [CA-IMP-10] [CL-IMP-17] writes each historical event’s precedence with its case, to verify, then classified', async () => {
    const { row, gameId, event } = profiled(0);

    await write([awaiting([event.id], { statusReason: 'precedence_to_verify' })], {
      precedences: new Map([[event.id, 'to_verify']]),
    });
    const toVerify = await eventOf(event.id);
    await write([measured(gameId, [event.id])], {
      precedences: new Map([[event.id, 'established']]),
    });

    expect(toVerify).toMatchObject({ caseId: row.id, precedence: 'to_verify' });
    expect(await eventOf(event.id)).toMatchObject({ caseId: row.id, precedence: 'established' });
  });

  it('[CL-IMP-17] [CA-IMP-10] [SEN-36] changes nothing when it writes the same results again', async () => {
    const kept = profiled(0);
    const emptied = profiled(1);
    const detected = await insertDetectedEvent(db, { playerId: world.player.id });
    const results = [
      measured(kept.gameId, [kept.event.id, emptied.event.id], { reviewFlags: ['ejection'] }),
      awaiting([detected.id], { status: 'not_measurable', statusReason: 'no_game_within_window' }),
    ];
    const precedences = new Map([[kept.event.id, 'established' as const]]);
    const eventIds = [kept.event.id, emptied.event.id, detected.id];
    const snapshot = async () => [
      await db.select().from(cases).orderBy(asc(cases.id)),
      await db.select().from(caseHistoryEntries).orderBy(asc(caseHistoryEntries.id)),
      await db.select().from(caseReviewFlags).orderBy(asc(caseReviewFlags.id)),
      await db.select().from(caseTriggeredCriteria).orderBy(asc(caseTriggeredCriteria.id)),
      await db.select().from(events).where(inArray(events.id, eventIds)).orderBy(asc(events.id)),
    ];
    const first = await write(results, { precedences });
    const before = await snapshot();
    const restoreClock = installFakeClock(fixedClock(LATER));

    const second = await write(results, { precedences });
    restoreClock();

    expect(second).toStrictEqual(first);
    expect(await snapshot()).toStrictEqual(before);
  });

  it('[SEN-05] refuses, as a bug, an evaluated case none of whose events is stored', async () => {
    await expect(write([awaiting([999_999])])).rejects.toThrow(
      'The case store found no stored event of the case of event 999999.',
    );
  });
});

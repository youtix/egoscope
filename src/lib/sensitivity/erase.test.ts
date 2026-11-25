import { asc, eq } from 'drizzle-orm';
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
  recalculationJobs,
} from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  insertHistoricalEvent,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, gameDay, installFakeClock, toEpochMs } from '@/lib/time';

import { eraseEventData, erasePlayerJobs } from './erase';

import type { ErasureCause } from './erase';
import type { CaseRow, NewRecalculationJobRow } from './types';
import type { Database } from '@/lib/db';
import type { EventRow, ProfiledPlayer } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9));
// The instants the tests record events, history rows, flags and decisions at, a minute apart.
const RECORDING_DAY = Date.UTC(2026, 10, 2, 12);
const MINUTE_MS = 60_000;
// The players that the recalculation jobs name: invented identifiers, no other row needs them.
const HIM = '00000000-0000-4000-8000-000000000201';
const OTHER = '00000000-0000-4000-8000-000000000202';
const THIRD = '00000000-0000-4000-8000-000000000203';

/** The instant `minutes` after the recording day's noon. */
const at = (minutes: number): Date => new Date(toEpochMs(RECORDING_DAY + minutes * MINUTE_MS));

describe(
  'the sensitivity step of an event’s erasure',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
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

    /** The profiled player's case `index` and its one event, recorded at `at(0)`. */
    async function profiledCase(
      index: number,
    ): Promise<Readonly<{ row: CaseRow; event: EventRow }>> {
      const row = world.cases.at(index);
      if (row === undefined) {
        throw new Error(`The profiled case ${String(index)}`);
      }
      const event = world.events.find((candidate) => candidate.caseId === row.id);
      if (event === undefined) {
        throw new Error(`The profiled case ${String(index)} and its event`);
      }
      await db
        .update(events)
        .set({ createdAt: at(0) })
        .where(eq(events.id, event.id));
      await db
        .update(cases)
        .set({ createdAt: at(0) })
        .where(eq(cases.id, row.id));
      return { row: { ...row, createdAt: at(0) }, event };
    }

    /** A detected media storm of the profiled player in `caseId`, recorded at `createdAt`. */
    async function detectedIn(caseId: number, createdAt: Date): Promise<EventRow> {
      return insertDetectedEvent(db, {
        playerId: world.player.id,
        overrides: { caseId, createdAt },
      });
    }

    /** A historical media storm of the profiled player's import in `caseId`, or in none, recorded at `createdAt`. */
    async function historicalIn(caseId: number | null, createdAt: Date): Promise<EventRow> {
      return insertHistoricalEvent(db, {
        playerId: world.player.id,
        originImportId: world.imported.id,
        overrides: { caseId, createdAt },
      });
    }

    /** A history row, a review flag `flag` and an exclusion of `row`, each dated `when`. */
    async function traceOf(
      row: CaseRow,
      when: Date,
      flag: 'ejection' | 'first_game_with_new_team',
    ) {
      const measuredGameId = row.measuredGameId ?? 0;
      await db.insert(caseHistoryEntries).values({
        caseId: row.id,
        recordedAt: when,
        status: 'measured',
        measuredGameId,
        normalizedGap: row.normalizedGap,
        gapStatus: row.gapStatus,
        cause: 'new_cases',
      });
      await db
        .insert(caseReviewFlags)
        .values({ caseId: row.id, flag, measuredGameId, raisedAt: when });
      await db.insert(caseManualDecisions).values({
        caseId: row.id,
        decidedAt: when,
        kind: 'exclude',
        exclusionReason: 'playing_time',
        previousStatus: 'measured',
        measuredGameId,
      });
    }

    /** Erases `event` as `events.eraseEvent` does, then runs the sensitivity step for its case. */
    async function erase(event: EventRow, cause: ErasureCause): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.delete(events).where(eq(events.id, event.id));
        await eraseEventData(tx, event.caseId, cause);
      });
    }

    /** The case `caseId`, or undefined once deleted. */
    async function caseOf(caseId: number): Promise<CaseRow | undefined> {
      const [row] = await db.select().from(cases).where(eq(cases.id, caseId));
      return row;
    }

    /** The instants of the history rows, flags and decisions of `caseId`, in order. */
    async function tracesOf(caseId: number) {
      const history = await db
        .select({ at: caseHistoryEntries.recordedAt })
        .from(caseHistoryEntries)
        .where(eq(caseHistoryEntries.caseId, caseId))
        .orderBy(asc(caseHistoryEntries.recordedAt));
      const flags = await db
        .select({ flag: caseReviewFlags.flag, at: caseReviewFlags.raisedAt })
        .from(caseReviewFlags)
        .where(eq(caseReviewFlags.caseId, caseId))
        .orderBy(asc(caseReviewFlags.raisedAt));
      const decisions = await db
        .select({ at: caseManualDecisions.decidedAt })
        .from(caseManualDecisions)
        .where(eq(caseManualDecisions.caseId, caseId))
        .orderBy(asc(caseManualDecisions.decidedAt));
      const criteria = await db
        .select({ criterion: caseTriggeredCriteria.criterion })
        .from(caseTriggeredCriteria)
        .where(eq(caseTriggeredCriteria.caseId, caseId));
      return {
        history: history.map((row) => row.at),
        flags: flags.map((row) => ({ flag: row.flag, at: row.at })),
        decisions: decisions.map((row) => row.at),
        criteria: criteria.map((row) => row.criterion),
      };
    }

    it.each<ErasureCause>(['withdrawal', 'player_deletion'])(
      '[DSN-27] [JOU-24] deletes a case left with no event, with its criteria, flags, decisions and history (%s)',
      async (cause) => {
        const { row, event } = await profiledCase(0);
        const { row: other } = await profiledCase(1);
        await traceOf(row, at(1), 'ejection');
        await traceOf(other, at(1), 'ejection');
        await db.insert(caseTriggeredCriteria).values({
          caseId: row.id,
          criterion: 'manual',
          triggeringValues: {},
        });

        await erase(event, cause);

        expect(await caseOf(row.id)).toBeUndefined();
        expect(await tracesOf(row.id)).toStrictEqual({
          history: [],
          flags: [],
          decisions: [],
          criteria: [],
        });
        expect(await caseOf(other.id)).toStrictEqual(other);
        expect(await tracesOf(other.id)).toStrictEqual({
          history: [at(1)],
          flags: [{ flag: 'ejection', at: at(1) }],
          decisions: [at(1)],
          criteria: [],
        });
      },
    );

    it.each<ErasureCause>([
      'withdrawal',
      'requalification_erasure',
      'split_erasure',
      'restore_reapplication',
    ])(
      '[CL-SUI-17] [DSN-27] rebuilds a shared case from its earliest-recorded remaining event (%s)',
      async (cause) => {
        const { row, event } = await profiledCase(0);
        await historicalIn(row.id, at(30));
        await detectedIn(row.id, at(20));
        await traceOf(row, at(10), 'ejection');
        await traceOf(row, at(20), 'first_game_with_new_team');
        await db.insert(caseHistoryEntries).values({
          caseId: row.id,
          recordedAt: at(40),
          status: 'excluded',
          measuredGameId: row.measuredGameId,
          normalizedGap: row.normalizedGap,
          gapStatus: row.gapStatus,
          cause: 'manual_decision',
        });

        await erase(event, cause);

        expect(await caseOf(row.id)).toStrictEqual({
          ...row,
          origin: 'tracked',
          createdAt: at(20),
        });
        expect(await tracesOf(row.id)).toStrictEqual({
          history: [at(20), at(40)],
          flags: [{ flag: 'first_game_with_new_team', at: at(20) }],
          decisions: [at(10), at(20)],
          criteria: [],
        });
      },
    );

    it('[CL-SUI-17] [SUI-07] gives a rebuilt case the historical origin of an imported earliest event', async () => {
      const { row } = await profiledCase(0);
      await db.update(cases).set({ origin: 'tracked' }).where(eq(cases.id, row.id));
      const first = await detectedIn(row.id, at(-5));
      await detectedIn(row.id, at(15));
      await db
        .update(cases)
        .set({ createdAt: at(-5) })
        .where(eq(cases.id, row.id));

      await erase(first, 'withdrawal');

      expect(await caseOf(row.id)).toMatchObject({ origin: 'historical', createdAt: at(0) });
    });

    it.each([
      { recorded: 'a minute before its game’s tip-off', offsetMinutes: -1, origin: 'tracked' },
      { recorded: 'at its game’s tip-off', offsetMinutes: 0, origin: 'historical' },
    ] as const)(
      '[CL-SUI-17] [CL-VUE-13] gives a rebuilt case the origin of a calendar-derived event recorded $recorded',
      async ({ offsetMinutes, origin }) => {
        await insertCalendarType(db);
        const [game] = await db.select().from(games).orderBy(asc(games.scheduledStartAt)).limit(1);
        const tipOff = game?.scheduledStartAt.getTime() ?? 0;
        const [birthday] = await db
          .insert(cases)
          .values({
            playerId: world.player.id,
            eventTypeId: BIRTHDAY,
            origin: 'tracked',
            createdAt: at(0),
            status: 'awaiting_game',
            statusReason: 'game_not_played_yet',
            referenceInstantOrigin: 'known_in_advance',
          })
          .returning();
        const caseId = birthday?.id ?? 0;
        const ofBirthday = { eventTypeId: BIRTHDAY, sheetEventTypeId: BIRTHDAY, caseId } as const;
        const erased = await insertDetectedEvent(db, {
          playerId: world.player.id,
          overrides: { ...ofBirthday, createdAt: at(0) },
        });
        const createdAt = new Date(toEpochMs(tipOff + offsetMinutes * MINUTE_MS));
        await db.insert(events).values({
          ...ofBirthday,
          playerId: world.player.id,
          sheetVersionNumber: 1,
          origin: 'calendar',
          description: 'The player plays on his birthday.',
          referenceDateOn: gameDay(toEpochMs(tipOff)),
          derivedGameId: game?.id,
          createdAt,
        });

        await erase(erased, 'withdrawal');

        expect(await caseOf(caseId)).toMatchObject({ origin, createdAt });
      },
    );

    it('[JOU-24] [CL-SUI-17] rebuilds no case at a player-data deletion', async () => {
      const { row, event } = await profiledCase(0);
      await detectedIn(row.id, at(20));
      await traceOf(row, at(10), 'ejection');
      const before = await tracesOf(row.id);

      await erase(event, 'player_deletion');

      expect(await caseOf(row.id)).toStrictEqual(row);
      expect(await tracesOf(row.id)).toStrictEqual(before);
    });

    it('[DSN-27] leaves every case as it was for an event that had no case', async () => {
      const before = await db.select().from(cases).orderBy(asc(cases.id));
      const loose = await historicalIn(null, at(5));

      await erase(loose, 'withdrawal');

      expect(await db.select().from(cases).orderBy(asc(cases.id))).toStrictEqual(before);
    });
  },
);

describe(
  'the erasure of a deleted player from the recalculation jobs',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      return database.close;
    }, DATABASE_TEST_TIMEOUT_MS);

    /** Records a job of the import scope with the cause "new cases", `values` written otherwise. */
    async function recordJob(values: Partial<NewRecalculationJobRow>): Promise<number> {
      const [job] = await db
        .insert(recalculationJobs)
        .values({ scope: 'import', cause: 'new_cases', ...values })
        .returning({ id: recalculationJobs.id });
      return job?.id ?? 0;
    }

    /** The players of each job left, by id. */
    async function jobsLeft() {
      return db
        .select({
          id: recalculationJobs.id,
          playerIds: recalculationJobs.playerIds,
          status: recalculationJobs.status,
        })
        .from(recalculationJobs)
        .orderBy(asc(recalculationJobs.id));
    }

    /** Erases him, the deleted player, from the jobs in a transaction of its own. */
    async function eraseHisJobs(): Promise<void> {
      await db.transaction(async (tx) => erasePlayerJobs(tx, HIM));
    }

    it('[JOU-24] [CL-JOU-06] takes him out of the pending jobs and deletes those he alone was in', async () => {
      await recordJob({ playerIds: [HIM] });
      const shared = await recordJob({ playerIds: [OTHER, HIM, THIRD] });
      const others = await recordJob({ playerIds: [OTHER] });
      const full = await recordJob({ scope: 'full', cause: 'recalculation', playerIds: null });

      await eraseHisJobs();

      expect(await jobsLeft()).toStrictEqual([
        { id: shared, playerIds: [OTHER, THIRD], status: 'pending' },
        { id: others, playerIds: [OTHER], status: 'pending' },
        { id: full, playerIds: null, status: 'pending' },
      ]);
    });

    it.each([
      { jobOf: 'him alone', playerIds: [HIM], left: [] },
      { jobOf: 'him and another player', playerIds: [HIM, OTHER], left: [[OTHER]] },
    ])(
      '[JOU-24] [CL-JOU-06] reaches a job running between two of its chunks, of $jobOf',
      async ({ playerIds, left }) => {
        const id = await recordJob({
          playerIds,
          status: 'running',
          startedAt: new Date(START),
          leaseExpiresAt: new Date(START + MINUTE_MS),
          progressCursor: 'chunk-2',
        });

        await eraseHisJobs();

        expect(await jobsLeft()).toStrictEqual(
          left.map((ids) => ({ id, playerIds: ids, status: 'running' })),
        );
      },
    );
  },
);

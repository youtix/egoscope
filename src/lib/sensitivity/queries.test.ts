import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  boxScores,
  cases,
  createTestDatabase,
  events,
  eventTypes,
  followedPlayers,
  games,
  generalTrends,
  parameterSnapshots,
  playerIndicators,
  recalculationJobs,
  sensitivityProfiles,
} from '@/lib/db';
import { setParam } from '@/lib/params';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertDetectedEvent,
  insertPlayer,
  insertValidCase,
  MEDIA_STORM,
  playerWithEveryStatus,
  profiledPlayer,
  trendWithHistory,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { getProfile, getTrend } from './queries';

import type { Database } from '@/lib/db';
import type { PlayerWithEveryStatus, TrendWithHistory } from '@/lib/testing';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
// The gaps of the valid cases of the worked example of 08, in the order of their games,
// C4, C6 and C9 left out (CA-SEN-11): possible, increase, fragile without C7, +1.81.
const WORKED_EXAMPLE_GAPS = [1.16, -0.43, 0.95, 0.55, 1.81, -0.2, 1.13, 1.43];
const WORKED_EXAMPLE_C7 = 4;

const ANY_ID: unknown = expect.any(Number);
// The world's default profile with its seven valid cases excluded too: of its ten cases, none
// is valid and eight are excluded, beside the one not measurable and the one awaiting.
const EVERY_CASE_EXCLUDED = {
  validCount: 0,
  historicalValidCount: 0,
  excludedCount: 8,
  meanGap: null,
  gapDispersion: null,
};

/** Counts by stored value, as a tally's reasons hold them. */
function countsOf(...counts: readonly (readonly [string, number])[]): Record<string, number> {
  return Object.fromEntries(counts);
}

type World = Readonly<{ db: Database; player: PlayerWithEveryStatus; trend: TrendWithHistory }>;

/** A fresh database holding the world of statistics and sensitivity, its clock fixed at `AT`. */
async function openWorld(): Promise<World & Readonly<{ close: () => Promise<void> }>> {
  const database = await createTestDatabase();
  const restoreClock = installFakeClock(fixedClock(AT));
  const { db } = database;
  const player = await playerWithEveryStatus(db, await profiledPlayer(db));
  const trend = await trendWithHistory(db);
  return {
    db,
    player,
    trend,
    close: async () => {
      restoreClock();
      await database.close();
    },
  };
}

/** Gives the valid cases of the profiled player, his excluded one made valid, the gaps of the worked example, in the order of their games. */
async function giveWorkedExampleGaps(world: World): Promise<readonly number[]> {
  const { db, player } = world;
  await db.update(cases).set({ status: 'measured' }).where(eq(cases.id, player.excluded.id));
  const valid = await db
    .select({ id: cases.id })
    .from(cases)
    .innerJoin(games, eq(games.id, cases.measuredGameId))
    .where(eq(cases.status, 'measured'))
    .orderBy(asc(games.scheduledStartAt));
  for (const [index, { id }] of valid.entries()) {
    await db
      .update(cases)
      .set({ normalizedGap: WORKED_EXAMPLE_GAPS[index] })
      .where(eq(cases.id, id));
  }
  return valid.map(({ id }) => id);
}

// The second player's one media storm: a tracked case of a gap above every gap of the
// worked example, measured at his first game of 2024-25, its detected event marked to
// requalify.
const SECOND_PLAYER_GAP = 2;
const MEASURED_SEASON = '2024-25';

/** Writes the second invented player and his one media storm, and gives his id. */
async function insertSecondPlayerCase(db: Database): Promise<string> {
  const second = await insertPlayer(db, { source: 'p02' });
  await insertBoxScores(db, { playerId: second.id, source: 'p02', season: MEASURED_SEASON });
  const [first] = await db
    .select({ id: games.id })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(eq(boxScores.playerId, second.id), eq(games.season, MEASURED_SEASON)))
    .orderBy(asc(games.scheduledStartAt))
    .limit(1);
  if (first === undefined) {
    throw new Error('Expected a game of the second player.');
  }
  const measured = await insertValidCase(db, {
    playerId: second.id,
    measuredGameId: first.id,
    overrides: { origin: 'tracked', normalizedGap: SECOND_PLAYER_GAP },
  });
  await insertDetectedEvent(db, {
    playerId: second.id,
    overrides: { caseId: measured.id, typeLinkMark: 'to_requalify' },
  });
  return second.id;
}

/** Marks the stored default profile of `playerId` and the type's default trend fragile, of a possible increase. */
async function markFragile(world: World, playerId: string): Promise<void> {
  const fragile = {
    isFragile: true,
    verdictLevel: 'possible',
    verdictDirection: 'increase',
  } as const;
  await world.db
    .update(sensitivityProfiles)
    .set(fragile)
    .where(eq(sensitivityProfiles.playerId, playerId));
  await world.db
    .update(generalTrends)
    .set(fragile)
    .where(eq(generalTrends.id, world.trend.trends.allCases.id));
}

describe('the reads of a profile and a trend', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let world: Awaited<ReturnType<typeof openWorld>>;

  beforeAll(async () => {
    world = await openWorld();
  }, DATABASE_TEST_TIMEOUT_MS);
  afterAll(async () => world.close());

  it('[SEN-19] [SEN-20] [SEN-33] [SEN-38] [IHM-24] gives a pair’s profile in the default view with its tally, reasons, verdict, control and the type’s trend', async () => {
    const { db, player, trend } = world;
    const profile = await getProfile(db, {
      playerId: player.profiled.player.id,
      eventTypeId: MEDIA_STORM,
    });
    const stored = player.profiles.allCases;

    expect(profile).toMatchObject({
      id: stored.id,
      playerId: player.profiled.player.id,
      eventTypeId: MEDIA_STORM,
      earlierVersionCaseCount: 0,
      casesWithoutWhichVerdictChanges: [],
      notices: [],
      warnings: [],
      lastCalculationChange: null,
    });
    expect(profile?.values).toMatchObject({
      view: 'all_cases',
      tally: {
        eventCount: 10,
        caseCount: 10,
        awaitingCount: 1,
        validCount: 7,
        excludedCount: 1,
        manuallyExcludedCount: 0,
        notMeasurableCount: 1,
        historicalValidCount: 7,
        trackedValidCount: 0,
        aboveZeroCount: stored.aboveZeroCount,
        belowZeroCount: stored.belowZeroCount,
      },
      reasons: {
        awaitingGame: countsOf(['precedence_to_verify', 1]),
        notMeasurable: countsOf(['season_not_covered', 1]),
        excluded: countsOf(['unusual_stakes', 1]),
      },
      exits: {},
      gaps: {
        meanGap: stored.meanGap,
        gapDispersion: stored.gapDispersion,
        retainedDispersion: stored.retainedDispersion,
        expectedNoise: stored.expectedNoise,
        signalToNoise: stored.signalToNoise,
        rangeLow: stored.rangeLow,
        rangeHigh: stored.rangeHigh,
      },
      isFragile: stored.isFragile,
      profileConfidence: stored.profileConfidence,
      dependsOnManualExclusions: false,
      validCaseThreshold: 5,
      computedAt: AT,
    });
    expect(profile?.values.control).toStrictEqual({
      caseCount: 8,
      meanGap: stored.controlMeanGap,
      rangeLow: stored.controlRangeLow,
      rangeHigh: stored.controlRangeHigh,
      verdict: { level: 'inconclusive', direction: null },
    });
    expect(profile?.trend).toMatchObject({
      id: trend.trends.allCases.id,
      distinctPlayerCount: 1,
      topContributorValidCount: 7,
      earlierVersionCaseCount: 0,
      notices: [],
      warnings: [],
    });
  });

  it('[SEN-21] [CL-SEN-19] gives the profile of each view with the trend of that view, the tracked-only one below the threshold', async () => {
    const { db, player, trend } = world;
    const playerId = player.profiled.player.id;
    const historical = await getProfile(db, {
      playerId,
      eventTypeId: MEDIA_STORM,
      view: 'historical_only',
    });
    const tracked = await getProfile(db, {
      playerId,
      eventTypeId: MEDIA_STORM,
      view: 'tracked_only',
    });

    expect(historical).toMatchObject({
      id: player.profiles.historicalOnly.id,
      values: { view: 'historical_only', tally: { validCount: 7 } },
      notices: [],
      trend: { id: trend.trends.historicalOnly.id },
    });
    expect(tracked).toMatchObject({
      id: player.profiles.trackedOnly.id,
      values: { view: 'tracked_only', tally: { caseCount: 0, validCount: 0 } },
      notices: ['below_threshold'],
      trend: { id: trend.trends.trackedOnly.id, notices: ['below_threshold'] },
    });
  });

  it('[SEN-19] [CL-STA-24] [CL-JOU-18] notes on a birthday profile the season from which birthday games count, since the player’s first game is not known', async () => {
    const { db, player } = world;
    const birthday = await getProfile(db, {
      playerId: player.profiled.player.id,
      eventTypeId: BIRTHDAY,
    });

    expect(birthday).toMatchObject({
      id: player.birthdayProfile.id,
      values: {
        tally: { caseCount: 1, awaitingCount: 1 },
        reasons: { awaitingGame: countsOf(['game_not_played_yet', 1]) },
      },
      notices: ['below_threshold'],
      warnings: [{ kind: 'birthday_counted_from', season: '2024-25' }],
      trend: null,
    });
  });

  it('[SEN-19] answers null for a pair without a profile and a type without a trend', async () => {
    const { db, player } = world;

    await expect(
      getProfile(db, { playerId: player.profiled.player.id, eventTypeId: 'trade-request' }),
    ).resolves.toBeNull();
    await expect(getTrend(db, { eventTypeId: BIRTHDAY })).resolves.toBeNull();
  });

  it('[SEN-28] [SEN-29] [SEN-30] [SEN-38] gives a type’s trend with its players, control, notices and the last calculation change', async () => {
    const { db, trend } = world;
    const found = await getTrend(db, { eventTypeId: MEDIA_STORM });
    const stored = trend.trends.allCases;

    expect(found).toMatchObject({
      id: stored.id,
      eventTypeId: MEDIA_STORM,
      distinctPlayerCount: 1,
      topContributorValidCount: 7,
      earlierVersionCaseCount: 0,
      notices: [],
      warnings: [],
      casesWithoutWhichVerdictChanges: [],
      lastCalculationChange: null,
      values: {
        view: 'all_cases',
        tally: { validCount: 7, excludedCount: 1 },
        control: { caseCount: 8, meanGap: stored.controlMeanGap },
        confidenceStepDownReasons: stored.confidenceStepDownReasons,
      },
    });
    await expect(
      getTrend(db, { eventTypeId: MEDIA_STORM, view: 'tracked_only' }),
    ).resolves.toMatchObject({
      id: trend.trends.trackedOnly.id,
      notices: ['below_threshold'],
    });
  });
});

describe(
  'the derived parts of a profile and a trend',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let world: Awaited<ReturnType<typeof openWorld>>;
    let key: Readonly<{ playerId: string; eventTypeId: string }>;

    beforeEach(async () => {
      world = await openWorld();
      key = { playerId: world.player.profiled.player.id, eventTypeId: MEDIA_STORM };
      return world.close;
    }, DATABASE_TEST_TIMEOUT_MS);

    it('[CA-SEN-11] [SEN-26] gives the case without which a fragile verdict changes: C7 of the worked example, on the profile and the trend, with the parameter values of each row’s snapshot', async () => {
      const { db } = world;
      const valid = await giveWorkedExampleGaps(world);
      await markFragile(world, key.playerId);

      const profile = await getProfile(db, key);
      const historical = await getProfile(db, { ...key, view: 'historical_only' });
      const found = await getTrend(db, { eventTypeId: MEDIA_STORM });

      expect(profile?.values.verdict).toStrictEqual({ level: 'possible', direction: 'increase' });
      expect(profile?.casesWithoutWhichVerdictChanges).toStrictEqual([valid[WORKED_EXAMPLE_C7]]);
      expect(historical?.casesWithoutWhichVerdictChanges).toStrictEqual([valid[WORKED_EXAMPLE_C7]]);
      expect(found?.casesWithoutWhichVerdictChanges).toStrictEqual([valid[WORKED_EXAMPLE_C7]]);
      // With the values of its own snapshot, a "possible" signal-to-noise threshold of 0.5,
      // the default profile stays a possible increase without C7; the others keep theirs.
      const [lowered] = await db
        .insert(parameterSnapshots)
        .values({ values: { 'sensitivity.possibleSignalToNoise': 0.5 }, valuesHash: 'lowered' })
        .returning({ id: parameterSnapshots.id });
      await db
        .update(sensitivityProfiles)
        .set({ parameterSnapshotId: lowered?.id })
        .where(eq(sensitivityProfiles.id, world.player.profiles.allCases.id));
      await expect(getProfile(db, key)).resolves.toMatchObject({
        casesWithoutWhichVerdictChanges: [],
      });
    });

    it('[SEN-26] [CL-SEN-14] runs the robustness test on the player’s own cases for a profile and on every player’s cases for the trend', async () => {
      const { db } = world;
      const valid = await giveWorkedExampleGaps(world);
      await insertSecondPlayerCase(db);
      await markFragile(world, key.playerId);

      // The robustness test of an increase sets aside the highest gap: C7 for his profile,
      // and for the trend the second player's gap of 2, which leaves the worked example's
      // eight cases and their possible increase.
      await expect(getProfile(db, key)).resolves.toMatchObject({
        casesWithoutWhichVerdictChanges: [valid[WORKED_EXAMPLE_C7]],
      });
      await expect(getTrend(db, { eventTypeId: MEDIA_STORM })).resolves.toMatchObject({
        casesWithoutWhichVerdictChanges: [],
      });
    });

    it('[SEN-26] gives no case for a fragile verdict that no recomputation changes any more', async () => {
      const { db, player } = world;
      // The world's seven gaps give an inconclusive verdict that neither recomputation, without
      // the highest gap or without the lowest, turns possible: the fragile mark is stale.
      await db
        .update(sensitivityProfiles)
        .set({ isFragile: true })
        .where(eq(sensitivityProfiles.id, player.profiles.allCases.id));

      await expect(getProfile(db, key)).resolves.toMatchObject({
        values: { verdict: { level: 'inconclusive', direction: null }, isFragile: true },
        casesWithoutWhichVerdictChanges: [],
      });
    });

    it('[CA-TAX-12] [SEN-46] [CL-TAX-07] counts on read the cases holding an event marked to requalify, over every player for the trend', async () => {
      const { db, player } = world;
      const marked = player.profiled.cases.slice(0, 2).map(({ id }) => id);
      await db
        .update(events)
        .set({ typeLinkMark: 'to_requalify' })
        .where(inArray(events.caseId, marked));
      // The second player's one case, tracked, is marked too: the trend counts it, his
      // profile does not.
      await insertSecondPlayerCase(db);

      await expect(getProfile(db, key)).resolves.toMatchObject({
        earlierVersionCaseCount: 2,
        trend: { earlierVersionCaseCount: 3 },
      });
      await expect(getProfile(db, { ...key, view: 'tracked_only' })).resolves.toMatchObject({
        earlierVersionCaseCount: 0,
        trend: { earlierVersionCaseCount: 1 },
      });
      await expect(getProfile(db, { ...key, view: 'historical_only' })).resolves.toMatchObject({
        earlierVersionCaseCount: 2,
        trend: { earlierVersionCaseCount: 2 },
      });
    });

    it('[SEN-19] [SEN-36] [CL-SEN-16] notes an archived pair, a recalculation in progress and a profile awaiting statistics', async () => {
      const { db, player } = world;
      await db
        .update(followedPlayers)
        .set({ status: 'withdrawn' })
        .where(eq(followedPlayers.id, key.playerId));
      await db.insert(recalculationJobs).values({ scope: 'full', cause: 'recalculation' });
      await db
        .update(sensitivityProfiles)
        .set({
          tallyReasons: {
            awaitingGame: countsOf(['statistics_pending', 1]),
            notMeasurable: {},
            excluded: {},
          },
        })
        .where(eq(sensitivityProfiles.id, player.birthdayProfile.id));

      await expect(getProfile(db, key)).resolves.toMatchObject({
        notices: ['archived', 'recalculating'],
        trend: { notices: ['recalculating'] },
      });
      await expect(getProfile(db, { ...key, eventTypeId: BIRTHDAY })).resolves.toMatchObject({
        notices: ['below_threshold', 'archived', 'recalculating', 'awaiting_statistics'],
      });
    });

    it('[SEN-36] [CL-SEN-16] notes a profile recalculating only while a job covers it, another player’s job covering the trend alone', async () => {
      const { db } = world;
      const second = await insertSecondPlayerCase(db);
      const job = { scope: 'event_or_case_change', cause: 'event_corrected_or_removed' } as const;
      await db.insert(recalculationJobs).values([
        { ...job, playerIds: [second], eventTypeIds: [MEDIA_STORM] },
        { ...job, playerIds: [second] },
      ]);

      await expect(getProfile(db, key)).resolves.toMatchObject({
        notices: [],
        trend: { notices: ['recalculating'] },
      });
    });

    it('[CL-SEN-13] warns of a criterion switched off for the type, and that every case is excluded for unusual stakes while that one is not', async () => {
      const { db, player } = world;
      const allExcluded = {
        ...EVERY_CASE_EXCLUDED,
        tallyReasons: {
          awaitingGame: {},
          notMeasurable: {},
          excluded: countsOf(['unusual_stakes', 8], ['injury_return', 1]),
        },
      };
      await db
        .update(sensitivityProfiles)
        .set(allExcluded)
        .where(eq(sensitivityProfiles.id, player.profiles.allCases.id));

      await expect(getProfile(db, key)).resolves.toMatchObject({
        warnings: [{ kind: 'all_excluded_for_unusual_stakes' }],
      });
      await db
        .update(eventTypes)
        .set({ switchedOffCriterion: 'playing_time_too_low' })
        .where(eq(eventTypes.id, MEDIA_STORM));
      await expect(getProfile(db, key)).resolves.toMatchObject({
        warnings: [
          { kind: 'confounder_not_separable', criterion: 'playing_time_too_low' },
          { kind: 'all_excluded_for_unusual_stakes' },
        ],
        trend: {
          warnings: [{ kind: 'confounder_not_separable', criterion: 'playing_time_too_low' }],
        },
      });
      await db
        .update(eventTypes)
        .set({ switchedOffCriterion: 'unusual_stakes' })
        .where(eq(eventTypes.id, MEDIA_STORM));
      await expect(getProfile(db, key)).resolves.toMatchObject({
        warnings: [{ kind: 'confounder_not_separable', criterion: 'unusual_stakes' }],
      });
    });

    it('[CL-SEN-13] does not warn of unusual stakes when a case was excluded for another criterion alone', async () => {
      const { db, player } = world;
      const otherCriterion = {
        ...EVERY_CASE_EXCLUDED,
        tallyReasons: {
          awaitingGame: {},
          notMeasurable: {},
          excluded: countsOf(['unusual_stakes', 7], ['injury_return', 1]),
        },
      };
      await db
        .update(sensitivityProfiles)
        .set(otherCriterion)
        .where(eq(sensitivityProfiles.id, player.profiles.allCases.id));

      await expect(getProfile(db, key)).resolves.toMatchObject({ warnings: [] });
    });

    it('[CL-JOU-16] [CL-STA-24] warns of a birthday not recorded, and counts birthday games from his first season when it is covered', async () => {
      const { db, player } = world;
      const birthdayKey = { ...key, eventTypeId: BIRTHDAY };
      const [first] = player.profiled.cases;
      await db.insert(playerIndicators).values({
        playerId: key.playerId,
        indicatorSeason: '2024-25',
        gamesPlayedThisSeason: 10,
        computedAt: new Date(AT),
        firstNbaGameId: first?.measuredGameId,
      });

      await expect(getProfile(db, birthdayKey)).resolves.toMatchObject({ warnings: [] });
      await db
        .update(followedPlayers)
        .set({ birthdayMonth: null, birthdayDay: null, birthdayOrigin: null })
        .where(eq(followedPlayers.id, key.playerId));
      await expect(getProfile(db, birthdayKey)).resolves.toMatchObject({
        warnings: [{ kind: 'birthday_not_recorded' }],
      });
    });

    it('[SEN-37] [CL-IHM-12] gives the last change of a calculation parameter with its journal entry', async () => {
      const { db } = world;
      await db.transaction(async (tx) =>
        setParam(tx, { key: 'sensitivity.minValidCases', value: 6, expectedVersion: 0 }),
      );

      await expect(getProfile(db, key)).resolves.toMatchObject({
        lastCalculationChange: { changedAt: AT, journalEntryId: ANY_ID },
      });
      await expect(getTrend(db, { eventTypeId: MEDIA_STORM })).resolves.toMatchObject({
        lastCalculationChange: { changedAt: AT },
      });
    });

    it('[SEN-36] marks a trend archived when its type is withdrawn', async () => {
      const { db } = world;
      await db
        .update(eventTypes)
        .set({
          status: 'withdrawn',
          withdrawalReasonKind: 'entered',
          withdrawalReason: 'Not followed any more.',
        })
        .where(eq(eventTypes.id, MEDIA_STORM));

      await expect(getTrend(db, { eventTypeId: MEDIA_STORM })).resolves.toMatchObject({
        notices: ['archived'],
      });
      await expect(getProfile(db, key)).resolves.toMatchObject({ notices: ['archived'] });
    });
  },
);

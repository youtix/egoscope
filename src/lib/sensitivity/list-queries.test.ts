import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, eventTypes, followedPlayers, sensitivityProfiles } from '@/lib/db';
import { setParam } from '@/lib/params';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertPlayer,
  insertProfile,
  leaguePlayerId,
  MEDIA_STORM,
  playerWithEveryStatus,
  profiledPlayer,
  trendWithHistory,
} from '@/lib/testing';
import { fixedClock, gameDayStart, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import {
  changedSince,
  listProfiles,
  profileValueVersionsUntil,
  verdictHistory,
} from './list-queries';

import type { Database } from '@/lib/db';
import type { LeaguePlayer, PlayerWithEveryStatus, TrendWithHistory } from '@/lib/testing';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const HOUR_MS = 3_600_000;
const ANY_NUMBER: unknown = expect.any(Number);
// The instants of the world: its cases imported, then completed on 1 July 2025.
const IMPORTED_AT = gameDayStart(toIsoDate('2025-06-03'));
const COMPLETED_AT = gameDayStart(toIsoDate('2025-07-01'));
const LEAGUE_PLAYERS: readonly LeaguePlayer[] = [
  'p01',
  'p02',
  'p03',
  'p04',
  'p05',
  'p06',
  'p07',
  'p08',
  'p09',
  'p10',
];
const OTHER_TYPES = ['type-a', 'type-b', 'type-c', 'type-d'];
// The counts of a profile of seven valid cases, each with one event.
const SEVEN_VALID_CASES = { eventCount: 7, caseCount: 7, validCount: 7, historicalValidCount: 7 };

type World = Readonly<{
  db: Database;
  player: PlayerWithEveryStatus;
  trend: TrendWithHistory;
  close: () => Promise<void>;
}>;

/** A fresh database holding the world of statistics and sensitivity, its clock fixed at `AT`. */
async function openWorld(): Promise<World> {
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

/** The verdict history entry of the world's change: a parameter change turned a possible increase inconclusive, of low confidence before and after. */
const FROM_POSSIBLE_INCREASE = {
  changedAt: COMPLETED_AT,
  from: { verdict: { level: 'possible', direction: 'increase' }, profileConfidence: 'low' },
  to: { verdict: { level: 'inconclusive', direction: null }, profileConfidence: 'low' },
  cause: 'parameter_change',
};

describe(
  'the profile list, the verdict history and the changes',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let world: World;

    beforeAll(async () => {
      world = await openWorld();
    }, DATABASE_TEST_TIMEOUT_MS);
    afterAll(async () => world.close());

    it('[IHM-49] [SEN-19] [SEN-41] lists the default-view profiles by player then type, with the filter, the total and the verdicts chance alone would give', async () => {
      const { db, player } = world;
      const listing = await listProfiles(db);

      expect([listing.filter, listing.total]).toStrictEqual([{}, 2]);
      expect(
        listing.profiles.map(({ id, playerId, playerName, eventTypeId, typeName, isArchived }) => ({
          id,
          playerId,
          playerName,
          eventTypeId,
          typeName,
          isArchived,
        })),
      ).toStrictEqual([
        {
          id: player.profiles.allCases.id,
          playerId: leaguePlayerId('p01'),
          playerName: 'Ansel Varga',
          eventTypeId: MEDIA_STORM,
          typeName: 'Media storm',
          isArchived: false,
        },
        {
          id: player.birthdayProfile.id,
          playerId: leaguePlayerId('p01'),
          playerName: 'Ansel Varga',
          eventTypeId: BIRTHDAY,
          typeName: "Player's birthday",
          isArchived: false,
        },
      ]);
      expect(listing.profiles[0]?.values).toMatchObject({
        view: 'all_cases',
        tally: { validCount: 7 },
      });
      expect(listing.expectedFalseSignals.evaluatedPairCount).toBe(1);
      expect(listing.lastCalculationChange).toBeNull();
    });

    it('[IHM-49] keeps the profiles that the filter names, and still gives the total', async () => {
      const { db, player } = world;

      await expect(listProfiles(db, { eventTypeId: BIRTHDAY })).resolves.toMatchObject({
        filter: { eventTypeId: BIRTHDAY },
        total: 2,
        profiles: [{ id: player.birthdayProfile.id }],
      });
      await expect(listProfiles(db, { playerId: leaguePlayerId('p02') })).resolves.toMatchObject({
        total: 2,
        profiles: [],
      });
      const byVerdict = await listProfiles(db, {
        verdict: 'inconclusive',
        playerId: leaguePlayerId('p01'),
        eventTypeId: MEDIA_STORM,
      });
      expect(byVerdict.profiles.map(({ id }) => id)).toStrictEqual([player.profiles.allCases.id]);
      await expect(
        listProfiles(db, { verdict: 'possible', eventTypeId: MEDIA_STORM }),
      ).resolves.toMatchObject({
        profiles: [],
      });
    });

    it('[SEN-37] [CL-SEN-18] [CL-SEN-20] gives the verdict history of a profile and of a trend, oldest first, and none for another', async () => {
      const { db, player, trend } = world;
      const profileHistory = await verdictHistory(db, { profileId: player.profiles.allCases.id });
      const trendHistory = await verdictHistory(db, { trendId: trend.trends.allCases.id });

      expect(profileHistory).toStrictEqual([FROM_POSSIBLE_INCREASE]);
      expect(trendHistory).toStrictEqual([FROM_POSSIBLE_INCREASE]);
      await expect(
        verdictHistory(db, { profileId: player.birthdayProfile.id }),
      ).resolves.toStrictEqual([]);
    });

    it('[SUI-08] [SUI-09] [CL-SEN-19] gives the historical-only values in force at an instant, oldest first, of a profile and of a trend', async () => {
      const { db } = world;
      const subject = { playerId: leaguePlayerId('p01'), eventTypeId: MEDIA_STORM };

      await expect(
        profileValueVersionsUntil(db, subject, toEpochMs(IMPORTED_AT - 1)),
      ).resolves.toStrictEqual([]);
      await expect(profileValueVersionsUntil(db, subject, IMPORTED_AT)).resolves.toMatchObject([
        {
          effectiveAt: IMPORTED_AT,
          validCount: 4,
          meanGap: ANY_NUMBER,
          verdict: { level: 'inconclusive' },
        },
      ]);
      await expect(profileValueVersionsUntil(db, subject, AT)).resolves.toMatchObject([
        { effectiveAt: IMPORTED_AT, validCount: 4 },
        { effectiveAt: COMPLETED_AT, validCount: 7 },
      ]);
      await expect(
        profileValueVersionsUntil(db, { eventTypeId: MEDIA_STORM }, AT),
      ).resolves.toMatchObject([{ effectiveAt: COMPLETED_AT, validCount: 7 }]);
      await expect(
        profileValueVersionsUntil(db, { eventTypeId: BIRTHDAY }, AT),
      ).resolves.toStrictEqual([]);
    });

    it('[SEN-34] [SEN-36] lists the cases and the profiles computed after an instant', async () => {
      const { db, player } = world;
      const since = await changedSince(db, toEpochMs(AT - HOUR_MS));
      const measured = [...player.profiled.cases.map(({ id }) => id), player.excluded.id];

      expect(since.cases.map(({ id }) => id)).toStrictEqual(measured);
      expect(since.cases[0]).toStrictEqual({
        id: measured[0],
        playerId: leaguePlayerId('p01'),
        eventTypeId: MEDIA_STORM,
      });
      expect(since.profiles.map(({ id, view }) => ({ id, view }))).toStrictEqual([
        { id: player.profiles.allCases.id, view: 'all_cases' },
        { id: player.profiles.historicalOnly.id, view: 'historical_only' },
        { id: player.profiles.trackedOnly.id, view: 'tracked_only' },
        { id: player.birthdayProfile.id, view: 'all_cases' },
      ]);
      await expect(changedSince(db, AT)).resolves.toStrictEqual({ cases: [], profiles: [] });
    });
  },
);

describe('the evaluated pairs of the profile list', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let world: World;

  beforeEach(async () => {
    world = await openWorld();
    return world.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[CA-SEN-19] [SEN-41] [CL-SEN-20] expects about 2.3 verdicts at least possible and 0.1 probable among 50 evaluated pairs', async () => {
    const { db } = world;
    for (const type of OTHER_TYPES) {
      await insertEventType(db, { id: type, name: `Type ${type}` });
    }
    for (const source of LEAGUE_PLAYERS.slice(1)) {
      await insertPlayer(db, { source });
    }
    const pairs = LEAGUE_PLAYERS.flatMap((source) =>
      [MEDIA_STORM, ...OTHER_TYPES].map((eventTypeId) => ({
        playerId: leaguePlayerId(source),
        eventTypeId,
      })),
    );
    for (const pair of pairs.slice(1)) {
      await insertProfile(db, pair);
    }
    // Every pair but the birthday one reaches the threshold, with seven valid cases, as the
    // world's media storm of the first player does.
    await db
      .update(sensitivityProfiles)
      .set({ ...SEVEN_VALID_CASES, meanGap: 0, gapDispersion: 1 })
      .where(
        and(
          eq(sensitivityProfiles.view, 'all_cases'),
          eq(sensitivityProfiles.validCount, 0),
          ne(sensitivityProfiles.eventTypeId, BIRTHDAY),
        ),
      );

    const listing = await listProfiles(db);

    expect(listing.total).toBe(51);
    expect(listing.expectedFalseSignals.evaluatedPairCount).toBe(50);
    expect(listing.expectedFalseSignals.atLeastPossibleCount).toBeCloseTo(2.3, 1);
    expect(listing.expectedFalseSignals.probableCount).toBeCloseTo(0.1, 1);
  });

  it('[SEN-19] [SEN-41] [CL-SEN-20] counts an archived pair among the evaluated ones and marks it archived, a pair below the threshold in force not', async () => {
    const { db } = world;
    await db
      .update(followedPlayers)
      .set({ status: 'withdrawn' })
      .where(eq(followedPlayers.id, leaguePlayerId('p01')));

    const archived = await listProfiles(db);
    // His media storm's seven valid cases reach a threshold of seven, not one of eight.
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'sensitivity.minValidCases', value: 7, expectedVersion: 0 }),
    );
    const atThreshold = await listProfiles(db);
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'sensitivity.minValidCases', value: 8, expectedVersion: 1 }),
    );
    const raised = await listProfiles(db);

    expect(archived.profiles.map(({ isArchived }) => isArchived)).toStrictEqual([true, true]);
    expect(archived.expectedFalseSignals.evaluatedPairCount).toBe(1);
    expect(atThreshold.expectedFalseSignals.evaluatedPairCount).toBe(1);
    expect(raised.expectedFalseSignals.evaluatedPairCount).toBe(0);
    expect(raised.lastCalculationChange).toStrictEqual({
      changedAt: AT,
      journalEntryId: ANY_NUMBER,
    });
  });

  it('[SEN-19] [SEN-36] marks archived the line of a withdrawn type, the player’s other type not', async () => {
    const { db } = world;
    await db
      .update(eventTypes)
      .set({
        status: 'withdrawn',
        withdrawalReasonKind: 'entered',
        withdrawalReason: 'Not followed any more.',
      })
      .where(eq(eventTypes.id, MEDIA_STORM));

    const listing = await listProfiles(db);

    expect(
      listing.profiles.map(({ eventTypeId, isArchived }) => ({ eventTypeId, isArchived })),
    ).toStrictEqual([
      { eventTypeId: MEDIA_STORM, isArchived: true },
      { eventTypeId: BIRTHDAY, isArchived: false },
    ]);
    expect(listing.expectedFalseSignals.evaluatedPairCount).toBe(1);
  });
});

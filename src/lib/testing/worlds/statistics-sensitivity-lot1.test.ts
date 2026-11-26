import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  cases,
  caseTriggeredCriteria,
  createTestDatabase,
  events,
  games,
  generalTrends,
  profileValueVersions,
  sensitivityProfiles,
  verdictHistoryEntries,
} from '@/lib/db';
import { fixedClock, gameDayStart, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { leaguePlayerId } from '../factories/players';
import { applyScenarios, profiledPlayer } from '../scenarios';
import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import {
  birthdayOnNextGameDay,
  playerWithEveryStatus,
  statisticsSensitivityLot1,
  trendWithHistory,
} from './statistics-sensitivity-lot1';

import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const NAMES = [
  'birthday-on-next-game-day',
  'player-with-cases-of-every-status',
  'general-trend-with-history',
];
const P01 = leaguePlayerId('p01');
// The start of 24 October 2026, US Eastern, when the birthday case was recorded.
const RECORDED_AT = gameDayStart(toIsoDate('2026-10-24'));
const IMPORTED_AT = gameDayStart(toIsoDate('2025-06-03'));
const COMPLETED_AT = gameDayStart(toIsoDate('2025-07-01'));
// What a scenario writes after its first application: nothing more.
const EVERY_ROW = { cases: 11, events: 11, profiles: 4, trends: 3, history: 2, versions: 3 };
// What the default profile and the default trend record: an inconclusive verdict, of low
// confidence, seven valid cases from one player reaching no threshold of a verdict; and
// their change by the parameter change of 1 July 2025.
const INCONCLUSIVE_LOW = {
  verdictLevel: 'inconclusive',
  verdictDirection: null,
  profileConfidence: 'low',
};
const FROM_POSSIBLE_INCREASE = {
  oldVerdictLevel: 'possible',
  oldVerdictDirection: 'increase',
  oldProfileConfidence: 'low',
  newVerdictLevel: 'inconclusive',
  newVerdictDirection: null,
  newProfileConfidence: 'low',
  cause: 'parameter_change',
};

/** The cases of the database, oldest first, by what the world sets. */
async function caseSummaries(db: Database) {
  return db
    .select({
      playerId: cases.playerId,
      eventTypeId: cases.eventTypeId,
      origin: cases.origin,
      status: cases.status,
      statusReason: cases.statusReason,
      referenceInstantOrigin: cases.referenceInstantOrigin,
    })
    .from(cases)
    .orderBy(asc(cases.id));
}

/** How many rows of each calculation table the database holds. */
async function calculationCounts(db: Database) {
  return {
    cases: await db.$count(cases),
    events: await db.$count(events),
    profiles: await db.$count(sensitivityProfiles),
    trends: await db.$count(generalTrends),
    history: await db.$count(verdictHistoryEntries),
    versions: await db.$count(profileValueVersions),
  };
}

const MEASURED = {
  playerId: P01,
  eventTypeId: 'media-storm',
  origin: 'historical',
  status: 'measured',
  statusReason: null,
  referenceInstantOrigin: 'date_only',
} as const;
const EVERY_STATUS = [
  ...Array.from({ length: 7 }, () => MEASURED),
  {
    ...MEASURED,
    eventTypeId: 'birthday',
    origin: 'tracked',
    status: 'awaiting_game',
    statusReason: 'game_not_played_yet',
    referenceInstantOrigin: 'known_in_advance',
  },
  { ...MEASURED, status: 'excluded' },
  { ...MEASURED, status: 'not_measurable', statusReason: 'season_not_covered' },
  { ...MEASURED, status: 'awaiting_game', statusReason: 'precedence_to_verify' },
] as const;

describe(
  'the world of statistics and sensitivity, Lot 1',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(AT));
      return async () => {
        restoreClock();
        await database.close();
      };
    }, DATABASE_TEST_TIMEOUT_MS);

    it('names its three scenarios', () => {
      expect(Object.keys(statisticsSensitivityLot1({ profiledPlayer }))).toStrictEqual(NAMES);
    });

    it('[SEN-05] [SEN-07] [SEN-19] loads into a fresh database: the profiled player with valid, excluded, not measurable and awaiting cases of both origins', async () => {
      await expect(
        applyScenarios(db, ['player-with-cases-of-every-status']),
      ).resolves.toStrictEqual({
        ok: true,
        value: ['player-with-cases-of-every-status'],
      });

      await expect(caseSummaries(db)).resolves.toStrictEqual(EVERY_STATUS);
      await expect(
        db
          .select({
            criterion: caseTriggeredCriteria.criterion,
            values: caseTriggeredCriteria.triggeringValues,
          })
          .from(caseTriggeredCriteria),
      ).resolves.toStrictEqual([{ criterion: 'unusual_stakes', values: { gameStakes: 'high' } }]);
      await expect(calculationCounts(db)).resolves.toStrictEqual({
        ...EVERY_ROW,
        trends: 0,
        history: 1,
        versions: 2,
      });
    });

    it('[SEN-02] [CL-TRV-03] gives a player whose birthday falls on his next game day: the derived event of his game of 26 October 2026, its tracked case recorded before that game', async () => {
      const birthday = await birthdayOnNextGameDay(db);
      const [game] = await db
        .select({ day: games.gameDayOn, tipOff: games.scheduledStartAt })
        .from(games)
        .where(eq(games.id, birthday.gameId));

      expect(game?.day).toBe('2026-10-26');
      expect(RECORDED_AT).toBeLessThan(game?.tipOff.getTime() ?? 0);
      expect(birthday).toMatchObject({
        player: { id: P01, birthdayMonth: 10, birthdayDay: 26 },
        type: { status: 'validated', calendarDerivation: 'birthday' },
        event: {
          origin: 'calendar',
          referenceDateOn: '2026-10-26',
          derivedGameId: birthday.gameId,
          caseId: birthday.tracked.id,
          createdAt: new Date(RECORDED_AT),
        },
        tracked: {
          origin: 'tracked',
          status: 'awaiting_game',
          statusReason: 'game_not_played_yet',
          referenceInstantAt: null,
          measuredGameId: birthday.gameId,
          createdAt: new Date(RECORDED_AT),
        },
      });
      await expect(birthdayOnNextGameDay(db)).resolves.toStrictEqual(birthday);
    });

    it('[SEN-21] [SEN-37] [SUI-08] writes the profiles in each view, the change of the default one and the versions of the historical-only one', async () => {
      const player = await playerWithEveryStatus(db, await profiledPlayer(db));

      expect(
        Object.values(player.profiles).map(({ view, validCount, historicalValidCount }) => ({
          view,
          validCount,
          historicalValidCount,
        })),
      ).toStrictEqual([
        { view: 'all_cases', validCount: 7, historicalValidCount: 7 },
        { view: 'historical_only', validCount: 7, historicalValidCount: 7 },
        { view: 'tracked_only', validCount: 0, historicalValidCount: 0 },
      ]);
      expect(player.birthdayProfile).toMatchObject({
        eventTypeId: 'birthday',
        view: 'all_cases',
        validCount: 0,
        awaitingCount: 1,
      });
      expect(player.profiles.allCases).toMatchObject(INCONCLUSIVE_LOW);
      expect(player.history).toMatchObject({
        sensitivityProfileId: player.profiles.allCases.id,
        changedAt: new Date(COMPLETED_AT),
        ...FROM_POSSIBLE_INCREASE,
      });
      expect(
        player.versions.map(({ effectiveAt, validCount }) => ({ effectiveAt, validCount })),
      ).toStrictEqual([
        { effectiveAt: new Date(IMPORTED_AT), validCount: 4 },
        { effectiveAt: new Date(COMPLETED_AT), validCount: 7 },
      ]);
    });

    it('[SEN-28] [SEN-37] [CL-SEN-20] [SUI-09] writes the trend in each view, the change of the default one and the version of the historical-only one', async () => {
      await playerWithEveryStatus(db, await profiledPlayer(db));
      const trend = await trendWithHistory(db);

      expect(
        Object.values(trend.trends).map(({ view, validCount }) => ({ view, validCount })),
      ).toStrictEqual([
        { view: 'all_cases', validCount: 7 },
        { view: 'historical_only', validCount: 7 },
        { view: 'tracked_only', validCount: 0 },
      ]);
      expect(trend.trends.allCases).toMatchObject(INCONCLUSIVE_LOW);
      expect(trend.history).toMatchObject({
        generalTrendId: trend.trends.allCases.id,
        changedAt: new Date(COMPLETED_AT),
        ...FROM_POSSIBLE_INCREASE,
      });
      expect(trend.version).toMatchObject({
        generalTrendId: trend.trends.historicalOnly.id,
        effectiveAt: new Date(COMPLETED_AT),
        validCount: 7,
      });
    });

    it.each([
      ['in the order of the world', NAMES],
      ['in the reverse order', NAMES.toReversed()],
    ])(
      '[SEN-05] combines its scenarios, %s, and leaves them as they are when applied again',
      async (_order, names) => {
        await applyScenarios(db, ['profiled-player', ...names]);
        const counts = await calculationCounts(db);
        await applyScenarios(db, [...names, 'profiled-player']);

        expect(counts).toStrictEqual(EVERY_ROW);
        await expect(calculationCounts(db)).resolves.toStrictEqual(EVERY_ROW);
      },
    );
  },
);

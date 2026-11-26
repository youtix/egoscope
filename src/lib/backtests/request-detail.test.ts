import { and, eq, or } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  backtestRequestTypes,
  createTestDatabase,
  followedPlayers,
  games,
  series,
  teamSourceRefs,
} from '@/lib/db';
import { setParam } from '@/lib/params';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { get } from './request-detail';

import type { Database } from '@/lib/db';
import type { RequestFactoryOptions, RequestRow } from '@/lib/testing';

// Sunday 8 November 2026, noon in New York: 2026-27 is played up to the 7th (the league's README).
const NOW = toEpochMs(Date.UTC(2026, 10, 8, 17, 0));
// A June day of 2025-26 after its regular season and before its Finals game.
const POSTSEASON = toEpochMs(Date.UTC(2026, 5, 5, 16, 0));
const FINALS_TIP_OFF = toEpochMs(Date.UTC(2026, 5, 10, 0, 30));
// 10 January 2028, noon in New York: no stored span tells its season.
const UNREAD_SEASON_DAY = toEpochMs(Date.UTC(2028, 0, 10, 17, 0));
// 00:00 US Eastern time on 10 November 2026, the deemed start of a game whose time is to be determined.
const DEEMED_START = toEpochMs(Date.UTC(2026, 10, 10, 5, 0));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UNKNOWN_REQUEST = 9999;
const KIRITIMATI = 'Pacific/Kiritimati';

const ago = (ms: number) => new Date(NOW - ms);

describe('a backtest request', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    const restoreClock = installFakeClock(fixedClock(NOW));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** The team of the league that the source names `ref`. */
  async function teamOf(ref: string): Promise<number> {
    const [team] = await db
      .select({ id: teamSourceRefs.teamId })
      .from(teamSourceRefs)
      .where(eq(teamSourceRefs.sourceTeamRef, ref));
    if (team === undefined) {
      throw new Error(`The team ${ref} is missing from the league`);
    }
    return team.id;
  }

  /** The game that the league's team 1 plays on the US date `day`. */
  async function gameOn(day: string) {
    const teamId = await teamOf('1');
    const ofTeam = or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId));
    const [game] = await db
      .select()
      .from(games)
      .where(and(eq(games.gameDayOn, day), ofTeam));
    if (game === undefined) {
      throw new Error(`The team 1 has no game on ${day}`);
    }
    return game;
  }

  /** Follows the first invented player on the league's team 1, and asks a request to do for him. */
  async function requestOfTeamPlayer(): Promise<RequestRow> {
    const currentTeamId = await teamOf('1');
    await insertPlayer(db, { overrides: { currentTeamId } });
    return insertRequest(db, {
      playerId: leaguePlayerId('p01'),
      overrides: { createdAt: ago(DAY) },
    });
  }

  /** Asks a request to do for the first invented player, who has no team. */
  async function requestOfPlayer(
    overrides: RequestFactoryOptions['overrides'] = {},
  ): Promise<RequestRow> {
    await insertPlayer(db);
    return insertRequest(db, {
      playerId: leaguePlayerId('p01'),
      overrides: { createdAt: ago(DAY), ...overrides },
    });
  }

  /** Writes the league's two seasons, and the request to do of the player of team 1. */
  async function leagueRequest(): Promise<RequestRow> {
    await insertLeagueSeason(db, '2025-26');
    await insertLeagueSeason(db, '2026-27');
    return requestOfTeamPlayer();
  }

  /** Makes the time of the game of team 1 on 10 November to be determined. */
  async function leaveTimeToBeDetermined() {
    const game = await gameOn('2026-11-10');
    await db
      .update(games)
      .set({ isStartTimeTbd: true, scheduledStartAt: new Date(DEEMED_START) })
      .where(eq(games.id, game.id));
  }

  describe('its deadline', () => {
    it('[BKT-16] [CA-BKT-17] gives the start of the next game of the player and its opponent', async () => {
      const created = await leagueRequest();
      const game = await gameOn('2026-11-10');
      const isHome = game.homeTeamId === (await teamOf('1'));

      const detail = await get(db, created.id, NOW);

      expect(detail).toMatchObject({
        deadline: {
          kind: 'game',
          scheduledStartAt: game.scheduledStartAt.getTime(),
          isStartTimeTbd: false,
        },
        nextGame: {
          gameId: game.id,
          phase: 'regular_season',
          opponentTeamId: isHome ? game.awayTeamId : game.homeTeamId,
          venue: isHome ? 'home' : 'away',
        },
      });
    });

    it('[BKT-16] [CL-BKT-24] gives the date of a game whose time is to be determined with the whole days left, the deemed start ordering it', async () => {
      const created = await leagueRequest();
      await leaveTimeToBeDetermined();

      const detail = await get(db, created.id, NOW);

      expect(detail?.deadline).toStrictEqual({
        kind: 'game',
        scheduledStartAt: DEEMED_START,
        isStartTimeTbd: true,
        daysRemaining: 2,
      });
    });

    it('[BKT-16] [CL-BKT-24] counts the days left from the owner’s day in his time zone', async () => {
      const created = await leagueRequest();
      await leaveTimeToBeDetermined();
      // 17:00 UTC is already 07:00 on 9 November at UTC+14.
      await db.transaction(async (tx) =>
        setParam(tx, { key: 'display.timeZone', value: KIRITIMATI, expectedVersion: 0 }),
      );

      const detail = await get(db, created.id, NOW);

      expect(detail?.deadline).toMatchObject({ isStartTimeTbd: true, daysRemaining: 1 });
    });

    it('[BKT-16] [CA-BKT-17] answers no game scheduled with the reason team eliminated for a player whose team is out', async () => {
      await insertLeagueSeason(db, '2025-26');
      const created = await requestOfTeamPlayer();
      const [teamA, teamB] = [await teamOf('2'), await teamOf('3')];
      const [finals] = await db
        .insert(series)
        .values({
          season: '2025-26',
          phase: 'playoffs',
          round: 'finals',
          teamAId: teamA,
          teamBId: teamB,
          winsNeeded: 1,
          isRebuilt: false,
        })
        .returning({ id: series.id });
      await db.insert(games).values({
        statsSource: 'sportsdataverse_espn',
        sourceGameRef: 'finals-2026',
        season: '2025-26',
        phase: 'playoffs',
        status: 'scheduled',
        scheduledStartAt: new Date(FINALS_TIP_OFF),
        gameDayOn: '2026-06-09',
        homeTeamId: teamA,
        awayTeamId: teamB,
        seriesId: finals?.id,
        gameNumber: 1,
        lastFetchedAt: new Date(POSTSEASON),
        scheduleChangedAt: new Date(POSTSEASON),
      });

      const detail = await get(db, created.id, POSTSEASON);

      expect(detail).toMatchObject({
        deadline: { kind: 'no_game_scheduled', reason: 'team_eliminated' },
        nextGame: null,
      });
    });

    it('[BKT-16] [CL-STA-28] says that the schedule is not read when the games read cannot tell the season', async () => {
      const created = await leagueRequest();

      const detail = await get(db, created.id, UNREAD_SEASON_DAY);

      expect(detail).toMatchObject({
        deadline: { kind: 'schedule_not_read', candidates: ['2027-28', '2028-29'] },
        nextGame: null,
      });
    });

    it('[BKT-16] gives the reason that a player without a team has no game', async () => {
      await insertLeagueSeason(db, '2026-27');
      await insertPlayer(db);
      const created = await insertRequest(db, { playerId: leaguePlayerId('p01') });

      const detail = await get(db, created.id, NOW);

      expect(detail?.deadline).toStrictEqual({
        kind: 'no_game_scheduled',
        reason: 'player_without_team',
      });
    });

    it('[BKT-16] [BKT-17] derives the deadline at each read: a new next game gives the new deadline, nothing being stored', async () => {
      const created = await leagueRequest();
      const first = await gameOn('2026-11-10');
      const second = await gameOn('2026-11-13');
      const before = await get(db, created.id, NOW);

      await db
        .update(games)
        .set({ status: 'postponed', scheduleChangedAt: new Date(NOW + HOUR) })
        .where(eq(games.id, first.id));
      const after = await get(db, created.id, NOW);

      expect(before?.nextGame?.gameId).toBe(first.id);
      expect(after?.nextGame?.gameId).toBe(second.id);
      expect(after?.deadline).toMatchObject({
        scheduledStartAt: second.scheduledStartAt.getTime(),
      });
    });
  });

  describe('its details', () => {
    it('[BKT-16] gives nothing for a request that does not exist', async () => {
      await expect(get(db, UNKNOWN_REQUEST, NOW)).resolves.toBeNull();
    });

    it('[BKT-17] gives the rank of a request to do in the to-do list, and none to another', async () => {
      await insertPlayer(db, { source: 'p02' });
      const older = await insertRequest(db, {
        playerId: leaguePlayerId('p02'),
        overrides: { createdAt: ago(8 * DAY) },
      });
      const newer = await requestOfPlayer();
      const done = await insertRequest(db, {
        playerId: leaguePlayerId('p01'),
        overrides: { status: 'imported', importedAt: ago(HOUR), createdAt: ago(12 * DAY) },
      });

      const ranks = await Promise.all([older, newer, done].map(async ({ id }) => get(db, id, NOW)));

      expect(ranks.map((detail) => detail?.rank)).toStrictEqual([1, 2, null]);
    });

    it('[BKT-15] gives the player, the dates, the cancellation, the version and the overall period of the requested types', async () => {
      const created = await requestOfPlayer({
        createdOn: '2026-11-02',
        status: 'canceled',
        canceledAt: ago(5 * DAY),
        cancellationReasonCode: 'player_withdrawn',
        cancellationReasonText: 'No longer followed.',
      });
      await insertEventType(db, { id: 'player-feud', name: 'Player feud' });
      await insertEventType(db, { id: 'trade-rumor', name: 'Trade rumor' });
      // Written out of alphabetical order, to be read in it.
      await db.insert(backtestRequestTypes).values([
        {
          backtestRequestId: created.id,
          eventTypeId: 'trade-rumor',
          sheetVersionNumber: 1,
          periodStartOn: '2021-10-19',
          periodEndOn: '2027-06-30',
          isRequested: false,
        },
        {
          backtestRequestId: created.id,
          eventTypeId: 'player-feud',
          sheetVersionNumber: 1,
          periodStartOn: '2022-10-18',
          periodEndOn: '2026-09-30',
        },
      ]);
      const [owner] = await db
        .select({ displayName: followedPlayers.displayName })
        .from(followedPlayers)
        .where(eq(followedPlayers.id, leaguePlayerId('p01')));

      const detail = await get(db, created.id, NOW);

      expect(detail).toMatchObject({
        id: created.id,
        player: { id: leaguePlayerId('p01'), displayName: owner?.displayName },
        triggerEventTypeId: null,
        triggerImportId: null,
        createdOn: '2026-11-02',
        importedAt: null,
        cancellation: {
          at: NOW - 5 * DAY,
          reasonCode: 'player_withdrawn',
          reasonText: 'No longer followed.',
        },
        rowVersion: 1,
        period: { startOn: '2022-10-18', endOn: '2026-11-08' },
      });
      expect(detail?.types.map(({ eventTypeId }) => eventTypeId)).toStrictEqual([
        'media-storm',
        'player-feud',
        'trade-rumor',
      ]);
    });

    it.each([
      ['media-storm', 'player-feud'],
      ['player-feud', 'media-storm'],
    ] as const)(
      '[BKT-08] spans from an unknown start when %s starts from the first NBA game and %s has a date',
      async (unknownStart, dated) => {
        const created = await requestOfPlayer();
        await insertEventType(db, { id: 'player-feud', name: 'Player feud' });
        await db.insert(backtestRequestTypes).values({
          backtestRequestId: created.id,
          eventTypeId: 'player-feud',
          sheetVersionNumber: 1,
          periodStartOn: '2024-01-15',
          periodEndOn: '2026-01-31',
        });
        await db
          .update(backtestRequestTypes)
          .set({ periodStartOn: null })
          .where(eq(backtestRequestTypes.eventTypeId, unknownStart));

        const detail = await get(db, created.id, NOW);

        const types = detail?.types.map((type) => [type.eventTypeId, type.periodStartOn]);
        expect(types).toContainEqual([unknownStart, null]);
        expect(types).not.toContainEqual([dated, null]);
        expect(detail?.period).toStrictEqual({ startOn: null, endOn: '2026-11-08' });
      },
    );

    it('[BKT-08] gives no overall period when no type is requested', async () => {
      const created = await requestOfPlayer();
      await db
        .update(backtestRequestTypes)
        .set({ isRequested: false })
        .where(eq(backtestRequestTypes.backtestRequestId, created.id));

      const detail = await get(db, created.id, NOW);

      expect(detail?.period).toBeNull();
    });

    it('[BKT-05] gives the type that triggered a supplement and its derived origin', async () => {
      const created = await requestOfPlayer({
        kind: 'supplement',
        trigger: 'type_validated',
        triggerEventTypeId: MEDIA_STORM,
        status: 'imported',
        importedAt: ago(HOUR),
      });

      const detail = await get(db, created.id, NOW);

      expect(detail).toMatchObject({
        kind: 'supplement',
        trigger: 'type_validated',
        triggerEventTypeId: MEDIA_STORM,
        importedAt: NOW - HOUR,
        origin: 'supplementary',
        cancellation: null,
      });
    });
  });

  describe('its prompt', () => {
    it('[BKT-20] reads a prompt produced after the last copy as stale, and one copied after it, or never copied, as current', async () => {
      const producedAt = NOW - 2 * DAY;
      await insertPlayer(db);
      /** An imported request whose prompt was produced at `producedAt` and copied at `copiedAt`. */
      const copiedAt = async (copy: number | null) =>
        insertRequest(db, {
          playerId: leaguePlayerId('p01'),
          overrides: {
            status: 'imported',
            importedAt: ago(HOUR),
            createdAt: ago(10 * DAY),
            promptProducedAt: new Date(producedAt),
            lastCopiedAt: copy === null ? null : new Date(copy),
          },
        });
      const copies = [producedAt - HOUR, producedAt + HOUR, producedAt, null];
      const requests = [
        await copiedAt(copies[0] ?? null),
        await copiedAt(copies[1] ?? null),
        await copiedAt(copies[2] ?? null),
        await copiedAt(copies[3] ?? null),
      ];
      const read = await Promise.all(requests.map(async ({ id }) => get(db, id, NOW)));

      expect(read.map((detail) => detail?.isCopiedTextStale)).toStrictEqual([
        true,
        false,
        false,
        false,
      ]);
      expect(read.map((detail) => detail?.lastCopiedAt)).toStrictEqual(copies);
      expect(read[0]?.prompt).toStrictEqual({
        text: 'Research the public events of the player over the periods requested.',
        producedAt,
      });
    });
  });
});

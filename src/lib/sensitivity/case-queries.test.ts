import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { caseReviewFlags, cases, createTestDatabase, games } from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  insertPlayer,
  leaguePlayerId,
  MEDIA_STORM,
  playerWithEveryStatus,
  profiledPlayer,
} from '@/lib/testing';
import { endOfDayPacific, fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { caseOfEvent, listCases, reviewFlags } from './case-queries';

import type { Database } from '@/lib/db';
import type { PlayerWithEveryStatus } from '@/lib/testing';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const HOUR_MS = 3_600_000;
const P01 = leaguePlayerId('p01');
const ANY_ID: unknown = expect.any(Number);

/** The one item of `items`, which the test expects. */
function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length > 1) {
    throw new Error(`Expected one item, found ${String(items.length)}.`);
  }
  return item;
}

describe('the case lists', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let world: PlayerWithEveryStatus;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    const restoreClock = installFakeClock(fixedClock(AT));
    db = database.db;
    world = await playerWithEveryStatus(db, await profiledPlayer(db));
    close = async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);
  afterAll(async () => close());

  it('[SEN-07] [SEN-40] [IHM-24] groups a profile’s cases by status, each with its reason or criteria, its events and its measurement', async () => {
    const groups = await listCases(db, { playerId: P01, eventTypeId: MEDIA_STORM });

    expect(groups.measured.map(({ id }) => id)).toStrictEqual(
      world.profiled.cases.map(({ id }) => id),
    );
    expect(groups.excluded).toMatchObject([
      {
        id: world.excluded.id,
        status: 'excluded',
        statusReason: null,
        criteria: ['unusual_stakes'],
      },
    ]);
    expect(groups.notMeasurable).toStrictEqual([
      {
        id: world.notMeasurable.id,
        playerId: P01,
        eventTypeId: MEDIA_STORM,
        origin: 'historical',
        status: 'not_measurable',
        statusReason: 'season_not_covered',
        criteria: [],
        events: [
          {
            id: ANY_ID,
            origin: 'historical',
            referenceDateOn: '2024-01-15',
            referenceAt: null,
            description: 'Every outlet covered the player on the same day.',
          },
        ],
        referenceInstantAt: endOfDayPacific(toIsoDate('2024-01-15')),
        referenceInstantOrigin: 'date_only',
        measuredGame: null,
        minutes: null,
        performanceIndex: null,
        baseline: {
          season: null,
          phase: null,
          gameCount: null,
          mean: null,
          standardDeviation: null,
          status: null,
          isPartial: null,
        },
        normalizedGap: null,
        gapStatus: null,
      },
    ]);
    expect(groups.awaitingGame).toMatchObject([
      { id: world.awaiting.id, statusReason: 'precedence_to_verify', measuredGame: null },
    ]);
  });

  it('[SEN-07] [IHM-24] gives a valid case its event date, reference instant, measured game with its opponent of that season, minutes, index, baseline and gap', async () => {
    const groups = await listCases(db, { playerId: P01, eventTypeId: MEDIA_STORM });
    const first = only(world.profiled.cases.slice(0, 1));
    const event = only(world.profiled.events.slice(0, 1));
    const game = only(
      await db
        .select()
        .from(games)
        .where(eq(games.id, first.measuredGameId ?? 0)),
    );

    expect(groups.measured[0]).toStrictEqual({
      id: first.id,
      playerId: P01,
      eventTypeId: MEDIA_STORM,
      origin: 'historical',
      status: 'measured',
      statusReason: null,
      criteria: [],
      events: [
        {
          id: event.id,
          origin: 'historical',
          referenceDateOn: event.referenceDateOn,
          referenceAt: null,
          description: 'Every outlet covered the player on the same day.',
        },
      ],
      referenceInstantAt: first.referenceInstantAt?.getTime(),
      referenceInstantOrigin: 'date_only',
      measuredGame: {
        id: game.id,
        gameDay: game.gameDayOn,
        scheduledStartAt: game.scheduledStartAt.getTime(),
        isStartTimeTbd: false,
        season: '2024-25',
        opponent: { location: 'Seaport', name: 'Gulls', abbreviation: 'SPG' },
      },
      minutes: first.measuredMinutes,
      performanceIndex: first.performanceIndex,
      baseline: {
        season: '2024-25',
        phase: 'regular_season',
        gameCount: 9,
        mean: first.baselineMean,
        standardDeviation: first.baselineStandardDeviation,
        status: first.baselineStatus,
        isPartial: false,
      },
      normalizedGap: first.normalizedGap,
      gapStatus: first.gapStatus,
    });
  });

  it('[SEN-21] [SEN-40] filters the cases by origin: the tracked birthday case, known in advance, without a reference instant', async () => {
    await expect(
      listCases(db, { playerId: P01, eventTypeId: MEDIA_STORM }, { origin: 'tracked' }),
    ).resolves.toStrictEqual({ measured: [], excluded: [], notMeasurable: [], awaitingGame: [] });
    const birthday = await listCases(
      db,
      { playerId: P01, eventTypeId: BIRTHDAY },
      { origin: 'tracked' },
    );

    expect(birthday.awaitingGame).toMatchObject([
      {
        id: world.birthday.tracked.id,
        origin: 'tracked',
        statusReason: 'game_not_played_yet',
        referenceInstantAt: null,
        referenceInstantOrigin: 'known_in_advance',
        events: [{ origin: 'calendar', referenceDateOn: '2026-10-26', referenceAt: null }],
        measuredGame: {
          id: world.birthday.gameId,
          gameDay: '2026-10-26',
          season: '2026-27',
          opponent: null,
        },
      },
    ]);
    const historical = await listCases(db, { eventTypeId: MEDIA_STORM }, { origin: 'historical' });
    expect(historical.measured).toHaveLength(7);
  });

  it('[SEN-28] [SEN-40] lists a trend’s cases over every player', async () => {
    const other = await insertPlayer(db, { source: 'p04' });
    const tracked = await db
      .insert(cases)
      .values({
        playerId: other.id,
        eventTypeId: MEDIA_STORM,
        origin: 'tracked',
        status: 'awaiting_game',
        statusReason: 'statistics_pending',
        referenceInstantOrigin: 'known_instant',
        referenceInstantAt: new Date(AT),
      })
      .returning();
    const detected = await insertDetectedEvent(db, {
      playerId: other.id,
      overrides: { caseId: tracked[0]?.id },
    });

    const groups = await listCases(db, { eventTypeId: MEDIA_STORM });

    expect(
      groups.awaitingGame.map(({ playerId, statusReason }) => ({ playerId, statusReason })),
    ).toStrictEqual([
      { playerId: P01, statusReason: 'precedence_to_verify' },
      { playerId: other.id, statusReason: 'statistics_pending' },
    ]);
    expect(groups.awaitingGame[1]?.events).toStrictEqual([
      {
        id: detected.id,
        origin: 'detected',
        referenceDateOn: null,
        referenceAt: AT,
        description: 'Every outlet covered the player on the same day.',
      },
    ]);
    await expect(caseOfEvent(db, detected.id)).resolves.toMatchObject({ id: tracked[0]?.id });
  });

  it('[SEN-05] gives the case that holds an event, and none for an event outside any case or unknown', async () => {
    const [event] = world.profiled.events;
    const loose = await insertDetectedEvent(db, { playerId: P01 });

    await expect(caseOfEvent(db, event?.id ?? 0)).resolves.toMatchObject({
      id: event?.caseId,
      status: 'measured',
    });
    await expect(caseOfEvent(db, world.birthday.event.id)).resolves.toMatchObject({
      id: world.birthday.tracked.id,
      origin: 'tracked',
    });
    await expect(caseOfEvent(db, loose.id)).resolves.toBeNull();
    await expect(caseOfEvent(db, 0)).resolves.toBeNull();
  });

  it('[SEN-16] [SEN-17] [IHM-20] [CL-SEN-11] lists the review flags not acknowledged, oldest first, with their case, player and game day', async () => {
    const [first, second] = world.profiled.cases;
    const flagOf = (row: typeof first, raisedAt: number, acknowledgedAt: number | null) => ({
      caseId: row?.id ?? 0,
      flag: 'first_game_with_new_team' as const,
      measuredGameId: row?.measuredGameId ?? 0,
      raisedAt: new Date(raisedAt),
      acknowledgedAt: acknowledgedAt === null ? null : new Date(acknowledgedAt),
    });
    const raised = await db
      .insert(caseReviewFlags)
      .values([
        flagOf(second, AT, null),
        flagOf(first, AT - HOUR_MS, null),
        { ...flagOf(first, AT, AT), flag: 'ejection' },
      ])
      .returning();
    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.id, second?.measuredGameId ?? 0));

    const flags = await reviewFlags(db);

    expect(flags.map(({ id }) => id)).toStrictEqual([raised[1]?.id, raised[0]?.id]);
    expect(flags[1]).toStrictEqual({
      id: raised[0]?.id,
      caseId: second?.id,
      playerId: P01,
      playerName: 'Ansel Varga',
      eventTypeId: MEDIA_STORM,
      flag: 'first_game_with_new_team',
      measuredGameId: second?.measuredGameId,
      gameDay: game?.gameDayOn,
      raisedAt: AT,
    });
  });
});

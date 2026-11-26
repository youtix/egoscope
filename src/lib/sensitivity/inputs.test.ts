import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  boxScores,
  caseManualDecisions,
  cases,
  createTestDatabase,
  events,
  eventSources,
  followedPlayers,
  games,
  parameterOverrides,
  seasons,
  statsSourceMappings,
  tallyExits,
  teams,
} from '@/lib/db';
import { evaluatePlayer } from '@/lib/stats-engine';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, gameDay, installFakeClock, toEpochMs } from '@/lib/time';

import { buildPlayerInput } from './inputs';

import type { PlayerInput, PlayerQuery } from './inputs';
import type { Database } from '@/lib/db';
import type { EvaluationEvent } from '@/lib/stats-engine';

const P01 = leaguePlayerId('p01');
const P07 = leaguePlayerId('p07');
const UNKNOWN_PLAYER = '00000000-0000-4000-8000-000000000000';
const SOURCE = 'sportsdataverse_espn';
const CONTRACT = 'contract-signing';
const TRADE_RUMOR = 'trade-rumor';
const QUERY: PlayerQuery = { playerId: P01, firstCoveredSeason: '2023-24' };
// Tuesday 20 January 2026, noon in New York.
const NOW = toEpochMs(Date.UTC(2026, 0, 20, 17, 0));
// 09:00 and 10:00 in New York on Thursday 15 January 2026.
const JAN_15_EARLY = Date.UTC(2026, 0, 15, 14, 0);
const JAN_15_MORNING = Date.UTC(2026, 0, 15, 15, 0);
// 19:30 in New York on 15 and 17 January 2026, and on 1 November 2024.
const JAN_15_EVENING = Date.UTC(2026, 0, 16, 0, 30);
const JAN_17_EVENING = Date.UTC(2026, 0, 18, 0, 30);
const NOVEMBER_2024 = Date.UTC(2024, 10, 1, 23, 30);
// 00:00 in Los Angeles on 16 January: the end of 15 January in Pacific time (CL-SEN-07).
const END_OF_JAN_15 = Date.UTC(2026, 0, 16, 8, 0);
// A Sunday before the games, when a calendar event is derived ahead of them.
const JAN_11 = Date.UTC(2026, 0, 11, 12, 0);
// The day after the 17 January game, when a manual decision is made.
const DECIDED_AT = Date.UTC(2026, 0, 18, 15, 0);
// New York's offset from UTC in winter, in minutes.
const NEW_YORK_WINTER = -300;
// The days the clocks moved for daylight saving time (DST) in 2026, each with the instant
// of 00:00 in Los Angeles the next day.
const DST_ENDS = { '2026-03-08': Date.UTC(2026, 2, 9, 7), '2026-11-01': Date.UTC(2026, 10, 2, 8) };
// His line of each game: 2 × 8 field goals, 2 threes and 4 free throws are 22 points, in 34:30.
const LINE = {
  statsSource: SOURCE,
  sourcePlayerRef: 'p01',
  status: 'complete',
  minutes: 34,
  seconds: 30,
  hasRoundedMinutes: false,
  points: 22,
  fieldGoalsMade: 8,
  fieldGoalsAttempted: 15,
  threePointersMade: 2,
  freeThrowsMade: 4,
  freeThrowsAttempted: 5,
  offensiveRebounds: 1,
  defensiveRebounds: 6,
  assists: 5,
  steals: 2,
  blocks: 1,
  turnovers: 3,
  personalFouls: 2,
  ejected: false,
} as const;

type World = Readonly<{
  db: Database;
  importId: number;
  games: Readonly<{ previous: number; jan15: number; jan17: number }>;
}>;

/** A date that a source was published on, and its instant when it had a time. */
type Publication = Readonly<{ on: string; at?: number }>;

function firstOf<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error('the row looked for is missing');
  }
  return row;
}

/** A final regular-season game of the source, `home` against `away`, starting at `at`. */
async function insertGame(
  db: Database,
  { season, at }: Readonly<{ season: string; at: number }>,
  [homeTeamId, awayTeamId]: readonly [number, number],
): Promise<number> {
  const startAt = new Date(at);
  const rows = await db
    .insert(games)
    .values({
      statsSource: SOURCE,
      sourceGameRef: `${season}-${String(at)}`,
      season,
      phase: 'regular_season',
      status: 'final',
      scheduledStartAt: startAt,
      gameDayOn: gameDay(toEpochMs(at)),
      homeTeamId,
      awayTeamId,
      homeScore: 101,
      awayScore: 99,
      overtimeCount: 0,
      lastFetchedAt: startAt,
      scheduleChangedAt: startAt,
    })
    .returning({ id: games.id });
  return firstOf(rows).id;
}

/**
 * An invented league: in 2024-25, a game of two other teams; in 2025-26, his team plays on
 * 15 and 17 January 2026 in the evening, his line complete each time. A second player,
 * p07, and four types: the media storm, whose sheet switches the opponent criterion off,
 * the birthday, a type known in advance and a withdrawn one.
 */
async function buildWorld(db: Database): Promise<World> {
  const teamOf = async (abbreviation: string, name: string) =>
    firstOf(await db.insert(teams).values({ abbreviation, name }).returning({ id: teams.id })).id;
  const harbor = await teamOf('HRB', 'Harbor Herons');
  const ridge = await teamOf('RDG', 'Ridge Rams');
  const cape = await teamOf('CPS', 'Cape Sparrows');
  const coverageFetchedAt = new Date(NOW);
  await db.insert(seasons).values([
    { season: '2024-25', statsSource: SOURCE, coverageFetchedAt },
    {
      season: '2025-26',
      statsSource: SOURCE,
      coverageFetchedAt,
      phasesWithLines: ['regular_season'],
    },
  ]);
  const previous = await insertGame(db, { season: '2024-25', at: NOVEMBER_2024 }, [cape, ridge]);
  const jan15 = await insertGame(db, { season: '2025-26', at: JAN_15_EVENING }, [harbor, ridge]);
  const jan17 = await insertGame(db, { season: '2025-26', at: JAN_17_EVENING }, [ridge, harbor]);
  await insertPlayer(db);
  await insertPlayer(db, { source: 'p07' });
  const fetchedAt = new Date(NOW);
  await db.insert(boxScores).values([
    { ...LINE, playerId: P01, gameId: jan15, teamId: harbor, fetchedAt },
    { ...LINE, playerId: P01, gameId: jan17, teamId: harbor, fetchedAt },
  ]);
  await insertEventType(db, { switchedOffCriterion: 'opponent_strength' });
  await insertCalendarType(db);
  await insertEventType(db, { id: CONTRACT, name: 'Contract signing', knownInAdvance: true });
  await insertEventType(db, {
    id: TRADE_RUMOR,
    name: 'Trade rumor',
    status: 'withdrawn',
    withdrawalReasonKind: 'entered',
    withdrawalReason: 'The press no longer tells a rumor from a fact.',
  });
  const request = await insertRequest(db, { playerId: P01 });
  const { id: importId } = await insertImport(db, { request });
  return { db, importId, games: { previous, jan15, jan17 } };
}

/** Writes his historical event with its sources, a media storm of 20 November 2024 by default. */
async function historical(
  world: World,
  overrides: Partial<typeof events.$inferInsert>,
  publications: readonly [Publication, ...Publication[]],
): Promise<number> {
  const { db, importId } = world;
  const { id } = await insertHistoricalEvent(db, {
    playerId: P01,
    originImportId: importId,
    overrides,
  });
  await db.insert(eventSources).values(
    publications.map(({ on, at }, index) => ({
      playerEventId: id,
      position: index + 1,
      url: `https://press.example/${String(id)}/${String(index)}`,
      cleanedUrl: `https://press.example/${String(id)}/${String(index)}`,
      publicationDateOn: on,
      publicationAt: at === undefined ? null : new Date(at),
      publicationOffsetMinutes: at === undefined ? null : NEW_YORK_WINTER,
    })),
  );
  return id;
}

// A historical event public at 10:00 in New York on 15 January 2026, given with its offset.
const TIMED_JAN_15 = {
  referenceDateOn: '2026-01-15',
  referenceAt: new Date(JAN_15_MORNING),
  referenceOffsetMinutes: NEW_YORK_WINTER,
  referenceDatePrecision: 'exact',
} as const;

/** Writes his birthday derived from `derivedGameId`, the event created at `createdAt`. */
async function birthday(world: World, derivedGameId: number, createdAt: number): Promise<number> {
  const rows = await world.db
    .insert(events)
    .values({
      playerId: P01,
      eventTypeId: BIRTHDAY,
      sheetEventTypeId: BIRTHDAY,
      sheetVersionNumber: 1,
      origin: 'calendar',
      referenceDateOn: '2026-01-17',
      description: 'The player plays on his birthday.',
      derivedGameId,
      createdAt: new Date(createdAt),
    })
    .returning({ id: events.id });
  return firstOf(rows).id;
}

/** Writes a tracked case of his media storms measured at `measuredGameId`, its baseline building. */
async function storedCase(db: Database, measuredGameId: number): Promise<number> {
  const rows = await db
    .insert(cases)
    .values({
      playerId: P01,
      eventTypeId: MEDIA_STORM,
      origin: 'tracked',
      status: 'awaiting_game',
      statusReason: 'baseline_building',
      referenceInstantAt: new Date(END_OF_JAN_15),
      referenceInstantOrigin: 'date_only',
      measuredGameId,
    })
    .returning({ id: cases.id });
  return firstOf(rows).id;
}

async function inputOf(db: Database, query: PlayerQuery = QUERY): Promise<PlayerInput> {
  const built = await buildPlayerInput(db, query);
  if (!built.ok) {
    throw new Error('the player looked for is followed');
  }
  return built.value;
}

function eventOf(input: PlayerInput['input'], eventId: number): EvaluationEvent {
  return firstOf(input.events.filter((event) => event.eventId === eventId));
}

describe('the input of a player’s evaluation', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let world: World;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(NOW));
    world = await buildWorld(db);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[SEN-01] [SEN-02] [CL-SEN-02] [CL-SEN-03] dates an event from its public instant, a date without a time from 00:00 Los Angeles time the next day, a type known in advance from its date and a calendar event from its game', async () => {
    const timed = await historical(world, TIMED_JAN_15, [{ on: '2026-01-15', at: JAN_15_EARLY }]);
    const dateOnly = await historical(world, { referenceDateOn: '2026-01-15' }, [
      { on: '2026-01-15' },
    ]);
    const inAdvance = await historical(
      world,
      { eventTypeId: CONTRACT, sheetEventTypeId: CONTRACT, referenceDateOn: '2026-01-17' },
      [{ on: '2026-01-10' }],
    );
    const derived = await birthday(world, world.games.jan17, JAN_11);
    const { input } = await inputOf(db);
    const ids = input.events.map(({ eventId }) => eventId);
    expect(ids).toStrictEqual([timed, dateOnly, inAdvance, derived]);
    expect(eventOf(input, timed)).toMatchObject({
      eventTypeId: MEDIA_STORM,
      attachmentEvent: {
        kind: 'reference_instant',
        referenceInstantAt: JAN_15_MORNING,
        referenceInstantOrigin: 'known_instant',
        sources: [{ publicationDateOn: '2026-01-15', publicationAt: JAN_15_EARLY }],
      },
      stateEvent: { origin: 'historical', referenceDayOn: '2026-01-15' },
    });
    expect(eventOf(input, dateOnly)).toMatchObject({
      attachmentEvent: {
        kind: 'reference_instant',
        referenceInstantAt: END_OF_JAN_15,
        referenceInstantOrigin: 'date_only',
        sources: [{ publicationDateOn: '2026-01-15', publicationAt: null }],
      },
      stateEvent: { origin: 'historical', referenceDayOn: '2026-01-16' },
    });
    expect(eventOf(input, inAdvance)).toMatchObject({
      eventTypeId: CONTRACT,
      attachmentEvent: {
        kind: 'known_in_advance',
        eventOn: '2026-01-17',
        sources: [{ publicationDateOn: '2026-01-10', publicationAt: null }],
      },
      stateEvent: { origin: 'historical', referenceDayOn: '2026-01-17' },
    });
    expect(eventOf(input, derived)).toStrictEqual({
      eventId: derived,
      eventTypeId: BIRTHDAY,
      contextIndications: { injuryReturn: 'unknown', gameStakes: 'unknown' },
      isDatingToVerify: false,
      researchConfidence: null,
      attachmentEvent: { kind: 'calendar_derived', derivedGame: input.teamGames[1] },
      stateEvent: { origin: 'calendar' },
    });
  });

  it('[CA-SEN-01] [SEN-01] [TRV-73] measures an event dated 15 January without a time on the game of 17 January, not on the evening of the 15th', async () => {
    const dateOnly = await historical(world, { referenceDateOn: '2026-01-15' }, [
      { on: '2026-01-15' },
    ]);
    const { input, params } = await inputOf(db);
    expect(evaluatePlayer(input, params).cases).toMatchObject([
      {
        eventIds: [dateOnly],
        referenceInstantAt: END_OF_JAN_15,
        referenceInstantOrigin: 'date_only',
        measuredGameId: world.games.jan17,
      },
    ]);
  });

  it('[SEN-01] [CL-SEN-02] [TRV-73] reads a date without a time at 00:00 Los Angeles time the next day across both changes of daylight saving time', async () => {
    const ids = await Promise.all(
      Object.keys(DST_ENDS).map(async (on) => historical(world, { referenceDateOn: on }, [{ on }])),
    );
    const { input } = await inputOf(db);
    expect(ids.map((id) => eventOf(input, id).attachmentEvent)).toMatchObject(
      Object.values(DST_ENDS).map((referenceInstantAt) => ({ referenceInstantAt })),
    );
  });

  it('[TRV-73] [CL-SEN-07] [SEN-44] reads a source of the game’s day without a time at the end of that US day in Pacific time, which shifts the event to the next game', async () => {
    const timed = await historical(world, TIMED_JAN_15, [{ on: '2026-01-15' }]);
    const { input, params } = await inputOf(db);
    expect(eventOf(input, timed).attachmentEvent).toMatchObject({
      referenceInstantAt: JAN_15_MORNING,
      sources: [{ publicationDateOn: '2026-01-15', publicationAt: null }],
    });
    expect(input.teamGames[0]).toMatchObject({
      game: { id: world.games.jan15 },
      gameDayOn: '2026-01-15',
      endOfDayPacificAt: END_OF_JAN_15,
    });
    expect(evaluatePlayer(input, params).cases).toMatchObject([
      {
        eventIds: [timed],
        referenceInstantAt: END_OF_JAN_15,
        referenceInstantOrigin: 'uncertain_precedence_shift',
        measuredGameId: world.games.jan17,
      },
    ]);
  });

  it('[JOU-19] [STA-03] [CL-SEN-26] [TAX-10] [SEN-33] gives the player, his mapping state and every type with its states and his events that left the tally', async () => {
    await db.insert(tallyExits).values([
      { playerId: P01, eventTypeId: MEDIA_STORM, exitReason: 'merged' },
      { playerId: P01, eventTypeId: BIRTHDAY, exitReason: 'no_longer_derived' },
      { playerId: P07, eventTypeId: MEDIA_STORM, exitReason: 'erased' },
    ]);
    const { input } = await inputOf(db);
    const ours = new Set([BIRTHDAY, CONTRACT, MEDIA_STORM, TRADE_RUMOR]);
    const types = input.types.filter(({ eventTypeId }) => ours.has(eventTypeId));
    expect([input.player, types]).toStrictEqual([
      { playerId: P01, isWithdrawn: false, hasBirthday: true, isMappingEstablished: true },
      [
        {
          eventTypeId: BIRTHDAY,
          status: 'validated',
          calendarDerivation: 'birthday',
          switchedOffCriterion: null,
          exitReasons: ['no_longer_derived'],
        },
        {
          eventTypeId: CONTRACT,
          status: 'validated',
          calendarDerivation: null,
          switchedOffCriterion: null,
          exitReasons: [],
        },
        {
          eventTypeId: MEDIA_STORM,
          status: 'validated',
          calendarDerivation: null,
          switchedOffCriterion: 'opponent_strength',
          exitReasons: ['merged'],
        },
        {
          eventTypeId: TRADE_RUMOR,
          status: 'withdrawn',
          calendarDerivation: null,
          switchedOffCriterion: null,
          exitReasons: [],
        },
      ],
    ]);
    await db
      .update(followedPlayers)
      .set({ status: 'withdrawn' })
      .where(eq(followedPlayers.id, P07));
    await db
      .update(statsSourceMappings)
      .set({ status: 'to_establish', sourcePlayerRef: null, establishedAt: null })
      .where(eq(statsSourceMappings.playerId, P07));
    const { input: withdrawn } = await inputOf(db, { ...QUERY, playerId: P07 });
    const storms = withdrawn.types.find(({ eventTypeId }) => eventTypeId === MEDIA_STORM);
    expect([withdrawn.player, storms?.exitReasons, withdrawn.teamGames]).toStrictEqual([
      { playerId: P07, isWithdrawn: true, hasBirthday: false, isMappingEstablished: false },
      ['erased'],
      [],
    ]);
  });

  it('[SEN-13] [SEN-14] [SEN-45] [CL-TAX-19] gives each event its context indications and research confidence, and leaves out a detected event and a calendar event whose game is no longer his', async () => {
    const kept = await historical(
      world,
      {
        referenceDateOn: '2026-01-15',
        injuryReturn: 'yes',
        injuryReturnOrigin: 'research',
        gameStakes: 'high',
        gameStakesOrigin: 'user',
        researchConfidence: 'low',
      },
      [{ on: '2026-01-15' }],
    );
    await insertDetectedEvent(db, { playerId: P01 });
    await birthday(world, world.games.previous, JAN_11);
    const { input } = await inputOf(db);
    expect(input.events.map(({ eventId }) => eventId)).toStrictEqual([kept]);
    expect(eventOf(input, kept)).toMatchObject({
      eventTypeId: MEDIA_STORM,
      contextIndications: { injuryReturn: 'yes', gameStakes: 'high' },
      researchConfidence: 'low',
      isDatingToVerify: false,
    });
  });

  it('[SEN-17] [CL-SEN-12] [CL-VUE-13] finds the stored case each case keeps, with its manual decisions, or the origin of a new one', async () => {
    const { previous, jan15, jan17 } = world.games;
    const onJan15 = await storedCase(db, jan15);
    const onJan17 = await storedCase(db, jan17);
    const recorded = await historical(world, { referenceDateOn: '2026-01-15', caseId: onJan15 }, [
      { on: '2026-01-15' },
    ]);
    const later = await historical(world, { referenceDateOn: '2026-01-16' }, [
      { on: '2026-01-16' },
    ]);
    const derivedAhead = await birthday(world, jan17, JAN_11);
    const derivedAtStart = await birthday(world, jan15, JAN_15_EVENING);
    const decisions = await db
      .insert(caseManualDecisions)
      .values({
        caseId: onJan17,
        kind: 'exclude',
        exclusionReason: 'playing_time',
        previousStatus: 'measured',
        measuredGameId: jan17,
        decidedAt: new Date(DECIDED_AT),
      })
      .returning({ id: caseManualDecisions.id });
    const { input } = await inputOf(db);
    const { storedCaseOf } = input;
    const fresh = { origin: 'historical', decisions: [] };
    expect([
      // The case of its type that already has its game, with the decisions made on that game.
      storedCaseOf({ eventTypeId: MEDIA_STORM, measuredGameId: jan17, eventIds: [recorded] }),
      // Else the case of its earliest-recorded event, whatever the order of its events.
      storedCaseOf({
        eventTypeId: MEDIA_STORM,
        measuredGameId: previous,
        eventIds: [later, recorded],
      }),
      // Else a new case with its event's origin, a calendar case tracked when derived ahead
      // and historical when derived at its game's scheduled start (CL-VUE-13).
      storedCaseOf({ eventTypeId: MEDIA_STORM, measuredGameId: null, eventIds: [later] }),
      storedCaseOf({ eventTypeId: CONTRACT, measuredGameId: jan17, eventIds: [later] }),
      storedCaseOf({ eventTypeId: BIRTHDAY, measuredGameId: jan17, eventIds: [derivedAhead] }),
      storedCaseOf({ eventTypeId: BIRTHDAY, measuredGameId: jan15, eventIds: [derivedAtStart] }),
    ]).toMatchObject([
      {
        origin: 'tracked',
        decisions: [
          {
            id: firstOf(decisions).id,
            kind: 'exclude',
            decidedAt: DECIDED_AT,
            measuredGameId: jan17,
          },
        ],
      },
      { origin: 'tracked', decisions: [] },
      fresh,
      fresh,
      { origin: 'tracked', decisions: [] },
      fresh,
    ]);
    const unknown = { eventTypeId: MEDIA_STORM, measuredGameId: null, eventIds: [0] };
    expect(() => storedCaseOf(unknown)).toThrow('No event of his among 0');
  });

  it('[TRV-35] [CL-TRV-03] refuses a player nobody follows, and gives the instant of the evaluation with its US date, the New York one in the evening, and the calculation parameters in force', async () => {
    const unknown = await buildPlayerInput(db, { ...QUERY, playerId: UNKNOWN_PLAYER });
    expect(unknown).toStrictEqual({ ok: false, error: { kind: 'player_not_found' } });
    await db
      .insert(parameterOverrides)
      .values({ parameterKey: 'games.minBaselineGames', value: 9 });
    // 19:30 in New York, already the next day in UTC; the suite's clock comes back after.
    installFakeClock(fixedClock(toEpochMs(JAN_15_EVENING)));
    const { input, params } = await inputOf(db);
    expect([input.now, input.nowGameDayOn, params.games.minBaselineGames]).toStrictEqual([
      JAN_15_EVENING,
      '2026-01-15',
      9,
    ]);
    expect(input.seasons).toMatchObject({
      firstCoveredSeason: '2023-24',
      readSeasons: [
        { season: '2024-25', hasPlayerLines: false },
        { season: '2025-26', hasPlayerLines: true },
      ],
    });
  });
});

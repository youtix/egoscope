// What evaluatePlayer reads of one followed player (SEN-01 to SEN-18, CL-SEN-05), loaded
// from stored data alone: the statistics source is never asked. With input-games.ts, it
// holds the only time conversions of the calculation (TRV-73, CL-SEN-02, CL-SEN-07): a
// public date known without its time is public at the end of its day in Pacific time, and
// each team game carries the end of its US day in Pacific time, where an uncertain
// precedence shifts an event. An imprecise instant is thus always read at its latest
// compatible instant.
import 'server-only';

import { asc, eq } from 'drizzle-orm';

import {
  caseManualDecisions,
  cases,
  eventTypes,
  followedPlayers,
  statsSourceMappings,
  tallyExits,
} from '@/lib/db';
import { eventsOfPlayer } from '@/lib/events';
import { seasonSpans } from '@/lib/games';
import { err, ok } from '@/lib/result';
import { endOfDayPacific, gameDay, now, toEpochMs } from '@/lib/time';

import { paramsInForce } from './engine-params';
import { caseSeasonsOf, playerGamesOf } from './input-games';

import type { CaseRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { CalendarDerivedEvent, HistoricalEvent, PlayerEvent } from '@/lib/events';
import type { Result } from '@/lib/result';
import type {
  CaseKey,
  CaseOrigin,
  EngineParams,
  EvaluationEvent,
  EvaluationTeamGame,
  ManualDecision,
  PlayerEvaluationInput,
  StoredCase,
} from '@/lib/stats-engine';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

/** What a player's input is built for: the player, and the source's first season (STA-45). */
export type PlayerQuery = Readonly<{ playerId: string; firstCoveredSeason: string }>;

/** A player's evaluation input, and the calculation parameters in force (TRV-35). */
export type PlayerInput = Readonly<{ input: PlayerEvaluationInput; params: EngineParams }>;

/** Why no input is built: the player is not followed, or no longer. */
export type PlayerNotFound = Readonly<{ kind: 'player_not_found' }>;

/** One of his events as the engine reads it, with its own case and the origin of a new one. */
type LoadedEvent = Readonly<{ event: EvaluationEvent; caseId: number | null; origin: CaseOrigin }>;

/** His stored cases and their manual decisions, each with its game (SEN-17, CL-SEN-12). */
type Stored = Readonly<{
  cases: readonly CaseRow[];
  decisions: readonly (ManualDecision & Readonly<{ caseId: number }>)[];
}>;

/** What every event of his gives the engine besides its dating (SEN-13, SEN-14, SEN-43). */
function commonOf(event: PlayerEvent) {
  const { injuryReturn, gameStakes } = event.context;
  return {
    eventId: event.playerEventId,
    eventTypeId: event.eventTypeId,
    contextIndications: { injuryReturn: injuryReturn.value, gameStakes: gameStakes.value },
    isDatingToVerify: false,
  };
}

/**
 * A historical event (SEN-01, SEN-02, CL-SEN-02, CL-SEN-04): of a type known in advance,
 * searched from its date as written; otherwise from its public instant, or, for a date
 * known without its time, from the end of that day in Pacific time, 00:00 Los Angeles
 * time the next day. Its sources keep their precision, a date alone with no instant, for
 * its precedence (IMP-18, SEN-44); its season is told from the US day of its instant.
 */
function historicalOf(event: HistoricalEvent, isKnownInAdvance: boolean): EvaluationEvent {
  const { on, at } = event.referenceDate;
  const sources = event.sources.map(({ publicationDate }) => ({
    publicationDateOn: publicationDate.on,
    publicationAt: publicationDate.at,
  }));
  const common = { ...commonOf(event), researchConfidence: event.researchConfidence };
  if (isKnownInAdvance) {
    const attachmentEvent = { kind: 'known_in_advance', eventOn: on, sources } as const;
    return { ...common, attachmentEvent, stateEvent: { origin: 'historical', referenceDayOn: on } };
  }
  const referenceInstantAt = at ?? endOfDayPacific(on);
  return {
    ...common,
    attachmentEvent: {
      kind: 'reference_instant',
      referenceInstantAt,
      referenceInstantOrigin: at === null ? 'date_only' : 'known_instant',
      sources,
    },
    stateEvent: { origin: 'historical', referenceDayOn: gameDay(referenceInstantAt) },
  };
}

/**
 * A calendar-derived event, measured on its derived game (CL-SEN-03), its case tracked
 * when the event was created before that game's start (CL-VUE-13); none while that game
 * is no longer one of his team games, until its type's derivation runs again (CL-TAX-19).
 */
function calendarOf(
  event: CalendarDerivedEvent,
  gameById: ReadonlyMap<number, EvaluationTeamGame>,
): LoadedEvent | null {
  const derivedGame = gameById.get(event.derivedGameId);
  if (derivedGame === undefined) {
    return null;
  }
  const attachmentEvent = { kind: 'calendar_derived', derivedGame } as const;
  return {
    event: {
      ...commonOf(event),
      researchConfidence: null,
      attachmentEvent,
      stateEvent: { origin: 'calendar' },
    },
    caseId: event.caseId,
    origin: event.createdAt < derivedGame.game.scheduledStartAt ? 'tracked' : 'historical',
  };
}

/**
 * His events that the engine measures, in the order recorded: his historical and
 * calendar-derived events, none of them withdrawn, since a withdrawn event is erased.
 */
function loadedEventsOf(
  playerEvents: readonly PlayerEvent[],
  of: Readonly<{
    knownInAdvance: ReadonlySet<string>;
    gameById: ReadonlyMap<number, EvaluationTeamGame>;
  }>,
): readonly LoadedEvent[] {
  return playerEvents.flatMap((event) => {
    if (event.origin === 'historical') {
      const evaluated = historicalOf(event, of.knownInAdvance.has(event.eventTypeId));
      return { event: evaluated, caseId: event.caseId, origin: 'historical' } as const;
    }
    // The slot of Lot 2: SS-sensitivity-detected-events gives a detected event here (SEN-45).
    return event.origin === 'calendar' ? (calendarOf(event, of.gameById) ?? []) : [];
  });
}

/**
 * The stored case that a case keeps (events-and-cases.md 2.5, CL-VUE-03), with its manual
 * decisions, each made on its game (SEN-17, CL-SEN-12): the case of its type that already
 * has its measured game, else the case of its earliest-recorded event, else a new case
 * with that event's origin and no decision. An event that is not his is a bug of the caller.
 */
function storedCaseOf(loaded: readonly LoadedEvent[], stored: Stored) {
  return ({ eventTypeId, measuredGameId, eventIds }: CaseKey): StoredCase => {
    const earliest = loaded.find(({ event }) => eventIds.includes(event.eventId));
    if (earliest === undefined) {
      throw new Error(`No event of his among ${eventIds.join(', ')}`);
    }
    const kept =
      stored.cases.find(
        (row) =>
          measuredGameId !== null &&
          row.measuredGameId === measuredGameId &&
          row.eventTypeId === eventTypeId,
      ) ?? stored.cases.find((row) => row.id === earliest.caseId);
    if (kept === undefined) {
      return { origin: earliest.origin, decisions: [] };
    }
    const decisions = stored.decisions.filter((decision) => decision.caseId === kept.id);
    return { origin: kept.origin, decisions };
  };
}

/** His stored cases and their manual decisions (SEN-17), read once. */
async function storedOf(db: Reader, playerId: string): Promise<Stored> {
  const rows = await db.select().from(cases).where(eq(cases.playerId, playerId));
  const decisions = await db
    .select({ row: caseManualDecisions })
    .from(caseManualDecisions)
    .innerJoin(cases, eq(cases.id, caseManualDecisions.caseId))
    .where(eq(cases.playerId, playerId));
  return {
    cases: rows,
    decisions: decisions.map(({ row }) => ({
      ...row,
      decidedAt: toEpochMs(row.decidedAt.getTime()),
    })),
  };
}

/**
 * Every event type (TAX-10, ADR 0015, ADR 0016), in the order of their ids: its status,
 * calendar derivation and switched-off criterion, and his events of it that left the
 * tally, by reason (SEN-33); and the types known in advance (SEN-02).
 */
async function typesOf(db: Reader, playerId: string) {
  const rows = await db.select().from(eventTypes).orderBy(asc(eventTypes.id));
  const exits = await db
    .select({ eventTypeId: tallyExits.eventTypeId, exitReason: tallyExits.exitReason })
    .from(tallyExits)
    .where(eq(tallyExits.playerId, playerId))
    .orderBy(asc(tallyExits.id));
  const types = rows.map((row) => ({
    eventTypeId: row.id,
    status: row.status,
    calendarDerivation: row.calendarDerivation,
    switchedOffCriterion: row.switchedOffCriterion,
    exitReasons: exits.filter((exit) => exit.eventTypeId === row.id).map((exit) => exit.exitReason),
  }));
  const knownInAdvance = new Set(rows.filter((row) => row.knownInAdvance).map((row) => row.id));
  return { types, knownInAdvance };
}

/** The player as his evaluation reads him (JOU-19, CL-SEN-26, STA-03), null when unknown. */
async function playerOf(db: Reader, playerId: string) {
  const rows = await db
    .select({
      status: followedPlayers.status,
      birthdayMonth: followedPlayers.birthdayMonth,
      mapping: statsSourceMappings.status,
    })
    .from(followedPlayers)
    .leftJoin(statsSourceMappings, eq(statsSourceMappings.playerId, followedPlayers.id))
    .where(eq(followedPlayers.id, playerId));
  const [row] = rows;
  return row === undefined
    ? null
    : {
        playerId,
        isWithdrawn: row.status === 'withdrawn',
        hasBirthday: row.birthdayMonth !== null,
        isMappingEstablished: rows.some(({ mapping }) => mapping === 'established'),
      };
}

/**
 * Builds what evaluatePlayer reads of one followed player, from stored data alone
 * (SEN-01 to SEN-18, CL-SEN-05, TRV-73): the player, withdrawn or not, with or without a
 * recorded birthday, and his mapping state; every type, with its states and his tally
 * exits; his historical and calendar-derived events, with their sources, context
 * indications and research confidence, each dated as CL-SEN-02 rules; his team games of
 * every season, with his participation, minutes and checked line, each with the end of
 * its US day in Pacific time (CL-SEN-07); the stored schedules; the seasons; the instant
 * of the evaluation and its US date (CL-TRV-03); his stored cases with their manual
 * decisions; and the calculation parameters in force. Refused when he is not followed.
 */
export async function buildPlayerInput(
  db: Reader,
  query: PlayerQuery,
): Promise<Result<PlayerInput, PlayerNotFound>> {
  const { playerId, firstCoveredSeason } = query;
  const player = await playerOf(db, playerId);
  if (player === null) {
    return err({ kind: 'player_not_found' });
  }
  const at = now();
  const spans = await seasonSpans(db);
  const { teamGames, schedules } = await playerGamesOf(db, playerId, spans);
  const { types, knownInAdvance } = await typesOf(db, playerId);
  const gameById = new Map(teamGames.map((teamGame) => [teamGame.game.id, teamGame]));
  const loaded = loadedEventsOf(await eventsOfPlayer(db, playerId), { knownInAdvance, gameById });
  const input: PlayerEvaluationInput = {
    player,
    types,
    events: loaded.map(({ event }) => event),
    teamGames,
    schedules,
    seasons: await caseSeasonsOf(db, { spans, at, firstCoveredSeason }),
    now: at,
    nowGameDayOn: gameDay(at),
    storedCaseOf: storedCaseOf(loaded, await storedOf(db, playerId)),
  };
  return ok({ input, params: await paramsInForce(db) });
}

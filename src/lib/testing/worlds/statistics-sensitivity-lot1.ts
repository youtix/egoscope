// The world of statistics and sensitivity, Lot 1 (module map, testing): a profiled player
// with cases of every status and of both origins and his profiles, a type's general trend
// with its verdict history, and a player whose birthday falls on his next game day.
import { and, asc, eq, inArray, or } from 'drizzle-orm';

import {
  boxScores,
  cases,
  caseTriggeredCriteria,
  events,
  games,
  generalTrends,
  sensitivityProfiles,
  teamSourceRefs,
} from '@/lib/db';
import { endOfDayPacific, gameDay, gameDayStart, toEpochMs, toIsoDate } from '@/lib/time';

import { insertHistoricalEvent } from '../factories/events';
import { insertLeagueSeason } from '../factories/games';
import { insertPlayer } from '../factories/players';
import { DEFAULT_PARAMS } from '../factories/profile-cases';
import {
  insertProfile,
  insertTrend,
  insertValueVersion,
  insertVerdictChange,
} from '../factories/profiles';
import { insertValidCase } from '../factories/sensitivity';
import { BIRTHDAY, insertCalendarType, MEDIA_STORM } from '../factories/taxonomy';
import { firstRow, present } from '../rows';

import type { EventRow } from '../factories/events';
import type { PlayerRow } from '../factories/players';
import type { CaseRow } from '../factories/sensitivity';
import type { EventTypeRow } from '../factories/taxonomy';
import type { ProfiledPlayer, World } from '../scenarios';
import type { Database } from '@/lib/db';
import type {
  GeneralTrendRow,
  ProfileValueVersionRow,
  SensitivityProfileRow,
  VerdictHistoryEntryRow,
} from '@/lib/sensitivity';
import type { EngineParams } from '@/lib/stats-engine';
import type { IsoDate } from '@/lib/time';

// The season of the birthday game, the team the first invented player plays for, and the
// day of that game, his birthday, 26 October, which the league's schedule makes a game day
// of his team, the third of the season.
const BIRTHDAY_SEASON = '2026-27';
const BIRTHDAY_TEAM = '1';
const BIRTHDAY_GAME_DAY = toIsoDate('2026-10-26');
// When the derivation recorded the birthday event and its case: the start of 24 October
// 2026, US Eastern, between his games of the 23rd and the 26th, so before the game.
const BIRTHDAY_RECORDED_AT = new Date(gameDayStart(toIsoDate('2026-10-24')));
// The season of the profiled player's cases, and the rank of the game of his excluded
// case among his games of that season: the one after his seven valid cases.
const MEASURED_SEASON = '2024-25';
const VALID_CASES = 7;
const DAY_MS = 86_400_000;
// A media storm of the season that the source does not cover, and one whose precedence
// over his game of that day is to verify.
const UNCOVERED_DAY = toIsoDate('2024-01-15');
const PRECEDENCE_TO_VERIFY_DAY = toIsoDate('2024-11-15');
// How many of his first valid cases his historical-only values held at the import.
const EARLIER_CASES = 4;
// When his cases were imported, and when the last came and the parameters changed.
const IMPORTED_AT = gameDayStart(toIsoDate('2025-06-03'));
const COMPLETED_AT = gameDayStart(toIsoDate('2025-07-01'));
// The parameters in force until then, under which his seven valid cases, of a ratio of
// about 0.55 and a mean gap of about 0.254, gave his default profile and the type's
// default trend, from one player, a possible increase, inconclusive since.
const POSSIBLE_SIGNAL_TO_NOISE_BEFORE = 0.5;
const PARAMS_BEFORE: EngineParams = {
  ...DEFAULT_PARAMS,
  sensitivity: {
    ...DEFAULT_PARAMS.sensitivity,
    possibleSignalToNoise: POSSIBLE_SIGNAL_TO_NOISE_BEFORE,
    trendMinPlayers: 1,
  },
};

/** What `birthdayOnNextGameDay` wrote. */
export type BirthdayGame = Readonly<{
  player: PlayerRow;
  type: EventTypeRow;
  gameId: number;
  event: EventRow;
  tracked: CaseRow;
}>;

/** The game of the first invented player's team on his birthday in 2026-27. */
async function birthdayGameId(db: Database): Promise<number> {
  const team = db
    .select({ id: teamSourceRefs.teamId })
    .from(teamSourceRefs)
    .where(eq(teamSourceRefs.sourceTeamRef, BIRTHDAY_TEAM));
  const playsIn = or(inArray(games.homeTeamId, team), inArray(games.awayTeamId, team));
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.gameDayOn, BIRTHDAY_GAME_DAY), playsIn));
  return firstRow(rows, 'the birthday game').id;
}

/**
 * A player whose birthday falls on his next game day (ADR 0015, SEN-02, CL-TRV-03): the
 * first invented player, born on 26 October, the season 2026-27 of the league, the
 * birthday type validated, and the event derived from the calendar for his team's game
 * of 26 October 2026, recorded on the 24th, with its tracked case awaiting that game,
 * known in advance; his next game day once the clock stands between his games of the 23rd
 * and the 26th. Once applied, it is left as it is and gives the rows it wrote.
 */
export async function birthdayOnNextGameDay(db: Database): Promise<BirthdayGame> {
  const type = await insertCalendarType(db);
  await insertLeagueSeason(db, BIRTHDAY_SEASON);
  const player = await insertPlayer(db, { source: 'p01' });
  const gameId = await birthdayGameId(db);
  const [held] = await db
    .select({ event: events, tracked: cases })
    .from(events)
    .innerJoin(cases, eq(cases.id, events.caseId))
    .where(and(eq(events.eventTypeId, BIRTHDAY), eq(events.derivedGameId, gameId)));
  if (held !== undefined) {
    return { player, type, gameId, ...held };
  }
  const recorded = { createdAt: BIRTHDAY_RECORDED_AT, computedAt: BIRTHDAY_RECORDED_AT };
  const trackedRows = await db
    .insert(cases)
    .values({
      playerId: player.id,
      eventTypeId: BIRTHDAY,
      origin: 'tracked',
      status: 'awaiting_game',
      statusReason: 'game_not_played_yet',
      referenceInstantOrigin: 'known_in_advance',
      measuredGameId: gameId,
      ...recorded,
    })
    .returning();
  const tracked = firstRow(trackedRows, 'the birthday case');
  const eventRows = await db
    .insert(events)
    .values({
      playerId: player.id,
      eventTypeId: BIRTHDAY,
      sheetEventTypeId: BIRTHDAY,
      sheetVersionNumber: present(type.currentVersionNumber, 'the version of the birthday sheet'),
      origin: 'calendar',
      referenceDateOn: BIRTHDAY_GAME_DAY,
      description: 'The player plays on his birthday.',
      derivedGameId: gameId,
      caseId: tracked.id,
      createdAt: BIRTHDAY_RECORDED_AT,
      updatedAt: BIRTHDAY_RECORDED_AT,
    })
    .returning();
  return { player, type, gameId, event: firstRow(eventRows, 'the birthday event'), tracked };
}

/** A profile or a trend in each view (SEN-21). */
export type ByView<T> = Readonly<{ allCases: T; historicalOnly: T; trackedOnly: T }>;

/** What `playerWithEveryStatus` wrote, beside the profiled player and his birthday game. */
export type PlayerWithEveryStatus = Readonly<{
  profiled: ProfiledPlayer;
  birthday: BirthdayGame;
  excluded: CaseRow;
  notMeasurable: CaseRow;
  awaiting: CaseRow;
  profiles: ByView<SensitivityProfileRow>;
  birthdayProfile: SensitivityProfileRow;
  history: VerdictHistoryEntryRow;
  versions: readonly ProfileValueVersionRow[];
}>;

/** The case excluded for the unusual stakes of his game after his seven valid ones, with its criterion and its event of the day before (SEN-12, SEN-18). */
async function insertExcludedCase(db: Database, profiled: ProfiledPlayer): Promise<CaseRow> {
  const { player, imported } = profiled;
  const after = await db
    .select({ id: games.id, tipOff: games.scheduledStartAt })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(eq(boxScores.playerId, player.id), eq(games.season, MEASURED_SEASON)))
    .orderBy(asc(games.scheduledStartAt))
    .offset(VALID_CASES)
    .limit(1);
  const measured = firstRow(after, 'his game after his seven valid cases');
  const eventOn = gameDay(toEpochMs(measured.tipOff.getTime() - DAY_MS));
  const excluded = await insertValidCase(db, {
    playerId: player.id,
    measuredGameId: measured.id,
    eventOn,
    overrides: { status: 'excluded' },
  });
  await db.insert(caseTriggeredCriteria).values({
    caseId: excluded.id,
    criterion: 'unusual_stakes',
    condition: 'flagged',
    triggeringValues: { gameStakes: 'high' },
  });
  await insertHistoricalEvent(db, {
    playerId: player.id,
    originImportId: imported.id,
    overrides: {
      referenceDateOn: eventOn,
      caseId: excluded.id,
      gameStakes: 'high',
      gameStakesOrigin: 'research',
    },
  });
  return excluded;
}

/** A historical case of the profiled player that reached no game, for `statusReason`, with its event of `day`, computed on 1 July 2025 (SEN-07, CL-SEN-05). */
async function insertGamelessCase(
  db: Database,
  profiled: ProfiledPlayer,
  of: Readonly<{ day: IsoDate } & Pick<CaseRow, 'status' | 'statusReason'>>,
): Promise<CaseRow> {
  const { player, imported } = profiled;
  const rows = await db
    .insert(cases)
    .values({
      playerId: player.id,
      eventTypeId: MEDIA_STORM,
      origin: 'historical',
      status: of.status,
      statusReason: of.statusReason,
      referenceInstantOrigin: 'date_only',
      referenceInstantAt: new Date(endOfDayPacific(of.day)),
      computedAt: new Date(COMPLETED_AT),
    })
    .returning();
  const written = firstRow(rows, 'the case written');
  const precedence = of.statusReason === 'precedence_to_verify' ? 'to_verify' : 'established';
  await insertHistoricalEvent(db, {
    playerId: player.id,
    originImportId: imported.id,
    overrides: { referenceDateOn: of.day, caseId: written.id, precedence },
  });
  return written;
}

/** The player's first four valid cases, all media storms, by identifier. */
async function earlierCaseIds(db: Database, playerId: string): Promise<readonly number[]> {
  const valid = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.playerId, playerId), eq(cases.status, 'measured')))
    .orderBy(asc(cases.id))
    .limit(EARLIER_CASES);
  return valid.map(({ id }) => id);
}

/**
 * A profiled player with cases of every status and of both origins (SEN-05, SEN-07,
 * SEN-19 to SEN-27, SEN-37, SUI-08): beside the seven valid media storms of `profiled`, a
 * case excluded for the unusual stakes of his next game, one not measurable in the season
 * the source does not cover and one awaiting the check of its precedence, all historical,
 * and the tracked birthday case of `birthdayOnNextGameDay`, recorded before its game; his
 * media-storm profiles in each view and his birthday profile, computed now from those
 * cases; the change of his default profile by the parameter change of 1 July 2025, from
 * a possible increase to inconclusive, of low confidence; and two versions of his
 * historical-only values, of his first four valid cases from the import and of all his
 * cases from 1 July 2025. Writes them anew at each call.
 */
export async function playerWithEveryStatus(
  db: Database,
  profiled: ProfiledPlayer,
): Promise<PlayerWithEveryStatus> {
  const birthday = await birthdayOnNextGameDay(db);
  const excluded = await insertExcludedCase(db, profiled);
  const notMeasurable = await insertGamelessCase(db, profiled, {
    day: UNCOVERED_DAY,
    status: 'not_measurable',
    statusReason: 'season_not_covered',
  });
  const awaiting = await insertGamelessCase(db, profiled, {
    day: PRECEDENCE_TO_VERIFY_DAY,
    status: 'awaiting_game',
    statusReason: 'precedence_to_verify',
  });
  const playerId = profiled.player.id;
  const profiles = {
    allCases: await insertProfile(db, { playerId, view: 'all_cases' }),
    historicalOnly: await insertProfile(db, { playerId, view: 'historical_only' }),
    trackedOnly: await insertProfile(db, { playerId, view: 'tracked_only' }),
  };
  const birthdayProfile = await insertProfile(db, { playerId, eventTypeId: BIRTHDAY });
  const history = await insertVerdictChange(db, {
    subject: { profileId: profiles.allCases.id },
    paramsBefore: PARAMS_BEFORE,
    cause: 'parameter_change',
    changedAt: COMPLETED_AT,
  });
  const earlier = await earlierCaseIds(db, playerId);
  const subject = { profileId: profiles.historicalOnly.id };
  const versions = [
    await insertValueVersion(db, { subject, effectiveAt: IMPORTED_AT, caseIds: earlier }),
    await insertValueVersion(db, { subject, effectiveAt: COMPLETED_AT }),
  ];
  return {
    profiled,
    birthday,
    excluded,
    notMeasurable,
    awaiting,
    profiles,
    birthdayProfile,
    history,
    versions,
  };
}

/** What `trendWithHistory` wrote. */
export type TrendWithHistory = Readonly<{
  trends: ByView<GeneralTrendRow>;
  history: VerdictHistoryEntryRow;
  version: ProfileValueVersionRow;
}>;

/**
 * The media storm's general trend with its verdict history (SEN-28 to SEN-30, SEN-37,
 * CL-SEN-20, SUI-09): the trend in each view, computed now from every player's stored
 * cases of the type; the change of the default trend by the parameter change of 1 July
 * 2025, as his profile's; the version of its historical-only values from then.
 * Writes them anew at each call.
 */
export async function trendWithHistory(db: Database): Promise<TrendWithHistory> {
  const trends = {
    allCases: await insertTrend(db, { view: 'all_cases' }),
    historicalOnly: await insertTrend(db, { view: 'historical_only' }),
    trackedOnly: await insertTrend(db, { view: 'tracked_only' }),
  };
  const history = await insertVerdictChange(db, {
    subject: { trendId: trends.allCases.id },
    paramsBefore: PARAMS_BEFORE,
    cause: 'parameter_change',
    changedAt: COMPLETED_AT,
  });
  const version = await insertValueVersion(db, {
    subject: { trendId: trends.historicalOnly.id },
    effectiveAt: COMPLETED_AT,
  });
  return { trends, history, version };
}

/** The scenarios of the testing module that this world builds on. */
export type WorldBase = Readonly<{
  profiledPlayer: (db: Database) => Promise<ProfiledPlayer>;
}>;

/**
 * The world of statistics and sensitivity, Lot 1, built on `base`, the profiled player of
 * the testing module, which `scenarios.ts` passes it (SEN-05, SEN-19, SEN-28, SEN-37):
 * `birthday-on-next-game-day`, `player-with-cases-of-every-status`, which applies it, and
 * `general-trend-with-history`, which applies the latter. A scenario already applied
 * leaves its rows as they are, so that scenarios combine.
 */
export function statisticsSensitivityLot1(base: WorldBase): World {
  const everyStatus = async (db: Database) => {
    const profiled = await base.profiledPlayer(db);
    const { id } = profiled.player;
    const profiles = await db.$count(sensitivityProfiles, eq(sensitivityProfiles.playerId, id));
    return profiles > 0 ? null : playerWithEveryStatus(db, profiled);
  };
  return {
    'birthday-on-next-game-day': birthdayOnNextGameDay,
    'player-with-cases-of-every-status': everyStatus,
    'general-trend-with-history': async (db) => {
      await everyStatus(db);
      const trends = await db.$count(generalTrends, eq(generalTrends.eventTypeId, MEDIA_STORM));
      return trends > 0 ? null : trendWithHistory(db);
    },
  };
}

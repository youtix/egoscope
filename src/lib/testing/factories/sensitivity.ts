import { and, asc, eq, gt } from 'drizzle-orm';

import { boxScores, cases, games, parameterOverrides } from '@/lib/db';
import {
  baselinePhaseOf,
  classifyGame,
  doubtfulCaseCriteria,
  gameScore,
  normalizedGap,
  participationOf,
  performanceIndex,
  phaseState,
  playingTimeThreshold,
  seasonBaseline,
  verifyBoxScore,
} from '@/lib/stats-engine';
import { endOfDayPacific, gameDay, now, toEpochMs } from '@/lib/time';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { firstRow, present } from '../rows';
import { MEDIA_STORM } from './taxonomy';

import type { Database } from '@/lib/db';
import type {
  BaselineGame,
  BoxScoreLine,
  CheckedBoxScore,
  DoubtfulCaseCriteria,
  EngineParams,
  PhaseGame,
  PlayerGame,
  SeasonBaseline,
} from '@/lib/stats-engine';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A case as the database holds it. */
export type CaseRow = typeof cases.$inferSelect;

/** What `insertValidCase` takes: the player, the game measured, the day its event became public, and the columns to write otherwise. */
export type CaseFactoryOptions = Readonly<{
  playerId: string;
  measuredGameId: number;
  /** The date-only public date of the case's event, the day before the game's US date by default. */
  eventOn?: IsoDate;
  overrides?: Partial<typeof cases.$inferInsert>;
}>;

// The engine's parameters at their default values, those of the parameter registry.
const DEFAULT_PARAMS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};
const DAY_MS = 86_400_000;
// A season is named by the year it starts in and the last two digits of the next one.
const YEAR_DIGITS = 4;
const SHORT_YEAR = 100;
const SHORT_YEAR_DIGITS = 2;
// An event of the factories says nothing of a return from injury or of the game's stakes.
const NO_INDICATION = { injuryReturn: 'unknown', gameStakes: 'unknown' } as const;

/** The instant that a timestamp column holds. */
const instantOf = (at: Date): EpochMs => toEpochMs(at.getTime());

/** The season before `season`: 2023-24 for 2024-25. */
function previousSeason(season: string): string {
  const year = Number(season.slice(0, YEAR_DIGITS)) - 1;
  return `${String(year)}-${String((year + 1) % SHORT_YEAR).padStart(SHORT_YEAR_DIGITS, '0')}`;
}

/** The engine's parameters, `games.minBaselineGames` as the database overrides it (STA-19). */
async function paramsOf(db: Database): Promise<EngineParams> {
  const rows = await db
    .select({ value: parameterOverrides.value })
    .from(parameterOverrides)
    .where(eq(parameterOverrides.parameterKey, 'games.minBaselineGames'));
  const value = rows[0]?.value;
  return typeof value === 'number'
    ? { ...DEFAULT_PARAMS, games: { ...DEFAULT_PARAMS.games, minBaselineGames: value } }
    : DEFAULT_PARAMS;
}

/** The stored schedule of `season`, every team's games, as the engine reads it (STA-06, STA-33). */
async function scheduleOf(db: Database, season: string): Promise<readonly PhaseGame[]> {
  const rows = await db.select().from(games).where(eq(games.season, season));
  return rows.map((game) => ({
    ...game,
    finalScore:
      game.homeScore === null || game.awayScore === null
        ? null
        : { home: game.homeScore, away: game.awayScore },
    scheduledStartAt: instantOf(game.scheduledStartAt),
    consolidatedAt: game.consolidatedAt === null ? null : instantOf(game.consolidatedAt),
  }));
}

/** His stored lines of `season`, with their games, by scheduled start, then game id (CL-STA-09). */
async function linesOf(db: Database, playerId: string, season: string) {
  return db
    .select({
      line: boxScores,
      scheduledStartAt: games.scheduledStartAt,
      phase: games.phase,
      overtimeCount: games.overtimeCount,
    })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(eq(boxScores.playerId, playerId), eq(games.season, season)))
    .orderBy(asc(games.scheduledStartAt), asc(games.id));
}

type StoredLine = Awaited<ReturnType<typeof linesOf>>[number];

/** A stored line as the engine checks it (STA-09, STA-10). */
function boxScoreLine({ line }: StoredLine): BoxScoreLine {
  const { minutes, seconds, ...rest } = line;
  const counts = {
    points: rest.points,
    fieldGoalsMade: rest.fieldGoalsMade,
    fieldGoalsAttempted: rest.fieldGoalsAttempted,
    threePointersMade: rest.threePointersMade,
    freeThrowsMade: rest.freeThrowsMade,
    freeThrowsAttempted: rest.freeThrowsAttempted,
    offensiveRebounds: rest.offensiveRebounds,
    defensiveRebounds: rest.defensiveRebounds,
    assists: rest.assists,
    steals: rest.steals,
    blocks: rest.blocks,
    turnovers: rest.turnovers,
    personalFouls: rest.personalFouls,
  };
  return line.hasRoundedMinutes
    ? { ...counts, minutesPrecision: 'whole_minutes', minutes, seconds: null }
    : { ...counts, minutesPrecision: 'seconds', minutes, seconds };
}

/**
 * One of his team games (CL-STA-04): the game of a stored line, since the source gives a
 * did-not-play line for each game of his team that he missed, and its lines are published.
 */
function playerGameOf(stored: StoredLine): PlayerGame {
  const line = boxScoreLine(stored);
  return {
    gameId: stored.line.gameId,
    scheduledStartAt: instantOf(stored.scheduledStartAt),
    phase: stored.phase,
    boxScore:
      participationOf(line, true) === 'played' ? verifyBoxScore(line, stored.overtimeCount) : null,
  };
}

/** A team game as a baseline reads it, with the threshold of its season (STA-13, STA-14). */
function baselineGameOf(game: PlayerGame, threshold: number): BaselineGame {
  const { boxScore, gameId, scheduledStartAt, phase } = game;
  const of = { gameId, scheduledStartAt, phase };
  if (boxScore === null) {
    return { ...of, classification: 'not_played', performanceIndex: null };
  }
  const index = boxScore.status === 'complete' ? performanceIndex(boxScore) : null;
  return index !== null && classifyGame(game, threshold) === 'usable'
    ? { ...of, classification: 'usable', performanceIndex: index }
    : { ...of, classification: 'played_not_usable', performanceIndex: index };
}

/** What a case of the player is measured at: the game, and the day its event became public. */
type Measured = Readonly<{ playerId: string; gameId: number; eventOn: IsoDate | undefined }>;

/**
 * What a case is measured from (SEN-01): the regular-season game, his team games of its
 * season and their threshold, the stored schedules of that season and of the one before,
 * and the reference instant, the end in Pacific time of the day of the event, the day
 * before the game's US date unless it is given.
 */
async function seasonOf(db: Database, { playerId, gameId, eventOn }: Measured) {
  const params = await paramsOf(db);
  const regular = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.phase, 'regular_season')));
  const game = firstRow(regular, `the regular-season game ${String(gameId)}`);
  const lines = await linesOf(db, playerId, game.season);
  const { line } = firstRow(
    lines.filter((stored) => stored.line.gameId === gameId),
    'his line of the game',
  );
  const teamGames = lines.map((stored) => playerGameOf(stored));
  const later = await db.select({ id: games.id }).from(games).where(gt(games.season, game.season));
  const tipOff = instantOf(game.scheduledStartAt);
  const dayBefore = gameDay(toEpochMs(tipOff - DAY_MS));
  return {
    params,
    game,
    teamId: present(line.teamId, 'his team in the game'),
    teamGames,
    threshold: playingTimeThreshold(teamGames, params),
    schedule: await scheduleOf(db, game.season),
    previousSchedule: await scheduleOf(db, previousSeason(game.season)),
    hasLaterSeasonGame: later.length > 0,
    referenceAt: endOfDayPacific(eventOn ?? dayBefore),
  };
}

type Season = Awaited<ReturnType<typeof seasonOf>>;

/**
 * The box score of the measured game (SEN-03, STA-14): the first game he played that
 * starts strictly after the reference instant must be the game measured, and usable.
 */
function measuredBoxScore({ game, teamGames, threshold, referenceAt }: Season): CheckedBoxScore {
  const first = teamGames.find(
    (candidate) => candidate.boxScore !== null && candidate.scheduledStartAt > referenceAt,
  );
  const boxScore = first?.boxScore;
  if (
    first?.gameId !== game.id ||
    boxScore?.status !== 'complete' ||
    classifyGame(first, threshold) !== 'usable'
  ) {
    throw new Error(`The game ${String(game.id)} is not a usable measured game.`);
  }
  return boxScore;
}

/** The season baseline of the measured game, which alone it leaves out (STA-16 to STA-24, SEN-08). */
function baselineOf(season: Season): SeasonBaseline {
  const { params, game, teamGames, threshold, schedule, hasLaterSeasonGame } = season;
  const state = phaseState(
    { games: schedule, series: [], hasLaterSeasonGame },
    { regularSeasonAt: now() },
  );
  return seasonBaseline(
    {
      games: teamGames.map((teamGame) => baselineGameOf(teamGame, threshold)),
      phase: baselinePhaseOf(game.phase, params),
      excludedGameId: game.id,
      phaseState: state,
    },
    params,
  );
}

/** The doubtful-case criteria of the measured game, whose events give no indication (SEN-11 to SEN-15). */
function criteriaOf(season: Season, minutes: number): DoubtfulCaseCriteria {
  const { params, game, teamGames } = season;
  return doubtfulCaseCriteria(
    {
      measuredGame: {
        game: {
          ...game,
          scheduledStartAt: instantOf(game.scheduledStartAt),
          homeTeamId: present(game.homeTeamId, 'its home team'),
          awayTeamId: present(game.awayTeamId, 'its away team'),
        },
        teamId: season.teamId,
        minutes,
        isEliminationGame: game.isEliminationGame,
      },
      seasonTeamGames: teamGames.map((teamGame) => ({
        game: { id: teamGame.gameId, scheduledStartAt: teamGame.scheduledStartAt },
        participation: teamGame.boxScore === null ? 'not_played' : 'played',
      })),
      playingTimeThresholdMinutes: season.threshold,
      seasonSchedule: season.schedule,
      previousSeasonSchedule: season.previousSchedule,
      contextIndications: [NO_INDICATION],
      coOccurringTypeIds: [],
      switchedOffCriterion: null,
    },
    params,
  );
}

/**
 * Measures a case of the player, from the lines and the schedule that the database
 * holds, as the engine does (SEN-01, SEN-03, SEN-08, SEN-11 to SEN-15, STA-12 to
 * STA-24): the columns of a valid case, or a bug of the caller, which is thrown.
 */
async function measure(db: Database, measured: Measured) {
  const season = await seasonOf(db, measured);
  const checked = measuredBoxScore(season);
  const baseline = baselineOf(season);
  const criteria = criteriaOf(season, checked.decimalMinutes);
  if (
    criteria.triggeredCriteria.length > 0 ||
    (baseline.status !== 'final' && baseline.status !== 'provisional')
  ) {
    throw new Error(
      `No valid case can be measured at the game ${String(measured.gameId)}: ${JSON.stringify({ baseline, criteria })}`,
    );
  }
  const index = performanceIndex(checked);
  return {
    referenceInstantAt: new Date(season.referenceAt),
    playingTimeThresholdMinutes: season.threshold,
    measuredMinutes: checked.decimalMinutes,
    hasRoundedMinutes: checked.hasRoundedMinutes,
    measuredGameScore: gameScore(checked),
    performanceIndex: index,
    baselineSeason: season.game.season,
    baselinePhase: baselinePhaseOf(season.game.phase, season.params),
    baselineGameCount: baseline.gameCount,
    baselineMean: baseline.mean,
    baselineStandardDeviation: baseline.standardDeviation,
    baselineStatus: baseline.status,
    baselineIsPartial: baseline.isPartial,
    ...normalizedGap(index, baseline),
    opponentStrengthNotEvaluable: criteria.opponentStrengthNotEvaluable,
    stakesNotEvaluable: criteria.stakesNotEvaluable,
  } as const;
}

/**
 * Writes a valid case of the player (SEN-01, SEN-03, SEN-07, SEN-08, TRV-76): a
 * historical media storm known by its day `eventOn`, public at the end of that day in
 * Pacific time, measured at the regular-season game `measuredGameId` from the player's
 * lines and the schedule that the database holds, as the engine measures it, with the
 * engine's parameters and `games.minBaselineGames` as the database overrides it: his
 * minutes, the Game Score, the performance index, the season baseline, the measured game
 * excluded, and the normalized gap, no doubtful-case criterion met. Throws when that game
 * is not the first he played after the event, or the case it gives is not valid.
 * `overrides` replaces any column, the type and the measurement included.
 */
export async function insertValidCase(
  db: Database,
  { playerId, measuredGameId, eventOn, overrides = {} }: CaseFactoryOptions,
): Promise<CaseRow> {
  const measurement = await measure(db, { playerId, gameId: measuredGameId, eventOn });
  const rows = await db
    .insert(cases)
    .values({
      playerId,
      eventTypeId: MEDIA_STORM,
      origin: 'historical',
      status: 'measured',
      referenceInstantOrigin: 'date_only',
      measuredGameId,
      ...measurement,
      computedAt: new Date(now()),
      ...overrides,
    })
    .returning();
  return firstRow(rows, 'the case written');
}

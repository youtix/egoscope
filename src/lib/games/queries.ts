import 'server-only';

import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';

import {
  followedPlayers,
  games,
  playerDirectoryEntries,
  playerIndicators,
  seasons,
  statsSourceMappings,
} from '@/lib/db';
import { err, ok } from '@/lib/result';
import {
  seasonBaseline as baselineOfSeason,
  expectedGameOf,
  nextGameOf,
  phaseState,
  playingTimeThreshold,
  seasonOfDate,
  seasonSpan,
  teamGames,
} from '@/lib/stats-engine';
import { gameDay } from '@/lib/time';

import {
  baselineGameOf,
  coverageOf,
  finalsOf,
  gamesOf,
  membershipOf,
  playerGameOf,
  recordsOf,
  scheduleOf,
  seasonDays,
  seasonFrom,
  storedGame,
} from './stored-schedule';

import type {
  CoverageQuery,
  Reader,
  SeasonCoverage,
  SeasonRead,
  StoredGame,
} from './stored-schedule';
import type { Result } from '@/lib/result';
import type {
  BaselineGame,
  EngineParams,
  ExpectedGame,
  FirstNbaGame,
  GameId,
  NextGame,
  NoGameScheduled,
  PhaseOf,
  PhaseState,
  PlayerId,
  PlayerIndicators,
  SeasonBaseline,
  SeasonNotRead,
  SeasonSpan,
  TeamGame,
  TeamId,
  TeamWinLossRecord,
} from '@/lib/stats-engine';
import type { EpochMs, IsoDate } from '@/lib/time';

/**
 * Why a read cannot answer: the followed player is unknown, or the stored spans cannot
 * tell the season of today, whose schedule is not read yet: its two candidate seasons,
 * which the caller can show as not read and queue (STA-48, CL-STA-28).
 */
export type ReadRefusal =
  | Readonly<{ kind: 'player_not_found' }>
  | Readonly<{ kind: 'schedule_not_read'; candidates: readonly [string, string] }>;

/** A stored season with its coverage (STA-45, CL-STA-22). */
export type CoveredSeason = Readonly<{ season: string; coverage: SeasonCoverage }>;

/** The baseline asked for: the player, the season, and its phase as phaseState takes it. */
export type BaselineQuery = Readonly<{ playerId: PlayerId; season: string; phase: PhaseOf }>;

/** What a season baseline is built from (STA-13 to STA-24): his classified games and the phase state. */
export type BaselineInputs = Readonly<{ games: readonly BaselineGame[]; phaseState: PhaseState }>;

/** Each team's regular-season record, of the season and of the season before (STA-06, SEN-15). */
export type TeamRecords = Readonly<{
  season: ReadonlyMap<TeamId, TeamWinLossRecord>;
  previousSeason: ReadonlyMap<TeamId, TeamWinLossRecord>;
}>;

// A display baseline leaves no game out: game ids are identities from 1, so 0 names none.
const NO_GAME: GameId = 0;
// A team that has not entered the postseason, while the season may go on, has not finished it.
const NOT_FINISHED: PhaseState = { finished: false, lastGameConsolidated: false };
const SEASON_READ = {
  season: seasons.season,
  phasesWithLines: seasons.phasesWithLines,
  coverageFetchedAt: seasons.coverageFetchedAt,
};

/**
 * The span of every stored season, a season counting as stored once its schedule is read
 * (STA-48, CL-STA-18, CL-STA-28, CL-STA-30): seasonSpan over one grouped read of the games
 * and one read of the Finals, never every game. Its Finals are over once a game of a later
 * season is stored, or once phaseState says a team of its Finals finished its postseason.
 */
export async function seasonSpans(db: Reader): Promise<readonly SeasonSpan[]> {
  const days = await seasonDays(db);
  const finals = await finalsOf(db);
  return days.flatMap((row, index) => {
    const hasLaterSeasonGame = index < days.length - 1;
    const ofFinals = finals.get(row.season);
    const schedule = ofFinals && { ...ofFinals, series: [ofFinals.finals], hasLaterSeasonGame };
    const isFinalsOver =
      hasLaterSeasonGame ||
      (schedule !== undefined &&
        phaseState(schedule, { postseasonTeamId: schedule.finals.teamAId })?.finished === true);
    return seasonSpan({ ...row, isFinalsOver }) ?? [];
  });
}

const notRead = ({ error }: SeasonNotRead): ReadRefusal => ({
  kind: 'schedule_not_read',
  candidates: error.candidates,
});

/**
 * The season in progress on `todayOn` or, between seasons, the one that ended last
 * (CL-STA-21), once the spans tell the season of that day (CL-STA-28).
 */
function currentSeasonOf(
  spans: readonly SeasonSpan[],
  todayOn: IsoDate,
): Result<string, ReadRefusal> {
  const today = seasonOfDate(todayOn, spans);
  if (!today.ok) {
    return err(notRead(today));
  }
  const hasBegun = spans.some(
    ({ season, firstGameOn }) => season === today.season && firstGameOn <= todayOn,
  );
  return ok(hasBegun ? today.season : seasonFrom(today.season, -1));
}

/**
 * A followed player's next game at `at` (STA-26, STA-28, CL-STA-20): nextGameOf over the
 * stored schedule as it is at this read, so that a postponement, a new time or a trade
 * gives the new next game at the next read and no copy is kept: the season in progress, or
 * the one that ended last, and the next season's games. Refused when the player is unknown
 * or the spans cannot tell the season of the day of `at`.
 */
export async function nextGame(
  db: Reader,
  playerId: PlayerId,
  at: EpochMs,
): Promise<Result<NextGame | NoGameScheduled, ReadRefusal>> {
  const [player] = await db
    .select({ teamId: followedPlayers.currentTeamId, lastOn: playerIndicators.lastGamePlayedOn })
    .from(followedPlayers)
    .leftJoin(playerIndicators, eq(playerIndicators.playerId, followedPlayers.id))
    .where(eq(followedPlayers.id, playerId));
  if (player === undefined) {
    return err({ kind: 'player_not_found' });
  }
  const current = currentSeasonOf(await seasonSpans(db), gameDay(at));
  if (!current.ok) {
    return current;
  }
  const season = await scheduleOf(db, current.value);
  const nextSeasonGames = await gamesOf(db, [seasonFrom(current.value, 1)]);
  const of = { teamId: player.teamId, lastGamePlayedOn: player.lastOn };
  return ok(nextGameOf(of, { season, nextSeasonGames }, at));
}

/** His membership and the stored games of his teams that start after `after`. */
async function teamScheduleAfter(db: Reader, playerId: PlayerId, after: EpochMs) {
  const player = await membershipOf(db, playerId);
  const teamIds = [...new Set(player.stints.map(({ teamId }) => teamId))];
  const ofTeams = or(inArray(games.homeTeamId, teamIds), inArray(games.awayTeamId, teamIds));
  const startsAfter = gt(games.scheduledStartAt, new Date(after));
  const rows = await db.select().from(games).where(and(startsAfter, ofTeams));
  return { player, games: rows.map((row) => storedGame(row)) };
}

/**
 * His team games that start strictly after `after`, in order, each with his participation
 * and minutes (STA-27, CL-STA-04, CL-STA-05): teamGames over the stored games of his teams.
 */
export async function gameLog(
  db: Reader,
  playerId: PlayerId,
  after: EpochMs,
): Promise<readonly TeamGame<StoredGame>[]> {
  const schedule = await teamScheduleAfter(db, playerId, after);
  return teamGames(schedule.player, schedule.games, after);
}

/**
 * His expected game after `after` (STA-27, STA-28, CL-IMP-17): the first official game of
 * his teams that starts strictly after it, read at each call; null while none is stored.
 */
export async function expectedGame(
  db: Reader,
  playerId: PlayerId,
  after: EpochMs,
): Promise<ExpectedGame<StoredGame> | null> {
  const schedule = await teamScheduleAfter(db, playerId, after);
  return expectedGameOf(schedule.player, schedule.games, after);
}

/**
 * What his season baseline is built from (STA-12 to STA-24, CL-STA-02, CL-STA-04): his
 * final team games of `season`, of every phase, each classified with the season's
 * playing-time threshold, which the games of unknown participation stay out of, and with
 * its performance index; and the state of the phase asked, a postseason that his team has
 * not entered being unfinished.
 */
export async function baselineInputs(
  db: Reader,
  query: BaselineQuery,
  params: EngineParams,
): Promise<BaselineInputs> {
  const player = await membershipOf(db, query.playerId);
  const schedule = await scheduleOf(db, query.season);
  const lineOf = new Map(player.lines.map(({ gameId, line }) => [gameId, line]));
  const played = teamGames(player, schedule.games, -Infinity)
    .filter(({ participation }) => participation !== null)
    .map((teamGame) => ({
      participation: teamGame.participation,
      game: playerGameOf(teamGame, lineOf.get(teamGame.game.id)),
    }));
  const known = played.filter(({ participation }) => participation !== 'unknown');
  const threshold = playingTimeThreshold(
    known.map(({ game }) => game),
    params,
  );
  const { phase } = query;
  return {
    games: played.map(({ participation, game }) => baselineGameOf(participation, game, threshold)),
    phaseState:
      'regularSeasonAt' in phase
        ? phaseState(schedule, phase)
        : (phaseState(schedule, phase) ?? NOT_FINISHED),
  };
}

/**
 * The display baseline of a season (STA-16 to STA-24): seasonBaseline over his baseline
 * inputs with no game left out, of the regular season for `{ regularSeasonAt }` and of the
 * postseason for `{ postseasonTeamId }`.
 */
export async function seasonBaseline(
  db: Reader,
  query: BaselineQuery,
  params: EngineParams,
): Promise<SeasonBaseline> {
  const inputs = await baselineInputs(db, query, params);
  const phase = 'regularSeasonAt' in query.phase ? 'regular_season' : 'postseason';
  return baselineOfSeason({ ...inputs, phase, excludedGameId: NO_GAME }, params);
}

/**
 * The records of the opponent criterion (STA-06, SEN-15, CL-STA-19): each team's
 * regular-season record of `season` from the stored scores, the measured game
 * `excludedGameId` left out, and its final record of the season before.
 */
export async function teamRecords(
  db: Reader,
  season: string,
  excludedGameId?: GameId,
): Promise<TeamRecords> {
  const previous = seasonFrom(season, -1);
  const stored = await gamesOf(db, [season, previous]);
  const of = (name: string) => stored.filter((game) => game.season === name);
  return {
    season: recordsOf(of(season), excludedGameId),
    previousSeason: recordsOf(of(previous), undefined),
  };
}

/** His stored indicators of the player page (STA-46, JOU-02, JOU-21), null until first stored. */
export async function indicators(db: Reader, playerId: PlayerId): Promise<PlayerIndicators | null> {
  const [row] = await db
    .select({
      indicatorSeason: playerIndicators.indicatorSeason,
      gamesPlayedThisSeason: playerIndicators.gamesPlayedThisSeason,
      averageMinutesThisSeason: playerIndicators.averageMinutesThisSeason,
      lastGamePlayedId: playerIndicators.lastGamePlayedId,
      lastGamePlayedOn: playerIndicators.lastGamePlayedOn,
      consecutiveTeamGamesMissed: playerIndicators.consecutiveTeamGamesMissed,
    })
    .from(playerIndicators)
    .where(eq(playerIndicators.playerId, playerId));
  return row ?? null;
}

/** His stored first NBA game (STA-47): null for « date inconnue », "date unknown". */
export async function firstNbaGame(db: Reader, playerId: PlayerId): Promise<FirstNbaGame | null> {
  const [row] = await db
    .select({ id: playerIndicators.firstNbaGameId, on: playerIndicators.firstNbaGameOn })
    .from(playerIndicators)
    .where(eq(playerIndicators.playerId, playerId));
  return row === undefined || row.id === null || row.on === null
    ? null
    : { firstNbaGameId: row.id, firstNbaGameOn: row.on };
}

async function withCoverage(
  db: Reader,
  rows: readonly SeasonRead[],
  query: CoverageQuery,
): Promise<readonly CoveredSeason[]> {
  const spans = await seasonSpans(db);
  const todayOn = gameDay(query.at);
  const today = seasonOfDate(todayOn, spans);
  const context = { ...query, spans, todayOn, coming: today.ok ? today.season : null };
  return rows.map((row) => ({ season: row.season, coverage: coverageOf(row, context) }));
}

/**
 * Every stored season with its coverage on the day of `query.at` (STA-45, CL-STA-22,
 * CL-STA-30), which step 5 of CL-SEN-05 reads.
 */
export async function coveredSeasons(
  db: Reader,
  query: CoverageQuery,
): Promise<readonly CoveredSeason[]> {
  const rows = await db.select(SEASON_READ).from(seasons).orderBy(asc(seasons.season));
  return withCoverage(db, rows, query);
}

/**
 * The seasons whose player directory lists him under his established mapping, with their
 * coverage on the day of `query.at` (STA-41, STA-45, CL-STA-22).
 */
export async function seasonsOf(
  db: Reader,
  playerId: PlayerId,
  query: CoverageQuery,
): Promise<readonly CoveredSeason[]> {
  const rows = await db
    .select(SEASON_READ)
    .from(seasons)
    .innerJoin(playerDirectoryEntries, eq(playerDirectoryEntries.season, seasons.season))
    .innerJoin(
      statsSourceMappings,
      and(
        eq(statsSourceMappings.statsSource, playerDirectoryEntries.statsSource),
        eq(statsSourceMappings.sourcePlayerRef, playerDirectoryEntries.sourcePlayerRef),
      ),
    )
    .where(eq(statsSourceMappings.playerId, playerId))
    .orderBy(asc(seasons.season));
  return withCoverage(db, rows, query);
}

/** The games whose schedule changed after `since`, by that change, then id (STA-28, ALE-23). */
export async function changedSince(db: Reader, since: EpochMs): Promise<readonly StoredGame[]> {
  const rows = await db
    .select()
    .from(games)
    .where(gt(games.scheduleChangedAt, new Date(since)))
    .orderBy(asc(games.scheduleChangedAt), asc(games.id));
  return rows.map((row) => storedGame(row));
}

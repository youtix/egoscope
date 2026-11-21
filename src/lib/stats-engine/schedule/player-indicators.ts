// The indicators of the player page (STA-46, JOU-02, JOU-21) and the date of his first
// NBA game (STA-47), computed from his box scores and his team games, which `games`
// stores in player_indicators at each statistics update. His games played and average
// minutes cover the season in progress or, between seasons, the season that ended last,
// and name it (CL-STA-21, CL-JOU-15). The team games he missed since his last game played
// are counted across seasons and trades under his membership, none while he has no team
// (CL-STA-05). No cause of absence is read, since none is ever stored (JOU-21).

import { verifyBoxScore } from '../performance/box-score';
import { participationOf } from '../performance/participation';
import { seasonOfDate } from './seasons';
import { teamGames } from './team-membership';

import type { GameId, IsoDate } from '../types';
import type { SeasonNotRead, SeasonOfDateResult, SeasonSpan } from './seasons';
import type { LinesGame, PlayerLine, TeamStint } from './team-membership';

/**
 * One of his box-score lines as the indicators read it (STA-08, STA-46): with its game's
 * US date (CL-TRV-03) and number of overtimes, null when it is unknown (CL-STA-03), which
 * bounds his minutes in the checks of STA-09.
 */
export type IndicatorLine = PlayerLine &
  Readonly<{ gameDayOn: IsoDate; overtimeCount: number | null }>;

/**
 * The indicators of the player page, as player_indicators stores them (STA-46, JOU-02,
 * JOU-21, CL-STA-21, CL-JOU-15): the season that his games played and his average minutes
 * cover, written `2024-25`; the official games he played in it and his mean minutes per
 * game played, null without a game whose minutes are known and pass the checks of
 * STA-09; his last game played, by id and US date, null before his first; and the team
 * games he missed since. No cause of absence is among them.
 */
export type PlayerIndicators = Readonly<{
  indicatorSeason: string;
  gamesPlayedThisSeason: number;
  averageMinutesThisSeason: number | null;
  lastGamePlayedId: GameId | null;
  lastGamePlayedOn: IsoDate | null;
  consecutiveTeamGamesMissed: number;
}>;

/**
 * The indicators of the player page, or `season_not_read` when the stored spans cannot
 * tell the season of a day they need (STA-46, STA-48, CL-STA-28).
 */
export type IndicatorsResult = Readonly<{ ok: true; indicators: PlayerIndicators }> | SeasonNotRead;

/** His first NBA game, by id and US date, as player_indicators stores it (STA-47). */
export type FirstNbaGame = Readonly<{ firstNbaGameId: GameId; firstNbaGameOn: IsoDate }>;

/**
 * His first NBA game, null for "date unknown" (STA-47), or `season_not_read` when the
 * stored spans cannot tell the season of the first game he played (STA-48, CL-STA-28).
 */
export type FirstNbaGameResult =
  Readonly<{ ok: true; firstNbaGame: FirstNbaGame | null }> | SeasonNotRead;

/**
 * What is stored of the seasons of his career (STA-41, STA-47, CL-STA-12): each season
 * whose player directory lists him, did-not-play lines included, with whether its box
 * scores are stored; and the first season the source covers, which the stats-source port
 * gives (1993-94 for the chosen source).
 */
export type CareerSeasons = Readonly<{
  listedSeasons: readonly Readonly<{ season: string; areBoxScoresStored: boolean }>[];
  firstCoveredSeason: string;
}>;

/** By scheduled start, then game id: the fixed order of every sum and every pick (CL-STA-09). */
function inFixedOrder(left: PlayerLine, right: PlayerLine): number {
  return left.scheduledStartAt === right.scheduledStartAt
    ? left.gameId - right.gameId
    : left.scheduledStartAt - right.scheduledStartAt;
}

/**
 * His lines of the games he played, in the fixed order (CL-STA-04): his own line is one of
 * his team's lines, so they are published, and he played unless it says he did not.
 */
function playedInOrder(lines: readonly IndicatorLine[]): readonly IndicatorLine[] {
  return lines
    .filter(({ line }) => participationOf(line, true) !== 'not_played')
    .toSorted(inFixedOrder);
}

/**
 * The season the indicators cover on `todayOn` (STA-48, CL-STA-21, CL-JOU-15): of the
 * stored `seasons`, the latest that has begun, none of the others having begun after it,
 * so the season in progress or, between seasons, the one that ended last; while none has
 * begun, the season of `todayOn` itself. Either is known only once `seasons` tell the
 * season of `todayOn`, and otherwise the answer is `season_not_read`: a season left out
 * may be the one in progress.
 */
function indicatorSeasonOf(seasons: readonly SeasonSpan[], todayOn: IsoDate): SeasonOfDateResult {
  const today = seasonOfDate(todayOn, seasons);
  const begun = seasons.filter(({ firstGameOn }) => firstGameOn <= todayOn);
  const latest = begun.find((span) =>
    begun.every(({ firstGameOn }) => firstGameOn <= span.firstGameOn),
  );
  return latest !== undefined && today.ok ? { ok: true, season: latest.season } : today;
}

/**
 * Those of `played` that `seasons` file under `season`, by their US date (STA-48), or
 * `season_not_read` for the first of them whose season `seasons` cannot tell.
 */
function linesOfSeason(
  played: readonly IndicatorLine[],
  season: string,
  seasons: readonly SeasonSpan[],
): Readonly<{ ok: true; lines: readonly IndicatorLine[] }> | SeasonNotRead {
  const lines: IndicatorLine[] = [];
  for (const line of played) {
    const filed = seasonOfDate(line.gameDayOn, seasons);
    if (!filed.ok) {
      return filed;
    }
    if (filed.season === season) {
      lines.push(line);
    }
  }
  return { ok: true, lines };
}

/**
 * His mean minutes per game over `lines` (STA-09, STA-46, CL-STA-06, CL-STA-09): the
 * decimal minutes of each line that the checks of STA-09 do not find suspect and whose
 * time on court is known, whole minutes as they are, added in the order given; null
 * without such a line.
 */
function averageMinutes(lines: readonly IndicatorLine[]): number | null {
  const minutes = lines.flatMap(({ line, overtimeCount }) => {
    const check = verifyBoxScore(line, overtimeCount);
    return check.status === 'suspect' || check.decimalMinutes === null ? [] : check.decimalMinutes;
  });
  if (minutes.length === 0) {
    return null;
  }
  let sum = 0;
  for (const value of minutes) {
    sum += value;
  }
  return sum / minutes.length;
}

/**
 * The indicators of his player page on `todayOn`, the US date of the statistics update
 * (STA-46, JOU-02, JOU-21, CL-STA-04, CL-STA-05, CL-STA-21, CL-JOU-15). The season they
 * cover is the season in progress or, between seasons, the season that ended last, as the
 * stored `seasons` frame them (STA-48). Its games played are the official games of his
 * `lines` that he played, filed by their US date under that season, a game whose line is
 * suspect included, and his average minutes the mean minutes of those whose time on court
 * is known and whose line is not suspect. His last game played is the latest of his lines
 * that he played, of any season and phase. His consecutive team games missed are the
 * final team games, of `games` under his `stints`, after the start of that game, or since
 * his membership began when he has played none: across seasons and trades, those of
 * unknown participation included, and none while he belongs to no team (JOU-22 reads it).
 * The answer is `season_not_read` when `seasons` cannot tell the season of `todayOn` or
 * of a game he played (CL-STA-28). So that it does not occur, `schedule.seasons` holds
 * the span of every stored season, never only those his lines fall in: without the
 * season in progress, for a player who has not played in it, the indicators would cover
 * an older season.
 */
export function indicatorsOf(
  player: Readonly<{ stints: readonly TeamStint[]; lines: readonly IndicatorLine[] }>,
  schedule: Readonly<{ games: readonly LinesGame[]; seasons: readonly SeasonSpan[] }>,
  todayOn: IsoDate,
): IndicatorsResult {
  const { seasons } = schedule;
  const indicatorSeason = indicatorSeasonOf(seasons, todayOn);
  if (!indicatorSeason.ok) {
    return indicatorSeason;
  }
  const played = playedInOrder(player.lines);
  const ofSeason = linesOfSeason(played, indicatorSeason.season, seasons);
  if (!ofSeason.ok) {
    return ofSeason;
  }
  const last = played.at(-1);
  const since = teamGames(player, schedule.games, last?.scheduledStartAt ?? -Infinity);
  return {
    ok: true,
    indicators: {
      indicatorSeason: indicatorSeason.season,
      gamesPlayedThisSeason: ofSeason.lines.length,
      averageMinutesThisSeason: averageMinutes(ofSeason.lines),
      lastGamePlayedId: last?.gameId ?? null,
      lastGamePlayedOn: last?.gameDayOn ?? null,
      // He played none of the team games after his last game played: each final one is a
      // game missed, whether his team's lines say so or are missing (CL-STA-04).
      consecutiveTeamGamesMissed: since.filter(({ participation }) => participation !== null)
        .length,
    },
  };
}

/**
 * The date of his first NBA game (STA-47, CL-STA-04, CL-STA-12): the earliest official
 * game of his `lines` that he played, by its US date, known only once the box scores of
 * every season that lists him, from the earliest to the season of that game, are stored,
 * so that it never comes from later seasons while an earlier one is missing; and never
 * when the first season the source covers lists him, since his career may start before
 * it. Null, the "date unknown" of STA-47, otherwise and while he has played no game. The
 * answer is `season_not_read` when `seasons` cannot tell the season of that game
 * (CL-STA-28): so that it does not occur, `seasons` holds the span of every season his
 * `lines` fall in.
 */
export function firstNbaGameOf(
  lines: readonly IndicatorLine[],
  career: CareerSeasons,
  seasons: readonly SeasonSpan[],
): FirstNbaGameResult {
  const [first] = playedInOrder(lines);
  const { listedSeasons, firstCoveredSeason } = career;
  if (first === undefined || listedSeasons.some(({ season }) => season === firstCoveredSeason)) {
    return { ok: true, firstNbaGame: null };
  }
  const seasonOfFirst = seasonOfDate(first.gameDayOn, seasons);
  if (!seasonOfFirst.ok) {
    return seasonOfFirst;
  }
  const isKnown = listedSeasons.every(
    ({ season, areBoxScoresStored }) => areBoxScoresStored || season > seasonOfFirst.season,
  );
  return {
    ok: true,
    firstNbaGame: isKnown
      ? { firstNbaGameId: first.gameId, firstNbaGameOn: first.gameDayOn }
      : null,
  };
}

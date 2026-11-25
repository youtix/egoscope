// What crosses the statistics-source port, whatever the source behind it: no file,
// column or provider name appears here (module map §5). Instants are epoch
// milliseconds and calendar dates `YYYY-MM-DD`; a game's day is the league's US
// Eastern date, and no type carries a venue time zone or a venue-local date
// (CL-TRV-03, CL-STA-14).
import type { EpochMs, IsoDate } from '@/lib/time';

/** A season, written with its two years, such as `2024-25` (CL-STA-28). */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- names a plain value that crosses the port
export type Season = string;

/** The source's identifier of a game, kept as the source writes it (STA-02). */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- names a plain value that crosses the port
export type SourceGameId = string;

/** The source's identifier of a player, stable across his career (STA-02, STA-03). */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- names a plain value that crosses the port
export type SourcePlayerId = string;

/** The source's identifier of a franchise, which survives a relocation (STA-02, CL-JOU-18). */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- names a plain value that crosses the port
export type SourceTeamId = string;

/** What the source sends back to make the next read of a resource conditional: opaque (STA-42). */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- names a plain value that crosses the port
export type SourceVersion = string;

/** The deadline and abort signal of one call, inside the budget of its tick (module map §5). */
export type CallContext = Readonly<{ deadline: EpochMs; signal: AbortSignal }>;

/** What one operation cost, which `quotas.withQuota` records (TRV-03, CL-STA-15). */
export type CallMetadata = Readonly<{
  /** Every HTTP request made, each redirect included. */
  httpRequests: number;
  /** The bytes received; a `not_modified` answer receives none. */
  bytesReceived: number;
  /** The file requests that the source's daily ceilings count: one per file answered 200 or 304, a redirect not counted. */
  fileRequests: number;
}>;

/** A conditional read: the resource with its new version, or `not_modified` for the version sent (STA-42). */
export type ConditionalRead<T> =
  Readonly<{ kind: 'read'; version: SourceVersion; data: T }> | Readonly<{ kind: 'not_modified' }>;

/** The source's last refresh, which the hourly probe compares with its threshold (CL-TRV-23). */
export type Publication = Readonly<{ refreshedAt: EpochMs }>;

/** The phase of a game (STA-04, STA-05). */
export type GamePhase = 'regular_season' | 'play_in' | 'playoffs';

/** The status of a game (STA-05). */
export type GameStatus = 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'canceled';

/** Why a game never counts, recognized by its label first, whatever its teams (STA-04, CL-STA-16). */
export type GameExclusion = 'all_star' | 'cup_final' | 'preseason';

/** The rounds of the play-in and the playoffs, in the data model's values (STA-05, CL-STA-18). */
export const SERIES_ROUNDS = [
  'first_round',
  'conference_semifinals',
  'conference_finals',
  'finals',
  'play_in_7_vs_8',
  'play_in_9_vs_10',
  'play_in_8th_seed',
] as const;

/** The round of a play-in or playoff game, when the source labels it (STA-05, CL-STA-18). */
export type SeriesRound = (typeof SERIES_ROUNDS)[number];

/** Where a postseason game sits in its series: either part may be missing in older seasons (CL-STA-18). */
export type SeriesPlace = Readonly<{ round: SeriesRound | null; gameNumber: number | null }>;

/** One game of a season's schedule, past or upcoming (STA-05, STA-29, STA-31). */
export type SourceGame = Readonly<{
  game: SourceGameId;
  season: Season;
  phase: GamePhase;
  /** Set when the game never counts; such a game is dropped at ingestion (CL-STA-16). */
  exclusion: GameExclusion | null;
  /** The scheduled start; while the time is to be determined, 00:00 US Eastern on the game's day (CL-STA-14). */
  tipOff: EpochMs;
  isTimeKnown: boolean;
  /** The league's date: the US Eastern date of the tip-off, games played abroad included (CL-TRV-03). */
  gameDay: IsoDate;
  /** Null for both teams of a placeholder whose teams are to be determined, and of an excluded game between no franchises (CL-STA-14). */
  homeTeam: SourceTeamId | null;
  awayTeam: SourceTeamId | null;
  isNeutralSite: boolean;
  status: GameStatus;
  /** The final score of a final game, else null. */
  score: Readonly<{ home: number; away: number }> | null;
  /** The overtimes of a final game, null when unknown or not final (CL-STA-03). */
  overtimes: number | null;
  /** Null for a regular-season game. */
  series: SeriesPlace | null;
  /** On a make-up game, the postponed game it replaces (CL-STA-17). */
  makeUpOf: SourceGameId | null;
}>;

/** A team of one season, under the names it had that season (JOU-08, CL-JOU-18). */
export type SourceTeam = Readonly<{
  team: SourceTeamId;
  name: string;
  abbreviation: string;
  location: string;
}>;

/** What the source holds of a season's box scores (STA-35, STA-45, CL-STA-22). */
export type SeasonCoverage = Readonly<{
  /** The phases whose final, counted games have box scores. */
  phasesWithBoxScores: readonly GamePhase[];
  /** The final, counted games listed without box scores. */
  gamesWithoutBoxScores: readonly SourceGameId[];
}>;

/** A schedule row whose status value the adapter does not recognize yet, held back alone (CL-STA-17). */
export type HeldBackRow = Readonly<{ game: SourceGameId; status: string }>;

/** A season's schedule, with its teams, its coverage and its held-back rows. */
export type SeasonGames = Readonly<{
  games: readonly SourceGame[];
  teams: readonly SourceTeam[];
  coverage: SeasonCoverage;
  heldBack: readonly HeldBackRow[];
}>;

/** The thirteen counts of a box score, in the glossary's names (STA-08). */
export const BOX_SCORE_COUNTS = [
  'points',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'threePointersMade',
  'freeThrowsMade',
  'freeThrowsAttempted',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'personalFouls',
] as const;

/** One of the thirteen counts of a box score (STA-08). */
export type BoxScoreCount = (typeof BOX_SCORE_COUNTS)[number];

/** Each count of a box score, null when the source does not provide it, never filled with 0 (STA-10). */
export type BoxScoreCounts = Readonly<Record<BoxScoreCount, number | null>>;

/** Time on court, with the precision the source gives: whole minutes, or minutes and seconds (STA-08, STA-12). */
export type PlayingTime =
  | Readonly<{ precision: 'whole_minutes'; minutes: number }>
  | Readonly<{ precision: 'seconds'; minutes: number; seconds: number }>;

/** A player's line for one game, a did-not-play line included; its reason is never given (STA-08, DSN-15). */
export type SourceBoxScore = Readonly<{
  game: SourceGameId;
  player: SourcePlayerId;
  team: SourceTeamId;
  opponent: SourceTeamId;
  isHome: boolean;
  didNotPlay: boolean;
  /** Null when not provided. */
  playingTime: PlayingTime | null;
  counts: BoxScoreCounts;
  /** Null when the source does not say (SEN-16). */
  ejected: boolean | null;
}>;

/**
 * Which sides of a game the source's box-score file holds at least one line for, a
 * did-not-play line included, whatever players were asked. A side that holds lines
 * without a player's tells "not played" from "unknown" (CL-STA-04).
 */
export type SidesWithLines = Readonly<{ game: SourceGameId; home: boolean; away: boolean }>;

/**
 * A conditional read of a season's box scores: the requested players' lines, and each
 * game of which the source's file holds a line, with the sides that hold lines; a game
 * that it does not name, such as one not played yet, holds no line on either side
 * (STA-08, STA-42, CL-STA-04).
 */
export type SeasonBoxScoresRead =
  | Readonly<{
      kind: 'read';
      version: SourceVersion;
      data: readonly SourceBoxScore[];
      sidesWithLines: readonly SidesWithLines[];
    }>
  | Readonly<{ kind: 'not_modified' }>;

/** A team of a player's box scores in one season, with the days of his first and last line for it (JOU-13). */
export type DirectoryTeam = Readonly<{
  team: SourceTeamId;
  firstGameDay: IsoDate;
  lastGameDay: IsoDate;
}>;

/** A player of the season's directory: every player with a box score that season (STA-03, JOU-10). */
export type DirectoryEntry = Readonly<{
  player: SourcePlayerId;
  displayName: string;
  /** His other names as the source gives them, such as a short name. */
  otherNames: readonly string[];
  teams: readonly DirectoryTeam[];
}>;

/** A day and month of birth, never a year (JOU-08, CL-JOU-16). */
export type Birthday = Readonly<{ month: number; day: number }>;

/**
 * What the current season's player file says of a player's team (CL-STA-27): his
 * team; listed without a team, which is a release (STA-26) and which a row says by a
 * free-agent status or an empty team (CL-STA-31); or not listed, which is no
 * observation at all, never a release.
 */
export type CurrentTeam =
  | Readonly<{ kind: 'team'; team: SourceTeamId }>
  | Readonly<{ kind: 'without_team' }>
  | Readonly<{ kind: 'not_listed' }>;

/** A requested player's record: his name and birthday, and his current team when the current file lists him. */
export type PlayerRecord = Readonly<{
  player: SourcePlayerId;
  displayName: string;
  birthday: Birthday | null;
  currentTeam: CurrentTeam;
}>;

/** A player's identifier in another statistics source, which only preselects a candidate (TRV-12, CL-TRV-14). */
export type PlayerMapping = Readonly<{ player: SourcePlayerId; otherPlayer: string }>;

/** A read of one season's resource, conditional on the version stored from the last read. */
export type SeasonRequest = Readonly<{ season: Season; knownVersion: SourceVersion | null }>;

/** A read of one season's resource for some players only. */
export type PlayersRequest = SeasonRequest & Readonly<{ players: readonly SourcePlayerId[] }>;

export type { StatsSourceError, StatsSourceErrorKind } from './errors';
export { createFakeStatsSource } from './fake';
export type { BoxScoreCorrection, FakeFault, FakeResource, FakeStatsSource } from './fake';
export { fakeStatsSource, statsSource } from './port';
export type { StatsSource, StatsSourceAccess, StatsSourceOutcome } from './port';
export { BOX_SCORE_COUNTS, SERIES_ROUNDS } from './types';
export type {
  Birthday,
  BoxScoreCount,
  BoxScoreCounts,
  CallContext,
  CallMetadata,
  ConditionalRead,
  CurrentTeam,
  DirectoryEntry,
  DirectoryTeam,
  GameExclusion,
  GamePhase,
  GameStatus,
  HeldBackRow,
  PlayerMapping,
  PlayerRecord,
  PlayersRequest,
  PlayingTime,
  Publication,
  Season,
  SeasonCoverage,
  SeasonGames,
  SeasonRequest,
  SeriesPlace,
  SeriesRound,
  SourceBoxScore,
  SourceGame,
  SourceGameId,
  SourcePlayerId,
  SourceTeam,
  SourceTeamId,
  SourceVersion,
} from './types';

// The public API of the game statistics (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  BoxScoreRow,
  CasesChange,
  CasesChanges,
  FetchQueueHooks,
  FetchQueueItemRow,
  GameRow,
  MappingCandidateRow,
  NewBoxScoreRow,
  NewFetchQueueItemRow,
  NewGameRow,
  NewMappingCandidateRow,
  NewPlayerDirectoryEntryRow,
  NewPlayerDirectoryTeamRow,
  NewPlayerIndicatorRow,
  NewSeasonRow,
  NewSeriesRow,
  NewStatCorrectionRow,
  NewStatsSourceMappingRow,
  NewStatsSourceVersionRow,
  NewTeamRow,
  NewTeamSeasonRow,
  NewTeamSourceRefRow,
  PlayerDirectoryEntryRow,
  PlayerDirectoryTeamRow,
  PlayerIndicatorRow,
  SeasonRow,
  SeriesRow,
  StatCorrectionRow,
  StatisticsUpdateScope,
  StatsSourceMappingRow,
  StatsSourceVersionRow,
  TeamRow,
  TeamSeasonRow,
  TeamSourceRefRow,
} from './types';

// mapping.ts: confirmMapping, markMappingToEstablish, changeMapping
export {
  changeMapping,
  confirmMapping,
  establishedMappings,
  markMappingToEstablish,
  pendingMappings,
  refreshPendingCandidates,
} from './mapping';
export type {
  AlreadyFollowed,
  ConfirmedMapping,
  ConfirmRefusal,
  MappingEstablished,
  MappingNotFound,
  MappingToEstablish,
  NewCandidates,
  PendingMapping,
  PlayerNotFound,
  StoredCandidate,
  UnknownIdentity,
} from './mapping';

// directory.ts: searchCandidates, refreshPendingCandidates
export { searchCandidates, storeDirectory } from './directory';
export type { Candidate, FollowedAs, UnknownTeams } from './directory';

// teams.ts: team, teams, teamHistory

// ingest.ts: refreshIndicators

// completeness.ts: completeThrough

// fetch-queue.ts: processFetchQueue, enqueue, requestRefetch, nextDueAt, fetchProgress

// daily-update.ts: planDailyUpdate, publicationProbe, dailyUpdateState, lastUpdateAt

// history.ts: requestHistory, seasonsComplete

// outage.ts: no export planned (the retries and the incident of the fetch queue)

// queries.ts: nextGame, expectedGame, gameLog, baselineInputs, teamRecords, seasonBaseline,
//   indicators, firstNbaGame, pendingMappings, seasonsOf, coveredSeasons, changedSince
export {
  baselineInputs,
  changedSince,
  coveredSeasons,
  expectedGame,
  firstNbaGame,
  gameLog,
  indicators,
  nextGame,
  seasonBaseline,
  seasonSpans,
  seasonsOf,
  teamRecords,
} from './queries';
export type {
  BaselineInputs,
  BaselineQuery,
  CoveredSeason,
  ReadRefusal,
  TeamRecords,
} from './queries';
export type { CoverageQuery, SeasonCoverage, StoredGame } from './stored-schedule';

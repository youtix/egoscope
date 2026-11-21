// The row and insert types of the tables of the game statistics (module map, section
// 2.4), as Drizzle derives them from the schema of `@/lib/db`, and the type of the hooks
// that the statistics tasks pass the fetch queue (sections 2.4 and 4).
import type {
  boxScores,
  fetchQueueItems,
  games,
  mappingCandidates,
  playerDirectoryEntries,
  playerDirectoryTeams,
  playerIndicators,
  seasons,
  series,
  statCorrections,
  statsSourceMappings,
  statsSourceVersions,
  teams,
  teamSeasons,
  teamSourceRefs,
  Transaction,
} from '@/lib/db';
import type { Result } from '@/lib/result';
import type { GameId, PlayerId, StatisticsUpdateCause } from '@/lib/stats-engine';

export type StatsSourceMappingRow = typeof statsSourceMappings.$inferSelect;
export type NewStatsSourceMappingRow = typeof statsSourceMappings.$inferInsert;
export type MappingCandidateRow = typeof mappingCandidates.$inferSelect;
export type NewMappingCandidateRow = typeof mappingCandidates.$inferInsert;
export type TeamRow = typeof teams.$inferSelect;
export type NewTeamRow = typeof teams.$inferInsert;
export type TeamSourceRefRow = typeof teamSourceRefs.$inferSelect;
export type NewTeamSourceRefRow = typeof teamSourceRefs.$inferInsert;
export type SeasonRow = typeof seasons.$inferSelect;
export type NewSeasonRow = typeof seasons.$inferInsert;
export type TeamSeasonRow = typeof teamSeasons.$inferSelect;
export type NewTeamSeasonRow = typeof teamSeasons.$inferInsert;
export type SeriesRow = typeof series.$inferSelect;
export type NewSeriesRow = typeof series.$inferInsert;
export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
export type BoxScoreRow = typeof boxScores.$inferSelect;
export type NewBoxScoreRow = typeof boxScores.$inferInsert;
export type StatCorrectionRow = typeof statCorrections.$inferSelect;
export type NewStatCorrectionRow = typeof statCorrections.$inferInsert;
export type PlayerIndicatorRow = typeof playerIndicators.$inferSelect;
export type NewPlayerIndicatorRow = typeof playerIndicators.$inferInsert;
export type FetchQueueItemRow = typeof fetchQueueItems.$inferSelect;
export type NewFetchQueueItemRow = typeof fetchQueueItems.$inferInsert;
export type StatsSourceVersionRow = typeof statsSourceVersions.$inferSelect;
export type NewStatsSourceVersionRow = typeof statsSourceVersions.$inferInsert;
export type PlayerDirectoryEntryRow = typeof playerDirectoryEntries.$inferSelect;
export type NewPlayerDirectoryEntryRow = typeof playerDirectoryEntries.$inferInsert;
export type PlayerDirectoryTeamRow = typeof playerDirectoryTeams.$inferSelect;
export type NewPlayerDirectoryTeamRow = typeof playerDirectoryTeams.$inferInsert;

/**
 * The cases whose recalculation a fetch unit's changes call for, as the scope of a
 * statistics update's job: the cases of these players that these new or modified games
 * concern (SEN-34, STA-32).
 */
export type StatisticsUpdateScope = Readonly<{
  kind: 'statistics_update';
  playerIds: readonly PlayerId[];
  gameIds: readonly GameId[];
}>;

/** One recalculation that a unit's changes call for: its cause and the cases it concerns (CL-SEN-17). */
export type CasesChange<C extends StatisticsUpdateCause = StatisticsUpdateCause> = Readonly<{
  cause: C;
  scope: StatisticsUpdateScope;
}>;

// The causes of a unit's recalculations, in the order of CL-SEN-17.
type ChangesInOrder = readonly [
  CasesChange<'stats_correction'>,
  CasesChange<'new_cases'>,
  CasesChange<'baseline_updated'>,
];

// The lists that keep some of the items of a tuple, in its order.
type InOrder<T extends readonly unknown[]> = T extends readonly [infer First, ...infer Rest]
  ? readonly [First, ...InOrder<Rest>] | InOrder<Rest>
  : readonly [];

/**
 * What a unit changed in cases: one recalculation or more, at most one per cause, in the
 * order statistics correction, new cases, baseline updated (CL-SEN-17).
 */
export type CasesChanges = Exclude<InOrder<ChangesInOrder>, readonly []>;

/**
 * The hooks of `games.processFetchQueue(ctx, hooks)`, which both statistics tasks fill
 * (module map, sections 2.4 and 4): the fetch queue calls them in the transaction of the
 * unit whose rows called for them, so that no interruption loses a request (TRV-30,
 * CL-SEN-16, CL-TAX-19). A failure rolls the unit back.
 */
export type FetchQueueHooks<E = never> = Readonly<{
  /** Once per unit that changed the game, baseline, absence count or opponent record of cases. */
  onCasesChanged: (tx: Transaction, changes: CasesChanges) => Promise<Result<undefined, E>>;
  /** For a void entry, an unconfirmed end or a box-score correction of his team history (CL-JOU-03). */
  onTeamHistoryChanged: (tx: Transaction, playerId: PlayerId) => Promise<Result<undefined, E>>;
  /** When the unit stores a season of his history for the first time (CL-STA-25). */
  onHistoryStored: (tx: Transaction, playerId: PlayerId) => Promise<Result<undefined, E>>;
}>;

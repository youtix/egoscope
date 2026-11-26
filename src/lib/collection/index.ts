// The public API of the news collection (module map, section 2.5): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  ArticleRow,
  ArticleSightingRow,
  CollectionGapRow,
  CollectionSourceReadRow,
  DedupTraceRow,
  NewArticleRow,
  NewArticleSightingRow,
  NewCollectionGapRow,
  NewCollectionSourceReadRow,
  NewDedupTraceRow,
  NewPressSourceDailyCountRow,
  NewPressSourceDeactivationRow,
  NewPressSourceIncidentRow,
  NewPressSourceRow,
  PressSourceDailyCountRow,
  PressSourceDeactivationRow,
  PressSourceIncidentRow,
  PressSourceRow,
} from './types';

// sources.ts: trialRead, addSource, editSource, setSourceActivation, withdrawSource
// run.ts: runCollection, requestOnDemand, setArticleStatus, countPrefilterKept, checkFeeds
// dating.ts: ownerSourceInstant
// dedup.ts: the deduplication of the articles a run reads (no operation of its own exposed)
// health.ts: the health of the sources and the collection indicators (no operation of its own exposed)
// purge.ts: purgeExpired
// queries.ts, with setArticleStatus and countPrefilterKept, and collection-journal.ts
export {
  article,
  articlesOfRun,
  articlesToAnalyze,
  countPrefilterKept,
  setArticleStatus,
  sources,
} from './queries';
export type {
  Article,
  ArticleStatusChange,
  ArticleStatusRefusal,
  ArticleWithSightings,
  NotRelevantReason,
  PrefilterCountRefusal,
  SourceIndicators,
  SourceOverview,
} from './queries';
export { run, runs } from './collection-journal';
export type {
  CatchUpRead,
  CollectionCounters,
  CollectionRun,
  CollectionRunOrigin,
  RunFilter,
  RunIncident,
  SourceRead,
  SourceReadResult,
} from './collection-journal';
// erase.ts: eraseDetachedArticles, eraseArticlesWithoutRole

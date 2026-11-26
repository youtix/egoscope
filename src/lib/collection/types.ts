// The row and insert types of the tables of the news collection (module map, section
// 2.5), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  articles,
  articleSightings,
  collectionGaps,
  collectionSourceReads,
  dedupTraces,
  pressSourceDailyCounts,
  pressSourceDeactivations,
  pressSourceIncidents,
  pressSources,
} from '@/lib/db';

export type PressSourceRow = typeof pressSources.$inferSelect;
export type NewPressSourceRow = typeof pressSources.$inferInsert;
export type PressSourceDeactivationRow = typeof pressSourceDeactivations.$inferSelect;
export type NewPressSourceDeactivationRow = typeof pressSourceDeactivations.$inferInsert;
export type PressSourceDailyCountRow = typeof pressSourceDailyCounts.$inferSelect;
export type NewPressSourceDailyCountRow = typeof pressSourceDailyCounts.$inferInsert;
export type ArticleRow = typeof articles.$inferSelect;
export type NewArticleRow = typeof articles.$inferInsert;
export type ArticleSightingRow = typeof articleSightings.$inferSelect;
export type NewArticleSightingRow = typeof articleSightings.$inferInsert;
export type DedupTraceRow = typeof dedupTraces.$inferSelect;
export type NewDedupTraceRow = typeof dedupTraces.$inferInsert;
export type CollectionSourceReadRow = typeof collectionSourceReads.$inferSelect;
export type NewCollectionSourceReadRow = typeof collectionSourceReads.$inferInsert;
export type CollectionGapRow = typeof collectionGaps.$inferSelect;
export type NewCollectionGapRow = typeof collectionGaps.$inferInsert;
export type PressSourceIncidentRow = typeof pressSourceIncidents.$inferSelect;
export type NewPressSourceIncidentRow = typeof pressSourceIncidents.$inferInsert;

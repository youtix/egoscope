// The row and insert types of the tables of the event detection (module map, section
// 2.5), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  articleAttachments,
  articleParts,
  classificationFacts,
  classificationIncidentDetails,
  classificationResults,
  detectionRuns,
  exposureCounts,
} from '@/lib/db';

export type ArticlePartRow = typeof articleParts.$inferSelect;
export type NewArticlePartRow = typeof articleParts.$inferInsert;
export type ClassificationResultRow = typeof classificationResults.$inferSelect;
export type NewClassificationResultRow = typeof classificationResults.$inferInsert;
export type ClassificationFactRow = typeof classificationFacts.$inferSelect;
export type NewClassificationFactRow = typeof classificationFacts.$inferInsert;
export type ArticleAttachmentRow = typeof articleAttachments.$inferSelect;
export type NewArticleAttachmentRow = typeof articleAttachments.$inferInsert;
export type ExposureCountRow = typeof exposureCounts.$inferSelect;
export type NewExposureCountRow = typeof exposureCounts.$inferInsert;
export type DetectionRunRow = typeof detectionRuns.$inferSelect;
export type NewDetectionRunRow = typeof detectionRuns.$inferInsert;
export type ClassificationIncidentDetailRow = typeof classificationIncidentDetails.$inferSelect;
export type NewClassificationIncidentDetailRow = typeof classificationIncidentDetails.$inferInsert;

// The row and insert types of the tables of the event types (module map, section
// 2.4), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  eventTypes,
  eventTypeStatusChanges,
  typeIllustrationSources,
  typeOccurrences,
  typeSheetChanges,
  typeSheetVersions,
} from '@/lib/db';

export type EventTypeRow = typeof eventTypes.$inferSelect;
export type NewEventTypeRow = typeof eventTypes.$inferInsert;
export type EventTypeStatusChangeRow = typeof eventTypeStatusChanges.$inferSelect;
export type NewEventTypeStatusChangeRow = typeof eventTypeStatusChanges.$inferInsert;
export type TypeSheetVersionRow = typeof typeSheetVersions.$inferSelect;
export type NewTypeSheetVersionRow = typeof typeSheetVersions.$inferInsert;
export type TypeSheetChangeRow = typeof typeSheetChanges.$inferSelect;
export type NewTypeSheetChangeRow = typeof typeSheetChanges.$inferInsert;
export type TypeIllustrationSourceRow = typeof typeIllustrationSources.$inferSelect;
export type NewTypeIllustrationSourceRow = typeof typeIllustrationSources.$inferInsert;
export type TypeOccurrenceRow = typeof typeOccurrences.$inferSelect;
export type NewTypeOccurrenceRow = typeof typeOccurrences.$inferInsert;

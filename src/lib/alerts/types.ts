// The row and insert types of the tables of the alert sheets (module map, section
// 2.5), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  alertSheetCaveats,
  alertSheetEvents,
  alertSheetExpectedGames,
  alertSheetOutcomes,
  alertSheets,
  alertSheetSections,
  alertSheetSnapshots,
  alertSheetUpdates,
} from '@/lib/db';

export type AlertSheetRow = typeof alertSheets.$inferSelect;
export type NewAlertSheetRow = typeof alertSheets.$inferInsert;
export type AlertSheetSectionRow = typeof alertSheetSections.$inferSelect;
export type NewAlertSheetSectionRow = typeof alertSheetSections.$inferInsert;
export type AlertSheetSnapshotRow = typeof alertSheetSnapshots.$inferSelect;
export type NewAlertSheetSnapshotRow = typeof alertSheetSnapshots.$inferInsert;
export type AlertSheetEventRow = typeof alertSheetEvents.$inferSelect;
export type NewAlertSheetEventRow = typeof alertSheetEvents.$inferInsert;
export type AlertSheetExpectedGameRow = typeof alertSheetExpectedGames.$inferSelect;
export type NewAlertSheetExpectedGameRow = typeof alertSheetExpectedGames.$inferInsert;
export type AlertSheetCaveatRow = typeof alertSheetCaveats.$inferSelect;
export type NewAlertSheetCaveatRow = typeof alertSheetCaveats.$inferInsert;
export type AlertSheetUpdateRow = typeof alertSheetUpdates.$inferSelect;
export type NewAlertSheetUpdateRow = typeof alertSheetUpdates.$inferInsert;
export type AlertSheetOutcomeRow = typeof alertSheetOutcomes.$inferSelect;
export type NewAlertSheetOutcomeRow = typeof alertSheetOutcomes.$inferInsert;

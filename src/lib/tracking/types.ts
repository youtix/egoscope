// The row and insert types of the tables of the tracked cases (module map, section
// 2.5), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  caseCategoryChanges,
  forecastVersions,
  regroupingExits,
  trackedCaseDecisions,
  trackedCases,
  trackedGameResults,
} from '@/lib/db';

export type TrackedCaseRow = typeof trackedCases.$inferSelect;
export type NewTrackedCaseRow = typeof trackedCases.$inferInsert;
export type ForecastVersionRow = typeof forecastVersions.$inferSelect;
export type NewForecastVersionRow = typeof forecastVersions.$inferInsert;
export type CaseCategoryChangeRow = typeof caseCategoryChanges.$inferSelect;
export type NewCaseCategoryChangeRow = typeof caseCategoryChanges.$inferInsert;
export type TrackedGameResultRow = typeof trackedGameResults.$inferSelect;
export type NewTrackedGameResultRow = typeof trackedGameResults.$inferInsert;
export type TrackedCaseDecisionRow = typeof trackedCaseDecisions.$inferSelect;
export type NewTrackedCaseDecisionRow = typeof trackedCaseDecisions.$inferInsert;
export type RegroupingExitRow = typeof regroupingExits.$inferSelect;
export type NewRegroupingExitRow = typeof regroupingExits.$inferInsert;

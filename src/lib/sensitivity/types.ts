// The row and insert types of the tables of the cases, profiles and trends (module map,
// section 2.4), as Drizzle derives them from the schema of `@/lib/db`, and the type of
// the regrouping reactions (section 1.10).
import type {
  caseHistoryEntries,
  caseManualDecisions,
  caseReviewFlags,
  cases,
  caseTriggeredCriteria,
  generalTrends,
  profileValueVersions,
  recalculationJobs,
  sensitivityProfiles,
  Transaction,
  verdictHistoryEntries,
} from '@/lib/db';
import type { Result } from '@/lib/result';
import type { CaseId } from '@/lib/stats-engine';

export type CaseRow = typeof cases.$inferSelect;
export type NewCaseRow = typeof cases.$inferInsert;
export type CaseTriggeredCriterionRow = typeof caseTriggeredCriteria.$inferSelect;
export type NewCaseTriggeredCriterionRow = typeof caseTriggeredCriteria.$inferInsert;
export type CaseReviewFlagRow = typeof caseReviewFlags.$inferSelect;
export type NewCaseReviewFlagRow = typeof caseReviewFlags.$inferInsert;
export type CaseManualDecisionRow = typeof caseManualDecisions.$inferSelect;
export type NewCaseManualDecisionRow = typeof caseManualDecisions.$inferInsert;
export type CaseHistoryEntryRow = typeof caseHistoryEntries.$inferSelect;
export type NewCaseHistoryEntryRow = typeof caseHistoryEntries.$inferInsert;
export type SensitivityProfileRow = typeof sensitivityProfiles.$inferSelect;
export type NewSensitivityProfileRow = typeof sensitivityProfiles.$inferInsert;
export type GeneralTrendRow = typeof generalTrends.$inferSelect;
export type NewGeneralTrendRow = typeof generalTrends.$inferInsert;
export type VerdictHistoryEntryRow = typeof verdictHistoryEntries.$inferSelect;
export type NewVerdictHistoryEntryRow = typeof verdictHistoryEntries.$inferInsert;
export type RecalculationJobRow = typeof recalculationJobs.$inferSelect;
export type NewRecalculationJobRow = typeof recalculationJobs.$inferInsert;
export type ProfileValueVersionRow = typeof profileValueVersions.$inferSelect;
export type NewProfileValueVersionRow = typeof profileValueVersions.$inferInsert;

/** A case that a regrouping emptied, and the case that its events joined. */
export type Regrouping = Readonly<{ emptiedCaseId: CaseId; survivingCaseId: CaseId }>;

/**
 * The regrouping reactions of the module map (section 1.10), which
 * `sensitivity.processRecalculationJobs(ctx, reactions)` calls in its transaction before it
 * deletes a case that a regrouping emptied, while that case and its gap are still readable
 * (CL-SUI-16). A Lot 1 build passes the empty list, which does nothing; a failure rolls the
 * regrouping back.
 */
export type RegroupingReactions<E = never> = (
  tx: Transaction,
  regrouping: Regrouping,
) => Promise<Result<undefined, E>>;

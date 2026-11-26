// The public API of the cases, profiles and trends (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  CaseHistoryEntryRow,
  CaseManualDecisionRow,
  CaseReviewFlagRow,
  CaseRow,
  CaseTriggeredCriterionRow,
  GeneralTrendRow,
  NewCaseHistoryEntryRow,
  NewCaseManualDecisionRow,
  NewCaseReviewFlagRow,
  NewCaseRow,
  NewCaseTriggeredCriterionRow,
  NewGeneralTrendRow,
  NewProfileValueVersionRow,
  NewRecalculationJobRow,
  NewSensitivityProfileRow,
  NewVerdictHistoryEntryRow,
  ProfileValueVersionRow,
  RecalculationJobRow,
  Regrouping,
  RegroupingReactions,
  SensitivityProfileRow,
  VerdictHistoryEntryRow,
} from './types';

// recalculate.ts: requestRecalculation, processRecalculationJobs, nextDueAt
export { isRecalculating, requestRecalculation } from './recalculate';
export type {
  FullScope,
  PlayersScope,
  RecalculationCause,
  RecalculationScope,
} from './recalculate';

// full-recalculation.ts: requestFullRecalculation

// manual-decisions.ts: excludeCase, reinstateCase, acknowledgeReviewFlag
export { acknowledgeReviewFlag, excludeCase, reinstateCase } from './manual-decisions';
export type {
  CaseDecision,
  DecisionRefusal,
  ManualExclusionReason,
  ManualReinstatementReason,
} from './manual-decisions';

// queries.ts: getProfile, listProfiles, getTrend, listCases, getCase, caseOfEvent, verdictHistory,
//   reviewFlags, isRecalculating, profileValueVersionsUntil, changedSince
//   spread, for the size of a file, over queries.ts, list-queries.ts, case-queries.ts and
//   case-detail.ts, with the values they share in calculation-values.ts
export { getProfile, getTrend } from './queries';
export type { ProfileDetail, ProfileKey, TrendDetail, TrendSummary } from './queries';
export {
  changedSince,
  listProfiles,
  profileValueVersionsUntil,
  verdictHistory,
} from './list-queries';
export type {
  ChangedItem,
  ChangedSince,
  HistorySubject,
  ProfileFilter,
  ProfileLine,
  ProfileListing,
  ProfileValueVersion,
  VerdictAndConfidence,
  VerdictChangeEntry,
} from './list-queries';
export { caseOfEvent, listCases, reviewFlags } from './case-queries';
export type {
  CaseEvent,
  CaseGroups,
  CaseLine,
  CaseStatus,
  MeasuredGame,
  ReviewFlagItem,
} from './case-queries';
export { getCase } from './case-detail';
export type {
  CaseCriterion,
  CaseDecision,
  CaseDetail,
  CaseEventDetail,
  CaseEventSource,
  CaseFlag,
  CaseHistoryItem,
} from './case-detail';
export type {
  CalculationValues,
  CaseStatusReason,
  CountsBy,
  DoubtfulCaseCriterion,
  ProfileNotice,
  ProfileWarning,
  SwitchableCriterion,
  TallyReasons,
} from './calculation-values';

// erase.ts: eraseEventData, erasePlayerJobs, purgeValueVersions
export { eraseEventData, erasePlayerJobs } from './erase';
export type { ErasureCause } from './erase';

// detected-case.ts: createCaseOfDetectedEvent (Lot 2)

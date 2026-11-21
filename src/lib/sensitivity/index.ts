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

// full-recalculation.ts: requestFullRecalculation

// manual-decisions.ts: excludeCase, reinstateCase, acknowledgeReviewFlag

// queries.ts: getProfile, listProfiles, getTrend, listCases, getCase, caseOfEvent, verdictHistory,
//   reviewFlags, isRecalculating, profileValueVersionsUntil, changedSince

// erase.ts: eraseEventData, erasePlayerJobs, purgeValueVersions

// detected-case.ts: createCaseOfDetectedEvent (Lot 2)

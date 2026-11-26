// The public API of the tracked cases and the validation table (module map, section 2.5): the
// types of types.ts, then one slot per other file that the plan gives the module, with the
// operations it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  CaseCategoryChangeRow,
  ForecastVersionRow,
  NewCaseCategoryChangeRow,
  NewForecastVersionRow,
  NewRegroupingExitRow,
  NewTrackedCaseDecisionRow,
  NewTrackedCaseRow,
  NewTrackedGameResultRow,
  RegroupingExitRow,
  TrackedCaseDecisionRow,
  TrackedCaseRow,
  TrackedGameResultRow,
} from './types';

// create.ts: createTrackedCase, ensureTrackedCases, recordDecision
// forecasts.ts: refreshForecasts, nextDueAt
// results.ts: runAfterStatsUpdate
// validation-table.ts: validationTable
// references.ts: moveCaseReferences, moveEventReferences
// queries.ts: trackedCase, trackedCasesOfPlayer, results
// erase.ts: eraseEventData, erasePlayerData

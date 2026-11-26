// The public API of the backtest requests and coverage (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  BacktestCoveragePeriodRow,
  BacktestRequestEventRow,
  BacktestRequestRow,
  BacktestRequestTypeRow,
  NewBacktestCoveragePeriodRow,
  NewBacktestRequestEventRow,
  NewBacktestRequestRow,
  NewBacktestRequestTypeRow,
} from './types';

// request.ts: createRequest, cancel, cancelRequestToDo

// edit.ts: update, reduce, reductionOptions

// prompt.ts: recordPromptCopied, hideInProgressBanner, outdatedPrompts

// coverage.ts
export { coverage, inheritCoverage, isProfiled, recordImport } from './coverage';
export type {
  CoverageInheritance,
  CoverageOrigin,
  CoveragePeriod,
  ImportRecordRefusal,
  SavedImport,
  TypeCoverageEntry,
} from './coverage';

// supplements.ts: acceptSupplement, proposedSupplements

// detection.ts: createFromDetection, attachDetectedEvent, routeDetectedEvent, rankedTodoRequests
//   (Lot 2)

// queries.ts: list, get, requestsToDo, requestsOfPlayer, inProgress

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

// coverage.ts: recordImport, inheritCoverage, coverage, isProfiled

// supplements.ts: acceptSupplement, proposedSupplements

// detection.ts: createFromDetection, attachDetectedEvent, routeDetectedEvent, rankedTodoRequests
//   (Lot 2)

// queries.ts, with request-detail.ts, sheet-versions.ts and request-reads.ts beside it for the
// size limits: list, get, requestsToDo, requestsOfPlayer, inProgress, outdatedPrompts
export { inProgress, list, requestsOfPlayer, requestsToDo } from './queries';
export type { InProgress, PlayerRequest, RequestListPage, RequestListQuery } from './queries';
export { get } from './request-detail';
export type {
  OverallPeriod,
  RequestCancellation,
  RequestDetail,
  RequestType,
} from './request-detail';
export type {
  BacktestRequestKind,
  BacktestRequestOrigin,
  BacktestRequestStatus,
  BacktestRequestTrigger,
  RequestDeadline,
  RequestGame,
  RequestPlayer,
  RequestSummary,
} from './request-reads';
export { outdatedPrompts } from './sheet-versions';
export type { OutdatedPrompt, OutdatedType } from './sheet-versions';

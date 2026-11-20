// The public API of the statistics core: the shared types, then one slot per part of
// the module map (section 2.2), in its order, and in each part's slot one sub-slot per
// file that the plan gives the part. A task adds its exports under its own file's
// sub-slot only; a file that the plan did not foresee gets its sub-slot at the end of
// its part's slot (module map, section 9).

// --- Shared types ----------------------------------------------------------------
export type {
  BacktestRequestId,
  BaselinePhase,
  CaseId,
  EngineParams,
  EpochMs,
  EventTypeId,
  GameId,
  IsoDate,
  PlayerEventId,
  PlayerId,
  SeriesId,
  TeamId,
} from './types';

// --- performance/ ----------------------------------------------------------------

// performance/game-score.ts
export { gameScore } from './performance/game-score';
export type { GameScoreInput } from './performance/game-score';

// performance/box-score.ts
export { verifyBoxScore } from './performance/box-score';
export type { BoxScoreCheck } from './performance/box-score';
export type { BoxScoreLine } from './performance/box-score';
export type { CheckedBoxScore } from './performance/box-score';
export type { FailedCheck } from './performance/box-score';
export type { MissingElement } from './performance/box-score';

// performance/performance-index.ts
export { performanceIndex } from './performance/performance-index';

// performance/participation.ts
export { participationOf } from './performance/participation';
export type { Participation } from './performance/participation';

// performance/playing-time.ts
export { classifyGame } from './performance/playing-time';
export { playingTimeThreshold } from './performance/playing-time';
export type { GamePlayClassification } from './performance/playing-time';
export type { PlayerGame } from './performance/playing-time';

// --- baseline/ -------------------------------------------------------------------

// baseline/season-baseline.ts

// baseline/indicative-comparison.ts

// --- schedule/ -------------------------------------------------------------------

// schedule/team-record.ts
export { teamRecord } from './schedule/team-record';
export type {
  GamePhase,
  GameStatus,
  ScheduleGame,
  TeamWinLossRecord,
} from './schedule/team-record';

// schedule/series.ts
export { rebuildSeries } from './schedule/series';
export type { RebuiltSeries, SeriesGame, SeriesGamePosition, SeriesRound } from './schedule/series';

// schedule/phase-state.ts
export { phaseState } from './schedule/phase-state';
export type {
  PhaseGame,
  PhaseOf,
  PhaseSeries,
  PhaseState,
  SeasonSchedule,
} from './schedule/phase-state';

// schedule/seasons.ts

// schedule/team-membership.ts

// schedule/next-game.ts

// schedule/player-indicators.ts

// --- measured-game/ --------------------------------------------------------------

// measured-game/attachment.ts

// measured-game/precedence.ts

// measured-game/late-detection.ts

// --- cases/ ----------------------------------------------------------------------

// cases/case-state.ts

// cases/normalized-gap.ts

// cases/doubtful-criteria.ts

// cases/grouping.ts

// cases/review-flags.ts

// cases/manual-decisions.ts

// --- profiles/ -------------------------------------------------------------------

// profiles/tally.ts
export { tallyProfile } from './profiles/tally';
export type { ProfileCase, ProfileTally, TallyExitReason } from './profiles/tally';

// profiles/verdict.ts
export {
  compareCasesInFixedOrder,
  profileVerdict,
  signalVerdict,
  verdictQuantities,
} from './profiles/verdict';
export type {
  ProfileVerdict,
  Verdict,
  VerdictDirection,
  VerdictLevel,
  VerdictQuantities,
} from './profiles/verdict';

// profiles/confidence.ts

// profiles/robustness.ts

// profiles/checks.ts

// profiles/general-trend.ts

// profiles/expected-false-signals.ts

// profiles/verdict-history.ts

// profiles/evaluate-player.ts

// profiles/evaluate-trend.ts

// --- tracking/ -------------------------------------------------------------------

// tracking/forecast.ts

// tracking/recording.ts

// tracking/category.ts

// tracking/assessment.ts

// tracking/decisions.ts

// tracking/validation-table.ts

// --- alerts/ ---------------------------------------------------------------------

// alerts/grouping.ts

// alerts/state.ts

// alerts/caveats.ts

// --- backtest/ -------------------------------------------------------------------

// backtest/counting.ts
export { countingPeriods, firstUncoveredOn } from './backtest/counting';
export type { CoveredPeriod, TypeCoverage } from './backtest/counting';

// backtest/extents.ts
export { initialExtent, reduceExtent, supplementExtent, updateExtent } from './backtest/extents';
export type {
  BacktestRequestKind,
  CoveredResearchType,
  ExtentResult,
  PlannedType,
  PlanResult,
  Reduction,
  RequestedType,
  RequestUpdate,
  ResearchType,
} from './backtest/extents';

// backtest/retained-coverage.ts

// backtest/proposals.ts

// backtest/deadline.ts

// backtest/urgency.ts

// --- correspondence/ -------------------------------------------------------------

// correspondence/links.ts

// correspondence/match.ts

// --- calendar/ -------------------------------------------------------------------

// calendar/calendar-games.ts

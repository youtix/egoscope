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
export { baselinePhaseOf } from './baseline/season-baseline';
export { seasonBaseline } from './baseline/season-baseline';
export type { BaselineGame } from './baseline/season-baseline';
export type { SeasonBaseline } from './baseline/season-baseline';
export type { SeasonBaselineInput } from './baseline/season-baseline';
export type { SeasonBaselineStatus } from './baseline/season-baseline';

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
export { seasonOfDate } from './schedule/seasons';
export type { SeasonSpan } from './schedule/seasons';

// schedule/team-membership.ts
export { teamGames } from './schedule/team-membership';
export { teamMembership } from './schedule/team-membership';
export type { LinesGame } from './schedule/team-membership';
export type { PlayerLine } from './schedule/team-membership';
export type { PlayerTeamChange } from './schedule/team-membership';
export type { TeamGame } from './schedule/team-membership';
export type { TeamStint } from './schedule/team-membership';

// schedule/next-game.ts
export { expectedGame } from './schedule/next-game';
export { nextGame } from './schedule/next-game';
export type { ExpectedGame } from './schedule/next-game';
export type { GameVenue } from './schedule/next-game';
export type { NextGame } from './schedule/next-game';
export type { NextGameCandidate } from './schedule/next-game';
export type { NextGameSchedule } from './schedule/next-game';

// schedule/player-indicators.ts
export { firstNbaGame } from './schedule/player-indicators';
export { indicatorsOf } from './schedule/player-indicators';
export type { CareerSeasons } from './schedule/player-indicators';
export type { FirstNbaGame } from './schedule/player-indicators';
export type { IndicatorLine } from './schedule/player-indicators';
export type { PlayerIndicators } from './schedule/player-indicators';

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
export { doubtfulShare, profileConfidence } from './profiles/confidence';
export type {
  ConfidenceInputs,
  ConfidenceStepDownReason,
  ConfidenceValues,
  ProfileConfidence,
} from './profiles/confidence';

// profiles/robustness.ts
export { runRobustnessTest } from './profiles/robustness';
export type { RobustnessTest, RobustnessTrial } from './profiles/robustness';

// profiles/checks.ts
export { profileChecks } from './profiles/checks';
export type { ManuallyDecidedCase, ProfileChecks } from './profiles/checks';

// profiles/general-trend.ts
export { generalTrend, topContributorShare } from './profiles/general-trend';
export type { GeneralTrendInput, GeneralTrendValues, TrendCase } from './profiles/general-trend';

// profiles/expected-false-signals.ts
export { expectedFalseSignals } from './profiles/expected-false-signals';
export type { ExpectedFalseSignals } from './profiles/expected-false-signals';

// profiles/verdict-history.ts
export { statisticsUpdateCause, verdictChanges } from './profiles/verdict-history';
export type {
  StatisticsUpdateCause,
  StatisticsUpdateEffects,
  VerdictAndConfidence,
  VerdictChange,
} from './profiles/verdict-history';

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
export { isTypeCovered, retainedCoverage } from './backtest/retained-coverage';
export type {
  CoverageGap,
  CoverageWarning,
  DeclaredCoverage,
  RetainedCoverage,
  RetainedPeriod,
} from './backtest/retained-coverage';

// backtest/proposals.ts
export { incompleteImportSupplement, isTypeSupplementNeeded } from './backtest/proposals';

// backtest/deadline.ts
export { deadlineOf, rankTodo } from './backtest/deadline';
export type {
  Deadline,
  DeadlineGame,
  NoGameScheduled,
  NoNextGameReason,
  RequestToDo,
} from './backtest/deadline';

// backtest/urgency.ts

// --- correspondence/ -------------------------------------------------------------

// correspondence/links.ts

// correspondence/match.ts

// --- calendar/ -------------------------------------------------------------------

// calendar/calendar-games.ts

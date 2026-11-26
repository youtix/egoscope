// The public API of the test support, which only tests, scripts/ and the hermetic
// routes under src/app/api/test/ import (lint): the shared files first, then one slot
// per planning area (module map, section 9.2), where the area exports the factory
// files and the world files that it adds, and nothing else.

// --- Shared files ----------------------------------------------------------------

// timeouts.ts
export { DATABASE_TEST_TIMEOUT_MS } from './timeouts';

// commands.ts
export { readCommand } from './commands';
export type { InvalidCommand } from './commands';

// fixed-clock.ts
export { fixedClock, scriptClock } from './fixed-clock';
export type { ClockCommandError } from './fixed-clock';

// no-query-database.ts
export { noQueryDatabase } from './no-query-database';
export type { NoQueryDatabase } from './no-query-database';

// fake-controls.ts
export { fakeControls, scriptFake } from './fake-controls';

// draft-server.ts
export { draftServerOf, withdrawDrafts } from './draft-server';

// to-do.ts
export { closeTodoItem, openTodoItem } from './to-do';

// scenarios.ts
export {
  applyScenarios,
  playerWithoutBacktest,
  profiledPlayer,
  requestToDo,
  scenarios,
  validatedTypeWithCalendarSibling,
} from './scenarios';
export type { ProfiledPlayer, Scenario, SeedError, World } from './scenarios';

// factories/players.ts
export { insertPlayer, leaguePlayerId } from './factories/players';
export type { LeaguePlayer, PlayerFactoryOptions, PlayerRow } from './factories/players';

// factories/taxonomy.ts
export { BIRTHDAY, insertCalendarType, insertEventType, MEDIA_STORM } from './factories/taxonomy';
export type { EventTypeRow } from './factories/taxonomy';

// factories/events.ts
export { insertDetectedEvent, insertHistoricalEvent } from './factories/events';
export type { EventFactoryOptions, EventRow } from './factories/events';

// factories/backtests.ts
export { insertImport, insertRequest } from './factories/backtests';
export type {
  ImportFactoryOptions,
  ImportRow,
  RequestFactoryOptions,
  RequestRow,
  TypePeriod,
} from './factories/backtests';

// factories/games.ts
export { insertBoxScores, insertLeagueSeason } from './factories/games';
export type { BoxScoreFactoryOptions } from './factories/games';

// factories/sensitivity.ts
export { insertValidCase } from './factories/sensitivity';
export type { CaseFactoryOptions, CaseRow } from './factories/sensitivity';

// --- players-taxonomy ------------------------------------------------------------

// --- backtest-import -------------------------------------------------------------

// --- statistics-sensitivity ------------------------------------------------------

// factories/profiles.ts
export {
  buildProfile,
  buildTrend,
  insertProfile,
  insertTrend,
  insertValueVersion,
  insertVerdictChange,
} from './factories/profiles';
export type { CalculationSubject, ViewShape } from './factories/profiles';
// factories/profile-cases.ts
export { DEFAULT_PARAMS } from './factories/profile-cases';
export type { CalculationScope, ProfileValues } from './factories/profile-cases';
// worlds/statistics-sensitivity-lot1.ts
export {
  birthdayOnNextGameDay,
  playerWithEveryStatus,
  statisticsSensitivityLot1,
  trendWithHistory,
} from './worlds/statistics-sensitivity-lot1';
export type {
  BirthdayGame,
  ByView,
  PlayerWithEveryStatus,
  TrendWithHistory,
  WorldBase,
} from './worlds/statistics-sensitivity-lot1';

// --- collection-detection --------------------------------------------------------

// --- alerts-tracking-telegram ----------------------------------------------------

// --- interface -------------------------------------------------------------------

// --- sensitive-crosscutting ------------------------------------------------------

// The row and insert types of the tables of the backtest requests and coverage (module map, section
// 2.4), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  backtestCoveragePeriods,
  backtestRequestEvents,
  backtestRequests,
  backtestRequestTypes,
} from '@/lib/db';

export type BacktestRequestRow = typeof backtestRequests.$inferSelect;
export type NewBacktestRequestRow = typeof backtestRequests.$inferInsert;
export type BacktestRequestTypeRow = typeof backtestRequestTypes.$inferSelect;
export type NewBacktestRequestTypeRow = typeof backtestRequestTypes.$inferInsert;
export type BacktestRequestEventRow = typeof backtestRequestEvents.$inferSelect;
export type NewBacktestRequestEventRow = typeof backtestRequestEvents.$inferInsert;
export type BacktestCoveragePeriodRow = typeof backtestCoveragePeriods.$inferSelect;
export type NewBacktestCoveragePeriodRow = typeof backtestCoveragePeriods.$inferInsert;

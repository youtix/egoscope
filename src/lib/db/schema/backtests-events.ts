// The table of the backtests module that links a request to detected events (Lot 2,
// created now). It references events, whose table references the imports of
// backtests.ts, so it lives apart from that file.
import { foreignKey, integer, pgTable, primaryKey } from 'drizzle-orm/pg-core';

import { backtestRequests } from './backtests';
import { timestamptz } from './builders';
import { events } from './events';

/**
 * A detected event attached to a request, whose urgency it carries: a dismissal keeps
 * the link, a withdrawal erases it with the event, the request keeping its trigger
 * (BKT-03, BKT-07, BKT-14, BKT-18, CL-DSN-05).
 */
export const backtestRequestEvents = pgTable(
  'backtest_request_events',
  {
    backtestRequestId: integer('backtest_request_id').notNull(),
    playerEventId: integer('player_event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    attachedAt: timestamptz('attached_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.backtestRequestId, table.playerEventId] }),
    foreignKey({
      name: 'backtest_request_events_backtest_request_id_fk',
      columns: [table.backtestRequestId],
      foreignColumns: [backtestRequests.id],
    }).onDelete('cascade'),
  ],
);

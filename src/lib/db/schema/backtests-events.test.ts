import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { DETECTED_EVENT, insertParents, PARENTS } from '../test-parents';
import { backtestRequests } from './backtests';
import { backtestRequestEvents } from './backtests-events';
import { events } from './events';

import type { Database } from '../types';

// The columns of backtest_request_events, in the order of backtest-and-import.md.
const COLUMNS = [
  'backtest_request_events.backtest_request_id integer NOT NULL',
  'backtest_request_events.player_event_id integer NOT NULL',
  'backtest_request_events.attached_at timestamp with time zone NOT NULL DEFAULT now()',
];

// Its composite primary key, and its references, which both cascade.
const INDEXES = [
  'CREATE UNIQUE INDEX backtest_request_events_backtest_request_id_player_event_id_pk ON public.backtest_request_events USING btree (backtest_request_id, player_event_id)',
];
const FOREIGN_KEYS = [
  'backtest_request_events FOREIGN KEY (backtest_request_id) REFERENCES backtest_requests(id) ON DELETE CASCADE',
  'backtest_request_events FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE CASCADE',
];

// The second detected event of the player, and its link to the parent request.
const SECOND_EVENT_ID = 2;
const LINK = { backtestRequestId: PARENTS.requestId, playerEventId: PARENTS.eventId } as const;
// The owner dismissed the parent event on 18 November 2026.
const DISMISSED_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18)));

describe('the detected events attached to a request', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(events).values(DETECTED_EVENT);
    return database.close;
  }, 60_000);

  it('builds the columns, key and references that backtest-and-import.md gives the table', async () => {
    const table = ['backtest_request_events'];

    await expect(describeColumns(db, table)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, table)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, table)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[BKT-07] attaches an event once to a request, a dismissal keeping the link', async () => {
    await db
      .insert(backtestRequestEvents)
      .values([LINK, { ...LINK, playerEventId: SECOND_EVENT_ID }]);

    const again = db.insert(backtestRequestEvents).values(LINK);
    await db
      .update(events)
      .set({
        detectedStatus: 'dismissed',
        dismissalReason: 'old_fact',
        dismissedAt: DISMISSED_AT,
      })
      .where(eq(events.id, PARENTS.eventId));

    await expect(again).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint: 'backtest_request_events_backtest_request_id_player_event_id_pk',
      },
    });
    await expect(db.$count(backtestRequestEvents)).resolves.toBe(2);
  });

  it('[BKT-14] [CL-DSN-05] erases the link with a withdrawn event, and every link with its request', async () => {
    await db
      .insert(backtestRequestEvents)
      .values([LINK, { ...LINK, playerEventId: SECOND_EVENT_ID }]);

    await db.delete(events).where(eq(events.id, PARENTS.eventId));
    const left = await db
      .select({ eventId: backtestRequestEvents.playerEventId })
      .from(backtestRequestEvents);
    await db.delete(backtestRequests).where(eq(backtestRequests.id, PARENTS.requestId));

    expect(left).toStrictEqual([{ eventId: SECOND_EVENT_ID }]);
    await expect(db.$count(backtestRequestEvents)).resolves.toBe(0);
  });
});

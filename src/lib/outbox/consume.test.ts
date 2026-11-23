import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, insertParents, outboxFacts, PARENTS } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { markConsumed, pending } from './consume';
import { emit } from './emit';

import type { OutboxFact } from './facts';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// The afternoon statistics pass of Monday 23 November 2026, 15:00 Paris time.
const NOW = toEpochMs(Date.UTC(2026, 10, 23, 14));
const MINUTE = 60_000;
const PASS_ID = '6d1e8a42-93b0-4f7c-a5e2-1c4b7d9f0a38';

const NO_SUBJECT = {
  backtestRequestId: null,
  deadlineGameId: null,
  playerEventId: null,
  eventTypeId: null,
  incidentId: null,
  lot2SubjectId: null,
} as const;

describe('the consumption of the facts', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    clock = fixedClock(NOW);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  /** Emits `facts` a minute apart, the first now. */
  async function emitApart(facts: readonly Readonly<{ fact: OutboxFact; passId?: string }>[]) {
    for (const { fact, passId } of facts) {
      await db.transaction(async (tx) => emit(tx, fact, passId));
      clock.advance(MINUTE);
    }
  }

  const consumed = async (ids: readonly number[]) =>
    db.transaction(async (tx) => markConsumed(tx, ids));

  it('[TEL-02] [TEL-19] lists the facts not consumed yet, oldest first, with their subject and pass', async () => {
    await emitApart([
      { fact: { kind: 'type_proposal_new', eventTypeId: 'media-storm' }, passId: PASS_ID },
      { fact: { kind: 'backtest_request_to_do', backtestRequestId: PARENTS.requestId } },
      { fact: { kind: 'tracked_result_ready', lot2SubjectId: 7 }, passId: PASS_ID },
    ]);

    await expect(db.transaction(async (tx) => pending(tx))).resolves.toStrictEqual([
      {
        ...NO_SUBJECT,
        id: 1,
        kind: 'type_proposal_new',
        eventTypeId: 'media-storm',
        passId: PASS_ID,
        createdAt: NOW,
      },
      {
        ...NO_SUBJECT,
        id: 2,
        kind: 'backtest_request_to_do',
        backtestRequestId: PARENTS.requestId,
        passId: null,
        createdAt: NOW + MINUTE,
      },
      {
        ...NO_SUBJECT,
        id: 3,
        kind: 'tracked_result_ready',
        lot2SubjectId: 7,
        passId: PASS_ID,
        createdAt: NOW + 2 * MINUTE,
      },
    ]);
  });

  it('[TEL-17] marks facts consumed once, so that they leave the pending facts and keep their first instant', async () => {
    await emitApart([
      { fact: { kind: 'alert_sheet_produced', lot2SubjectId: 3 } },
      { fact: { kind: 'alert_sheet_updated', lot2SubjectId: 5 } },
    ]);

    await expect(consumed([1])).resolves.toBe(1);
    clock.advance(MINUTE);
    await expect(consumed([1, 2])).resolves.toBe(1);
    await expect(consumed([])).resolves.toBe(0);

    await expect(pending(db)).resolves.toStrictEqual([]);
    await expect(
      db
        .select({ id: outboxFacts.id, consumedAt: outboxFacts.consumedAt })
        .from(outboxFacts)
        .orderBy(asc(outboxFacts.id)),
    ).resolves.toStrictEqual([
      { id: 1, consumedAt: new Date(NOW + 2 * MINUTE) },
      { id: 2, consumedAt: new Date(NOW + 3 * MINUTE) },
    ]);
  });
});

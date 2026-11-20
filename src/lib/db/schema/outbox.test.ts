import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '../test-database';
import { incidents } from './incidents';
import { outboxFacts } from './outbox';

import type { Database } from '../types';

// The pass that emitted the facts (TEL-19).
const PASS_ID = '9a4e1c7b-2f58-4d03-b6e9-71c2a5d8f034';
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the outbox table', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await db.insert(incidents).values({ kind: 'backup_failed', causeKey: 'upload_failed' });
    return database.close;
  }, 60_000);

  it('records a fact of a pass with the defaults of the data model', async () => {
    await db
      .insert(outboxFacts)
      .values({ kind: 'incident_opened', incidentId: 1, passId: PASS_ID });

    await expect(db.select().from(outboxFacts)).resolves.toStrictEqual([
      {
        id: 1,
        kind: 'incident_opened',
        backtestRequestId: null,
        deadlineGameId: null,
        playerEventId: null,
        eventTypeId: null,
        incidentId: 1,
        lot2SubjectId: null,
        passId: PASS_ID,
        createdAt: ANY_INSTANT,
        consumedAt: null,
      },
    ]);
  });

  it('accepts each kind of the glossary with exactly its subjects', async () => {
    await db.insert(outboxFacts).values([
      { kind: 'backtest_request_to_do', backtestRequestId: 4 },
      {
        kind: 'backtest_request_deadline_changed',
        backtestRequestId: 4,
        deadlineGameId: 51,
        playerEventId: 12,
      },
      { kind: 'alert_sheet_produced', lot2SubjectId: 3 },
      { kind: 'alert_sheet_updated', lot2SubjectId: 8 },
      { kind: 'tracked_result_ready', lot2SubjectId: 21 },
      { kind: 'type_proposal_new', eventTypeId: 'media-storm' },
      { kind: 'incident_opened', incidentId: 1 },
      { kind: 'incident_closed', incidentId: 1 },
    ]);

    const unknown = db.insert(outboxFacts).values({ kind: sql`'export_reminder_due'` });

    await expect(db.select().from(outboxFacts)).resolves.toHaveLength(8);
    await expect(unknown).rejects.toMatchObject(violationOf('outbox_facts_kind_check'));
  });

  it.each([
    { fact: 'a request to do without its request', subjects: { kind: 'backtest_request_to_do' } },
    {
      fact: 'a request to do that names a game',
      subjects: { kind: 'backtest_request_to_do', backtestRequestId: 4, deadlineGameId: 51 },
    },
    {
      fact: 'a deadline changed without the event that moved it',
      subjects: {
        kind: 'backtest_request_deadline_changed',
        backtestRequestId: 4,
        deadlineGameId: 51,
      },
    },
    {
      fact: 'a type proposal that names an incident',
      subjects: { kind: 'type_proposal_new', eventTypeId: 'media-storm', incidentId: 1 },
    },
    { fact: 'an incident fact without its incident', subjects: { kind: 'incident_closed' } },
    {
      fact: 'a tracked result that names a request instead of its Lot 2 subject',
      subjects: { kind: 'tracked_result_ready', backtestRequestId: 4 },
    },
  ] as const)('refuses $fact', async ({ subjects }) => {
    const fact = db.insert(outboxFacts).values(subjects);

    await expect(fact).rejects.toMatchObject(violationOf('outbox_facts_subject_check'));
  });

  it('records one fact per kind and subject, so that a rerun of a step yields no second message', async () => {
    await db.insert(outboxFacts).values([
      { kind: 'incident_opened', incidentId: 1, passId: PASS_ID },
      { kind: 'incident_closed', incidentId: 1, passId: PASS_ID },
      { kind: 'backtest_request_to_do', backtestRequestId: 4 },
    ]);

    const rerun = db.insert(outboxFacts).values({ kind: 'incident_opened', incidentId: 1 });
    const again = db
      .insert(outboxFacts)
      .values({ kind: 'backtest_request_to_do', backtestRequestId: 4 });

    await expect(rerun).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'outbox_facts_fact_key' },
    });
    await expect(again).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'outbox_facts_fact_key' },
    });
  });

  it('deletes the facts of an incident with it', async () => {
    await db.insert(outboxFacts).values([
      { kind: 'incident_opened', incidentId: 1 },
      { kind: 'type_proposal_new', eventTypeId: 'media-storm' },
    ]);

    await db.delete(incidents).where(eq(incidents.id, 1));

    await expect(db.select({ kind: outboxFacts.kind }).from(outboxFacts)).resolves.toStrictEqual([
      { kind: 'type_proposal_new' },
    ]);
  });
});

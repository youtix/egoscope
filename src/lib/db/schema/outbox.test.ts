import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { backtestRequests } from './backtests';
import { events } from './events';
import { games } from './games';
import { incidents } from './incidents';
import { outboxFacts } from './outbox';
import { eventTypes } from './taxonomy';

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
    await insertParents(db);
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
      { kind: 'backtest_request_to_do', backtestRequestId: PARENTS.requestId },
      {
        kind: 'backtest_request_deadline_changed',
        backtestRequestId: PARENTS.requestId,
        deadlineGameId: PARENTS.gameId,
        playerEventId: PARENTS.eventId,
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

  // Each fact breaks one clause of the row check alone, by a subject that its kind
  // lacks or by one that it has, so that every clause is proven both ways.
  it.each([
    { fact: 'a request to do without its request', subjects: { kind: 'backtest_request_to_do' } },
    {
      fact: 'a tracked result that names a request beside its Lot 2 subject',
      subjects: {
        kind: 'tracked_result_ready',
        lot2SubjectId: 21,
        backtestRequestId: PARENTS.requestId,
      },
    },
    {
      fact: 'a deadline changed without its new deadline game',
      subjects: {
        kind: 'backtest_request_deadline_changed',
        backtestRequestId: PARENTS.requestId,
        playerEventId: PARENTS.eventId,
      },
    },
    {
      fact: 'a request to do that names a game',
      subjects: {
        kind: 'backtest_request_to_do',
        backtestRequestId: PARENTS.requestId,
        deadlineGameId: PARENTS.gameId,
      },
    },
    {
      fact: 'a deadline changed without the event that moved it',
      subjects: {
        kind: 'backtest_request_deadline_changed',
        backtestRequestId: PARENTS.requestId,
        deadlineGameId: PARENTS.gameId,
      },
    },
    {
      fact: 'a request to do that names an event',
      subjects: {
        kind: 'backtest_request_to_do',
        backtestRequestId: PARENTS.requestId,
        playerEventId: PARENTS.eventId,
      },
    },
    { fact: 'a type proposal without its type', subjects: { kind: 'type_proposal_new' } },
    {
      fact: 'an incident fact that names a type',
      subjects: { kind: 'incident_opened', incidentId: 1, eventTypeId: 'media-storm' },
    },
    { fact: 'an incident fact without its incident', subjects: { kind: 'incident_closed' } },
    {
      fact: 'a type proposal that names an incident',
      subjects: { kind: 'type_proposal_new', eventTypeId: 'media-storm', incidentId: 1 },
    },
    {
      fact: 'an alert sheet produced without its sheet',
      subjects: { kind: 'alert_sheet_produced' },
    },
    {
      fact: 'an incident fact that names a Lot 2 subject',
      subjects: { kind: 'incident_opened', incidentId: 1, lot2SubjectId: 3 },
    },
  ] as const)('refuses $fact', async ({ subjects }) => {
    const fact = db.insert(outboxFacts).values(subjects);

    await expect(fact).rejects.toMatchObject(violationOf('outbox_facts_subject_check'));
  });

  it('records one fact per kind and subject, so that a rerun of a step yields no second message', async () => {
    await db.insert(outboxFacts).values([
      { kind: 'incident_opened', incidentId: 1, passId: PASS_ID },
      { kind: 'incident_closed', incidentId: 1, passId: PASS_ID },
      { kind: 'backtest_request_to_do', backtestRequestId: PARENTS.requestId },
    ]);

    const rerun = db.insert(outboxFacts).values({ kind: 'incident_opened', incidentId: 1 });
    const again = db
      .insert(outboxFacts)
      .values({ kind: 'backtest_request_to_do', backtestRequestId: PARENTS.requestId });

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

  it('deletes the facts of a request or an event with it, and keeps the game and the type a fact names', async () => {
    const deadline = {
      kind: 'backtest_request_deadline_changed',
      backtestRequestId: PARENTS.requestId,
      deadlineGameId: PARENTS.gameId,
      playerEventId: PARENTS.eventId,
    } as const;
    await db
      .insert(eventTypes)
      .values({ id: 'player-conflict', origin: 'scoping', name: 'Conflict between players' });
    await db
      .insert(outboxFacts)
      .values([
        deadline,
        { kind: 'backtest_request_to_do', backtestRequestId: PARENTS.requestId },
        { kind: 'type_proposal_new', eventTypeId: 'player-conflict' },
      ]);

    const gameDeleted = db.delete(games).where(eq(games.id, PARENTS.gameId));
    const typeDeleted = db.delete(eventTypes).where(eq(eventTypes.id, 'player-conflict'));
    await expect(gameDeleted).rejects.toMatchObject({
      cause: { code: '23001', constraint: 'outbox_facts_deadline_game_id_games_id_fk' },
    });
    await expect(typeDeleted).rejects.toMatchObject({
      cause: { code: '23001', constraint: 'outbox_facts_event_type_id_event_types_id_fk' },
    });
    await db.delete(events).where(eq(events.id, PARENTS.eventId));
    const afterEvent = await db
      .select({ kind: outboxFacts.kind })
      .from(outboxFacts)
      .orderBy(outboxFacts.id);
    await db.delete(backtestRequests).where(eq(backtestRequests.id, PARENTS.requestId));

    expect(afterEvent).toStrictEqual([
      { kind: 'backtest_request_to_do' },
      { kind: 'type_proposal_new' },
    ]);
    await expect(db.select({ kind: outboxFacts.kind }).from(outboxFacts)).resolves.toStrictEqual([
      { kind: 'type_proposal_new' },
    ]);
  });
});

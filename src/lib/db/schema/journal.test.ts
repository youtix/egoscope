import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { backtestRequests, imports } from './backtests';
import { events } from './events';
import { incidents } from './incidents';
import { journalEntries, journalTechnicalDetails } from './journal';
import { followedPlayers } from './players';
import { taskRuns } from './scheduler';
import { cases } from './sensitivity';
import { eventTypes } from './taxonomy';

import type { Database } from '../types';

// An entry's required fields: a refused trigger, as the next pass journals it.
const REFUSED_TRIGGER = {
  category: 'trigger_refused',
  level: 'warning',
  messageKey: 'trigger_refused',
} as const;
// The run of the purge that an entry names.
const PURGE_DUE_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18, 3)));
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the journal tables', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('records an entry with the defaults of the data model, naming nothing', async () => {
    await db.insert(journalEntries).values(REFUSED_TRIGGER);

    await expect(db.select().from(journalEntries)).resolves.toStrictEqual([
      {
        id: 1,
        occurredAt: ANY_INSTANT,
        ...REFUSED_TRIGGER,
        messageParams: {},
        playerId: null,
        playerEventId: null,
        eventTypeId: null,
        backtestRequestId: null,
        importId: null,
        caseId: null,
        incidentId: null,
        taskRunId: null,
        lot2ObjectKind: null,
        lot2ObjectId: null,
      },
    ]);
  });

  it('[CL-TRV-25] accepts each category and level of the glossary, and refuses others', async () => {
    const categories = [
      'task_pass',
      'profile_recalculation',
      'service_failure',
      'incident',
      'user_action',
      'import_refused',
      'parameter_change',
      'login_refused',
      'login_lockout',
      'telegram_message',
      'trigger_refused',
    ] as const;
    const levels = ['info', 'warning', 'incident'] as const;
    await db
      .insert(journalEntries)
      .values(categories.map((category) => ({ ...REFUSED_TRIGGER, category })));
    await db.insert(journalEntries).values(levels.map((level) => ({ ...REFUSED_TRIGGER, level })));

    const stored = await db
      .select({ category: journalEntries.category, level: journalEntries.level })
      .from(journalEntries);
    const category = db
      .insert(journalEntries)
      .values({ ...REFUSED_TRIGGER, category: sql`'tick'` });
    const level = db.insert(journalEntries).values({ ...REFUSED_TRIGGER, level: sql`'error'` });

    expect(new Set(stored.map((row) => row.category))).toStrictEqual(new Set(categories));
    expect(new Set(stored.map((row) => row.level))).toStrictEqual(new Set(levels));
    await expect(category).rejects.toMatchObject(violationOf('journal_entries_category_check'));
    await expect(level).rejects.toMatchObject(violationOf('journal_entries_level_check'));
  });

  it('[CL-TRV-10] names a Lot 2 object by its kind and its identifier together', async () => {
    const kinds = ['press_source', 'article', 'alert_sheet', 'notification_message'] as const;
    await db
      .insert(journalEntries)
      .values(
        kinds.map((lot2ObjectKind) => ({ ...REFUSED_TRIGGER, lot2ObjectKind, lot2ObjectId: 7 })),
      );

    const stored = await db
      .select({ kind: journalEntries.lot2ObjectKind })
      .from(journalEntries)
      .orderBy(journalEntries.id);
    const kindAlone = db
      .insert(journalEntries)
      .values({ ...REFUSED_TRIGGER, lot2ObjectKind: 'article' });
    const idAlone = db.insert(journalEntries).values({ ...REFUSED_TRIGGER, lot2ObjectId: 7 });
    const unknown = db
      .insert(journalEntries)
      .values({ ...REFUSED_TRIGGER, lot2ObjectKind: sql`'telegram_link'`, lot2ObjectId: 7 });

    expect(stored.map((row) => row.kind)).toStrictEqual(kinds);
    await expect(kindAlone).rejects.toMatchObject(violationOf('journal_entries_lot2_object_check'));
    await expect(idAlone).rejects.toMatchObject(violationOf('journal_entries_lot2_object_check'));
    await expect(unknown).rejects.toMatchObject(
      violationOf('journal_entries_lot2_object_kind_check'),
    );
  });

  // The other references an entry can hold beside an event or a case.
  const REFERENCES = [
    { reference: 'its player', names: { playerId: PARENTS.playerId } },
    { reference: 'its type', names: { eventTypeId: 'media-storm' } },
    { reference: 'a request', names: { backtestRequestId: PARENTS.requestId } },
    { reference: 'an import', names: { importId: PARENTS.importId } },
  ] as const;

  it.each([...REFERENCES, { reference: 'its case', names: { caseId: PARENTS.caseId } }])(
    '[CL-TRV-10] names an event by that reference alone, never with $reference',
    async ({ names }) => {
      const entry = db
        .insert(journalEntries)
        .values({ ...REFUSED_TRIGGER, playerEventId: PARENTS.eventId, ...names });

      await expect(entry).rejects.toMatchObject(
        violationOf('journal_entries_event_reference_check'),
      );
    },
  );

  it('[CL-TRV-10] names a case alone, the display reading its player and its type through it', async () => {
    await db.insert(journalEntries).values([
      {
        ...REFUSED_TRIGGER,
        playerEventId: PARENTS.eventId,
        lot2ObjectKind: 'alert_sheet',
        lot2ObjectId: 3,
      },
      {
        ...REFUSED_TRIGGER,
        caseId: PARENTS.caseId,
        lot2ObjectKind: 'alert_sheet',
        lot2ObjectId: 3,
      },
      { ...REFUSED_TRIGGER, backtestRequestId: PARENTS.requestId, importId: PARENTS.importId },
    ]);

    await expect(db.$count(journalEntries)).resolves.toBe(3);
  });

  it.each(REFERENCES)(
    '[CL-TRV-10] names a case without $reference beside it',
    async ({ names }) => {
      const entry = db
        .insert(journalEntries)
        .values({ ...REFUSED_TRIGGER, caseId: PARENTS.caseId, ...names });

      await expect(entry).rejects.toMatchObject(
        violationOf('journal_entries_case_reference_check'),
      );
    },
  );

  it('[CL-TRV-10] [DSN-27] lets go of an erased event, case, request, import or player at once, and keeps its type', async () => {
    await db
      .insert(eventTypes)
      .values({ id: 'player-conflict', origin: 'scoping', name: 'Conflict between players' });
    await db
      .insert(journalEntries)
      .values([
        { ...REFUSED_TRIGGER, playerEventId: PARENTS.eventId },
        { ...REFUSED_TRIGGER, caseId: PARENTS.caseId },
        { ...REFUSED_TRIGGER, eventTypeId: 'player-conflict' },
        ...REFERENCES.map(({ names }) => ({ ...REFUSED_TRIGGER, ...names })),
      ]);
    const typeDeleted = db.delete(eventTypes).where(eq(eventTypes.id, 'player-conflict'));

    await db.delete(events).where(eq(events.id, PARENTS.eventId));
    await db.delete(cases).where(eq(cases.id, PARENTS.caseId));
    await db.delete(imports).where(eq(imports.id, PARENTS.importId));
    await db.delete(backtestRequests).where(eq(backtestRequests.id, PARENTS.requestId));
    await db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.playerId));

    await expect(typeDeleted).rejects.toMatchObject({
      cause: { code: '23001', constraint: 'journal_entries_event_type_id_event_types_id_fk' },
    });
    await expect(
      db
        .select({
          named: sql<number>`num_nonnulls(${journalEntries.playerEventId}, ${journalEntries.caseId}, ${journalEntries.playerId}, ${journalEntries.backtestRequestId}, ${journalEntries.importId})`,
        })
        .from(journalEntries)
        .orderBy(journalEntries.id),
    ).resolves.toStrictEqual(Array.from({ length: 7 }, () => ({ named: 0 })));
  });

  it('keeps an entry when its incident or its task run goes, and drops its technical details with it', async () => {
    await db.insert(incidents).values({ kind: 'task_not_run', causeKey: 'purge' });
    await db.insert(taskRuns).values({
      taskKey: 'purge',
      trigger: 'on_demand',
      dueAt: PURGE_DUE_AT,
    });
    await db.insert(journalEntries).values({ ...REFUSED_TRIGGER, incidentId: 1, taskRunId: 1 });
    await db
      .insert(journalTechnicalDetails)
      .values({ journalEntryId: 1, details: { status: 401 } });

    await db.delete(incidents).where(eq(incidents.id, 1));
    await db.delete(taskRuns).where(eq(taskRuns.id, 1));
    const kept = await db
      .select({ incident: journalEntries.incidentId, run: journalEntries.taskRunId })
      .from(journalEntries);
    const details = await db.select().from(journalTechnicalDetails);
    await db.delete(journalEntries).where(eq(journalEntries.id, 1));

    expect(kept).toStrictEqual([{ incident: null, run: null }]);
    expect(details).toStrictEqual([{ journalEntryId: 1, details: { status: 401 } }]);
    await expect(db.select().from(journalTechnicalDetails)).resolves.toStrictEqual([]);
  });
});

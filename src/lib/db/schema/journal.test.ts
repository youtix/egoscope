import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { createTestDatabase } from '../test-database';
import { incidents } from './incidents';
import { journalEntries, journalTechnicalDetails } from './journal';
import { taskRuns } from './scheduler';

import type { Database } from '../types';

// An entry's required fields: a refused trigger, as the next pass journals it.
const REFUSED_TRIGGER = {
  category: 'trigger_refused',
  level: 'warning',
  messageKey: 'trigger_refused',
} as const;
// A followed player's identifier, a random UUID (CL-JOU-09).
const PLAYER_ID = '5b0d2f8e-3c41-4f6a-9d7e-2a1c8b9e4f60';
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

  it.each([
    { reference: 'its player', names: { playerId: PLAYER_ID } },
    { reference: 'its type', names: { eventTypeId: 'birthday' } },
    { reference: 'its case', names: { caseId: 3 } },
    { reference: 'its request', names: { backtestRequestId: 4 } },
    { reference: 'its import', names: { importId: 5 } },
  ])(
    '[CL-TRV-10] names an event by that reference alone, never with $reference',
    async ({ names }) => {
      const entry = db
        .insert(journalEntries)
        .values({ ...REFUSED_TRIGGER, playerEventId: 12, ...names });

      await expect(entry).rejects.toMatchObject(
        violationOf('journal_entries_event_reference_check'),
      );
    },
  );

  it('[CL-TRV-10] names a case without its player or its type, which the display reads through it', async () => {
    await db.insert(journalEntries).values([
      { ...REFUSED_TRIGGER, playerEventId: 12, lot2ObjectKind: 'alert_sheet', lot2ObjectId: 3 },
      { ...REFUSED_TRIGGER, caseId: 3, backtestRequestId: 4, importId: 5 },
    ]);

    const withPlayer = db
      .insert(journalEntries)
      .values({ ...REFUSED_TRIGGER, caseId: 3, playerId: PLAYER_ID });
    const withType = db
      .insert(journalEntries)
      .values({ ...REFUSED_TRIGGER, caseId: 3, eventTypeId: 'birthday' });

    await expect(withPlayer).rejects.toMatchObject(
      violationOf('journal_entries_case_reference_check'),
    );
    await expect(withType).rejects.toMatchObject(
      violationOf('journal_entries_case_reference_check'),
    );
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

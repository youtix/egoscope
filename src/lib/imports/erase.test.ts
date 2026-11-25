import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  events,
  eventSources,
  importEventOutcomes,
  importPossibleDuplicates,
  imports,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { eraseEventData } from './erase';
import { eventTrace, history } from './queries';

import type { Database } from '@/lib/db';
import type { EventRow, ImportRow } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const DAY = 86_400_000;
const PLAYER = leaguePlayerId('p01');

describe('the import step of a withdrawal', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  /**
   * The traces of two imports of one player: the first, recovered from a cut result,
   * brought the withdrawn event, a sibling added with a warning and an existing event, and
   * refused one; the second matched the withdrawn and the existing event as duplicates,
   * attached a source to each, and recorded a third event that the owner judged distinct
   * from the withdrawn one.
   */
  type Traces = Readonly<{
    recovered: ImportRow;
    addition: ImportRow;
    withdrawn: EventRow;
    sibling: EventRow;
    existing: EventRow;
    distinct: EventRow;
  }>;

  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    await insertEventType(db);
    await insertPlayer(db);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** An import saved into a new request of the player, at `at`. */
  async function saveImport(at: number, columns: Partial<typeof imports.$inferInsert> = {}) {
    const saved = await insertImport(db, {
      request: await insertRequest(db, { playerId: PLAYER }),
    });
    const [updated] = await db
      .update(imports)
      .set({ importedAt: new Date(at), ...columns })
      .where(eq(imports.id, saved.id))
      .returning();
    return updated ?? saved;
  }

  /** A source of `playerEventId` at `position`, added by `addedByImportId`. */
  async function attachSource(playerEventId: number, position: number, addedByImportId: number) {
    const url = `https://news.example.com/story-${String(playerEventId)}-${String(position)}`;
    await db.insert(eventSources).values({
      playerEventId,
      position,
      url,
      cleanedUrl: url,
      publicationDateOn: '2024-11-20',
      addedByImportId,
    });
  }

  /** Writes the traces that the tests withdraw an event from. */
  async function writeTraces(): Promise<Traces> {
    const recovered = await saveImport(START, { truncationRecovered: true });
    const brought = async () =>
      insertHistoricalEvent(db, { playerId: PLAYER, originImportId: recovered.id });
    const withdrawn = await brought();
    const sibling = await brought();
    const existing = await brought();
    const addition = await saveImport(START + DAY, { mode: 'addition' });
    const distinct = await insertHistoricalEvent(db, {
      playerId: PLAYER,
      originImportId: addition.id,
    });
    for (const event of [withdrawn, sibling, existing]) {
      await attachSource(event.id, 1, recovered.id);
    }
    await attachSource(distinct.id, 1, addition.id);
    await attachSource(withdrawn.id, 2, addition.id);
    await attachSource(existing.id, 2, addition.id);
    await db.insert(importEventOutcomes).values([
      { importId: recovered.id, outcome: 'added', playerEventId: withdrawn.id },
      { importId: recovered.id, outcome: 'added_with_warning', playerEventId: sibling.id },
      { importId: recovered.id, outcome: 'added', playerEventId: existing.id },
      { importId: recovered.id, outcome: 'refused', position: 4, reason: 'no_valid_source' },
      { importId: addition.id, outcome: 'duplicate_not_added', playerEventId: withdrawn.id },
      { importId: addition.id, outcome: 'duplicate_not_added', playerEventId: existing.id },
      { importId: addition.id, outcome: 'added', playerEventId: distinct.id },
    ]);
    await db.insert(importPossibleDuplicates).values([
      {
        importId: recovered.id,
        resultPlayerEventId: withdrawn.id,
        existingPlayerEventId: existing.id,
        answer: 'keep_as_distinct',
      },
      { importId: addition.id, existingPlayerEventId: withdrawn.id, answer: 'same_fact' },
      { importId: addition.id, existingPlayerEventId: existing.id, answer: 'same_fact' },
      {
        importId: addition.id,
        resultPlayerEventId: distinct.id,
        existingPlayerEventId: withdrawn.id,
        answer: 'distinct_facts',
      },
    ]);
    return { recovered, addition, withdrawn, sibling, existing, distinct };
  }

  /** Withdraws `event` as the withdrawal does: this step, then the event's row, in one transaction. */
  async function withdraw(event: EventRow) {
    await db.transaction(async (tx) => {
      await eraseEventData(tx, event.id);
      await tx.delete(events).where(eq(events.id, event.id));
    });
  }

  it('[IMP-37] [DSN-27] leaves no outcome row and no possible-duplicate answer that designates the withdrawn event, on either side', async () => {
    const traces = await writeTraces();

    await withdraw(traces.withdrawn);

    await expect(
      db
        .select({
          importId: importEventOutcomes.importId,
          outcome: importEventOutcomes.outcome,
          playerEventId: importEventOutcomes.playerEventId,
        })
        .from(importEventOutcomes)
        .orderBy(asc(importEventOutcomes.id)),
    ).resolves.toStrictEqual([
      {
        importId: traces.recovered.id,
        outcome: 'added_with_warning',
        playerEventId: traces.sibling.id,
      },
      { importId: traces.recovered.id, outcome: 'added', playerEventId: traces.existing.id },
      { importId: traces.recovered.id, outcome: 'refused', playerEventId: null },
      {
        importId: traces.addition.id,
        outcome: 'duplicate_not_added',
        playerEventId: traces.existing.id,
      },
      { importId: traces.addition.id, outcome: 'added', playerEventId: traces.distinct.id },
    ]);
    await expect(
      db
        .select({
          importId: importPossibleDuplicates.importId,
          resultPlayerEventId: importPossibleDuplicates.resultPlayerEventId,
          existingPlayerEventId: importPossibleDuplicates.existingPlayerEventId,
          answer: importPossibleDuplicates.answer,
        })
        .from(importPossibleDuplicates),
    ).resolves.toStrictEqual([
      {
        importId: traces.addition.id,
        resultPlayerEventId: null,
        existingPlayerEventId: traces.existing.id,
        answer: 'same_fact',
      },
    ]);
  });

  it('[IMP-37] [DSN-27] shrinks the tallies and the events recovered with the withdrawn event, and no trace names it any more', async () => {
    const traces = await writeTraces();

    await withdraw(traces.withdrawn);

    await expect(history(db, PLAYER)).resolves.toMatchObject([
      {
        importId: traces.addition.id,
        tally: { added: 1, duplicatesNotAdded: 1, sourcesAttached: 1 },
        recoveredEventCount: null,
      },
      {
        importId: traces.recovered.id,
        tally: { added: 2, addedWithWarning: 1, refused: 1 },
        recoveredEventCount: 3,
      },
    ]);
    await expect(eventTrace(db, traces.withdrawn.id)).resolves.toBeNull();
    await expect(eventTrace(db, traces.existing.id)).resolves.toMatchObject({
      originImportNumber: traces.recovered.sequenceNumber,
      sourceImportNumbers: [traces.addition.sequenceNumber],
    });
  });

  it('[IMP-37] counts the withdrawn event in every trace until it is withdrawn', async () => {
    const traces = await writeTraces();

    await expect(history(db, PLAYER)).resolves.toMatchObject([
      {
        importId: traces.addition.id,
        tally: { added: 1, duplicatesNotAdded: 2, sourcesAttached: 2 },
      },
      {
        importId: traces.recovered.id,
        tally: { added: 3, addedWithWarning: 1, refused: 1 },
        recoveredEventCount: 4,
      },
    ]);
  });

  it('[IMP-37] runs inside the withdrawal’s transaction, so that a withdrawal rolled back keeps every trace', async () => {
    const traces = await writeTraces();

    await expect(
      db.transaction(async (tx) => {
        await eraseEventData(tx, traces.withdrawn.id);
        tx.rollback();
      }),
    ).rejects.toThrow('Rollback');

    await expect(db.$count(importEventOutcomes)).resolves.toBe(7);
    await expect(db.$count(importPossibleDuplicates)).resolves.toBe(4);
  });
});

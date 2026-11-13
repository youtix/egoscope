import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '../test-database';
import { installation, sequenceCounters } from './db';

import type { Database } from '../types';

const GO_LIVE = new Date('2026-11-13T08:30:00.000Z');

/** The check violation that a failed query reports, with the check's name. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the tables of the db module', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  });

  it('records the first start as an absolute instant and reads it back unchanged', async () => {
    await db.insert(installation).values({ id: 1, firstStartedAt: GO_LIVE });

    await expect(db.select().from(installation)).resolves.toStrictEqual([
      { id: 1, firstStartedAt: GO_LIVE },
    ]);
  });

  it('keeps the installation to its single row, id 1', async () => {
    const second = db.insert(installation).values({ id: 2, firstStartedAt: GO_LIVE });

    await expect(second).rejects.toMatchObject(violationOf('installation_id_check'));
  });

  it('starts a counter at 0 and never lets it fall below 0', async () => {
    await db.insert(sequenceCounters).values({ name: 'request_reference_2026' });

    const created = await db.select().from(sequenceCounters);
    const below = db
      .update(sequenceCounters)
      .set({ lastValue: -1 })
      .where(eq(sequenceCounters.name, 'request_reference_2026'));

    expect(created).toStrictEqual([{ name: 'request_reference_2026', lastValue: 0 }]);
    await expect(below).rejects.toMatchObject(violationOf('sequence_counters_last_value_check'));
  });

  it('increments a counter in the transaction that uses the number', async () => {
    await db.insert(sequenceCounters).values({ name: 'import_sequence' });

    const issued = await db.transaction(async (tx) =>
      tx
        .update(sequenceCounters)
        .set({ lastValue: sql`${sequenceCounters.lastValue} + 1` })
        .where(eq(sequenceCounters.name, 'import_sequence'))
        .returning({ number: sequenceCounters.lastValue }),
    );

    expect(issued).toStrictEqual([{ number: 1 }]);
  });

  it('leaves no trace of a failed transaction', async () => {
    await db.insert(sequenceCounters).values({ name: 'import_sequence', lastValue: 4 });

    const failed = db.transaction(async (tx) => {
      await tx.insert(installation).values({ id: 1, firstStartedAt: GO_LIVE });
      await tx
        .update(sequenceCounters)
        .set({ lastValue: 5 })
        .where(eq(sequenceCounters.name, 'import_sequence'));
      throw new Error('The import failed after drawing its number.');
    });

    await expect(failed).rejects.toThrow('The import failed after drawing its number.');
    await expect(db.select().from(installation)).resolves.toStrictEqual([]);
    await expect(db.select().from(sequenceCounters)).resolves.toStrictEqual([
      { name: 'import_sequence', lastValue: 4 },
    ]);
  });
});

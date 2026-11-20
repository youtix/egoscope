import { TransactionRollbackError } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { sequenceCounters } from './schema';
import { nextValue } from './sequence';
import { createTestDatabase } from './test-database';

import type { SequenceName } from './sequence';
import type { Database } from './types';

describe('nextValue', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  /** Draws the next number of `name` in a transaction of its own, which commits. */
  async function drawCommitted(name: SequenceName): Promise<number> {
    return db.transaction(async (tx) => nextValue(tx, name));
  }

  it('[IMP-31] [CL-BKT-11] issues 1, 2, 3 to the transactions that draw them, one counter per name', async () => {
    const drawn = [
      await drawCommitted('import_sequence'),
      await drawCommitted('import_sequence'),
      await drawCommitted('request_reference_2026'),
      await drawCommitted('import_sequence'),
      await drawCommitted('request_reference_2027'),
    ];

    expect(drawn).toStrictEqual([1, 2, 1, 3, 1]);
    await expect(
      db.select().from(sequenceCounters).orderBy(sequenceCounters.name),
    ).resolves.toStrictEqual([
      { name: 'import_sequence', lastValue: 3 },
      { name: 'request_reference_2026', lastValue: 1 },
      { name: 'request_reference_2027', lastValue: 1 },
    ]);
  });

  it('[IMP-31] [CL-BKT-11] leaves no gap when the transaction that drew a number rolls back', async () => {
    await drawCommitted('import_sequence');
    const rolledBack = db.transaction(async (tx) => {
      await nextValue(tx, 'import_sequence');
      tx.rollback();
    });

    await expect(rolledBack).rejects.toBeInstanceOf(TransactionRollbackError);
    await expect(drawCommitted('import_sequence')).resolves.toBe(2);
  });

  it('[BKT-12] [CL-BKT-11] never issues a number twice, within one transaction or across transactions', async () => {
    const drawn = await db.transaction(async (tx) => [
      await nextValue(tx, 'request_reference_2026'),
      await nextValue(tx, 'request_reference_2026'),
    ]);

    expect([...drawn, await drawCommitted('request_reference_2026')]).toStrictEqual([1, 2, 3]);
  });
});

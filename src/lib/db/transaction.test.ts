import { beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok } from '@/lib/result';

import { getDb } from './database';
import { sequenceCounters } from './schema';
import { createTestDatabase } from './test-database';
import { transaction } from './transaction';

import type { Transaction } from './transaction';
import type { Database } from './types';

// The database that getDb() gives transaction(): each test's own.
vi.mock(import('./database'), () => ({ getDb: vi.fn() }));

const REFUSAL = { kind: 'out_of_bounds' } as const;

/** Writes one counter in `tx`, as a service's own write. */
async function writeCounter(tx: Transaction, name: 'import_sequence' | 'request_reference_2026') {
  await tx.insert(sequenceCounters).values({ name, lastValue: 1 });
}

/** The names of the counters that `reader` sees: the committed ones, or those of its transaction. */
async function committedCounters(reader: Database | Transaction): Promise<readonly string[]> {
  const rows = await reader
    .select({ name: sequenceCounters.name })
    .from(sequenceCounters)
    .orderBy(sequenceCounters.name);
  return rows.map((row) => row.name);
}

describe('transaction', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    vi.mocked(getDb).mockResolvedValue({ ok: true, db });
    return database.close;
  }, 60_000);

  it('commits the writes of work that succeeds, and returns its value', async () => {
    const result = await transaction(async (tx) => {
      await writeCounter(tx, 'import_sequence');
      return ok('saved');
    });

    expect(result).toStrictEqual({ ok: true, value: 'saved' });
    await expect(committedCounters(db)).resolves.toStrictEqual(['import_sequence']);
  });

  it('rolls back the writes of work that fails, and returns its failure', async () => {
    const result = await transaction(async (tx) => {
      await writeCounter(tx, 'import_sequence');
      return err(REFUSAL);
    });

    expect(result).toStrictEqual({ ok: false, error: REFUSAL });
    await expect(committedCounters(db)).resolves.toStrictEqual([]);
  });

  it('lets a nested service call join the outer transaction, on one driver transaction opened without session settings', async () => {
    const driverTransaction = vi.spyOn(db, 'transaction');

    const result = await transaction(async (tx) => {
      await writeCounter(tx, 'import_sequence');
      const inner = await transaction(async (innerTx) => {
        await writeCounter(innerTx, 'request_reference_2026');
        return ok(await committedCounters(innerTx));
      });
      return inner;
    });

    expect(result).toStrictEqual({
      ok: true,
      value: ['import_sequence', 'request_reference_2026'],
    });
    expect(driverTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    await expect(committedCounters(db)).resolves.toStrictEqual([
      'import_sequence',
      'request_reference_2026',
    ]);
  });

  it('rolls back the outer writes and the nested ones when the nested call fails', async () => {
    const result = await transaction(async (tx) => {
      await writeCounter(tx, 'import_sequence');
      const inner = await transaction(async (innerTx) => {
        await writeCounter(innerTx, 'request_reference_2026');
        return err(REFUSAL);
      });
      return inner.ok ? ok('saved') : inner;
    });

    expect(result).toStrictEqual({ ok: false, error: REFUSAL });
    await expect(committedCounters(db)).resolves.toStrictEqual([]);
  });

  it('rolls back everything, as a bug, when the work goes on as if a nested failure had succeeded', async () => {
    const outcome = transaction(async (tx) => {
      await writeCounter(tx, 'import_sequence');
      await transaction(async (innerTx) => {
        await writeCounter(innerTx, 'request_reference_2026');
        return err(REFUSAL);
      });
      return ok('saved');
    });

    await expect(outcome).rejects.toThrow(
      'A call nested in this transaction failed, and the work around it went on as if it had succeeded: return that failure instead.',
    );
    await expect(committedCounters(db)).resolves.toStrictEqual([]);
  });

  it('rolls back everything and throws again when the work throws', async () => {
    const outcome = transaction(async (tx) => {
      await writeCounter(tx, 'import_sequence');
      await writeCounter(tx, 'import_sequence');
      return ok('saved');
    });

    await expect(outcome).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(committedCounters(db)).resolves.toStrictEqual([]);
  });

  it('runs nothing and says so when no database is configured', async () => {
    vi.mocked(getDb).mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });
    const work = vi.fn(async (tx: Transaction) => {
      await writeCounter(tx, 'import_sequence');
      return ok('saved');
    });

    await expect(transaction(work)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
    expect(work).not.toHaveBeenCalled();
  });
});

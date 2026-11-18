import { describe, expect, it, onTestFinished } from 'vitest';

import { installation, sequenceCounters } from './schema';
import { createTestDatabase } from './test-database';

import type { TestDatabase } from './test-database';

/** A test database, closed when the test ends. */
async function openTestDatabase(): Promise<TestDatabase> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  return database;
}

describe('createTestDatabase', { timeout: 60_000 }, () => {
  it('[TRV-76] gives a database with every migration applied and no rows', async () => {
    const { db } = await openTestDatabase();

    const rows = await Promise.all([
      db.select().from(installation),
      db.select().from(sequenceCounters),
    ]);

    expect(rows).toStrictEqual([[], []]);
  });

  it('gives each caller a database of its own, which no write of another reaches', async () => {
    const first = await openTestDatabase();
    await first.db.insert(sequenceCounters).values({ name: 'import_sequence', lastValue: 7 });

    const second = await openTestDatabase();

    await expect(first.db.select().from(sequenceCounters)).resolves.toStrictEqual([
      { name: 'import_sequence', lastValue: 7 },
    ]);
    await expect(second.db.select().from(sequenceCounters)).resolves.toStrictEqual([]);
  });

  it('closes the database, which then answers no query', async () => {
    const { db, close } = await createTestDatabase();

    await close();

    await expect(db.select().from(installation)).rejects.toMatchObject({
      cause: { message: 'PGlite is closed' },
    });
  });
});

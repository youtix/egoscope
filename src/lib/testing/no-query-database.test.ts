import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { followedPlayers, installation } from '@/lib/db';

import { noQueryDatabase } from './no-query-database';

import type { Database } from '@/lib/db';

const REFUSED = /^The database was queried where no query may run: /v;
const PLAYER = '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f01';

describe('the no-query database', () => {
  it('starts with no attempt', () => {
    expect(noQueryDatabase().attempts()).toStrictEqual([]);
  });

  it.each([
    ['a select', (db: Database) => db.select().from(installation)],
    [
      'an insert',
      (db: Database) =>
        db
          .insert(followedPlayers)
          .values({ displayName: 'Ansel Varga', displayNameNormalized: 'ansel varga' }),
    ],
    [
      'an update',
      (db: Database) =>
        db
          .update(followedPlayers)
          .set({ displayName: 'Ilias Brenner' })
          .where(eq(followedPlayers.id, PLAYER)),
    ],
    [
      'a delete',
      (db: Database) => db.delete(followedPlayers).where(eq(followedPlayers.id, PLAYER)),
    ],
    ['a raw statement', (db: Database) => db.execute(sql`select 1`)],
  ])('fails %s, and records its statement', async (_query, run) => {
    const database = noQueryDatabase();

    await expect(run(database.db)).rejects.toThrow(REFUSED);
    expect(database.attempts()).toHaveLength(1);
    expect(database.attempts()[0]).toMatch(/^(?:select|insert|update|delete) /iv);
  });

  it('fails a transaction at its first statement', async () => {
    const database = noQueryDatabase();

    await expect(
      database.db.transaction(async (tx) => tx.select().from(installation)),
    ).rejects.toThrow(REFUSED);
    expect(database.attempts().length).toBeGreaterThan(0);
  });

  it('fails a relational query as soon as it is reached', () => {
    const database = noQueryDatabase();

    expect(() => database.db.query).toThrow(
      'The database was queried where no query may run: a relational query',
    );
    expect(database.attempts()).toStrictEqual(['a relational query']);
  });

  it('gives each database its own attempts, and a copy of them', async () => {
    const first = noQueryDatabase();
    const second = noQueryDatabase();
    await expect(first.db.select().from(installation)).rejects.toThrow(REFUSED);
    const seen = first.attempts();

    expect(second.attempts()).toStrictEqual([]);
    expect(seen).not.toBe(first.attempts());
    expect(seen).toStrictEqual(first.attempts());
  });
});

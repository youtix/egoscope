import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, incidents } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import { todoCount } from '@/lib/todo';

import { DATABASE_TEST_TIMEOUT_MS } from './timeouts';
import { closeTodoItem, openTodoItem } from './to-do';

import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 26, 9));

describe('the to-do items of the end-to-end tests', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(installFakeClock(fixedClock(AT)));
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  /** The incidents, by cause, with their status. */
  const incidentRows = async () =>
    db
      .select({ kind: incidents.kind, cause: incidents.causeKey, status: incidents.status })
      .from(incidents)
      .orderBy(asc(incidents.id));

  it('[IHM-16] [IHM-20] opens one item per name, each a failed backup, and answers the count', async () => {
    await expect(todoCount(db)).resolves.toBe(0);

    await expect(openTodoItem(db, 'desktop')).resolves.toBe(1);
    await expect(openTodoItem(db, 'desktop')).resolves.toBe(1);
    await expect(openTodoItem(db, 'phone')).resolves.toBe(2);

    await expect(incidentRows()).resolves.toStrictEqual([
      { kind: 'backup_failed', cause: 'desktop', status: 'open' },
      { kind: 'backup_failed', cause: 'phone', status: 'open' },
    ]);
  });

  it('[IHM-16] [IHM-20] closes the item of a name, leaves the others, and answers the count', async () => {
    await openTodoItem(db, 'desktop');
    await openTodoItem(db, 'phone');

    await expect(closeTodoItem(db, 'desktop')).resolves.toBe(1);
    await expect(closeTodoItem(db, 'desktop')).resolves.toBe(1);
    await expect(closeTodoItem(db, 'a name nobody opened')).resolves.toBe(1);

    await expect(incidentRows()).resolves.toStrictEqual([
      { kind: 'backup_failed', cause: 'desktop', status: 'closed' },
      { kind: 'backup_failed', cause: 'phone', status: 'open' },
    ]);
  });
});

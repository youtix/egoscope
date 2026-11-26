import { close, open } from '@/lib/incidents';
import { todoCount } from '@/lib/todo';

import type { Database } from '@/lib/db';

/** The incident that stands for the to-do item `name`: a failed backup, whose cause is the name. */
const itemOf = (name: string) => ({ kind: 'backup_failed', cause: name }) as const;

/**
 * Opens the to-do item `name`, for the hermetic end-to-end control `/api/test/to-do`: an
 * open `backup_failed` incident whose cause is `name`, so that each name is an item of its
 * own and opening it twice changes nothing (TRV-45). Answers the number of items to do that
 * the navigation bar now shows (IHM-16, IHM-20).
 */
export async function openTodoItem(db: Database, name: string): Promise<number> {
  await db.transaction(async (tx) => open(tx, itemOf(name)));
  return todoCount(db);
}

/**
 * Closes the to-do item `name` that `openTodoItem` opened, if it is open, and answers the
 * number of items to do that the navigation bar now shows (IHM-16, IHM-20).
 */
export async function closeTodoItem(db: Database, name: string): Promise<number> {
  await db.transaction(async (tx) => close(tx, itemOf(name)));
  return todoCount(db);
}

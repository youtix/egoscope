import { unstable_rethrow } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { NavigationBar, navigationEntries, paths } from '@/lib/navigation';
import { recordDatabaseActivity } from '@/lib/quotas';
import { todoCount } from '@/lib/todo';

import type { ReactNode } from 'react';

/**
 * The number of items to do, for an open session only, once the minute's database activity
 * is recorded for the compute estimate (TRV-03), through the connection that the session
 * check already woke. Without an open session there is no count: the screen itself sends
 * the device to the login page, with its own path to come back to (IHM-10), which a layout
 * does not know, so the path given here is never followed.
 */
async function signedInTodoCount(): Promise<number | null> {
  const session = await requireSession(paths.home());
  if (!session.ok) {
    return null;
  }
  const database = await getDb();
  if (!database.ok) {
    return null;
  }
  await recordDatabaseActivity(database.db);
  return todoCount(database.db);
}

/**
 * The count, or none when the database fails while it is read: the count is only a badge,
 * so the bar stays and the screen below it answers for itself, with the error screen of the
 * group when the server fails it (IHM-16, edge case « Erreur du serveur »). The errors
 * through which Next.js controls the request go on to it.
 */
async function countOrNone(): Promise<number | null> {
  try {
    return await signedInTodoCount();
  } catch (error) {
    unstable_rethrow(error);
    logger.error(
      'The navigation bar is shown without the number of items to do, which could not be read.',
      { error },
    );
    return null;
  }
}

/**
 * The navigation bar of a signed-in owner, whose Home entry carries the number of items to
 * do (IHM-16, IHM-20); the bar alone, without a count, for any other request and when the
 * database fails while the count is read.
 */
export async function SignedInNavigation(): Promise<ReactNode> {
  return <NavigationBar entries={navigationEntries()} todoCount={await countOrNone()} />;
}
